import {Interval} from './Interval.js';
import {MatchState} from './MatchState.js';
import {RecoveredFailure, distinctByPosition} from './RecoveredFailure.js';
import {DiagnosticSnapshot} from './DiagnosticSnapshot.js';
import {SourcePositions} from './SourcePositions.js';
import {RecoveryCache} from './RecoveryCache.js';
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
    this.cache = new RecoveryCache(this);
    // How the first pass ran; see `matchRecovering` and MatchResult#getFirstPass.
    this.firstPass = undefined;
  }

  chooseAttempt(position) {
    return this.attempts.choose(position, this.permitted);
  }

  permit(attempt, result) {
    this.permitted.set(attempt.key, {position: attempt.rightmost, result});
    for (const retired of this.attempts.invalidateAt(attempt.start)) {
      this.cache.attemptReplay.changed(retired.start);
      this.cache.invalidate(retired.key);
    }
    this.cache.invalidate(attempt.key);
  }
}

// Whether the last recovering match of a grammar succeeded on its first pass; a performance hint
// only, it never changes a result.
const firstPassSucceeded = new WeakMap();

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

  // Nothing is reused within a single pass, and valid input needs only one. A "probe" is a first
  // pass without the reuse cache; if it fails, the match restarts with the cache enabled, which
  // costs an extra pass. `firstPass` is 'probe' or 'cached' to force that choice. With 'auto'
  // the probe runs when the grammar's previous recovering match was valid, or there was none.
  let ctx = new RecoveryContext(matcher.getInput());
  const {firstPass} = opts;
  let probing =
    firstPass === 'auto' ? firstPassSucceeded.get(matcher.grammar) ?? true : firstPass === 'probe';
  const report = {mode: probing ? 'probe' : 'cached', better: undefined};
  ctx.firstPass = report;
  ctx.cache.disabled = probing;
  let first;
  let firstPassSeen = false;
  for (;;) {
    const {state, result} = runPass(matcher, startExpr, ctx, false);
    if (!firstPassSeen) {
      firstPassSeen = true;
      firstPassSucceeded.set(matcher.grammar, result.succeeded());
      report.better = result.succeeded() ? 'probe' : 'cached';
    }
    if (probing && !result.succeeded()) {
      // The probe's memo entries have no recovery records, so later permits could not
      // invalidate them.
      probing = false;
      matcher._resetMemoTable();
      ctx = new RecoveryContext(matcher.getInput());
      ctx.firstPass = report;
      continue;
    }
    if (result.succeeded()) {
      const answer = opts.tracing ? runPass(matcher, startExpr, ctx, true).trace : result;
      ctx.cache.release();
      ctx.attempts.clear();
      return answer;
    }
    ctx.cache.flushAttempts(state._attemptEffects);

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
        ctx.cache.release();
        ctx.attempts.clear();
        return trace;
      }
      ctx.cache.release();
      ctx.attempts.clear();
      return first;
    }

    ctx.permit(chosen, diagnostic);
    if (ctx.cache.disabled) matcher._invalidateMemoEntries(chosen.start, chosen.start + 1);
  }
}
