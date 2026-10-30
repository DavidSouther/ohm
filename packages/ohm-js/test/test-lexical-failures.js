/**
 * `Failure#isLexical`: whether an expectation failed inside a token that had
 * already begun (a malformed token) or at a token boundary (missing or
 * unexpected input).
 */

import test from 'ava';
import * as ohm from '../index.mjs';
import {RecoveryCache} from '../src/RecoveryCache.js';

const RECOVER = {recover: true};

const TOKENS = String.raw`
Tokens {
  Start = Item+ end
  Item  = hex | pair | Pair | Named | word
  Named = name ";"
  Pair  = "1" "3"
  hex   = "0x" hexDigit+
  name  = letter+
  pair  = "1" "2"
  word  = "%" "&"
}`;

function expected(result) {
  return result
    .getRightmostFailures()
    .filter(failure => !failure.isFluffy())
    .map(failure => [failure.toString(), failure.isLexical()])
    .sort(([a], [b]) => a.localeCompare(b));
}

test('an expectation inside a begun token is lexical', t => {
  const g = ohm.grammar(TOKENS);

  const result = g.match('0xZ');

  t.true(result.failed());
  t.deepEqual(expected(result), [['a hexadecimal digit', true]]);
});

test('an expectation at a token boundary is structural, even inside a lexical rule', t => {
  const g = ohm.grammar(TOKENS);

  const result = g.match(';');

  t.deepEqual(expected(result), [
    ['"%"', false],
    ['"0x"', false],
    ['"1"', false],
    ['a letter', false],
  ]);
});

test('one position can expect a token continuation and a structural expectation', t => {
  const g = ohm.grammar(TOKENS);

  const result = g.match('1x');

  t.deepEqual(expected(result), [
    ['"2"', true],
    ['"3"', false],
  ]);
});

test('terminal-only expectations are classified by their enclosing token', t => {
  const g = ohm.grammar(TOKENS);

  const inside = g.match('%x');
  const boundary = g.match('ab');

  t.deepEqual(expected(inside), [['"&"', true]]);
  t.deepEqual(expected(boundary), [['";"', false]]);
});

const STMTS = String.raw`
Stmts {
  Start = Stmt* end
  Stmt  = Item ! ";"
  Item  = hex | name
  hex   = "0x" hexDigit+
  name  = letter+
}`;

test('a recovered failure classifies the pass that selected its recovery', t => {
  const g = ohm.grammar(STMTS);

  const result = g.match('0xZ; ab cd;', undefined, RECOVER);

  t.true(result.succeeded());
  t.deepEqual(result.getRecoveredFailures().map(expected), [
    [['a hexadecimal digit', true]],
    [['";"', false]],
  ]);
});

test('an unrecoverable recovering match classifies its final failure', t => {
  const g = ohm.grammar(STMTS);

  const lexical = g.match('ab; 0xZ', undefined, RECOVER);
  const structural = g.match('ab; cd', undefined, RECOVER);

  t.true(lexical.failed());
  t.deepEqual(expected(lexical), [['a hexadecimal digit', true]]);
  t.true(structural.failed());
  t.deepEqual(expected(structural), [['";"', false]]);
});

test('a memoized lexical application is classified by the token it is reused in', t => {
  const g = ohm.grammar(String.raw`
    Memo {
      Start = wrap | Two
      wrap  = "a" inner
      Two   = "a" inner
      inner = "b"
    }`);

  const result = g.match('a?');

  t.deepEqual(expected(result), [['"b"', false]]);
});

test('a recovered failure merges a token continuation with a boundary expectation', t => {
  const g = ohm.grammar(String.raw`
    Memo {
      Start = Stmt* end
      Stmt  = (Two | wrap) ! ";"
      wrap  = "a" inner
      Two   = "a" inner
      inner = "b"
    }`);

  const result = g.match('a?;', undefined, RECOVER);

  t.deepEqual(result.getRecoveredFailures().map(expected), [[['"b"', false]]]);
});

test.serial('cached recovery retains lexical classification across token contexts', t => {
  const sources = [
    STMTS,
    String.raw`G {
    Start = Stmt* end
    Stmt = (Two | wrap) ! ";"
    wrap = "a" inner
    Two = "a" inner
    inner = "b"
  }`,
  ];
  const inputs = [
    ['0xZ; ab cd;', 'ab; 0xZ', 'ab; cd'],
    ['a?;a?;', 'a?;a?'],
  ];
  const summarize = result => ({
    success: result.succeeded(),
    diagnostics: result.getRecoveredFailures().map(expected),
    final: result.failed() ? expected(result) : [],
  });
  for (let i = 0; i < sources.length; i++) {
    const g = ohm.grammar(sources[i]);
    for (const input of inputs[i]) {
      const cached = g.match(input, undefined, {recover: true, firstPass: 'cached'});
      const original = RecoveryCache.prototype.evaluate;
      let uncached;
      try {
        RecoveryCache.prototype.evaluate = function (...args) {
          this.disabled = true;
          return original.apply(this, args);
        };
        uncached = g.match(input, undefined, {recover: true, firstPass: 'cached'});
      } finally {
        RecoveryCache.prototype.evaluate = original;
      }
      t.deepEqual(summarize(cached), summarize(uncached), `${input}`);
    }
  }
});

test('memo replay preserves a nested syntactic token boundary', t => {
  const g = ohm.grammar(String.raw`G {
    Start = ~Two wrap
    wrap = "a" inner
    Two = "a" inner
    inner = applySyntactic<Next>
    Next = "b"
  }`);
  t.deepEqual(expected(g.match('a?')), [['"b"', false]]);
});
