import {Interval} from './Interval.js';
import {MatchState} from './MatchState.js';
import {RecoveredFailure, byPosition} from './RecoveredFailure.js';

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

  chooseAttempt(position) {
    let chosen;
    for (const attempt of this.attempts.values()) {
      if (attempt.rightmost !== position || this.permitted.has(attempt.key)) continue;
      if (
        !chosen ||
        attempt.start > chosen.start ||
        (attempt.start === chosen.start && attempt.depth > chosen.depth)
      ) {
        chosen = attempt;
      }
    }
    return chosen;
  }

  permit(attempt, result) {
    this.permitted.set(attempt.key, {position: attempt.rightmost, result});
    for (const [key, recorded] of this.attempts) {
      if (recorded.start <= attempt.start && recorded.rightmost >= attempt.start) {
        this.attempts.delete(key);
      }
    }
  }
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
  Each retry adds a distinct permission, so recovery terminates without
  a pass cap.
*/
export function matchRecovering(matcher, startExpr, opts) {
  matcher._prepareForRecovery();

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
    const chosen = ctx.chooseAttempt(position);

    if (!chosen) {
      // Recovery cannot finish: every recovery the last pass made, then the
      // final failure. The final result's message is the message of the first failure.
      const finalFailure = new RecoveredFailure(
        new Interval(result.input, position, position),
        position,
        result
      );
      first._recoveredFailures = [...state._recoveryLog].sort(byPosition).concat(finalFailure);
      if (opts.tracing) {
        const {trace} = runPass(matcher, startExpr, ctx, true);
        trace.result = first;
        return trace;
      }
      return first;
    }

    ctx.permit(chosen, result);
    matcher._invalidateMemoEntries(chosen.start, chosen.start + 1);
  }
}
