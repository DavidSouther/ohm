import {DiagnosticSnapshot} from './DiagnosticSnapshot.js';
import {Interval} from './Interval.js';
import FailureGroup from './FailureGroup.js';
import {insertionCandidate, insertionFrame} from './RecoveryInsertion.js';
import {RecoveredFailure} from './RecoveredFailure.js';
import {CorrectionNode, IterationNode, ListNode} from './nodes.js';
import * as pexprs from './pexprs-main.js';
import {partitionRecoveries} from './RecoveryOwnership.js';
import {mergeFailureSummaries, noFailures} from './RecoveryCache.js';

// --------------------------------------------------------------------
// Fallible: `B ! C`
// --------------------------------------------------------------------

/*
  Without recovery, a fallible is the sequence `B C`. During a recovering
  match (`state.recovery` is set), it records each failed attempt for the pass
  driver, and recovers only at a point selected after a failed pass.
*/

const fallibleIds = new WeakMap();
let nextFallibleId = 0;

// A recovery point is an authored fallible site at a start position, plus the
// actual parameters of a parameterized rule. Substituted copies share their
// authored site's id. `Fallible#eval` appends the enclosing recovery context
// and frame, because continuation evidence for insertion differs by frame.
function recoveryKey(fallible, state, pos) {
  const site = fallible._insertionSite || fallible;
  let id = fallibleIds.get(site);
  if (id === undefined) {
    id = ++nextFallibleId;
    fallibleIds.set(site, id);
  }
  const app = state.currentApplication();
  return app && app.args.length > 0 ? `${id}@${pos}@${app.toMemoKey()}` : `${id}@${pos}`;
}

function matchesAt(state, expr, pos) {
  const {inputStream} = state;
  const origNumBindings = state._bindings.length;
  inputStream.pos = pos;
  const ans = state.eval(expr);
  state.truncateBindings(origNumBindings);
  inputStream.pos = pos;
  return ans;
}

// Repetition blocks make nested stop markers active while scanning.
function isBlock(fallible) {
  return (
    fallible.guarded instanceof pexprs.Iter &&
    !(fallible.guarded instanceof pexprs.Opt) &&
    !(fallible.join instanceof pexprs.Lookahead)
  );
}

const recoveryStop = new pexprs.Apply('recoveryStop');
const recoveryToken = new pexprs.Apply('recoveryToken');

// Prefer whole-token progress, with a one-code-unit fallback.
function nextCandidate(state, tokenStart, stepsByToken) {
  if (stepsByToken) {
    const {inputStream} = state;
    const origNumBindings = state._bindings.length;
    inputStream.pos = tokenStart;
    const matched = state.eval(recoveryToken);
    state.truncateBindings(origNumBindings);
    if (matched && inputStream.pos > tokenStart) {
      return inputStream.pos;
    }
  }
  return tokenStart + 1;
}

function emptyOptional(state) {
  return state._rowBasedIteration
    ? new ListNode([], [], 0, true)
    : new IterationNode([], [], 0, true);
}

function matchPlain(fallible, state) {
  // A failure-only rematch gathers the same diagnostic evidence as a recovering pass.
  if (state.terminalProgress) return matchOperands(fallible, state).ok;
  return matchSequence(fallible, state).ok;
}

// `B C` without terminal progress: a recovering probe pass or a plain match.
function matchSequence(fallible, state) {
  const guardedMatched = state.eval(fallible.guarded);
  const guardedEnd = state.inputStream.pos;
  if (!guardedMatched) return {guardedMatched, guardedEnd, guardedTerminalEnd: -1, ok: false};
  state.pushBinding(emptyOptional(state), guardedEnd);
  return {guardedMatched, guardedEnd, guardedTerminalEnd: -1, ok: state.eval(fallible.join)};
}

function withProposedDiagnosticPosition(summary, proposedDiagnosticPosition) {
  return summary.hasStrongFailures && summary.proposedDiagnosticPosition === undefined
    ? {...summary, proposedDiagnosticPosition}
    : summary;
}

