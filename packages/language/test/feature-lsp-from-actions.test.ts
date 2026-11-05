/**
 * Feature test: a language writer has a grammar and an `eval` operation, adds
 * one `addRoles` block of two actions, and an editor gets diagnostics, outline,
 * definition, references, rename and completion over LSP, including while the
 * file is being typed. Red until `@ohm-js/language` and `@ohm-js/lsp` exist.
 *
 * Story. Given a calculator grammar with an existing `eval` operation and a
 * role block (an assignment declares a variable, a variable use refers to one).
 * When an editor opens `a = 1;` and `b = a + c;` over LSP.
 * Then it sees one error for `c`, an outline of `a` and `b`, definition
 * and references for `a`, a rename of `a` that edits both sites, and completion
 * before `c` that offers `a` but not `b`.
 * When the editor then breaks the second line and adds a third that uses `b`.
 * Then it still sees a syntax error, the outline keeps `a` and the new
 * variable, and the use of `b` is below error severity. Assertions use
 * severities and message text, not diagnostic code spellings or symbol kinds.
 */

import test from 'ava';
import {PassThrough} from 'node:stream';
import * as ohm from 'ohm-js';
import {
  createMessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
} from 'vscode-jsonrpc/node.js';
import {addRoles, createLanguageService, roles} from '@ohm-js/language';
import {serve} from '@ohm-js/lsp';

const CALC = String.raw`
Calc {
  Program = Stmt*
  Stmt = StmtBody ! ";"
  StmtBody = Assign | Exp
  Assign = ident "=" Exp
  Exp = Exp "+" Pri  -- add
      | Pri
  Pri = "(" Exp ")"  -- paren
      | number
      | Var
  Var = ident
  number = digit+
  ident = letter alnum*
}`;

interface Pos {
  line: number;
  character: number;
}
interface Range {
  start: Pos;
  end: Pos;
}
interface Diagnostic {
  range: Range;
  severity?: number;
  code?: string | number;
  message: string;
}

const at = (line: number, from: number, to: number): Range => ({
  start: {line, character: from},
  end: {line, character: to},
});
const many = <T>(x: T | T[] | null | undefined): T[] =>
  x == null ? [] : Array.isArray(x) ? x : [x];

