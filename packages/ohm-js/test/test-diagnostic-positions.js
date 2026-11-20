import test from 'ava';
import * as ohm from '../index.mjs';
import {MatchState} from '../src/MatchState.js';

const modes = [{}, ...['auto', 'cached', 'probe'].map(firstPass => ({recover: true, firstPass}))];

test('ordinary failures use the rightmost grammar failure regardless of expected text', t => {
  const cases = [
    ['Start = "name" ";"', 'name\n wrong', 6],
    ['Start = "name" "done"', 'name\n wrong', 6],
    ['Start = "name" semi\n semi (a semicolon) = ";"', 'name\n wrong', 6],
    ['Start = "name" (";" | digit)', 'name\n wrong', 6],
    ['Start = "name" ";"\n space += "~"', 'name~~wrong', 6],
    ['Start = token ";"\n token = "name~"\n space += "~"', 'name~~wrong', 6],
    ['Start = "name" ";"\n space += comment\n comment = "/*" (~"*/" any)* "*/"',
      'name/*hi*/wrong', 10],
  ];
  for (const [rules, input, position] of cases) {
    const g = ohm.grammar(`G { ${rules} }`);
    for (const options of modes) {
      const r = g.match(input, undefined, options);
      t.true(r.failed(), `${rules}`);
      t.is(r.getRightmostFailurePosition(), position, `${rules}`);
      t.is(r.getDiagnosticPosition(), position, `${rules}`);
      t.is(r.getInterval().startIdx, position, `${rules}`);
    }
    const traced = g.trace(input, undefined, {recover: true}).result;
    t.is(traced.getDiagnosticPosition(), position, `${rules}`);
  }
});

test('ordinary recovery diagnostics preserve the selected rightmost failure', t => {
  const g = ohm.grammar('G { Start = ("a" ";") ! "}" }');
  for (const firstPass of ['auto', 'cached', 'probe']) {
    const r = g.match('a\n x}', undefined, {recover: true, firstPass});
    t.true(r.succeeded());
    const failure = r.getRecoveredFailures()[0];
    t.is(failure.position, 3);
    t.is(failure.getDiagnosticPosition(), 3);
  }
});

test('saved display position survives later matcher edits', t => {
  const g = ohm.grammar('G { Start = "name" ";" }');
  for (const first of ['getInterval', 'getDiagnosticPosition']) {
    const matcher = g.matcher().setInput('name\n  wrong');
    const old = matcher.match();
    matcher.setInput('name;');
    const memo = matcher._memo;
    old[first]();
    t.is(old.getInterval().startIdx, 7);
    t.is(old.getDiagnosticPosition(), 7);
    t.is(matcher.getInput(), 'name;');
    t.is(matcher._memo, memo);
    t.true(matcher.match().succeeded());
  }
});

function countEvaluations(fn) {
  const original = MatchState.prototype.eval;
  let count = 0;
  MatchState.prototype.eval = function (expr) {
    count++;
    return original.call(this, expr);
  };
  try {
    fn();
  } finally {
    MatchState.prototype.eval = original;
  }
  return count;
}

const statements = ohm.grammar(`G {
  Prog = Stmt*
  Stmt = ident "=" Exp ! ";"
  Exp = Exp "+" Pri  -- add
      | Pri
  Pri = ident | number | Paren
  Paren = "(" Exp ")"
  ident = letter alnum*
  number = digit+
}`);

test('a failure-only rematch reuses the plain match memo table', t => {
  const valid = Array.from({length: 200}, (_, i) => `x${i} = a + (b + ${i});`).join('\n');
  let result;
  const matchEvaluations = countEvaluations(() => {
    result = statements.match(valid + '\nz = 1 2;');
  });
  const rematchEvaluations = countEvaluations(() => result.getDiagnosticPosition());
  t.is(result.getDiagnosticPosition(), valid.length + 6);
  t.true(
    rematchEvaluations * 20 < matchEvaluations,
    `${rematchEvaluations} rematch evaluations, ${matchEvaluations} match evaluations`
  );
});

test('a successful probe pass does not track terminal progress', t => {
  const matcher = statements.matcher().setInput('a = 1; b = a + 2;');
  const result = matcher.match(undefined, {recover: true, firstPass: 'probe'});
  t.true(result.succeeded());
  t.is(result.getFirstPass().mode, 'probe');
  t.is(matcher._memo.terminalOffsets, undefined);
});
