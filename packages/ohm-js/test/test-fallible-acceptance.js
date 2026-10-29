/**
 * Acceptance test for `B ! C` recovery.
 *
 * Story: a grammar author marks `Part` as a recovery point. Without asking
 * for recovery, the grammar matches exactly as if `!` were a plain sequence.
 * Asking for recovery, one match reports every broken part, including a part
 * broken at its first character, with the message a plain match gives for
 * that mistake alone, and the CST holds a `_fail` node for each broken part.
 * Recovery never changes a valid parse, never preempts an alternative that
 * matches, never runs past an enclosing stop marker, and always consumes
 * input.
 */

/* eslint-disable max-len, ava/assertion-arguments -- expected messages and trees are long literals; t.deepEqual messages carry the input */
import test from 'ava';
import * as ohm from '../index.mjs';

const FALLIBLE = String.raw`
Chips {
  Chip = "CHIP" name "{" Part* "}"
  Part = PartBody ! ";"
  PartBody = name "(" name ")"
  name = letter alnum*
}`;

const PLAIN = FALLIBLE.replace('PartBody ! ";"', 'PartBody ";"');
const LOOKAHEAD = FALLIBLE.replace('Part = PartBody ! ";"', 'Part = PartBody ! &";" ";"');

const VALID = 'CHIP A { N(a); M(b); }';
const BROKEN = 'CHIP A { N(a b); M(c); X(; }';
const UNCLOSED = 'CHIP A { N(a); M(b';
const FIRST_TOKEN = 'CHIP A { 1N(a); M(c); }';
const MISSING = 'CHIP A { ; M(c); }';
const INPUTS = [VALID, BROKEN, UNCLOSED, FIRST_TOKEN, MISSING];

const FIRST_TOKEN_MESSAGE = 'Line 1, col 10: expected "}" or a letter';

// An iteration followed by a closer, bounded by a stop marker.
const BLOCKS = String.raw`
Blocks {
  Prog = Sub*
  Sub = "sub" "{" Stmt* ! &"}" "}"
  Stmt = StmtBody ! ";"
  StmtBody = Let | Do
  Let = "let" letter
  Do = "do" letter
}`;

const RECOVER = {recover: true};

const EXPECTED_RECOVERIES = [
  {startIdx: 9, endIdx: 15, position: 13, message: 'Line 1, col 14: expected ")"'},
  {startIdx: 23, endIdx: 25, position: 25, message: 'Line 1, col 26: expected a letter'},
];

function recoveries(result) {
  return result.getRecoveredFailures().map(f => ({
    startIdx: f.interval.startIdx,
    endIdx: f.interval.endIdx,
    position: f.position,
    message: f.shortMessage,
  }));
}

function outcome(result) {
  return result.succeeded()
    ? {succeeded: true, recovered: recoveries(result)}
    : {succeeded: false, message: result.shortMessage};
}

function run(source, input, options) {
  return outcome(ohm.grammar(source).match(input, undefined, options));
}

// Structure of a rule body, without source locations.
function bodyShape(rhs) {
  const g = ohm.grammar(String.raw`
G {
  Start = ${rhs}
  Stmt = "s" ";"
  Close = "}"
  Other = "o"
  A = "a"
  B = "b"
  C = "c"
  Line = "l"
  Semi = ";"
}`);
  return JSON.stringify(g.rules.Start.body, (k, v) =>
    k === 'source'
      ? undefined
      : v instanceof Object && !Array.isArray(v)
        ? {kind: v.constructor.name, ...v}
        : v
  );
}