test('a grammar, an eval operation and two role actions give an editor a language server', async t => {
  // Existing author code, untouched by the feature.
  const grammar = ohm.grammar(CALC);
  const semantics = grammar.createSemantics();
  semantics.addOperation('eval(env)', {
    Program(stmts) {
      return stmts.children.map((s: any) => s.eval(this.args.env));
    },
    Stmt(body, _correction, _semi) {
      return body.eval(this.args.env);
    },
    StmtBody(x) {
      return x.eval(this.args.env);
    },
    Assign(name, _eq, rhs) {
      return (this.args.env[name.sourceString] = rhs.eval(this.args.env));
    },
    Exp_add(l, _plus, r) {
      return l.eval(this.args.env) + r.eval(this.args.env);
    },
    Pri_paren(_l, e, _r) {
      return e.eval(this.args.env);
    },
    Var(name) {
      return this.args.env[name.sourceString];
    },
    number(_digits) {
      return parseInt(this.sourceString, 10);
    },
  });
  t.deepEqual(semantics(grammar.match('a = 1; b = a + 2;')).eval({}), [1, 3]);

  // The whole addition for a language server: two role actions.
  addRoles(semantics, {
    Assign(name, _eq, _rhs) {
      return roles.ref(name, 'variable', {orDeclare: 'variable', after: true});
    },
    Var(name) {
      return roles.ref(name, 'variable');
    },
  });

  // Serve it over in-memory streams and drive it as an editor would.
  const toServer = new PassThrough();
  const toClient = new PassThrough();
  serve(createLanguageService(semantics, {start: 'Program'}), {
    input: toServer,
    output: toClient,
  });
  const client = createMessageConnection(
    new StreamMessageReader(toClient),
    new StreamMessageWriter(toServer)
  );
  const published = new Map<number, Diagnostic[]>();
  const waiters = new Map<number, (d: Diagnostic[]) => void>();
  client.onNotification(
    'textDocument/publishDiagnostics',
    (p: {version: number; diagnostics: Diagnostic[]}) => {
      published.set(p.version, p.diagnostics);
      waiters.get(p.version)?.(p.diagnostics);
    }
  );
  client.listen();
  const diagnosticsFor = (version: number) =>
    published.has(version)
      ? Promise.resolve(published.get(version)!)
      : new Promise<Diagnostic[]>(res => waiters.set(version, res));

  const uri = 'file:///calc.calc';
  const textDocument = {uri};
  await client.sendRequest('initialize', {processId: null, rootUri: null, capabilities: {}});
  client.sendNotification('initialized', {});

  // First document: `c` is undefined and nothing is skipped, so the error is certain.
  const v1 = 'a = 1;\nb = a + c;\n';
  client.sendNotification('textDocument/didOpen', {
    textDocument: {uri, languageId: 'calc', version: 1, text: v1},
  });
  const d1 = await diagnosticsFor(1);
  t.is(d1.length, 1);
  t.is(d1[0].severity, 1); // Error
  t.regex(d1[0].message, /\bc\b/);
  t.deepEqual(d1[0].range, at(1, 8, 9));

  const symbols = (await client.sendRequest('textDocument/documentSymbol', {
    textDocument,
  })) as {name: string}[];
  t.deepEqual(
    symbols.map(s => s.name),
    ['a', 'b']
  );

  const definition = many(
    (await client.sendRequest('textDocument/definition', {
      textDocument,
      position: {line: 1, character: 4},
    })) as {range: Range} | {range: Range}[] | null
  );
  t.deepEqual(
    definition.map(l => l.range),
    [at(0, 0, 1)]
  );

  const references = (await client.sendRequest('textDocument/references', {
    textDocument,
    position: {line: 0, character: 0},
    context: {includeDeclaration: true},
  })) as {range: Range}[];
  t.deepEqual(references.map(l => l.range), [at(0, 0, 1), at(1, 4, 5)]);

  const rename = (await client.sendRequest('textDocument/rename', {
    textDocument,
    position: {line: 0, character: 0},
    newName: 'first',
  })) as {changes: Record<string, {range: Range; newText: string}[]>};
  t.deepEqual(rename.changes[uri], [
    {range: at(0, 0, 1), newText: 'first'},
    {range: at(1, 4, 5), newText: 'first'},
  ]);

  // `b` is being declared on this line, so it is not yet visible; `a` is.
  const completion = many(
    (await client.sendRequest('textDocument/completion', {
      textDocument,
      position: {line: 1, character: 8},
    })) as {label: string}[] | {items: {label: string}[]}
  );
  const labels = completion.flatMap(i => ('items' in i ? i.items : [i])).map(i => i.label);
  t.true(labels.includes('a'));
  t.false(labels.includes('b'));

  // Typing: the second statement is broken and a third uses `b`.
  const v2 = 'a = 1;\nb = ;\nc = b;\n';
  client.sendNotification('textDocument/didChange', {
    textDocument: {uri, version: 2},
    contentChanges: [{text: v2}],
  });
  const d2 = await diagnosticsFor(2);
  t.true(d2.some(d => d.severity === 1 && d.range.start.line === 1));
  const useOfB = d2.filter(d => d.range.start.line === 2 && d.range.start.character === 4);
  t.false(useOfB.some(d => d.severity === 1)); // not a certain error
  t.true(useOfB.every(d => (d.severity ?? 4) > 1));

  const symbols2 = (await client.sendRequest('textDocument/documentSymbol', {
    textDocument,
  })) as {name: string}[];
  t.deepEqual(
    symbols2.map(s => s.name),
    ['a', 'c']
  );

  client.dispose();
});
