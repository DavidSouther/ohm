import test from 'ava';
import * as ohm from '../index.mjs';

test('lazy failure lookup does not replace edited matcher input or memo', t => {
  const grammar = ohm.grammar('G { Start = "a" "b" }');
  for (const options of [{}, {recover: true}]) {
    const matcher = grammar.matcher().setInput('a!');
    const saved = matcher.match(undefined, options);
    t.true(saved.failed());
    matcher.setInput('ab');
    const memo = matcher._memo;
    t.is(saved.getExpectedText(), '"b"');
    t.is(saved.getRightmostFailurePosition(), 1);
    t.is(matcher.getInput(), 'ab');
    t.is(matcher._memo, memo);
    t.true(matcher.match().succeeded());
  }
});

test('saved failure lookup leaves intervening matcher edits usable', t => {
  const grammar = ohm.grammar('G { Start = "a" "b" }');
  const matcher = grammar.matcher().setInput('a!');
  const saved = matcher.match();
  matcher.replaceInputRange(1, 2, 'b');
  t.is(saved.shortMessage, 'Line 1, col 2: expected "b"');
  t.is(matcher.getInput(), 'ab');
  t.true(matcher.match().succeeded());
});

test('saved failure remains inspectable after restoring a non-incremental matcher input', t => {
  const g = ohm.grammar('G <: IndentationSensitive { Start = "a" ! ";" }', {
    IndentationSensitive: ohm.ExperimentalIndentationSensitive,
  });
  const matcher = g.matcher().setInput('a ?');
  const saved = matcher.match();
  matcher.setInput('a;').setInput('a ?');
  const memo = matcher._memo;

  t.is(saved.getRightmostFailurePosition(), 2);
  t.is(saved.getExpectedText(), '";"');
  t.is(saved.getDiagnosticPosition(), 1);
  t.is(saved.getInterval().startIdx, 1);
  t.is(saved.shortMessage, 'Line 1, col 2: expected ";"');
  t.is(matcher.getInput(), 'a ?');
  t.is(matcher._memo, memo);
  t.throws(() => matcher.match(), {message: /does not support incremental parsing/});
});

test('saved strict failure leaves a later recovery memo on the same input intact', t => {
  const g = ohm.grammar('G { Start = Item "!"\n Item = "a" ! ";" }');
  const matcher = g.matcher().setInput('a x;!');
  const saved = matcher.match();
  t.true(matcher.match(undefined, {recover: true, firstPass: 'cached'}).succeeded());
  const memo = matcher._memo;
  const memoCount = memo.count;

  t.is(saved.getRightmostFailurePosition(), 2);
  t.is(saved.getExpectedText(), '";"');
  t.is(saved.getDiagnosticPosition(), 1);
  t.is(saved.getInterval().startIdx, 1);
  t.is(saved.shortMessage, 'Line 1, col 2: expected ";"');
  t.is(matcher._memo, memo);
  t.is(memo.count, memoCount);
});
