/**
 * Evaluator invariants of `B ! C`: bindings, failure scope and messages,
 * memoization, the pass driver, incremental matching and static checks, plus
 * `ohm-js/v18` row-based iteration. test-fallible-acceptance.js covers
 * user-facing behavior.
 */

import test from 'ava';
import * as ohm from '../index.mjs';

// --------------------------------------------------------------------
// Static checks
// --------------------------------------------------------------------

test('both operands must have arity 1', t => {
  t.throws(() => ohm.grammar('G { S = "a" ! ("b" "c") }'), {message: /synchronizer.*arity/});
  t.throws(() => ohm.grammar('G { S = ("a" ! "b") ! "c" }'), {message: /guarded.*arity/});
  t.throws(() => ohm.grammar('G { S = ("a" "b") ! "c" }'), {message: /wrap it in a rule/});
  t.throws(() => ohm.grammar('G { S = ~"a" ! "c" }'), {message: /never consumes input/});
  t.throws(() => ohm.grammar('G { S = &"a" ! "c" }'), {message: /never consumes input/});
  t.notThrows(() => ohm.grammar('G { S = "a"* ! &"c" "c" }'));
});

test('a fallible is nullable only when `B C` is', t => {
  t.throws(() => ohm.grammar('G { S = ("a"? ! "b"?)* }'), {message: /Nullable/});
  t.notThrows(() => ohm.grammar('G { S = ("a"? ! "b")* }'));
  t.notThrows(() => ohm.grammar('G { S = ("a" ! "b"?)* }'));
});

test('a trailing `!` has a clear message', t => {
  t.throws(() => ohm.grammar('G { S = "a" !\n T = "b" }'), {message: /synchronizer/});
  t.throws(() => ohm.grammar('G { S = "a" ! }'), {message: /synchronizer/});
});

test('toString parenthesizes a fallible', t => {
  const g = ohm.grammar('G { S = "{" "a"* ! &"}" "}" }');
  t.is(g.rules.S.body.toString(), '("{" ("a"* ! &"}") "}")');
});

test('`!` is an operator token', t => {
  const r = ohm.ohmGrammar.match('A ! B', 'tokens');
  t.true(r.succeeded());
  const s = ohm.ohmGrammar.createSemantics().addOperation('kinds', {
    tokens(ts) {
      return ts.children.map(c => c.kinds());
    },
    token(x) {
      return x.ctorName;
    },
  });
  t.deepEqual(
    s(r)
      .kinds()
      .filter(k => k !== 'any'),
    ['ident', 'operator', 'ident']
  );
});
