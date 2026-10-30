import test from 'ava';
import * as ohm from '../index.mjs';
import * as v18 from '../src/v18.js';
import {RecoveryCache} from '../src/RecoveryCache.js';

const diagnostic = failure => ({
  interval: [failure.interval.startIdx, failure.interval.endIdx],
  position: failure.position,
  message: failure.shortMessage,
  expected: failure.getExpectedText(),
});
const tree = node =>
  node && {
    kind: node.ctorName,
    length: node.matchLength,
    offsets: node.childOffsets,
    diagnostic: node.recoveredFailure && diagnostic(node.recoveredFailure),
    children: node.children?.map(tree),
  };
const summary = result => ({
  success: result.succeeded(),
  message: result.message,
  diagnostics: result.getRecoveredFailures().map(diagnostic),
  tree: tree(result._cst),
});

test.serial('cached and uncached recovery preserve all three slots and diagnostics', t => {
  const source = `G {
    Start = "{" Item* ! "}"
    Item = Block | Line
    Block = "(" Line* ! ")"
    Line = Body ! ";"
    Body = letter
  }`;
  for (const api of [ohm, v18]) {
    const grammar = api.grammar(source);
    for (const input of ['{a;b;}', '{a x;1;b;}', '{a;(b x;1;)c;}', '{a;(b;}', '{a;1;']) {
      const cached = grammar.match(input, undefined, {recover: true, firstPass: 'cached'});
      const original = RecoveryCache.prototype.evaluate;
      let uncached;
      try {
        RecoveryCache.prototype.evaluate = function (...args) {
          this.disabled = true;
          return original.apply(this, args);
        };
        uncached = grammar.match(input, undefined, {recover: true, firstPass: 'cached'});
      } finally {
        RecoveryCache.prototype.evaluate = original;
      }
      t.deepEqual(summary(cached), summary(uncached), `${input}`);
      t.is(uncached._recovery.cache.stats.reused, 0);
      if (cached.succeeded()) {
        const rootFailures = grammar.createSemantics()(cached).recoveredFailures;
        t.deepEqual(rootFailures, cached.getRecoveredFailures());
      }
    }
  }
});

test.serial('discarded join diagnostics survive cached and uncached recovery', t => {
  for (const api of [ohm, v18]) {
    for (const [guard, input, positions, guardedPositions, nestedPositions] of [
      ['"a"', 'a b x; q c;z', [4, 7], [], [4]],
      ['Guard', 'a x;g b y; q c;z', [2, 8, 11], [2], [8]],
    ]) {
      const grammar = api.grammar(`G {
        Start = ${guard} ! Join
        Guard = Inner "g"
        Join = Inner "z"
        Inner = letter ! ";"
      }`);
      const run = () =>
        grammar.match(input, undefined, {
          recover: true,
          firstPass: 'cached',
        });
      const cached = run();
      const original = RecoveryCache.prototype.evaluate;
      let uncached;
      try {
        RecoveryCache.prototype.evaluate = function (...args) {
          this.disabled = true;
          return original.apply(this, args);
        };
        uncached = run();
      } finally {
        RecoveryCache.prototype.evaluate = original;
      }
      t.deepEqual(summary(cached), summary(uncached));
      for (const result of [cached, uncached]) {
        t.true(result.succeeded());
        const root = grammar.createSemantics()(result);
        t.deepEqual(
          root.recoveredFailures.map(f => f.position),
          positions
        );
        root.recoveredFailures.forEach((failure, index) => {
          t.is(failure, result.getRecoveredFailures()[index]);
        });
        t.deepEqual(
          root.child(1).recoveredFailures.map(f => f.position),
          positions.slice(-2)
        );
        t.deepEqual(
          root.child(1)._node.nestedFailures.map(f => f.position),
          nestedPositions
        );
        t.deepEqual(
          root.child(0).recoveredFailures.map(f => f.position),
          guardedPositions
        );
        t.deepEqual(root.child(2).recoveredFailures, []);
      }
    }
  }
});

test.serial(
  'failed guarded children retain ownership through cached and uncached wrappers',
  t => {
    for (const api of [ohm, v18]) {
      for (const [guarded, extra] of [
        ['Block*', ''],
        ['Body', 'Body = Block*'],
        ['Block?', ''],
        ['Body', 'Body = Block* "x" -- first\n | Block* -- second'],
        ['Repeated<Block>', 'Repeated<x> = x*'],
      ]) {
        const grammar = api.grammar(`G {
        Start = "{" ${guarded} ! "}"
        Block = "(" Line* ! ")"
        Line = letter ! ";"
        ${extra}
      }`);
        const run = () =>
          grammar.match('{ ( a x; }', undefined, {
            recover: true,
            firstPass: 'cached',
          });
        const cached = run();
        const original = RecoveryCache.prototype.evaluate;
        let uncached;
        try {
          RecoveryCache.prototype.evaluate = function (...args) {
            this.disabled = true;
            return original.apply(this, args);
          };
          uncached = run();
        } finally {
          RecoveryCache.prototype.evaluate = original;
        }
        t.deepEqual(summary(cached), summary(uncached));
        for (const result of [cached, uncached]) {
          t.true(result.succeeded());
          const root = grammar.createSemantics()(result);
          t.deepEqual(
            root.recoveredFailures.map(f => f.position),
            [6, 9]
          );
          t.deepEqual(root.child(1).recoveredFailures, []);
          t.deepEqual(root.child(2).recoveredFailures, root.recoveredFailures);
        }
      }
    }
  }
);
