/**
 * Feature test: a language server resolves across files.
 *
 * Two language families share one mechanism. An ambient language (a class per
 * file, no import statements) sees every definition its `exported` predicate
 * admits. An explicit language (JavaScript style) sees only what an `import`
 * role names. Files that are not open come from a virtual file system, and an
 * open document always wins over it.
 */
import test from 'ava';
import * as ohm from 'ohm-js';
import type {Node} from 'ohm-js';

import {addRoles, createLanguageService, offset, roles} from '../src/index.ts';
import type {Definition, LanguageService, ReadonlyVfs} from '../src/index.ts';

const MINI = String.raw`
Mini {
  File = Item*
  Item = "class" name "{" Member* "}"
  Member = "uses" name ";"
  name = letter alnum*
}`;

const MOD = String.raw`
Mod {
  File = Stmt*
  Stmt = Import | Export | Let | Use
  Import = "import" name "from" path ";"
  Export = "export" name ";"
  Let = "let" name ";"
  Use = "use" name ";"
  name = letter alnum*
  path = "\"" (~"\"" any)* "\""
}`;

function files(entries: Record<string, string>): ReadonlyVfs {
  return {
    list: () => Object.keys(entries),
    read: uri => entries[uri],
  };
}

function mini(entries: Record<string, string>): LanguageService {
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
      vfs: files(entries),
    },
  });
}

function mod(entries: Record<string, string>): LanguageService {
  const sem = ohm.grammar(MOD).createSemantics();
  addRoles(sem, {
    Import: (_i: Node, n: Node, _f: Node, p: Node, _s: Node) => roles.import(p, {names: [n]}),
    Export: (_e: Node, n: Node, _s: Node) =>
      roles.declare(n, 'value', {data: {exported: true}}),
    Let: (_l: Node, n: Node, _s: Node) => roles.declare(n, 'value'),
    Use: (_u: Node, n: Node, _s: Node) => roles.ref(n, 'value'),
  });
  return createLanguageService(sem, {
    start: 'File',
    workspace: {
      mode: 'explicit',
      exported: (d: Definition) =>
        (d.data as {exported?: boolean} | undefined)?.exported === true,
      resolveImport: spec => {
        const uri = `file:///${spec.replaceAll('"', '')}.mod`;
        return uri in entries ? uri : undefined;
      },
      vfs: files(entries),
    },
  });
}

const A = 'file:///a.mini';
const B = 'file:///b.mini';
const at = (text: string, needle: string, nth = 0) => {
  let i = -1;
  for (let k = 0; k <= nth; k++) i = text.indexOf(needle, i + 1);
  return offset(i);
};

test('ambient: a class in a file on disk is visible from an open file', t => {
  const bText = 'class B { }';
  const aText = 'class A { uses B; uses Z; }';
  const svc = mini({[B]: bText});
  svc.scan();

  const a = svc.open(A, 1, aText);

  t.deepEqual(
    a.diagnostics.map(d => [d.code, aText.slice(d.span.start, d.span.end)]),
    [['ref.undefined', 'Z']]
  );
  const [def] = svc.definition(A, at(aText, 'B'));
  t.is(def.uri, B);
  t.is(bText.slice(def.nameSpan.start, def.nameSpan.end), 'B');
});

test('ambient: references and rename cross files, and a rename may not collide', t => {
  const bText = 'class B { }';
  const aText = 'class A { uses B; }';
  const svc = mini({[B]: bText});
  svc.scan();
  svc.open(A, 1, aText);

  const refs = svc.references(B, at(bText, 'B'), true);
  const edits = svc.rename(B, at(bText, 'B'), 'C');

  t.deepEqual(refs.map(r => r.uri).sort(), [A, B]);
  t.deepEqual(edits.map(e => [e.uri, e.newText]).sort(), [
    [A, 'C'],
    [B, 'C'],
  ]);
  t.deepEqual(svc.rename(B, at(bText, 'B'), 'A'), []);
});

test('ambient: an edit in one file changes which files it affects and their diagnostics', t => {
  const svc = mini({[B]: 'class B { }'});
  svc.scan();
  svc.open(A, 1, 'class A { uses B; }');
  t.deepEqual(svc.analysis(A)?.analysis.diagnostics, []);

  svc.change(B, 2, 'class D { }');

  t.deepEqual(svc.affected(B), [A]);
  const refreshed = svc.refresh(A);
  t.deepEqual(
    refreshed?.diagnostics.map(d => d.code),
    ['ref.undefined']
  );
});

test('ambient: an open document wins over the disk copy, and closing falls back to disk', t => {
  const svc = mini({[B]: 'class B { }'});
  svc.scan();
  svc.open(B, 1, 'class Edited { }');
  t.deepEqual(
    svc.documentSymbols(B).map(d => d.name),
    ['Edited']
  );

  svc.close(B);

  t.deepEqual(
    svc.documentSymbols(B).map(d => d.name),
    ['B']
  );
});

const LIB = 'file:///lib.mod';
const MAIN = 'file:///main.mod';
const libText = 'export x;\nlet h;\n';

test('explicit: only an imported, exported name resolves, and diagnostics say why not', t => {
  const mainText =
    'import x from "lib";\nimport q from "lib";\nimport h from "lib";\nimport z from "nope";\nuse x;\nuse h;\n';
  const svc = mod({[LIB]: libText});
  svc.scan();

  const a = svc.open(MAIN, 1, mainText);

  t.deepEqual(
    a.diagnostics.map(d => [d.code, mainText.slice(d.span.start, d.span.end)]),
    [
      ['import.missing', 'q'],
      ['import.missing', 'h'],
      ['import.unresolved', '"nope"'],
      ['ref.undefined', 'h'],
    ]
  );
  t.deepEqual(
    a.references.filter(r => r.status === 'resolved').map(r => r.name),
    ['x', 'x']
  );
  t.is(a.references.find(r => r.name === 'x')?.target?.uri, LIB);
});

test('explicit: definition, references and rename follow an import to its export', t => {
  const mainText = 'import x from "lib";\nuse x;\n';
  const svc = mod({[LIB]: libText});
  svc.scan();
  svc.open(MAIN, 1, mainText);

  const useAt = at(mainText, 'x', 1);
  const [def] = svc.definition(MAIN, useAt);
  const refs = svc.references(MAIN, useAt, true);
  const edits = svc.rename(MAIN, useAt, 'y');

  t.is(def.uri, LIB);
  t.is(refs.length, 3);
  t.deepEqual(edits.map(e => e.uri).sort(), [LIB, MAIN, MAIN]);
});

test("explicit: completion offers imported names but not the other file's locals", t => {
  const mainText = 'import x from "lib";\n\n';
  const svc = mod({[LIB]: libText});
  svc.scan();
  svc.open(MAIN, 1, mainText);

  const names = svc.completion(MAIN, offset(mainText.length)).map(d => d.name);

  t.deepEqual(names, ['x']);
});
