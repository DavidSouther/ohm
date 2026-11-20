import test from 'ava';
import * as ohm from '../index.mjs';

function countRuleReads(grammar, ruleName) {
  let count = 0;
  grammar.rules = new Proxy(grammar.rules, {
    get(target, key, receiver) {
      if (key === ruleName) count++;
      return Reflect.get(target, key, receiver);
    },
  });
  return () => count;
}

test('equivalent parameterized applications reuse completed join analysis', t => {
  const grammar = ohm.grammar(`G {
    Item<j> = "a" ! Join<j>
    Join<j> = ~"bad" Actual<j>
    Actual<j> = j
  }`);
  // Recognition fails at the predicate. Only analysis visits Actual.
  const reads = countRuleReads(grammar, 'Actual');
  t.is(grammar.match('a bad', 'Item<";">').getDiagnosticPosition(), 1);
  const cold = reads();
  t.true(cold > 0);
  t.is(grammar.match('a bad', 'Item<";">').getDiagnosticPosition(), 1);
  t.is(reads(), cold);

  t.is(grammar.match('a bad', 'Item<"">').getDiagnosticPosition(), 2);
  const differentArgument = reads();
  t.true(differentArgument > cold);
  t.is(grammar.match('a bad', 'Item<"">').getDiagnosticPosition(), 2);
  t.is(reads(), differentArgument);
});

test('ordinary joins reuse analysis and inherited joins use the derived grammar', t => {
  const grammar = ohm.grammar(`G {
    Start = "a" ! Join
    Join = ~"bad" Actual
    Actual = ";"
  }`);
  const child = ohm.grammar('H <: G { Actual := "" }', {G: grammar});
  const reads = countRuleReads(grammar, 'Actual');
  const childReads = countRuleReads(child, 'Actual');
  t.is(grammar.match('a bad').getDiagnosticPosition(), 1);
  t.is(child.match('a bad').getDiagnosticPosition(), 2);
  const cold = reads();
  const childCold = childReads();
  t.true(cold > 0);
  t.true(childCold > 0);
  t.is(grammar.match('a bad').getDiagnosticPosition(), 1);
  t.is(child.match('a bad').getDiagnosticPosition(), 2);
  t.is(reads(), cold);
  t.is(childReads(), childCold);
});

test('an unresolved recursive join reuses the conservative result', t => {
  const grammar = ohm.grammar(`G {
    Start = "a" ! Join
    Join = ~"bad" Recursive
    Recursive = More | Base
    More = Recursive
    Base = ";"
  }`);
  const reads = countRuleReads(grammar, 'Recursive');
  t.is(grammar.match('a bad').getDiagnosticPosition(), 2);
  const cold = reads();
  t.true(cold > 0);
  t.is(grammar.match('a bad').getDiagnosticPosition(), 2);
  t.is(reads(), cold);
});

test('exhausting the visit budget reuses the conservative result', t => {
  const depth = 9;
  const rules = Array.from({length: depth}, (_, i) =>
    `R${i}<x> = R${i + 1}<WrapA${i}<x>> | R${i + 1}<WrapB${i}<x>>\n` +
    `WrapA${i}<x> = x\nWrapB${i}<x> = x`
  );
  const grammar = ohm.grammar(`G {
    Start = "a" ! Join
    Join = ~"bad" R0<";">
    ${rules.join('\n')}
    R${depth}<x> = x
  }`);
  const reads = countRuleReads(grammar, 'R0');
  t.is(grammar.match('a bad').getDiagnosticPosition(), 2);
  const cold = reads();
  t.true(cold > 1);
  t.is(grammar.match('a bad').getDiagnosticPosition(), 2);
  t.is(reads(), cold);
});

test('a grammar sizes the analysis budget once across different joins', t => {
  const grammar = ohm.grammar(`G {
    First = "a" ! ";"
    Second = "a" ! "."
    Unrelated = "unrelated"
  }`);
  const reads = countRuleReads(grammar, 'Unrelated');
  t.is(grammar.match('a bad', 'First').getDiagnosticPosition(), 1);
  t.is(reads(), 1);
  t.is(grammar.match('a bad', 'Second').getDiagnosticPosition(), 1);
  t.is(reads(), 1);
});
