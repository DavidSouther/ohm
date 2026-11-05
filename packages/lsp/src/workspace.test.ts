import test from 'ava';
import {addRoles, createLanguageService, roles} from '@ohm-js/language';
import type {Definition} from '@ohm-js/language';
import * as ohm from 'ohm-js';
import type {Node} from 'ohm-js';
import {mkdtempSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {PassThrough} from 'node:stream';
import {
  createMessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
} from 'vscode-jsonrpc/node.js';

import {diskVfs, serve} from './index.ts';

const MINI = String.raw`
Mini {
  File = Item*
  Item = "class" name "{" Member* "}"
  Member = "uses" name ";"
  name = letter alnum*
}`;

function miniService(roots: string[]) {
  const sem = ohm.grammar(MINI).createSemantics();
  addRoles(sem, {
    Item: (_c: Node, n: Node, _o: Node, _m: Node, _x: Node) => [
      roles.scope(),
      roles.declare(n, 'class'),
    ],
    Member: (_u: Node, n: Node, _s: Node) => roles.ref(n, 'class'),
  });
  return createLanguageService(sem, {
    start: 'File',
    workspace: {
      mode: 'ambient',
      exported: (d: Definition) => d.scope.parent === undefined,
      vfs: diskVfs(roots, ['.mini']),
    },
  });
}

interface Published {
  uri: string;
  version: number;
  diagnostics: {message: string}[];
}

async function connect(roots: string[]) {
  const toServer = new PassThrough();
  const toClient = new PassThrough();
  const server = serve(
    miniService(roots),
    {input: toServer, output: toClient},
    {debounceMs: 5}
  );
  const client = createMessageConnection(
    new StreamMessageReader(toClient),
    new StreamMessageWriter(toServer)
  );
  const all: Published[] = [];
  client.onNotification('textDocument/publishDiagnostics', (p: Published) => all.push(p));
  client.listen();
  await client.sendRequest('initialize', {processId: null, rootUri: null, capabilities: {}});
  client.sendNotification('initialized', {});
  const until = async (done: () => boolean) => {
    for (let i = 0; i < 200 && !done(); i++) await new Promise(r => setTimeout(r, 5));
  };
  return {client, all, until, dispose: () => (client.dispose(), server.dispose())};
}

test('diskVfs streams and reads files with the given extensions', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'ohm-lsp-'));
  writeFileSync(join(dir, 'b.mini'), 'class B { }');
  writeFileSync(join(dir, 'notes.txt'), 'x');

  const vfs = diskVfs([dir], ['.mini']);
  const listed = await Array.fromAsync(vfs.list());
  const [uri] = listed;

  t.is(listed.length, 1);
  t.is(uri, pathToFileURL(join(dir, 'b.mini')).href);
  t.is(await vfs.read(uri), 'class B { }');
  t.is(await vfs.read('file:///does/not/exist.mini'), undefined);
});

test('an edit to one open file republishes the diagnostics of a file that uses it', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'ohm-lsp-'));
  const bPath = join(dir, 'b.mini');
  writeFileSync(bPath, 'class B { }');
  const bUri = pathToFileURL(bPath).href;
  const aUri = pathToFileURL(join(dir, 'a.mini')).href;
  const {client, all, until, dispose} = await connect([dir]);
  const doc = (uri: string, version: number, text: string) => ({
    textDocument: {uri, languageId: 'mini', version, text},
  });

  client.sendNotification('textDocument/didOpen', doc(aUri, 10, 'class A { uses B; }'));
  // The disk scan streams in behind the open, so `B` is first only uncertain; it settles clean.
  await until(() => all.filter(p => p.uri === aUri).at(-1)?.diagnostics.length === 0);
  const first = all.filter(p => p.uri === aUri).at(-1);
  client.sendNotification('textDocument/didOpen', doc(bUri, 20, 'class B { }'));
  client.sendNotification('textDocument/didChange', {
    textDocument: {uri: bUri, version: 21},
    contentChanges: [{text: 'class Renamed { }'}],
  });
  await until(() => all.filter(p => p.uri === aUri).at(-1)?.diagnostics.length === 1);
  const last = all.filter(p => p.uri === aUri).at(-1);

  t.deepEqual(first?.diagnostics, []);
  t.is(last?.version, 10);
  t.regex(last?.diagnostics[0].message ?? '', /Undefined class 'B'/);
  dispose();
});
