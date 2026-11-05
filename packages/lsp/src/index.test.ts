import test from 'ava';
import {offset} from '@ohm-js/language';
import type {Analysis, LanguageService, Span, Definition} from '@ohm-js/language';
import {PassThrough} from 'node:stream';
import {
  createMessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
} from 'vscode-jsonrpc/node.js';

import {serve} from './index.ts';

const uri = 'file:///x.calc';
const span = (start: number, end: number): Span => ({start: offset(start), end: offset(end)});

function analysis(uri: string, version: number, text: string, hasTree = true): Analysis {
  const root = {children: [], symbols: [], span: span(0, text.length)};
  return {
    uri,
    version,
    text,
    hasTree,
    root,
    symbols: [],
    references: [],
    diagnostics: text.includes('?')
      ? [{span: span(2, 3), severity: 'hint', code: 'x', message: 'question'}]
      : [],
    hasSkippedInput: false,
  };
}

/** A fake service over one document that records calls and answers fixed spans. */
function fakeService(overrides: Partial<LanguageService> = {}) {
  const texts = new Map<string, Analysis>();
  const calls: string[] = [];
  const sym = (name: string, at: number): Definition => ({
    name,
    kind: 'variable',
    nameSpan: span(at, at + name.length),
    uri,
    scope: {children: [], symbols: [], span: span(0, 0)},
    implicit: false,
    private: false,
    visibleFrom: offset(0),
  });
  const service: LanguageService = {
    open(uri, version, text) {
      calls.push(`open ${version}`);
      const a = analysis(uri, version, text);
      texts.set(uri, a);
      return a;
    },
    change(uri, version, text) {
      calls.push(`change ${version} ${JSON.stringify(text)}`);
      const a = analysis(uri, version, text);
      texts.set(uri, a);
      return a;
    },
    close(uri) {
      calls.push('close');
      texts.delete(uri);
    },
    analysis(uri) {
      const a = texts.get(uri);
      return a && {analysis: a, stale: false};
    },
    documentSymbols: () => [sym('a', 0), sym('bb', 4)],
    definition: (_uri, at) => (at === 10 ? [sym('a', 0)] : []),
    references: () => [span(0, 1), span(6, 7)],
    rename: (uri, _at, newText) => [{uri, span: span(6, 7), newText}],
    completion: () => [sym('a', 0)],
    ...overrides,
  };
  return {service, calls};
}

async function connect(service: LanguageService) {
  const toServer = new PassThrough();
  const toClient = new PassThrough();
  const server = serve(service, {input: toServer, output: toClient});
  const client = createMessageConnection(
    new StreamMessageReader(toClient),
    new StreamMessageWriter(toServer)
  );
  const published = new Map<number, unknown[]>();
  const waiters = new Map<number, (d: unknown[]) => void>();
  client.onNotification(
    'textDocument/publishDiagnostics',
    (p: {version: number; diagnostics: unknown[]}) => {
      published.set(p.version, p.diagnostics);
      waiters.get(p.version)?.(p.diagnostics);
    }
  );
  const logs: string[] = [];
  client.onNotification('window/logMessage', (p: {message: string}) => logs.push(p.message));
  client.listen();
  const publish = (version: number) =>
    published.has(version)
      ? Promise.resolve(published.get(version)!)
      : new Promise<unknown[]>(res => waiters.set(version, res));
  const init = (await client.sendRequest('initialize', {
    processId: null,
    rootUri: null,
    capabilities: {},
  })) as {capabilities: Record<string, unknown>};
  const dispose = () => {
    client.dispose();
    server.dispose();
  };
  return {client, publish, init, logs, dispose};
}

const textDocument = {uri};
const open = (text: string, version = 1) => ({
  textDocument: {uri, languageId: 'x', version, text},
});

test('serve is exported', t => {
  t.is(typeof serve, 'function');
});

test('initialize advertises capabilities and didOpen publishes diagnostics with version', async t => {
  const {client, publish, init, dispose} = await connect(fakeService().service);

  client.sendNotification('textDocument/didOpen', open('a\nb ?'));
  const diagnostics = await publish(1);

  t.is(init.capabilities.textDocumentSync, 1);
  t.truthy(init.capabilities.renameProvider);
  t.truthy(init.capabilities.definitionProvider);
  t.truthy(init.capabilities.referencesProvider);
  t.truthy(init.capabilities.documentSymbolProvider);
  t.truthy(init.capabilities.completionProvider);
  t.deepEqual(diagnostics, [
    {
      range: {start: {line: 1, character: 0}, end: {line: 1, character: 1}},
      severity: 4,
      code: 'x',
      source: 'ohm',
      message: 'question',
    },
  ]);
  dispose();
});

test('didChange with several content changes uses the last full text', async t => {
  const {service, calls} = fakeService();
  const {client, publish, dispose} = await connect(service);
  client.sendNotification('textDocument/didOpen', open('a'));
  await publish(1);

  client.sendNotification('textDocument/didChange', {
    textDocument: {uri, version: 2},
    contentChanges: [{text: 'first'}, {text: 'second'}],
  });
  await publish(2);

  t.deepEqual(calls, ['open 1', 'change 2 "second"']);
  dispose();
});

test('requests convert positions both ways', async t => {
  const {client, publish, dispose} = await connect(fakeService().service);
  client.sendNotification('textDocument/didOpen', open('a = 1\nb = a\n'));
  await publish(1);

  const definition = await client.sendRequest('textDocument/definition', {
    textDocument,
    position: {line: 1, character: 4},
  });
  const references = await client.sendRequest('textDocument/references', {
    textDocument,
    position: {line: 0, character: 0},
    context: {includeDeclaration: true},
  });
  const rename = await client.sendRequest('textDocument/rename', {
    textDocument,
    position: {line: 0, character: 0},
    newName: 'z',
  });
  const symbols = (await client.sendRequest('textDocument/documentSymbol', {
    textDocument,
  })) as {
    name: string;
  }[];
  const completion = (await client.sendRequest('textDocument/completion', {
    textDocument,
    position: {line: 1, character: 4},
  })) as {label: string}[];

  const r = (l1: number, c1: number, l2: number, c2: number) => ({
    start: {line: l1, character: c1},
    end: {line: l2, character: c2},
  });
  t.deepEqual(definition, [{uri, range: r(0, 0, 0, 1)}]);
  t.deepEqual(references, [
    {uri, range: r(0, 0, 0, 1)},
    {uri, range: r(1, 0, 1, 1)},
  ]);
  t.deepEqual(rename, {changes: {[uri]: [{range: r(1, 0, 1, 1), newText: 'z'}]}});
  t.deepEqual(
    symbols.map(s => s.name),
    ['a', 'bb']
  );
  t.deepEqual(
    completion.map(c => c.label),
    ['a']
  );
  dispose();
});

test('a service method that throws gives an empty response and a log message', async t => {
  const {service} = fakeService({
    definition: () => {
      throw new Error('boom');
    },
  });
  const {client, publish, logs, dispose} = await connect(service);
  client.sendNotification('textDocument/didOpen', open('a'));
  await publish(1);

  const definition = await client.sendRequest('textDocument/definition', {
    textDocument,
    position: {line: 0, character: 0},
  });

  t.deepEqual(definition, []);
  t.true(logs.some(m => /boom/.test(m)));
  dispose();
});

test('requests for an unopened document answer empty', async t => {
  const {client, dispose} = await connect(fakeService().service);

  const definition = await client.sendRequest('textDocument/definition', {
    textDocument: {uri: 'file:///other'},
    position: {line: 0, character: 0},
  });

  t.deepEqual(definition, []);
  dispose();
});