// Re-evaluates `expr` at `pos` with exact terminal progress and returns it,
// leaving the state as it was. Only a failure-only rematch without recovery,
// which reuses untracked memo entries, has unknown (NaN) progress to resolve.
function exactOperandProgress(state, expr, pos, userData) {
  const {inputStream, terminalProgress: progress} = state;
  const saved = {
    pos: inputStream.pos,
    examinedLength: inputStream.examinedLength,
    bindings: state._bindings.length,
    rightmostFailurePosition: state.rightmostFailurePosition,
    recordedFailures: state.recordedFailures,
    userData: state.userData,
    retainedEnd: progress.retainedEnd,
    attemptedEnd: progress.attemptedEnd,
  };
  state.recordedFailures = new FailureGroup();
  state.userData = userData;
  inputStream.pos = pos;
  progress.retainedEnd = progress.attemptedEnd = -1;
  progress.exact = true;
  try {
    state.eval(expr);
    return {retainedEnd: progress.retainedEnd, attemptedEnd: progress.attemptedEnd};
  } finally {
    progress.exact = false;
    state.truncateBindings(saved.bindings);
    inputStream.pos = saved.pos;
    inputStream.examinedLength = saved.examinedLength;
    state.rightmostFailurePosition = saved.rightmostFailurePosition;
    state.recordedFailures = saved.recordedFailures;
    state.userData = saved.userData;
    progress.retainedEnd = saved.retainedEnd;
    progress.attemptedEnd = saved.attemptedEnd;
  }
}

// Evaluates the operands and, when the join fails at its start, proposes the
// end of the guard's last retained terminal as the diagnostic position. A
// failure-only rematch records failures in a FailureGroup and a recovering
// pass in its failure summary, so both receive the proposal.
function matchOperands(fallible, state) {
  const {guarded, join} = fallible;
  const {inputStream, terminalProgress: progress, recordedFailures: previousFailures} = state;
  if (!progress) return matchSequence(fallible, state);
  const origPos = inputStream.pos;
  const origUserData = state.userData;
  const previousSummary = state._recoveryFailureSummary;
  if (previousFailures) state.recordedFailures = new FailureGroup();
  state._recoveryFailureSummary = noFailures;

  const guardedMatched = state.eval(guarded);
  const guardedEnd = inputStream.pos;
  let guardedTerminalEnd = progress.retainedEnd;
  let ok = false;

  if (guardedMatched) {
    const guardFailures = state.recordedFailures;
    let guardSummary = state._recoveryFailureSummary;
    if (previousFailures) state.recordedFailures = new FailureGroup();
    state._recoveryFailureSummary = noFailures;
    state.pushBinding(emptyOptional(state), guardedEnd);
    const previousAttempted = progress.attemptedEnd;
    progress.attemptedEnd = -1;
    ok = state.eval(join);
    let farthestCompletedJoinTerminalEnd = progress.attemptedEnd;
    progress.attemptedEnd = Math.max(previousAttempted, farthestCompletedJoinTerminalEnd);

    const joinFailures = state.recordedFailures;
    let joinSummary = state._recoveryFailureSummary;
    // The join's failure is proposed when (1) the guard retained a terminal past
    // its start, (2) the join completed no terminal, (3) a strong join failure,
    // less its preceding implicit space, lies at the guard's end, and (4) the
    // join retains a terminal whenever it succeeds. Unknown (NaN) progress
    // passes (1) and (2) here and is computed only once (3) and (4) hold.
    if (
      !ok &&
      !(guardedTerminalEnd <= origPos) &&
      !(farthestCompletedJoinTerminalEnd >= 0)
    ) {
      const failurePosition = state.positionToRecordFailures;
      const recordedFailureAtJoinStart = joinFailures?.hasStrongFailures &&
        failurePosition - joinFailures.minPrecedingImplicitSpaceLength === guardedEnd;
      const summaryFailureAtJoinStart = joinSummary.hasStrongFailures &&
        joinSummary.position - joinSummary.minPrecedingImplicitSpaceLength === guardedEnd;
      const eligible = (recordedFailureAtJoinStart || summaryFailureAtJoinStart) &&
        join.retainsTerminalOnSuccess(state.grammar, state.currentApplication());
      if (eligible && Number.isNaN(guardedTerminalEnd)) {
        guardedTerminalEnd =
          exactOperandProgress(state, guarded, origPos, origUserData).retainedEnd;
      }
      if (eligible && Number.isNaN(farthestCompletedJoinTerminalEnd) &&
          guardedTerminalEnd > origPos) {
        farthestCompletedJoinTerminalEnd =
          exactOperandProgress(state, join, guardedEnd, state.userData).attemptedEnd;
      }
      if (eligible && guardedTerminalEnd > origPos && farthestCompletedJoinTerminalEnd < 0) {
        if (recordedFailureAtJoinStart) {
          joinFailures.proposeDiagnosticPosition(guardedTerminalEnd);
          // A guard failure at or before the retained end shares the proposal.
          const guardFailureWithoutImplicitSpace =
            failurePosition - guardFailures.minPrecedingImplicitSpaceLength;
          if (guardFailureWithoutImplicitSpace <= guardedTerminalEnd) {
            guardFailures.proposeDiagnosticPosition(guardedTerminalEnd);
          }
        }
        if (summaryFailureAtJoinStart) {
          joinSummary = withProposedDiagnosticPosition(joinSummary, guardedTerminalEnd);
          const guardFailureWithoutImplicitSpace =
            guardSummary.position - guardSummary.minPrecedingImplicitSpaceLength;
          if (guardSummary.position === joinSummary.position &&
              guardFailureWithoutImplicitSpace <= guardedTerminalEnd) {
            guardSummary = withProposedDiagnosticPosition(guardSummary, guardedTerminalEnd);
          }
        }
      }
    }

    if (joinFailures) joinFailures.merge(guardFailures);
    state._recoveryFailureSummary = mergeFailureSummaries(joinSummary, guardSummary);
  }

  if (previousFailures) state.recordedFailures.merge(previousFailures);
  state._recoveryFailureSummary = mergeFailureSummaries(
    state._recoveryFailureSummary, previousSummary
  );
  return {guardedMatched, guardedEnd, guardedTerminalEnd, ok};
}

