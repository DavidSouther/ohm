export {diskVfs} from './disk.ts';
import type {Analysis, Definition, LanguageService, Offset, Severity} from '@ohm-js/language';
import type {Readable, Writable} from 'node:stream';
import {
  createMessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
} from 'vscode-jsonrpc/node.js';

import {lineIndex, toOffset, toRange} from './positions.ts';
import type {LineIndex, Position, Range} from './positions.ts';

export interface ServeIo {
  input: Readable;
  output: Writable;
}

export interface ServeOptions {
  /** Quiet time before documents that depend on an edited one are reanalyzed. Default 100. */
  debounceMs?: number;
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

interface DocumentSymbolNode {
  name: string;
  detail: string;
  kind: number;
  range: Range;
  selectionRange: Range;
  children: DocumentSymbolNode[];
}

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

const textDocumentOf = (params: unknown) =>
  record(record(params, 'params').textDocument, 'textDocument');

const uriOf = (params: unknown): string => field(textDocumentOf(params), 'uri', 'string');

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
export function serve(
  service: LanguageService,
  {input, output}: ServeIo,
  {debounceMs = 100}: ServeOptions = {}
): {dispose(): void} {
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

  /** The line index of any known document, which a location in another file needs. */
  const indexForUri = (uri: string): LineIndex | undefined => {
    const a = service.analysis(uri)?.analysis;
    return a && indexOf(a);
  };

  /** The document's analysis, its line index, and the offset of the request's position. */
  const locate = (
    params: unknown
  ): {a: Analysis; index: LineIndex; at: Offset} | undefined => {
    const a = service.analysis(uriOf(params))?.analysis;
    if (!a) return undefined;
    const index = indexOf(a);
    return {a, index, at: toOffset(index, positionOf(params))};
  };

  const open = new Set<string>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  let disposed = false;

  const refreshDependents = async (uri: string) => {
    for (const other of service.affected(uri)) {
      const a = await service.refresh(other);
      if (!disposed && a && open.has(other)) publish(a);
    }
  };

  /** Reanalyzes documents that depend on `uri` once typing pauses, publishing the open ones. */
  const scheduleDependents = (uri: string) => {
    clearTimeout(timers.get(uri));
    timers.set(
      uri,
      setTimeout(() => {
        timers.delete(uri);
        refreshDependents(uri).catch(e => failed('dependents', e));
      }, debounceMs)
    );
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
    renameProvider: {prepareProvider: true},
    completionProvider: {},
  };
  request('initialize', {capabilities}, () => ({capabilities}));
  /** Loads the workspace's files, publishing each open document as it is reanalyzed. */
  const scanWorkspace = async () => {
    for await (const uri of service.scan()) {
      if (disposed) return;
      const found = service.analysis(uri);
      if (found && open.has(uri)) publish(found.analysis);
    }
  };
  notification('initialized', () => void scanWorkspace().catch(e => failed('scan', e)));
  notification('workspace/didChangeWatchedFiles', params => {
    const changes = record(params, 'params').changes;
    if (!Array.isArray(changes)) throw new TypeError("Expected 'changes' to be an array");
    const uris = changes
      .map(change => field<string>(record(change, 'change'), 'uri', 'string'))
      .filter(uri => !open.has(uri));
    void (async () => {
      for (const uri of uris) {
        await service.refresh(uri);
        scheduleDependents(uri);
      }
    })().catch(e => failed('didChangeWatchedFiles', e));
  });
  request('shutdown', null, () => null);
  notification('exit', () => {
    disposed = true;
    for (const timer of timers.values()) clearTimeout(timer);
    c.dispose();
  });

  notification('textDocument/didOpen', params => {
    const doc = textDocumentOf(params);
    const uri = field<string>(doc, 'uri', 'string');
    open.add(uri);
    publish(service.open(uri, field(doc, 'version', 'number'), field(doc, 'text', 'string')));
    scheduleDependents(uri);
  });
  notification('textDocument/didChange', params => {
    const doc = textDocumentOf(params);
    const uri = field<string>(doc, 'uri', 'string');
    publish(service.change(uri, field(doc, 'version', 'number'), lastText(params)));
    scheduleDependents(uri);
  });
  notification('textDocument/didClose', params => {
    const uri = uriOf(params);
    open.delete(uri);
    void service
      .close(uri)
      .then(() => scheduleDependents(uri))
      .catch(e => failed('didClose', e));
    void c.sendNotification('textDocument/publishDiagnostics', {uri, diagnostics: []});
  });

  request('textDocument/documentSymbol', [], params => {
    const found = service.analysis(uriOf(params));
    if (!found || found.stale) return [];
    const a = found.analysis;
    const index = indexOf(a);
    const defs = service.documentSymbols(a.uri);
    const outline = (d: Definition): DocumentSymbolNode => {
      const selectionRange = toRange(index, d.nameSpan);
      const children =
        d.members && d.members !== d.scope ? defs.filter(c => c.scope === d.members) : [];
      return {
        name: d.name,
        detail: d.kind,
        kind: SYMBOL_KIND[d.kind] ?? VARIABLE,
        range: d.span ? toRange(index, d.span) : selectionRange,
        selectionRange,
        children: children.filter(c => c !== d).map(outline),
      };
    };
    const nested = new Set(
      defs
        .filter(d => d.members && d.members !== d.scope)
        .flatMap(d => defs.filter(c => c.scope === d.members))
    );
    return defs.filter(d => !nested.has(d)).map(outline);
  });
  request('textDocument/prepareRename', null, params => {
    const found = locate(params);
    const prepared = found && service.prepareRename(found.a.uri, found.at);
    return prepared
      ? {range: toRange(found.index, prepared.span), placeholder: prepared.placeholder}
      : null;
  });
  request('textDocument/definition', [], params => {
    const found = locate(params);
    if (!found) return [];
    const {a, at} = found;
    return service.definition(a.uri, at).flatMap(s => {
      const index = indexForUri(s.uri);
      return index ? [{uri: s.uri, range: toRange(index, s.nameSpan)}] : [];
    });
  });
  request('textDocument/references', [], params => {
    const found = locate(params);
    if (!found) return [];
    const {a, at} = found;
    const context = record(record(params, 'params').context ?? {}, 'context');
    return service.references(a.uri, at, context.includeDeclaration === true).flatMap(l => {
      const index = indexForUri(l.uri);
      return index ? [{uri: l.uri, range: toRange(index, l.span)}] : [];
    });
  });
  request('textDocument/rename', null, params => {
    const found = locate(params);
    if (!found) return null;
    const {a, at} = found;
    const edits = service.rename(
      a.uri,
      at,
      field(record(params, 'params'), 'newName', 'string')
    );
    if (edits.length === 0) return null;
    const changes: Record<string, {range: Range; newText: string}[]> = {};
    for (const e of edits) {
      const index = indexForUri(e.uri);
      if (index)
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
  return {
    dispose() {
      disposed = true;
      for (const timer of timers.values()) clearTimeout(timer);
      c.dispose();
    },
  };
}