test('syntax: `!` is looser than `*`, `&` and `~`, and tighter than sequence', t => {
  // Whitespace around `!` is optional, and `!&` is two tokens.
  t.is(bodyShape('Line!Semi'), bodyShape('Line ! Semi'));
  t.is(bodyShape('Line! Semi'), bodyShape('Line ! Semi'));
  t.is(bodyShape('((Stmt*)!&Close) Close'), bodyShape('Stmt* ! &Close Close'));

  // Precedence.
  t.is(bodyShape('A B ! C'), bodyShape('A (B ! C)'));
  t.is(bodyShape('Stmt* ! &Close Other'), bodyShape('(Stmt* ! &Close) Other'));
  t.is(bodyShape('A ! C+'), bodyShape('A ! (C+)'));
  t.is(bodyShape('A A A | B ! C C'), bodyShape('A A A | (B ! C) C'));

  // Errors: no chains, no trailing `!`, and a left side that cannot recover.
  t.throws(() => bodyShape('A ! B ! C'));
  t.throws(() => bodyShape('(A ! B) ! C'), {message: /arity/});
  t.throws(() => bodyShape('A !'));
  t.throws(() => bodyShape('~A ! C'));
  t.throws(() => bodyShape('&A ! C'));

  // A quoted "!" is still a terminal.
  t.notThrows(() => bodyShape('A "!" B'));

  // toString round-trips: printing a body and parsing it again gives the same structure.
  for (const rhs of ['Stmt* ! &Close Close', 'A B ! C', 'A ! C+']) {
    const printed = ohm
      .grammar(`G { Start = ${rhs}\n Stmt = "s"\n Close = "}"\n A = "a"\n B = "b"\n C = "c" }`)
      .rules.Start.body.toString();
    t.is(bodyShape(printed), bodyShape(rhs), printed);
  }
});

test('with recover, a part broken at its first character recovers', t => {
  t.deepEqual(run(FALLIBLE, FIRST_TOKEN, RECOVER), {
    succeeded: true,
    recovered: [{startIdx: 9, endIdx: 14, position: 9, message: FIRST_TOKEN_MESSAGE}],
  });
  // A bare `;` is a missing part: nothing is skipped and the synchronizer is consumed.
  t.deepEqual(run(FALLIBLE, MISSING, RECOVER), {
    succeeded: true,
    recovered: [{startIdx: 9, endIdx: 9, position: 9, message: FIRST_TOKEN_MESSAGE}],
  });
});

test('a parse recovery cannot finish reports every error it found', t => {
  // Two broken parts and no closing brace: both recoveries, then the final failure.
  const r = ohm.grammar(FALLIBLE).match('CHIP A { N(a b); X(; M(c', undefined, RECOVER);
  t.true(r.failed());
  t.is(r.shortMessage, ohm.grammar(PLAIN).match('CHIP A { N(a b); X(; M(c').shortMessage);
  t.deepEqual(
    r.getRecoveredFailures().map(f => f.shortMessage),
    [
      'Line 1, col 14: expected ")"',
      'Line 1, col 20: expected a letter',
      'Line 1, col 25: expected ")"',
    ]
  );
});

test('a synchronizer must have arity 1', t => {
  t.throws(() => bodyShape('A ! (B C)'), {message: /arity/});
  t.notThrows(() => bodyShape('A ! &Close'));
});

test('every recovery consumes input, so recovery terminates', t => {
  // A zero-width synchronizer cannot recover a missing part; the match fails as plain.
  t.deepEqual(run(LOOKAHEAD, MISSING, RECOVER), run(PLAIN, MISSING));

  // Thirty stray separators give thirty recoveries, each consuming its `;`.
  const strays = 'sub { ' + '; '.repeat(30) + '}';
  const {succeeded, recovered} = run(BLOCKS, strays, RECOVER);
  t.true(succeeded);
  t.is(recovered.length, 30);
  t.true(recovered.every((r, i) => r.position === 6 + 2 * i));
});

test('`B ! &C` stops before the synchronizer and recovers the same mistakes', t => {
  for (const input of INPUTS) {
    t.deepEqual(run(LOOKAHEAD, input), run(PLAIN, input), input);
  }
  t.deepEqual(run(LOOKAHEAD, BROKEN, RECOVER).recovered, EXPECTED_RECOVERIES);
});