// The number of values the guarded operand produces, computed on first use.
pexprs.Fallible.prototype.guardedArity = function () {
  if (this._guardedArity === undefined) this._guardedArity = this.guarded.getArity();
  return this._guardedArity;
};

pexprs.Fallible.prototype.eval = function (state) {
  const ctx = state.recovery;
  if (!ctx) {
    return matchPlain(this, state);
  }
  const {inputStream} = state;
  const origPos = inputStream.pos;
  if (state._noRecoveryDepth > 0) {
    // Inside `~`, `&` and recovery scans, a fallible is `B C` and records no
    // attempt. Prevent later reuse of this result, which has no attempts
    // for the pass driver.
    state._recoveryTaint++;
    return matchPlain(this, state);
  }

  const frame = insertionFrame(this, state);
  const key = `${recoveryKey(this, state, origPos)}@${state._syncContext}@${frame.toString()}`;
  const origNumBindings = state._bindings.length;
  const logMark = state._recoveryLog;

  // Isolate the attempt's failures so its own farthest failure can be recorded
  // for the pass driver, and its last complete token so a recovery scan can
  // start after it.
  state.pushFailuresInfo();
  state.rightmostFailurePosition = -1;
  const outerTokenEnd = state._tokenEnd;
  state._tokenEnd = origPos;
  const blockDepth = isBlock(this) ? 1 : 0;
  state._pushRecoveryFrame(frame);
  state._blockDepth += blockDepth;

  // Try the guarded expression and its join before considering recovery.
  const {guardedMatched, guardedEnd, guardedTerminalEnd, ok} = matchOperands(this, state);

  state._blockDepth -= blockDepth;
  state._popRecoveryFrame();
  const tokenEnd = state._tokenEnd;
  state._tokenEnd = Math.max(outerTokenEnd, tokenEnd);
  const attemptRightmost = state.rightmostFailurePosition;
  const attemptFailures = state.recordedFailures;
  const attemptSummary = state._recoveryFailureSummary;
  state.popFailuresInfo();

  const correction = ok ? undefined : ctx.cache.readCorrection(key);
  if (correction) {
    state._recoveryTaint++;
    state.truncateBindings(origNumBindings + (guardedMatched ? this.guardedArity() : 0));
    // A recovery discards the attempt's failures; the enclosing record is
    // already restored.
    if (
      this.recover(
        state,
        origPos,
        correction,
        logMark,
        tokenEnd,
        guardedMatched,
        guardedEnd,
        guardedTerminalEnd,
        frame
      )
    ) {
      return true;
    }
    state.truncateBindings(origNumBindings);
    inputStream.pos = origPos;
  } else if (!ok) {
    ctx.cache.writeAttempt(state, {
      key,
      start: origPos,
      rightmost: attemptRightmost,
      depth: state._applicationStack.length,
    });
  }
  // Merge the attempt's failures back, position and expected set both, so this
  // reports what `B C` would; merging only the position leaves the message
  // without expected text.
  state.rightmostFailurePosition = Math.max(state.rightmostFailurePosition, attemptRightmost);
  state.recordedFailures = attemptFailures;
  state._recoveryFailureSummary = mergeFailureSummaries(
    attemptSummary,
    state._recoveryFailureSummary
  );
  return ok;
};

