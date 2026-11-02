import test from 'ava';
import * as ohm from '../index.mjs';
import * as v18 from '../src/v18.js';
import {MatchState} from '../src/MatchState.js';

const cases = [
  ['direct repetition', 'Block*', '', '{ ( a x; }'],
  ['wrapped repetition', 'Body', 'Body = Block*', '{ ( a x; }'],
  ['optional repetition', 'Block?', '', '{ ( a x; }'],
  [
    'choice of repetitions',
    'Body',
    'Body = Block* "x" -- first\n | Block* -- second',
    '{ ( a x; }',
  ],
  ['parameterized repetition', 'Repeated<Block>', 'Repeated<x> = x*', '{ ( a x; }'],
  ['retained successful prefix', 'Block*', '', '{ (b;) (a x; }'],
];

for (const [name, guarded, extra, input] of cases) {
  test(`a correction owns a failed last child through ${name}`, t => {
    for (const api of [ohm, v18]) {
      const grammar = api.grammar(`G {
        Start = "{" ${guarded} ! "}"
        Block = "(" Line* ! ")"
        Line = letter ! ";"
        ${extra}
      }`);
      const result = grammar.match(input, undefined, {recover: true});
      t.true(result.succeeded());
      const root = grammar.createSemantics()(result);
      const failures = root.recoveredFailures;
      t.deepEqual(
        failures.map(f => f.position),
        [input.indexOf('x'), input.indexOf('}')]
      );
      t.deepEqual(root.child(1).recoveredFailures, []);
      t.deepEqual(root.child(2).recoveredFailures, failures);
      failures.forEach((failure, index) =>
        t.is(failure, result.getRecoveredFailures()[index])
      );
      if (name === 'retained successful prefix') {
        t.is(root.child(1).sourceString, '(b;)');
      }
    }
  });
}

test('a zero-width discarded recovery at the end of B belongs to the correction', t => {
  for (const api of [ohm, v18]) {
    const grammar = api.grammar(`G {
      Start = "{" Body ! "}"
      Body = Item*
      Item = Line "x"
      Line = "a" ! ";"
    }`);
    const result = grammar.match('{;}', undefined, {recover: true});
    t.true(result.succeeded());
    const root = grammar.createSemantics()(result);
    t.deepEqual(
      root.recoveredFailures.map(f => f.position),
      [1, 2]
    );
    t.deepEqual(root.child(1).recoveredFailures, []);
    const nested = root.child(2)._node.nestedFailures;
    t.is(nested.length, 1);
    t.is(nested[0].interval.startIdx, root.child(1).source.endIdx);
    t.is(nested[0].interval.endIdx, nested[0].interval.startIdx);
  }
});

test.serial(
  'discarded B diagnostics occur once in successful and later-failed pass logs',
  t => {
    for (const api of [ohm, v18]) {
      for (const suffix of ['', ' "z"']) {
        const grammar = api.grammar(`G {
        Start = "{" Body ! "}" ${suffix}
        Body = Block*
        Block = "(" Line* ! ")"
        Line = letter ! ";"
      }`);
        let lastLog;
        const original = MatchState.prototype.getMatchResult;
        try {
          MatchState.prototype.getMatchResult = function (...args) {
            const result = original.apply(this, args);
            if (this.recovery) {
              lastLog = Array.isArray(this._recoveryLog)
                ? this._recoveryLog.slice()
                : this._recoveryLog.toArray();
            }
            return result;
          };
          const result = grammar.match('{ ( a x; }', undefined, {recover: true});
          t.is(result.succeeded(), suffix === '');
          t.deepEqual(
            result
              .getRecoveredFailures()
              .slice(0, 2)
              .map(f => f.position),
            [6, 9]
          );
        } finally {
          MatchState.prototype.getMatchResult = original;
        }
        t.deepEqual(
          lastLog.map(f => f.position),
          [9, 6]
        );
        t.is(new Set(lastLog).size, lastLog.length);
      }
    }
  }
);
