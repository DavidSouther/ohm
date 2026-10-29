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

test('a synchronizer must have arity 1', t => {
  t.throws(() => bodyShape('A ! (B C)'), {message: /arity/});
  t.notThrows(() => bodyShape('A ! &Close'));
});