/*
  Keep matched guarded material, put the skipped region in the correction slot,
  and retain the real or zero-width inserted join binding.
*/
pexprs.Fallible.prototype.recover = function (
  state,
  origPos,
  correction,
  logMark,
  tokenEnd,
  guardedMatched,
  guardedEnd,
  guardedTerminalEnd,
  frame
) {
  const {inputStream} = state;
  const attemptLog = state._recoveryLog.since(logMark);
  // Matched guarded material is the last N bindings; the join is not pushed yet.
  const guardedArity = this.guardedArity();
  const retained = !guardedMatched
    ? []
    : guardedArity === 1
      ? [state._bindings.at(-1)]
      : state._bindings.slice(-guardedArity);
  const {owned, discarded: nested} = partitionRecoveries(attemptLog, ...retained);
  state._recoveryLog = logMark;
  // Scan steps are not traced; only the matching join expression's entry joins the
  // Fallible's children. An inferred join adds no trace entry.
  const outerTrace = state.trace;
  if (outerTrace) {
    state.trace = [];
  }
  state.pushFailuresInfo();

  inputStream.pos = guardedMatched ? guardedEnd : origPos;
  if (!guardedMatched) {
    // A failed guarded operand keeps nothing: each of its slots is empty.
    for (let i = guardedArity; i > 0; i--) {
      state.pushBinding(emptyOptional(state), origPos);
    }
  }
  const scanStart = state.skipSpacesIfInSyntacticContext();
  const insertion =
    guardedMatched && guardedTerminalEnd > origPos
      ? insertionCandidate(this, state, frame)
      : null;
  const diagnosticPosition = guardedTerminalEnd > origPos ? guardedTerminalEnd : guardedEnd;
  const found = this.scan(state, scanStart, Math.max(scanStart, tokenEnd), insertion);
  state.popFailuresInfo();

  const syncTrace =
    outerTrace && found && !found.missing ? state.trace[state.trace.length - 1] : undefined;
  if (outerTrace) {
    state.trace = outerTrace;
  }
  if (!found) {
    state._recoveryLog = logMark.concat(attemptLog);
    return false;
  }

  const correctionStart = found.missing && found.skipEnd === scanStart
    ? diagnosticPosition : scanStart;
  if (found.missing && found.skipEnd === scanStart) {
    found.skipEnd = diagnosticPosition;
    // The insertion can precede space consumed by the guard or text skipped
    // by an inner recovery. Resume where the guard ended.
    found.resumeAt = guardedEnd;
    found.joinOffset = state.posToOffset(diagnosticPosition);
  }
  let diagnostic = correction.result;
  if (found.missing) {
    const failure = insertion.literal.toFailure(state.grammar);
    // Keep the selected expectations only when they include this join at its
    // actual failure site. A farther failure may belong to an abandoned path.
    const snapshot = correction.result;
    const failures = snapshot.getRightmostFailures();
    const joinAtFailure = correction.position === scanStart &&
      failures.some(item => !item.isFluffy() && item.toKey() === failure.toKey());
    const selected = joinAtFailure ? failures : [failure];
    const expected = joinAtFailure ? snapshot.getExpectedText() : failure.toString();
    const location = state.recovery.positionIndex.getLineAndColumnNumbers(diagnosticPosition);
    diagnostic = new DiagnosticSnapshot(
      diagnosticPosition,
      selected,
      expected,
      `Line ${location.lineNum}, col ${location.colNum}: expected ${expected}`
    );
  }
  const recovered = new RecoveredFailure(
    new Interval(inputStream.source, correctionStart, found.skipEnd),
    found.missing ? diagnosticPosition : correction.position,
    diagnostic,
    !!found.missing
  );
  // B may have logged discarded alternatives or a failed final iteration row.
  // Their diagnostics belong to the correction, rather than to retained B.
  state._recoveryLog = state._recoveryLog.concat(owned);
  state.pushBinding(
    new CorrectionNode(found.skipEnd - correctionStart, recovered, nested),
    correctionStart
  );
  state._bindings.push(found.joinNode);
  state._bindingOffsets.push(found.joinOffset);
  inputStream.pos = found.resumeAt;
  state._recoveryLog = state._recoveryLog.append(recovered).concat(nested);
  if (outerTrace) {
    // The failed join may have traced implicit spaces beyond a zero-width
    // insertion. Those spaces belong to the continuation, not this node.
    if (found.missing) {
      for (let i = outerTrace.length - 1; i >= 0; i--) {
        if (outerTrace[i].succeeded && outerTrace[i].pos2 > found.resumeAt) {
          outerTrace.splice(i, 1);
        }
      }
    }
    if (syncTrace) outerTrace.push(syncTrace);
    state._traceRecovered = true;
  }
  return true;
};

