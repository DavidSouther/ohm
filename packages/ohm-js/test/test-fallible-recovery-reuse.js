import test from 'ava';
import * as ohm from '../index.mjs';
import {MatchState} from '../src/MatchState.js';
import * as v18 from '../src/v18.js';

const HDL = String.raw`Hdl {
  Chip = "CHIP" name "{" Parts "}"
  Parts = "PARTS:" Part* ! &"}"
  Part = PartBody ! ";"
  PartBody = name "(" ListOf<Wire, ","> ")"
  Wire = name "=" name
  name = letter alnum*
}`;
const PLAIN_HDL = HDL.replace('Part* ! &"}"', 'Part* &"}"').replace(
  'PartBody ! ";"',
  'PartBody ";"'
);
const GOOD_PART = '  Nand(a=a,b=b, out=w);';
const BAD_PART = '  Nand(a=a b=b, out=w);';

function source(errors, corrected = 0) {
  const lines = [GOOD_PART];
  for (let i = 0; i < errors; i++) lines.push(i < corrected ? GOOD_PART : BAD_PART);
  lines.push(GOOD_PART);
  return `CHIP Demo {\n PARTS:\n${lines.join('\n')}\n}\n`;
}

function expectedFailures(result) {
  return result.getRightmostFailures().map(failure => ({
    text: failure.toString(),
    type: failure.getType(),
    fluffy: failure.isFluffy(),
  }));
}

function partsIn(node, found = []) {
  if (node.ctorName === 'Part') found.push(node);
  else if (node.children) {
    for (const child of node.children) partsIn(child, found);
  }
  return found;
}

function measuredRecovery(grammar, input) {
  let evaluations = 0;
  let prefixCharacterReads = 0;
  const originalEval = MatchState.prototype.eval;
  const originalCharAt = String.prototype.charAt;
  MatchState.prototype.eval = function (expr) {
    evaluations++;
    return originalEval.call(this, expr);
  };
  // Observe the existing formatter's prefix walk; this is not a general allocation counter.
  // eslint-disable-next-line no-extend-native
  String.prototype.charAt = function (index) {
    if (this === input) prefixCharacterReads++;
    return originalCharAt.call(this, index);
  };
  try {
    const result = grammar.match(input, undefined, {recover: true});
    const failures = result.getRecoveredFailures();
    return {result, failures, evaluations, prefixCharacterReads, inputLength: input.length};
  } finally {
    MatchState.prototype.eval = originalEval;
    // eslint-disable-next-line no-extend-native
    String.prototype.charAt = originalCharAt;
  }
}

test.serial('dense recovery preserves corrected-prefix errors without quadratic replay', t => {
  const growth = [];
  for (const [version, api] of [['v17', ohm], ['v18', v18]]) {
    const grammar = api.grammar(HDL);
    const plain = api.grammar(PLAIN_HDL);
    const rows = [];
    for (const errors of [16, 32, 64]) {
      const input = source(errors);
      const measured = measuredRecovery(grammar, input);
      const {result, failures} = measured;
      t.true(result.succeeded(), `${version}: ${errors} errors recover`);
      t.is(failures.length, errors, `${version}: every error is reported`);
      const parts = partsIn(result._cst);
      t.is(parts.length, errors + 2, `${version}: all parts remain in the CST`);
      const kinds = parts.map(part => part.children.map(child => child.ctorName));
      t.deepEqual(kinds[0], ['PartBody', '_terminal'], `${version}: first valid part`);
      t.deepEqual(kinds[kinds.length - 1], kinds[0], `${version}: last valid part`);
      t.true(
        kinds.slice(1, -1).every(row => row.join(',') === '_fail,_fail'),
        `${version}: recovered parts retain both failure slots`
      );

      // Corrections have equal width, so plain and recovered positions share coordinates.
      // Build these reference parses after measurement; their work is not recovery work.
      for (let i = 0; i < errors; i++) {
        const reference = plain.match(source(errors, i));
        const failure = failures[i];
        t.true(reference.failed(), `${version}: corrected prefix exposes error ${i}`);
        t.is(failure.position, reference.getRightmostFailurePosition());
        t.is(failure.shortMessage, reference.shortMessage);
        t.is(failure.getExpectedText(), reference.getExpectedText());
        t.deepEqual(expectedFailures(failure), expectedFailures(reference));
        t.false(failure.missing);
        t.is(failure.interval.contents, BAD_PART.trim().slice(0, -1));
        t.is(failure.interval.startIdx, input.indexOf(BAD_PART) + 2 + i * (BAD_PART.length + 1));
        t.is(failure.interval.endIdx, failure.interval.startIdx + failure.interval.contents.length);
      }
      t.true(plain.match(source(errors, errors)).succeeded(), `${version}: all corrections parse`);
      rows.push({
        errors,
        evaluations: measured.evaluations,
        prefixCharacterReads: measured.prefixCharacterReads,
        inputLength: measured.inputLength,
      });
    }
    growth.push({version, rows});
  }

  const violations = [];
  for (const {version, rows} of growth) {
    for (let i = 1; i < rows.length; i++) {
      const previous = rows[i - 1];
      const current = rows[i];
      if (current.evaluations > 2.75 * previous.evaluations) {
        violations.push(`${version}: eval growth ${JSON.stringify([previous, current])}`);
      }
    }
    for (const row of rows) {
      if (row.prefixCharacterReads > 12 * row.inputLength) {
        violations.push(`${version}: repeated formatter prefix scans ${JSON.stringify(row)}`);
      }
    }
  }
  t.deepEqual(violations, [], 'all semantics passed; recovery work must grow below quadratic');
});

test('valid and invalid matches of one grammar are independent of the cache-free first pass', t => {
  // The first pass runs without the reuse cache after a valid match, and with it after an
  // invalid one; the order of earlier matches must not change any later result.
  const fresh = input => {
    const result = ohm.grammar(HDL).match(input, undefined, {recover: true});
    return [result.succeeded(), result.message, result.getRecoveredFailures().length];
  };
  const grammar = ohm.grammar(HDL);
  const run = input => {
    const result = grammar.match(input, undefined, {recover: true});
    return [result.succeeded(), result.message, result.getRecoveredFailures().length];
  };
  const inputs = [source(0), source(2), source(0), source(0), source(3), source(1), source(0)];
  for (const input of inputs) t.deepEqual(run(input), fresh(input));
});
