import test from 'ava';
import type {Node} from 'ohm-js';

import {addRoles, roles} from './roles.ts';
import {calc, span} from './test-calc.ts';
import {offset} from './types.ts';
import {collect} from './walk.ts';

const calcRoles = {
  Assign: (n: Node, _e: Node, _r: Node) =>
    roles.ref(n, 'variable', {orDeclare: 'variable', after: true}),
  Var: (n: Node) => roles.ref(n, 'variable'),
};

test('collects roles from two actions and skips corrections', t => {
  const {g, sem} = calc();
  addRoles(sem, calcRoles);
  const m = g.match('a = 1;\nb = ;\nc = b;\n', 'Program', {recover: true});

  const found = collect(sem, m);

  t.deepEqual(
    found.refs.map(r => r.name),
    ['a', 'b', 'c', 'b']
  );
  t.deepEqual(found.skipped, [span(9, 10)]);
  t.deepEqual(found.refs[0].nameSpan, span(0, 1));
  t.is(found.refs[0].ownerEnd, offset(5));
});

test('role builders return frozen data', t => {
  const {g, sem} = calc();
  const node = sem(g.match('a', 'Var')) as Node;

  const r = roles.ref(node, 'variable');

  t.true(Object.isFrozen(r));
  t.deepEqual(r.role === 'ref' && r.kinds, ['variable']);
  t.deepEqual(roles.scope(), {role: 'scope'});
});

test('wrong parameter count gives the Ohm arity error naming roles', t => {
  const {sem} = calc();

  const err = t.throws(() => addRoles(sem, {Assign: (n: Node) => roles.ref(n, 'variable')}));

  t.regex(err.message, /'roles'/);
  t.regex(err.message, /arity/);
});

test('an action may return nothing, one role or an array', t => {
  const {g, sem} = calc();
  addRoles(sem, {
    Assign: (n: Node, _e: Node, _r: Node) => [
      roles.declare(n, 'variable'),
      [roles.ref(n, 'variable')],
    ],
    Var: (_n: Node) => undefined,
  });

  const found = collect(sem, g.match('a = b;', 'Program'));

  t.deepEqual(
    found.symbols.map(s => s.name),
    ['a']
  );
  t.deepEqual(
    found.refs.map(r => r.name),
    ['a']
  );
});

test('a throwing action is reported and siblings are still collected', t => {
  const {g, sem} = calc();
  addRoles(sem, {
    Assign: (n: Node, _e: Node, _r: Node) => {
      if (n.sourceString === 'a') throw new Error('boom');
      return roles.declare(n, 'variable');
    },
  });

  const found = collect(sem, g.match('a = 1;\nb = 2;\n', 'Program'));

  t.deepEqual(
    found.problems.map(p => [p.code, p.severity, p.span]),
    [['roles.actionFailed', 'error', span(0, 5)]]
  );
  t.regex(found.problems[0].message, /Assign/);
  t.regex(found.problems[0].message, /boom/);
  t.deepEqual(
    found.symbols.map(s => s.name),
    ['b']
  );
});

test('a scope role opens a child scope for descendants', t => {
  const {g, sem} = calc();
  addRoles(sem, {
    Assign: (n: Node, _e: Node, _r: Node) => roles.declare(n, 'variable'),
    Pri_block: (_o: Node, _s: Node, _c: Node) => roles.scope(),
  });

  const found = collect(sem, g.match('a = 1;\nb = {c = 2;};\n', 'Program'));

  const [a, b, c] = found.symbols;
  t.is(a.scope, found.root);
  t.is(b.scope, found.root);
  t.is(c.scope.parent, found.root);
  t.deepEqual(c.scope.span, span(11, 19));
  t.deepEqual(found.root.span, span(0, 21));
});

test('a declare with after is visible from the end of its node', t => {
  const {g, sem} = calc();
  addRoles(sem, {
    Assign: (n: Node, _e: Node, _r: Node) => roles.declare(n, 'variable', {after: true}),
  });

  const found = collect(sem, g.match('x = 1;', 'Program'));

  t.is(found.symbols[0].visibleFrom, offset(5));
});

test('a name node with empty text is a bad name', t => {
  const {g, sem} = calc();
  addRoles(sem, {
    Program: (stmts: Node) => roles.declare(stmts, 'variable'),
  });

  const found = collect(sem, g.match('', 'Program'));

  t.deepEqual(
    found.problems.map(p => p.code),
    ['roles.badName']
  );
  t.deepEqual(found.symbols, []);
});