/*
  Scan forward from `scanStart` for the join expression. Candidate positions are
  those whose following spaces reach `searchFrom` for a real join, so the
  skip region still ends before any spaces. Insertion also considers earlier
  candidates after the retained guard, independent of abandoned token progress.
  At each candidate, try this fallible's own eligible real join first; where
  it fails and an enclosing active join matches, stop.
  Ordinary skip recovery requires positive-width progress through the skipped
  text or real join. An inferred join is zero width and is considered only
  after a nonempty guarded match. Comments are stepped over whole, by the
  ordinary space skipping of a syntactic rule.

  A grammar may define a rule named `recoveryToken` that matches one whole
  token, such as a string literal, an identifier or a number. A scan then
  steps from one candidate to the next by one `recoveryToken` match, so a
  join expression or stop marker inside a token is never a candidate. Where it
  does not match with progress, such as at an unterminated string, the scan
  steps one code unit. Without it, every code unit is a candidate. Ordinary
  matching never evaluates it.

  A grammar may define `recoveryStop` to stop a scan inside a nested block
  before the next top-level item. The outermost block ignores it.

  Return the real or inferred join and its offset, or null if neither is
  available before a stop marker or the end of input.
*/
pexprs.Fallible.prototype.scan = function (state, scanStart, searchFrom, insertion) {
  const {inputStream, terminalProgress: progress} = state;
  const end = inputStream.source.length;
  const nested = state._blockDepth + (isBlock(this) ? 1 : 0) >= 2;
  const enclosing =
    nested && state.grammar.rules.recoveryStop
      ? [...state._recoveryFrames, recoveryStop]
      : state._recoveryFrames;
  const stepsByToken = !!state.grammar.rules.recoveryToken;
  let found = null;
  const previousRetained = progress?.retainedEnd;
  const previousAttempted = progress?.attemptedEnd;
  const origTokenEnd = state._suspendRecovery();
  for (let p = scanStart; p <= end; ) {
    inputStream.pos = p;
    const next = Math.max(state.skipSpacesIfInSyntacticContext(), p);
    inputStream.pos = p;
    const numBindings = state._bindings.length;
    // Stop and token probes discard their bindings. Only the selected join can
    // contribute terminal progress to the recovered expression.
    if (progress) progress.retainedEnd = progress.attemptedEnd = -1;
    if (next >= searchFrom && state.eval(this.join)) {
      const resumeAt = inputStream.pos;
      const joinNode = state._bindings[numBindings];
      const joinOffset = state._bindingOffsets[numBindings];
      state.truncateBindings(numBindings);
      found = resumeAt > scanStart ? {skipEnd: p, resumeAt, joinNode, joinOffset} : null;
      break;
    }
    if (insertion && insertion.canResumeAt(next)) {
      found = {
        skipEnd: p,
        resumeAt: p,
        joinNode: insertion.node,
        joinOffset: state.posToOffset(p),
        missing: true,
      };
      break;
    }
    if (next >= searchFrom && enclosing.some(stop => matchesAt(state, stop.join || stop, p))) {
      found = null;
      break;
    }
    p = nextCandidate(state, next, stepsByToken);
  }
  state._resumeRecovery(origTokenEnd);
  const matchedJoin = found && !found.missing;
  if (progress) {
    progress.retainedEnd = matchedJoin ? Math.max(previousRetained, progress.retainedEnd)
      : previousRetained;
    progress.attemptedEnd = matchedJoin ? Math.max(previousAttempted, progress.attemptedEnd)
      : previousAttempted;
  }
  return found;
};
