import test from 'ava';
import type {Node, Semantics} from 'ohm-js';

import {analyze} from './analysis.ts';
import {addRoles, roles} from './roles.ts';
import {calc, span} from './test-calc.ts';
import type {ServiceConfig} from './types.ts';

const config: ServiceConfig = {start: 'Program'};

function calcWithRoles(): Semantics {
  const {sem} = calc();
  addRoles(sem, {
    Assign: (n: Node, _e: Node, _r: Node) =>
      roles.ref(n, 'variable', {orDeclare: 'variable', after: true}),
    Var: (n: Node) => roles.ref(n, 'variable'),
  });
  return sem;
}

const run = (sem: Semantics, text: string) => analyze(sem, config, 'u', 1, text);
const codes = (sem: Semantics, text: string) =>
  run(sem, text).diagnostics.map(d => [d.code, d.severity, d.span]);

test('undefined use is an error when nothing was skipped', t => {
  const a = run(calcWithRoles(), 'a = 1;\nb = a + c;\n');

  t.deepEqual(
    a.diagnostics.map(d => [d.code, d.severity, d.span]),
    [['ref.undefined', 'error', span(15, 16)]]
  );
  t.regex(a.diagnostics[0].message, /\bc\b/);
  t.false(a.hasSkippedInput);
  t.true(a.hasTree);
  t.deepEqual(
    a.symbols.map(s => [s.name, s.implicit, s.nameSpan]),
    [
      ['a', true, span(0, 1)],
      ['b', true, span(7, 8)],
    ]
  );
  const [refA, refB, useA, useC] = a.references;
  t.is(useA.target, a.symbols[0]);
  t.is(refA.target, a.symbols[0]);
  t.is(refB.status, 'resolved');
  t.is(useC.status, 'undefined');
});

test('lost declaration makes uses uncertain, not errors', t => {
  const a = run(calcWithRoles(), 'a = 1;\nb = ;\nc = b;\n');

  t.deepEqual(
    a.diagnostics.map(d => [d.code, d.severity, d.span]),
    [
      ['ref.uncertain', 'hint', span(7, 8)],
      ['syntax.expected', 'error', span(9, 10)],
      ['ref.uncertain', 'hint', span(17, 18)],
    ]
  );
  t.true(a.hasSkippedInput);
  t.deepEqual(
    a.symbols.map(s => s.name),
    ['a', 'c']
  );
});

test('a use inside its own assignment is undefined because of after', t => {
  t.deepEqual(codes(calcWithRoles(), 'x = x + 1;\n'), [
    ['ref.undefined', 'error', span(4, 5)],
  ]);
});

test('re-assignment resolves to the first declaration, not a duplicate', t => {
  const a = run(calcWithRoles(), 'a = 1;\na = 2;\n');

  t.deepEqual(a.diagnostics, []);
  t.deepEqual(
    a.symbols.map(s => s.nameSpan),
    [span(0, 1)]
  );
  t.is(a.references[1].target, a.symbols[0]);
});

test('two explicit declarations in one scope are duplicates', t => {
  const {sem} = calc();
  addRoles(sem, {Assign: (n: Node, _e: Node, _r: Node) => roles.declare(n, 'variable')});

  t.deepEqual(codes(sem, 'a = 1;\na = 2;\n'), [['def.duplicate', 'error', span(7, 8)]]);
});

test('namespaces group kinds for lookup and duplicates', t => {
  const {sem} = calc();
  addRoles(sem, {
    Assign: (n: Node, _e: Node, _r: Node) =>
      roles.declare(n, n.sourceString === 'a' ? 'local' : 'parameter'),
    Var: (n: Node) => roles.ref(n, 'value'),
  });
  const ns = {start: 'Program', namespaces: {value: ['local', 'parameter']}};

  const a = analyze(sem, ns, 'u', 1, 'a = 1;\nb = a;\nb = 2;\n');

  t.deepEqual(
    a.diagnostics.map(d => [d.code, d.span]),
    [['def.duplicate', span(14, 15)]]
  );
  t.is(a.references[0].status, 'resolved');
});

test('a reference before the visibility offset of a declaration does not resolve', t => {
  const {sem} = calc();
  addRoles(sem, {
    Assign: (n: Node, _e: Node, _r: Node) => roles.declare(n, 'variable', {after: true}),
    Var: (n: Node) => roles.ref(n, 'variable'),
  });

  t.deepEqual(codes(sem, 'b;\nb = 1;\nb;\n'), [['ref.undefined', 'error', span(0, 1)]]);
});

test('wholly unparseable text gives a syntax diagnostic and no symbols', t => {
  const a = run(calcWithRoles(), 'a = 1;\n+++');

  t.false(a.hasTree);
  t.true(a.hasSkippedInput);
  t.deepEqual(a.symbols, []);
  t.deepEqual(
    a.diagnostics.map(d => [d.code, d.severity]),
    [['syntax.expected', 'error']]
  );
  t.regex(a.diagnostics[0].message, /[Ee]xpected/);
});

test('role problems are reported with the analysis', t => {
  const {sem} = calc();
  addRoles(sem, {
    Var: (_n: Node) => {
      throw new Error('boom');
    },
  });

  t.deepEqual(codes(sem, 'a;\n'), [['roles.actionFailed', 'error', span(0, 1)]]);
});
