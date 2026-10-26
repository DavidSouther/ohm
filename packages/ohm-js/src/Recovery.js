import {Interval} from './Interval.js';
import {MatchState} from './MatchState.js';
import {RecoveredFailure, byPosition} from './RecoveredFailure.js';
import * as errors from './errors.js';

// --------------------------------------------------------------------
// Recovery at `B ! C` recovery points
// --------------------------------------------------------------------

/*
  State shared by every pass of one recovering match.
  - `permitted` maps a recovery key (a Fallible at a start position) to the
    farthest failure position and result of the pass that permitted it.
  - `attempts` maps a recovery key to the last failed, unpermitted attempt
    seen there. Attempts are kept across passes, because applications that
    were memoized in an earlier pass do not run, or record attempts, again.
*/
export class RecoveryContext {
  constructor() {
    this.permitted = new Map();
    this.attempts = new Map();
  }
}

// Every recovery from a failed parse, in position order. An
// application that is not memoized can run more than once in a pass,
// logging recoveries each time.
function loggedFailures(log) {
  const seen = new Set();
  const found = [];
  for (const f of log) {
    const k = `${f.interval.startIdx}:${f.interval.endIdx}:${f.position}`;
    if (!seen.has(k)) {
      seen.add(k);
      found.push(f);
    }
  }
  return found.sort(byPosition);
}

function runPass(matcher, startExpr, ctx, tracing) {
  const state = new MatchState(matcher, startExpr, undefined, ctx);
  if (tracing) {
    const trace = state.getTrace();
    trace.result._recovery = ctx;
    return {state, result: trace.result, trace};
  }
  const result = state.getMatchResult();
  result._recovery = ctx;
  return {state, result};
}

/*
  The pass driver. Pass 1 has no permissions, so it is a plain parse. Each
  failed pass permits the innermost unpermitted attempt that reached its
  farthest failure, with that pass's message, or ends the match. There is no
  pass cap: each pass adds a distinct permission, so the match terminates.

  All passes share the matcher's memo table. A new permission at `s` clears
  only the memo entries whose examined input reaches `s`, as
  `Matcher#replaceInputRange` does, and the attempts whose span covers `s`.
*/
export function matchRecovering(matcher, startExpr, opts) {
  if (matcher._isMemoTableStale) {
    throw errors.matcherCannotRecover('its input changed after an earlier match');
  }
  if (matcher._memoMode === 'plain') {
    throw errors.matcherCannotRecover('its memo table comes from a match without recovery');
  }
  // A fresh RecoveryContext has no attempts for entries left by an earlier
  // match, so start empty. A plain matcher is refused anyway, to keep
  // incremental matching from mixing the two kinds of match.
  matcher._resetMemoTable();
  matcher._memoMode = 'recover';

  const ctx = new RecoveryContext();
  let first;
  for (;;) {
    const {state, result} = runPass(matcher, startExpr, ctx, false);
    if (result.succeeded()) {
      return opts.tracing ? runPass(matcher, startExpr, ctx, true).trace : result;
    }

    // Compute the message now, while this pass's permissions are in force.
    result.getRightmostFailures();
    void result.shortMessage;
    first = first || result;

    const position = result.getRightmostFailurePosition();
    let chosen;
    for (const attempt of ctx.attempts.values()) {
      if (attempt.rightmost !== position || ctx.permitted.has(attempt.key)) continue;
      if (
        !chosen ||
        attempt.start > chosen.start ||
        (attempt.start === chosen.start && attempt.depth > chosen.depth)
      ) {
        chosen = attempt;
      }
    }

    if (!chosen) {
      // Recovery cannot finish: every recovery the last pass made, then the
      // final failure. The result's own message stays pass 1's.
      const finalFailure = new RecoveredFailure(
        new Interval(result.input, position, position),
        position,
        result
      );
      first._recoveredFailures = [...loggedFailures(state._recoveryLog), finalFailure];
      if (opts.tracing) {
        const {trace} = runPass(matcher, startExpr, ctx, true);
        trace.result = first;
        return trace;
      }
      return first;
    }

    const s = chosen.start;
    ctx.permitted.set(chosen.key, {position, result});
    const memoTable = matcher._memoTable;
    for (let pos = 0; pos <= s && pos < memoTable.length; pos++) {
      const posInfo = memoTable[pos];
      if (posInfo) posInfo.clearObsoleteEntries(pos, s);
    }
    for (const [key, attempt] of ctx.attempts) {
      if (attempt.start <= s && attempt.rightmost >= s) ctx.attempts.delete(key);
    }
  }
}
