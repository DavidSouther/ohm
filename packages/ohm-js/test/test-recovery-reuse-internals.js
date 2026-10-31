import test from 'ava';
import * as ohm from '../index.mjs';
import * as v18 from '../src/v18.js';
import {emptyEffects} from '../src/RecoveryEffects.js';
import * as pexprs from '../src/pexprs.js';
import {RecoveryAttempts} from '../src/RecoveryAttempts.js';
import {CorrectionNode} from '../src/nodes.js';
import {collectRecoveredFailures} from '../src/RecoveredFailure.js';
import {RecoveryAttemptReplay} from '../src/RecoveryAttemptReplay.js';

test('shared effect histories preserve first and last occurrences without expansion', t => {
  const first = {key: 'a', depth: 1};
  const second = {key: 'a', depth: 2};
  let shared = emptyEffects.append(first).append(second);
  for (let i = 0; i < 30; i++) shared = shared.concat(shared);
  const forward = [];
  const reverse = [];
  shared.forEachUnique(value => forward.push(value.depth));
  shared.forEachUnique(value => reverse.push(value.depth), true);
  t.deepEqual(forward, [1, 2]);
  t.deepEqual(reverse, [2, 1]);
  const shifted = [];
  emptyEffects
    .append(first)
    .shift(3)
    .forEachUnique((value, shift) => shifted.push(value.depth + shift));
  t.deepEqual(shifted, [4]);
});

test('overlap retirement reevaluates a different parameterized recovery attempt', t => {
  const grammar = ohm.grammar(String.raw`G {
    S = R<"a", ";"> "!" -- a
      | R<"a", ":"> "?" -- b
    R<x, c> = x ! c
  }`);
  const result = grammar.match(':', undefined, {recover: true});
  t.true(result.failed());
  t.deepEqual(
    result.getRecoveredFailures().map(f => [f.position, f.shortMessage]),
    [
      [0, 'Line 1, col 1: expected "a"'],
      [1, 'Line 1, col 2: expected "?"'],
    ]
  );
  t.is(result._recovery.corrections.size, 2);
});

test.serial(
  'completed recovery is shared across backtracking and releases evaluation indexes',
  t => {
    const grammar = ohm.grammar(String.raw`G {
    S = E end
    E = "(" E ")" "a" -- a
      | "(" E ")" "b" -- b
      | X
    X = "x" ! ";"
  }`);
    const original = pexprs.Fallible.prototype.scan;
    let scans = 0;
    pexprs.Fallible.prototype.scan = function (...args) {
      scans++;
      return original.apply(this, args);
    };
    try {
      const result = grammar.match('('.repeat(8) + 'y;' + ')b'.repeat(8), undefined, {
        recover: true,
      });
      t.true(result.succeeded());
      t.is(scans, 1);
      t.is(result.getRecoveredFailures().length, 1);
      t.is(result._recovery.cache.records.size, 0);
      t.is(result._recovery.cache.correctionReaders.size, 0);
      t.is(result._recovery.attempts.size, 0);
      t.is(result._recovery.corrections.size, 1);
    } finally {
      pexprs.Fallible.prototype.scan = original;
    }
  }
);

test('returned iteration arrays survive cache reclamation with nested source offsets', t => {
  const grammar = ohm.grammar(String.raw`G {
    S = "{" Item* ! "}"
    Item = "{" Item* ! "}" -- block
         | letter ! ";" -- simple
  }`);
  const result = grammar.match('{a;{b;c}d;}', undefined, {recover: true});
  t.true(result.succeeded());
  const failures = result.getRecoveredFailures();
  t.deepEqual(
    failures.map(f => f.interval.contents),
    ['c']
  );
  t.is(result._recovery.cache.records.size, 0);
  const operation = grammar.createSemantics().addOperation('letters', {
    _nonterminal(...children) {
      return children.flatMap(child => child.letters());
    },
    _iter(...children) {
      return children.flatMap(child => child.letters());
    },
    _terminal() {
      return /^[a-z]$/.test(this.sourceString) ? [this.sourceString] : [];
    },
    _correction() {
      return [];
    },
  });
  t.deepEqual(operation(result).letters(), ['a', 'b', 'd']);
});

test('left-recursion memo hits retain successful-seed expectation ordering', t => {
  const grammar = ohm.grammar(String.raw`G {
    S = Item*
    Item = Expr ! ";"
    Expr = Expr "+" Term -- plus
         | Expr "-" Term -- minus
         | Term
    Term = Term "*" atom -- times
         | Term "/" atom -- divide
         | atom
    atom = letter | digit
  }`);
  const result = grammar.match('a 2; b 3;', undefined, {recover: true});
  t.true(result.succeeded());
  t.deepEqual(
    result.getRecoveredFailures().map(f => f.getExpectedText()),
    ['";", "-", "+", "/", or "*"', '";", "-", "+", "/", or "*"']
  );
});

test('stateful indentation pseudotokens are consumed on every evaluation', t => {
  const grammar = ohm.grammar(
    'G <: IndentationSensitive { Start = indent indent "x" dedent }',
    {IndentationSensitive: ohm.ExperimentalIndentationSensitive}
  );
  const result = grammar.match('  x', undefined, {recover: true});
  t.true(result.failed());
  t.is(result.shortMessage, 'Line 1, col 3: expected an indented block');
  t.true(result._recovery.cache.disabled);
});

