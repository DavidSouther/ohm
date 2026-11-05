import type {Analysis, LanguageService, Offset, Severity} from '@ohm-js/language';
import type {Readable, Writable} from 'node:stream';
import {
  createMessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
} from 'vscode-jsonrpc/node.js';

import {lineIndex, toOffset, toRange} from './positions.ts';
import type {LineIndex, Position} from './positions.ts';

export interface ServeIo {
  input: Readable;
  output: Writable;
}

const SEVERITY: Record<Severity, number> = {error: 1, warning: 2, information: 3, hint: 4};

/** LSP SymbolKind for common declaration kinds; anything else is a Variable. */
const SYMBOL_KIND: Record<string, number> = {
  class: 5,
  method: 6,
  field: 8,
  constructor: 9,
  function: 12,
  variable: 13,
  constant: 14,
};
const VARIABLE = 13;

const TEXT_DOCUMENT_SYNC_FULL = 1;
const LOG_ERROR = 1;

function record(x: unknown, what: string): Record<string, unknown> {
  if (typeof x !== 'object' || x === null)
    throw new TypeError(`Expected ${what} to be an object`);
  return x as Record<string, unknown>;
}

function field<T>(o: Record<string, unknown>, key: string, type: string): T {
  if (typeof o[key] !== type) throw new TypeError(`Expected '${key}' to be a ${type}`);
  return o[key] as T;
}

const uriOf = (params: unknown): string =>
  field(record(record(params, 'params').textDocument, 'textDocument'), 'uri', 'string');

function positionOf(params: unknown): Position {
  const p = record(record(params, 'params').position, 'position');
  return {line: field(p, 'line', 'number'), character: field(p, 'character', 'number')};
}

/** The full text of the last content change, since the server only advertises full sync. */
function lastText(params: unknown): string {
  const changes = record(params, 'params').contentChanges;
  if (!Array.isArray(changes) || changes.length === 0) {
    throw new TypeError("Expected 'contentChanges' to be a non-empty array");
  }
  return field(record(changes[changes.length - 1], 'content change'), 'text', 'string');
}

/**
 * Serves `service` as a language server over a JSON-RPC stream pair. Positions
 * are converted to and from offsets here, so LSP shapes never reach the
 * service. A request whose handler throws answers empty and is logged.
 */
export function serve(service: LanguageService, {input, output}: ServeIo): {dispose(): void} {
  const c = createMessageConnection(
    new StreamMessageReader(input),
    new StreamMessageWriter(output)
  );
  const indexes = new WeakMap<Analysis, LineIndex>();
  const indexOf = (a: Analysis): LineIndex => {
    let index = indexes.get(a);
    if (!index) indexes.set(a, (index = lineIndex(a.text)));
    return index;
  };

  const log = (message: string) =>
    void c.sendNotification('window/logMessage', {type: LOG_ERROR, message});
  const failed = (method: string, e: unknown) =>
    log(`${method} failed: ${e instanceof Error ? e.message : String(e)}`);

  const request = <R>(method: string, empty: R, handler: (params: unknown) => R) =>
    c.onRequest(method, (params: unknown) => {
      try {
        return handler(params);
      } catch (e) {
        failed(method, e);
        return empty;
      }
    });
  const notification = (method: string, handler: (params: unknown) => void) =>
    c.onNotification(method, (params: unknown) => {
      try {
        handler(params);
      } catch (e) {
        failed(method, e);
      }
    });

  /** The document's analysis, its line index, and the offset of the request's position. */
  const locate = (
    params: unknown
  ): {a: Analysis; index: LineIndex; at: Offset} | undefined => {
    const a = service.analysis(uriOf(params))?.analysis;
    if (!a) return undefined;
    const index = indexOf(a);
    return {a, index, at: toOffset(index, positionOf(params))};
  };

  const publish = (a: Analysis) => {
    const index = indexOf(a);
    void c.sendNotification('textDocument/publishDiagnostics', {
      uri: a.uri,
      version: a.version,
      diagnostics: a.diagnostics.map(d => ({
        range: toRange(index, d.span),
        severity: SEVERITY[d.severity],
        code: d.code,
        source: 'ohm',
        message: d.message,
      })),
    });
  };

  const capabilities = {
    textDocumentSync: TEXT_DOCUMENT_SYNC_FULL,
    documentSymbolProvider: true,
    definitionProvider: true,
    referencesProvider: true,
    renameProvider: true,
    completionProvider: {},
  };
  request('initialize', {capabilities}, () => ({capabilities}));
  notification('initialized', () => {});
  request('shutdown', null, () => null);
  notification('exit', () => c.dispose());

  notification('textDocument/didOpen', params => {
    const doc = record(record(params, 'params').textDocument, 'textDocument');
    publish(
      service.open(
        field(doc, 'uri', 'string'),
        field(doc, 'version', 'number'),
        field(doc, 'text', 'string')
      )
    );
  });
  notification('textDocument/didChange', params => {
    const doc = record(record(params, 'params').textDocument, 'textDocument');
    publish(
      service.change(
        field(doc, 'uri', 'string'),
        field(doc, 'version', 'number'),
        lastText(params)
      )
    );
  });
  notification('textDocument/didClose', params => {
    const uri = uriOf(params);
    service.close(uri);
    void c.sendNotification('textDocument/publishDiagnostics', {uri, diagnostics: []});
  });

  request('textDocument/documentSymbol', [], params => {
    const a = service.analysis(uriOf(params))?.analysis;
    if (!a) return [];
    const index = indexOf(a);
    return service.documentSymbols(a.uri).map(s => {
      const range = toRange(index, s.nameSpan);
      return {
        name: s.name,
        detail: s.kind,
        kind: SYMBOL_KIND[s.kind] ?? VARIABLE,
        range,
        selectionRange: range,
      };
    });
  });
  request('textDocument/definition', [], params => {
    const found = locate(params);
    if (!found) return [];
    const {a, index, at} = found;
    return service
      .definition(a.uri, at)
      .map(s => ({uri: s.uri, range: toRange(index, s.nameSpan)}));
  });
  request('textDocument/references', [], params => {
    const found = locate(params);
    if (!found) return [];
    const {a, index, at} = found;
    const context = record(record(params, 'params').context ?? {}, 'context');
    return service
      .references(a.uri, at, context.includeDeclaration === true)
      .map(span => ({uri: a.uri, range: toRange(index, span)}));
  });
  request('textDocument/rename', null, params => {
    const found = locate(params);
    if (!found) return null;
    const {a, index, at} = found;
    const edits = service.rename(
      a.uri,
      at,
      field(record(params, 'params'), 'newName', 'string')
    );
    if (edits.length === 0) return null;
    const changes: Record<string, {range: ReturnType<typeof toRange>; newText: string}[]> = {};
    for (const e of edits) {
      (changes[e.uri] ??= []).push({range: toRange(index, e.span), newText: e.newText});
    }
    return {changes};
  });
  request('textDocument/completion', [], params => {
    const found = locate(params);
    if (!found) return [];
    return service
      .completion(found.a.uri, found.at)
      .map(s => ({label: s.name, detail: s.kind}));
  });

  c.listen();
  return {dispose: () => c.dispose()};
}
