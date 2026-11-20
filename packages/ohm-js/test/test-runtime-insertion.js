import test from 'ava';
import * as ohm from '../index.mjs';

const recover = {recover: true};

test('lexical and lexified continuations insert after a consumed guard', t => {
  for (const source of ['G { start = ("a" ! ";") "b" }', 'G { Start = #(("a" ! ";") "b") }']) {
    const grammar = ohm.grammar(source);
    const result = grammar.match('ab', undefined, recover);
    t.true(result.succeeded());
    t.deepEqual(
      result.getRecoveredFailures().map(f => [f.position, f.missing]),
      [[1, true]]
    );
  }
});

test('wrapped punctuation preserves wrapper CST and literal expectation', t => {
  const grammar = ohm.grammar('G { Start = ("a" "b") ! Semi "c"\nSemi = semi\nsemi = ";" }');
  const result = grammar.match('ab c', undefined, recover);
  t.true(result.succeeded());
  t.is(result.getRecoveredFailures()[0].getExpectedText(), '";"');
  const root = grammar.createSemantics()(result);
  const semi = root.child(3);
  t.is(semi.ctorName, 'Semi');
  t.is(semi.child(0).ctorName, 'semi');
  t.is(semi.child(0).child(0).ctorName, '_terminal');
  t.is(semi.source.startIdx, 2);
  t.is(semi.source.endIdx, 2);
  t.is(root.child(0).sourceString, 'a');
  t.is(root.child(1).sourceString, 'b');
});

test('an empty guard after skipped whitespace does not authorize insertion', t => {
  const grammar = ohm.grammar('G { Start = ("a"? ! ";") "b" }');
  const result = grammar.match('   b', undefined, recover);
  t.true(result.failed());
  t.false(result.getRecoveredFailures().some(f => f.missing));
});

test('a nullable predicate suffix must succeed before enclosing follow evidence', t => {
  const grammar = ohm.grammar(`G {
    Start = "{" Item* ! "}"
    Item = ("a" ! ";") ~"b" -- a
         | "b" ";" -- b
  }`);
  const result = grammar.match('{ a b; }', undefined, recover);
  t.false(result.getRecoveredFailures().some(f => f.missing));
});

test('opt-out survives grammar recipe serialization and parameter substitution', t => {
  const grammar = ohm.grammar('G { Start = Rule<"a"> "b"\nRule<x> = x !~ ";" }');
  const copy = ohm.makeRecipe(grammar.toRecipe());
  for (const g of [grammar, copy]) {
    const result = g.match('ab', undefined, recover);
    t.true(result.failed());
    t.false(result.getRecoveredFailures().some(f => f.missing));
    t.is(g.rules.Rule.body.insertion, false);
  }
});

test('a continuation outside lexification resumes syntactic whitespace skipping', t => {
  const grammar = ohm.grammar('G { Start = #("a" ! ";") "b" }');
  const result = grammar.match('a b', undefined, recover);
  t.true(result.succeeded());
  t.deepEqual(
    result.getRecoveredFailures().map(f => [f.position, f.interval.contents, f.missing]),
    [[1, '', true]]
  );
});

test('a lexical guarded prefix does not recognize spaces between its factors', t => {
  const grammar = ohm.grammar(`G {
    Start = Item* ! end
    Item = atom
    atom = ("a" "b") ! ";"
  }`);
  const result = grammar.match('ab a b;', undefined, recover);
  t.true(result.succeeded());
  t.deepEqual(
    result.getRecoveredFailures().map(f => [f.interval.contents, f.missing]),
    [[' a b', false]]
  );
});

test('true EOF evidence must also satisfy the nullable local suffix', t => {
  for (const suffix of ['&"b"', '~end']) {
    const grammar = ohm.grammar(`G { Start = ("a" ! ";") ${suffix} }`);
    const result = grammar.match('a', undefined, recover);
    t.true(result.failed());
    t.false(result.getRecoveredFailures().some(f => f.missing));
  }
});

test('custom spaces outside lexification do not become unexpected text', t => {
  for (const [space, input] of [
    ['space += "_"', 'a_b'],
    ['space += comment\ncomment = "/*" (~"*/" any)* "*/"', 'a/*x*/b'],
  ]) {
    const grammar = ohm.grammar(`G { Start = #("a" ! ";") "b"\n${space} }`);
    const result = grammar.match(input, undefined, recover);
    t.true(result.succeeded());
    t.deepEqual(
      result.getRecoveredFailures().map(f => [f.position, f.interval.contents, f.missing]),
      [[1, '', true]]
    );
  }
});

// Stateful pseudotokens cannot be reconstructed from a bounded input slice.
test('stateful indentation grammars retain ordinary recovery without sandbox crashes', t => {
  const grammar = ohm.grammar('G <: I { Start = ("a" ! ";") indent "b" dedent }', {
    I: ohm.ExperimentalIndentationSensitive,
  });
  for (const input of ['a\n  b', 'a b']) {
    const result = grammar.match(input, undefined, recover);
    t.true(result.failed());
    t.false(result.getRecoveredFailures().some(f => f.missing));
  }
});

test('the continuation gate compares supplementary Unicode ranges by code point', t => {
  const grammar = ohm.grammar('G { start = ("a" ! ";") "😀".."🙏" }');
  const result = grammar.match('a😁', undefined, recover);
  t.true(result.succeeded());
  t.deepEqual(
    result.getRecoveredFailures().map(f => [f.position, f.missing]),
    [[1, true]]
  );
});
