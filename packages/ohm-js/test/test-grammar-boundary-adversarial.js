/* eslint-disable max-len, ava/assertion-arguments */
import test from 'ava';
import * as ohm from '../index.mjs';

const modes = [{}, ...['cached', 'probe', 'auto'].map(firstPass => ({recover: true, firstPass}))];
const cases = [
  ['declared delimiter', 'Start = "name" ! ";"', 'name\n wrong', 6, 4],
  ['declared word', 'Start = "name" ! "done"', 'name\n wrong', 6, 4],
  ['described join', 'Start = "name" ! Semi\n Semi (a semicolon) = ";"', 'name\n wrong', 6, 4],
  ['nullable guard tail', 'Start = ("name" Empty) ! ";"\n Empty = ""', 'name\n wrong', 6, 4],
  ['lookahead memo', 'Start = (&Word Word) ! ";"\n Word = "name"', 'name\n wrong', 6, 4],
  ['explicit space', 'Start = ("name" #spaces) ! ";"', 'name wrong', 5, 5],
  ['partial join', 'Start = "name" ! Join\n Join = "x" ";"', 'name\n xwrong', 7, 7],
  ['nonjoin competitor', 'Start = A | B\n A = "name" ! ";"\n B = "name" ";"', 'name wrong', 5, 5],
  ['nonjoin competitor reversed', 'Start = B | A\n A = "name" ! ";"\n B = "name" ";"', 'name wrong', 5, 5],
  ['abandoned farther guard', 'Start = Guard ! ";"\n Guard = "x" "next" "z" -- long\n | "x" -- short', 'x next', 6, 6],
  ['empty guard', 'Start = Stmt* ! "}"\n Stmt = letter+ ";"', ' 1aa;', 1, 1],
  ['custom implicit spaces', 'Start = "name" ! ";"\n space += "~"', 'name~~wrong', 6, 4],
];
for (const [name, rules, input, rightmost, display] of cases) {
  test(name, t => {
    const g = ohm.grammar(`G { ${rules} }`);
    for (const options of modes) {
      const r = g.match(input, undefined, options);
      t.true(r.failed(), JSON.stringify(options));
      t.is(r.getRightmostFailurePosition(), rightmost, JSON.stringify(options));
      t.is(r.getDiagnosticPosition(), display, JSON.stringify(options));
      t.is(r.getInterval().startIdx, display, JSON.stringify(options));
    }
    const traced = g.trace(input, undefined, {recover: true}).result;
    t.true(traced.failed());
    t.is(traced.getRightmostFailurePosition(), rightmost);
    t.is(traced.getDiagnosticPosition(), display);
  });
}

test('an abandoned guard alternative that explicitly consumes whitespace vetoes relocation', t => {
  const grammar = 'G { Start = Guard ! ";" Guard = "name" #("\\n " "x") -- long\n | "name" -- short }';
  const g = ohm.grammar(grammar);
  for (const options of modes) {
    const result = g.match('name\n wrong', undefined, options);
    t.true(result.failed(), JSON.stringify(options));
    t.is(result.getRightmostFailurePosition(), 6, JSON.stringify(options));
    t.is(result.getDiagnosticPosition(), 6, JSON.stringify(options));
  }
});

test('zero-width synchronizer joins do not move diagnostic positions', t => {
  for (const [join, extra] of [
    ['&"}"', ''],
    ['NotClose', 'NotClose = &"}"'],
    ['end', ''],
    ['MaybeClose', 'MaybeClose = "!" | &"}"'],
  ]) {
    const g = ohm.grammar(`G { Start = "{" Stmt* ! ${join}\n Stmt = letter+ ";"\n ${extra} }`);
    for (const options of modes) {
      const result = g.match('{ let;\n typo', undefined, options);
      if (result.failed()) {
        t.is(result.getDiagnosticPosition(), result.getRightmostFailurePosition(), `${join} ${JSON.stringify(options)}`);
      } else {
        const failures = result.getRecoveredFailures();
        for (const f of failures) t.is(f.getDiagnosticPosition(), f.position, `${join} ${JSON.stringify(options)}`);
      }
    }
  }
});