test.serial('unchanged attempt-effect prefixes avoid repeated visits and index writes', t => {
  const grammar = ohm.grammar(String.raw`G {
    s = item*
    item = ("z" ! "q") | (body ! ";")
    body = "a" "b"
  }`);
  const original = RecoveryAttempts.prototype.set;
  let writes = 0;
  RecoveryAttempts.prototype.set = function (...args) {
    writes++;
    return original.apply(this, args);
  };
  try {
    const rows = [];
    for (const count of [16, 32, 64]) {
      writes = 0;
      const result = grammar.match('a?;'.repeat(count), undefined, {recover: true});
      t.true(result.succeeded());
      t.is(result.getRecoveredFailures().length, count);
      const visits = result._recovery.cache.stats.attemptEffectsVisited;
      rows.push({writes, visits});
    }
    for (let i = 1; i < rows.length; i++) {
      t.true(rows[i].writes <= 2.75 * rows[i - 1].writes, `${JSON.stringify(rows)}`);
      t.true(
        Number.isFinite(rows[i].visits),
        'attempt-state replay accounts for segment visits'
      );
      t.true(rows[i].visits <= 2.75 * rows[i - 1].visits, `${JSON.stringify(rows)}`);
    }
  } finally {
    RecoveryAttempts.prototype.set = original;
  }
});

test('pure subgrammars do not allocate recovery evaluation records', t => {
  const grammar = ohm.grammar('G { S = letter+ }');
  const result = grammar.match('a'.repeat(128), undefined, {recover: true});
  t.true(result.succeeded());
  t.is(result._recovery.cache.stats.evaluated, 0);
  t.is(result._cst.children[0].children.length, 128);
});

test('materialized nested failures retain writable array identity and mutations', t => {
  const failure = position => ({
    position,
    interval: {startIdx: position, endIdx: position + 1},
    shortMessage: `error ${position}`,
  });
  const nested = failure(1);
  const node = new CorrectionNode(2, failure(0), emptyEffects.append(nested));
  const values = node.nestedFailures;
  t.is(node.nestedFailures, values);
  const descriptor = Object.getOwnPropertyDescriptor(node, 'nestedFailures');
  t.true(descriptor.enumerable);
  t.true(descriptor.writable);
  values.push(failure(2));
  t.deepEqual(
    collectRecoveredFailures(node).map(value => value.position),
    [0, 1, 2]
  );

  const grammar = ohm.grammar('G { S = "{" Item* ! "}"\n Item = letter ! ";" }');
  const result = grammar.match('{a;1; x}', undefined, {recover: true});
  t.true(result.succeeded());
  const recovered = result._cst.children[2];
  t.true(recovered.isCorrection());
  t.deepEqual(Object.keys(recovered), ['matchLength', 'recoveredFailure', 'nestedFailures']);
  const replacement = [];
  recovered.nestedFailures = replacement;
  t.is(recovered.nestedFailures, replacement);
  t.false(Object.hasOwn(recovered, '_nestedFailureEffects'));
  t.deepEqual(collectRecoveredFailures(recovered), [recovered.recoveredFailure]);
});

test('attempt transforms remain correct across overwrites, retirement and depth shifts', t => {
  const attempts = new RecoveryAttempts();
  const stats = {attemptEffectsVisited: 0, attemptEffectsSkipped: 0};
  const replay = new RecoveryAttemptReplay(attempts, 10, stats);
  const value = depth => ({key: 'a', start: 2, rightmost: 3, depth});
  let effects = emptyEffects.append(value(1)).append(value(2));
  for (let i = 0; i < 25; i++) effects = effects.concat(effects);
  replay.apply(effects);
  t.is(attempts.get('a').depth, 2);
  t.true(stats.attemptEffectsVisited < 100);
  const visited = stats.attemptEffectsVisited;
  replay.apply(effects);
  t.is(stats.attemptEffectsVisited, visited + 1);

  attempts.set('a', value(9));
  replay.changed(2);
  replay.apply(effects);
  t.is(attempts.get('a').depth, 2);

  attempts.set('b', {key: 'b', start: 8, rightmost: 9, depth: 1});
  replay.changed(8);
  attempts.delete('a');
  replay.changed(2);
  replay.apply(effects.shift(4));
  t.deepEqual(
    [...attempts].map(([key]) => key),
    ['b', 'a']
  );
  t.is(attempts.get('a').depth, 6);
});

test('unread iteration arrays remain writable in both CST formats', t => {
  for (const api of [ohm, v18]) {
    const grammar = api.grammar('G { S = Item*\n Item = letter ! ";" }');
    const first = grammar.match('x;', undefined, {recover: true})._cst.children[0];
    const children = [];
    first.children = children;
    t.is(first.children, children);
    t.deepEqual(first.childOffsets, [0]);

    const second = grammar.match('x;', undefined, {recover: true})._cst.children[0];
    const offsets = [];
    second.childOffsets = offsets;
    t.is(second.childOffsets, offsets);
    t.is(second.children.length, 1);
  }
});
