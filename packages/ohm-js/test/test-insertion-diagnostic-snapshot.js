import test from 'ava';
import * as ohm from '../index.mjs';

test('inferred insertion retains same-position join and continuation expectations', t => {
  const g = ohm.grammar(`G {
    Start = Stmt* ! end
    Stmt = ("let" name "=" digit+) ! ";"
    name = letter+
  }`);
  for (const firstPass of ['cached', 'probe', 'auto']) {
    for (const trace of [false, true]) {
      const source = 'let a=1\nlet b=2;';
      const options = {recover: true, firstPass};
      const result = trace
        ? g.trace(source, undefined, options).result
        : g.match(source, undefined, options);
      t.true(result.succeeded());
      const [failure] = result.getRecoveredFailures();
      t.true(failure.missing);
      t.is(failure.position, 7);
      t.is(failure.getDiagnosticPosition(), 7);
      t.is(failure.getExpectedText(), '";" or a digit');
      t.is(failure.shortMessage, 'Line 1, col 8: expected ";" or a digit');
      t.deepEqual(
        failure.getRightmostFailures().map(f => f.toString()).sort(),
        ['";"', 'a digit'].sort()
      );
    }
  }
});

test('inferred insertion never borrows a failure beyond the join', t => {
  const g = ohm.grammar(`G { Start = A ! ";" "next"
 A = "a" "b" "next" "z" -- long
 | "a" "b" -- short }`);
  const result = g.match('ab next', undefined, {recover: true});
  t.true(result.succeeded());
  const [failure] = result.getRecoveredFailures();
  t.true(failure.missing);
  t.is(failure.position, 2);
  t.is(failure.getExpectedText(), '";"');
});
