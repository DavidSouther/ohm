import test from 'ava';
import * as ohm from '../index.mjs';
import {DiagnosticSnapshot} from '../src/DiagnosticSnapshot.js';
import {Interval} from '../src/Interval.js';
import {RecoveredFailure} from '../src/RecoveredFailure.js';
import {SourcePositions} from '../src/SourcePositions.js';
import {getLineAndColumn} from '../src/util.js';

const properties = failure => ({
  expression: failure.getPExpr(),
  text: failure.getText(),
  type: failure.getType(),
  fluffy: failure.isFluffy(),
});

test('indexed positions preserve line, column and excerpt formatting at every offset', t => {
  for (const input of ['', 'abc', '\n', '\r\n', 'a\rb\nc\r\nd\n', '\r\r\n\n', '😀\rX\n𐀀\r\n']) {
    const positions = new SourcePositions(input);
    for (let offset = 0; offset <= input.length; offset++) {
      const expected = getLineAndColumn(input, offset);
      const actual = positions.getLineAndColumn(offset);
      t.deepEqual(positions.getLineAndColumnNumbers(offset), {
        lineNum: expected.lineNum,
        colNum: expected.colNum,
      });
      t.deepEqual(actual, expected, `${JSON.stringify(input)} at ${offset}`);
      t.is(actual.toString(), expected.toString());
      t.is(actual.toString([0, input.length]), expected.toString([0, input.length]));
    }
  }
});

test('a diagnostic snapshot preserves failures without retaining parser state', t => {
  const grammar = ohm.grammar('G { Start = "a" "b" | "a" "c" }');
  const result = grammar.match('a!');
  const failures = result.getRightmostFailures();
  const snapshot = DiagnosticSnapshot.fromResult(result, new SourcePositions(result.input));
  t.is(snapshot.shortMessage, result.shortMessage);
  t.is(snapshot.getExpectedText(), result.getExpectedText());
  t.is(snapshot.getRightmostFailurePosition(), result.getRightmostFailurePosition());
  t.is(DiagnosticSnapshot.fromResult(snapshot), snapshot);
  t.deepEqual(snapshot.getRightmostFailures().map(properties), failures.map(properties));
  t.false('matcher' in snapshot);
  t.false('_recovery' in snapshot);
  t.false('_passResult' in snapshot);

  const saved = snapshot.getRightmostFailures().map(properties);
  failures[0].makeFluffy();
  const exposed = snapshot.getRightmostFailures();
  exposed[0].makeFluffy();
  exposed.length = 0;
  result.matcher.setInput('different');
  t.deepEqual(snapshot.getRightmostFailures().map(properties), saved);
  t.is(snapshot.shortMessage, 'Line 1, col 2: expected "c" or "b"');
});

test('short recovery diagnostics do not materialize source excerpts', t => {
  const input = 'a'.repeat(10000) + '!';
  const result = ohm.grammar('G { Start = "a"* "b" }').match(input);
  result.getRightmostFailures();
  const index = new SourcePositions(input);
  const coordinatesOnly = {
    getLineAndColumnNumbers: offset => index.getLineAndColumnNumbers(offset),
    getLineAndColumn() {
      throw new Error('short diagnostics must not construct source excerpts');
    },
  };
  result._recovery = {positionIndex: coordinatesOnly};
  const snapshot = DiagnosticSnapshot.fromResult(result, coordinatesOnly);
  t.is(snapshot.shortMessage, 'Line 1, col 10001: expected "b"');
  t.is(result.shortMessage, snapshot.shortMessage);
});

test('a recovered failure owns detached diagnostics for an earlier pass', t => {
  const result = ohm.grammar('G { Start = "a" "b" }').match('a!');
  const recovered = new RecoveredFailure(new Interval('a!', 1, 2), 1, result);
  t.is(recovered.shortMessage, result.shortMessage);
  t.is(recovered.getExpectedText(), result.getExpectedText());
  t.deepEqual(
    recovered.getRightmostFailures().map(properties),
    result.getRightmostFailures().map(properties)
  );
  t.false('_passResult' in recovered);
  result.getRightmostFailures()[0].makeFluffy();
  t.is(recovered.getExpectedText(), '"b"');
  t.false(recovered.getRightmostFailures()[0].isFluffy());
});
