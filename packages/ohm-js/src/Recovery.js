import {Interval} from './Interval.js';
import {MatchState} from './MatchState.js';
import {RecoveredFailure, distinctByPosition} from './RecoveredFailure.js';
import {DiagnosticSnapshot} from './DiagnosticSnapshot.js';
import {SourcePositions} from './SourcePositions.js';
import {RecoveryAttempts} from './RecoveryAttempts.js';

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
  constructor(input = '') {
    this.permitted = new Map();
    this.attempts = new RecoveryAttempts();
    this.positionIndex = new SourcePositions(input);
  }

  chooseAttempt(position) {
    return this.attempts.choose(position, this.permitted);
  }

  permit(attempt, result) {
    this.permitted.set(attempt.key, {position: attempt.rightmost, result});
    this.attempts.invalidateAt(attempt.start);
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

  const ctx = new RecoveryContext(matcher.getInput());
  let first;
  for (;;) {
    const {state, result} = runPass(matcher, startExpr, ctx, false);
    if (result.succeeded()) {
      return opts.tracing ? runPass(matcher, startExpr, ctx, true).trace : result;
    }

    // Compute the message now, while this pass's permissions are in force.
    result.getRightmostFailures();
    void result.shortMessage;
    const diagnostic = DiagnosticSnapshot.fromResult(result, ctx.positionIndex);
    first = first || result;

    const position = result.getRightmostFailurePosition();
    const chosen = ctx.chooseAttempt(position);

    if (!chosen) {
      // Recovery cannot finish: every recovery the last pass made, then the
      // final failure. The final result's message is the message of the first failure.
      const finalFailure = new RecoveredFailure(
        new Interval(result.input, position, position),
        position,
        diagnostic
      );
      // An application that is not memoized can run more than once in a
      // pass, logging its recoveries each time.
      const failures = [];
      state._recoveryLog.forEachUnique(failure => failures.push(failure));
      first._recoveredFailures = [...distinctByPosition(failures), finalFailure];
      if (opts.tracing) {
        const {trace} = runPass(matcher, startExpr, ctx, true);
        trace.result = first;
        return trace;
      }
      return first;
    }

    ctx.permit(chosen, diagnostic);
    matcher._invalidateMemoEntries(chosen.start, chosen.start + 1);
  }
}