test('described multi-token join failure does not move past consumed input', t => {
  const g = ohm.grammar('G { Start = "a" ! Join  Join (a join) = "x" "y" }');
  for (const options of [{}, {recover: true, firstPass: 'cached'},
    {recover: true, firstPass: 'probe'}, {recover: true, firstPass: 'auto'}]) {
    for (const result of [g.match('a x z', undefined, options),
      g.trace('a x z', undefined, options).result]) {
      t.is(result.getRightmostFailurePosition(), 2);
      t.is(result.getDiagnosticPosition(), 2);
    }
  }
});

test('multi-token joins anchor only before they attempt to consume', t => {
  for (const rule of ['Join = "xy"', 'Join = "x" "y"', 'Join (a join) = "x" "y"',
    'Join (a join) = #("x" "y")']) {
    const g = ohm.grammar(`G { Start = "a" ! Join\n ${rule} }`);
    for (const options of modes) {
      const result = g.match('a z', undefined, options);
      t.is(result.getRightmostFailurePosition(), 2, rule);
      t.is(result.getDiagnosticPosition(), 1, rule);
      t.is(g.trace('a z', undefined, options).result.getDiagnosticPosition(), 1, rule);
    }
  }
});

test('case-insensitive terminals contribute guard and join positions', t => {
  for (const [rules, input, raw, display] of [
    ['Start = caseInsensitive<"name"> ! ";"', 'NAME\n wrong', 6, 4],
    ['Start = caseInsensitive<""> ! ";"', ' wrong', 1, 1],
    ['Start = "name" ! caseInsensitive<"END">', 'name\n wrong', 6, 4],
    ['Start = "name" ! Join\n Join = caseInsensitive<"X"> "y"', 'name\n Xwrong', 7, 7],
    ['Start = "name" ! (caseInsensitive<""> | &"!")', 'name\n wrong', 6, 6],
  ]) {
    const g = ohm.grammar(`G { ${rules} }`);
    for (const options of modes) {
      for (const result of [g.match(input, undefined, options), g.trace(input, undefined, options).result]) {
        t.is(result.getRightmostFailurePosition(), raw, rules);
        t.is(result.getDiagnosticPosition(), display, rules);
      }
    }
  }
});

test('failed joins inside lookahead use the same diagnostic in every match mode', t => {
  const g = ohm.grammar('G { Start = &Item Item\n Item = "a" ! ";" }');
  for (const options of modes) {
    for (const result of [
      g.match('a x', undefined, options),
      g.trace('a x', undefined, options).result,
    ]) {
      t.true(result.failed());
      t.is(result.getRightmostFailurePosition(), 2);
      t.is(result.getDiagnosticPosition(), 1);
      t.is(result.shortMessage, 'Line 1, col 2: expected ";"');
    }
  }
});

test('a recovery scan contributes only the selected join to the retained guard', t => {
  for (const tokenRule of ['', 'recoveryToken = any']) {
    for (const [join, input, expected] of [
      ['&"z"', 'a xxz!', [[2, 2, 'xx'], [4, 1, 'z']]],
      ['"z"', 'a xxzx!', [[2, 1, 'xx'], [5, 5, 'x']]],
    ]) {
      const g = ohm.grammar(`G {
        Start = Guard ! "!"
        Guard = "a" ! Sync
        Sync = ${join}
        ${tokenRule}
      }`);
      for (const options of modes.slice(1)) {
        for (const result of [g.match(input, undefined, options),
          g.trace(input, undefined, options).result]) {
          t.true(result.succeeded());
          t.deepEqual(result.getRecoveredFailures().map(failure => [
            failure.position, failure.getDiagnosticPosition(), failure.interval.contents,
          ]), expected);
        }
      }
    }
  }
});

test('disagreeing inner and outer joins keep the rightmost position', t => {
  const g = ohm.grammar(`G {
    Start = Guard ! ";"
    Guard = ("a" ! "y") -- inner
          | #("a" " ") -- kept
  }`);
  for (const options of modes) {
    const inner = g.match('a  wrong', 'Guard_inner', options);
    t.is(inner.getDiagnosticPosition(), 1);
    const outer = g.match('a  wrong', undefined, options);
    t.is(outer.getRightmostFailurePosition(), 3);
    t.is(outer.getDiagnosticPosition(), 3);
    t.is(outer.getExpectedText(), '";" or "y"');
  }
});
