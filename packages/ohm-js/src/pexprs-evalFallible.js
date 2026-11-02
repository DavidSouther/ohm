import {Interval} from './Interval.js';
import {RecoveredFailure} from './RecoveredFailure.js';
import {CorrectionNode, IterationNode, ListNode} from './nodes.js';
import * as pexprs from './pexprs-main.js';
import {partitionRecoveries} from './RecoveryOwnership.js';
import {mergeFailureSummaries} from './RecoveryCache.js';

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

// A recovery point is a fallible at a start position. A fallible in a
// parameterized rule is also distinguished by the actual parameters.
function recoveryKey(fallible, state, pos) {
  let id = fallibleIds.get(fallible);
  if (id === undefined) {
    id = ++nextFallibleId;
    fallibleIds.set(fallible, id);
  }
  const app = state.currentApplication();
  return app && app.args.length > 0 ? `${id}@${pos}@${app.toMemoKey()}` : `${id}@${pos}`;
}

// The join expression as an enclosing stop marker: resolved against the current
// application's parameters, because a scan evaluates it in another context.
function activeJoin(fallible, state) {
  const app = state.currentApplication();
  return app && app.args.length > 0 ? fallible.join.substituteParams(app.args) : fallible.join;
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
  if (!state.eval(fallible.guarded)) return false;
  state.pushBinding(emptyOptional(state), state.inputStream.pos);
  return state.eval(fallible.join);
}

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

  const key = recoveryKey(this, state, origPos);
  const origNumBindings = state._bindings.length;
  const logMark = state._recoveryLog;
  const sync = activeJoin(this, state);

  // Isolate the attempt's failures so its own farthest failure can be recorded
  // for the pass driver, and its last complete token so a recovery scan can
  // start after it.
  state.pushFailuresInfo();
  state.rightmostFailurePosition = -1;
  const outerTokenEnd = state._tokenEnd;
  state._tokenEnd = origPos;
  const blockDepth = isBlock(this) ? 1 : 0;
  state._pushRecoverySync(sync);
  state._blockDepth += blockDepth;

  // Try the guarded expression and its join before considering recovery.
  const guardedMatched = state.eval(this.guarded);
  const guardedEnd = inputStream.pos;
  if (guardedMatched) state.pushBinding(emptyOptional(state), guardedEnd);
  const ok = guardedMatched && state.eval(this.join);

  state._blockDepth -= blockDepth;
  state._popRecoverySync();
  const tokenEnd = state._tokenEnd;
  state._tokenEnd = Math.max(outerTokenEnd, tokenEnd);
  const attemptRightmost = state.rightmostFailurePosition;
  const attemptFailures = state.recordedFailures;
  const attemptSummary = state._recoveryFailureSummary;
  state.popFailuresInfo();

  const correction = ok ? undefined : ctx.cache.readCorrection(key);
  if (correction) {
    state._recoveryTaint++;
    state.truncateBindings(origNumBindings + (guardedMatched ? 1 : 0));
    // A recovery discards the attempt's failures; the enclosing record is
    // already restored.
    if (
      this.recover(state, origPos, correction, logMark, tokenEnd, guardedMatched, guardedEnd)
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
  and retain the actual join binding. Without a matching join recovery fails.
*/
pexprs.Fallible.prototype.recover = function (
  state,
  origPos,
  correction,
  logMark,
  tokenEnd,
  guardedMatched,
  guardedEnd
) {
  const {inputStream} = state;
  const attemptLog = state._recoveryLog.since(logMark);
  const {owned, discarded: nested} = partitionRecoveries(
    attemptLog,
    guardedMatched ? state._bindings.at(-1) : undefined
  );
  state._recoveryLog = logMark;
  // Scan steps are not traced; only the matching join expression's entry joins the
  // Fallible's children.
  const outerTrace = state.trace;
  if (outerTrace) {
    state.trace = [];
  }
  state.pushFailuresInfo();

  inputStream.pos = guardedMatched ? guardedEnd : origPos;
  if (!guardedMatched) state.pushBinding(emptyOptional(state), origPos);
  const scanStart = state.skipSpacesIfInSyntacticContext();
  const found = this.scan(state, scanStart, Math.max(scanStart, tokenEnd));
  state.popFailuresInfo();

  const syncTrace = outerTrace && found ? state.trace[state.trace.length - 1] : undefined;
  if (outerTrace) {
    state.trace = outerTrace;
  }
  if (!found) {
    state._recoveryLog = logMark.concat(attemptLog);
    return false;
  }

  const recovered = new RecoveredFailure(
    new Interval(inputStream.source, scanStart, found.skipEnd),
    correction.position,
    correction.result
  );
  // B may have logged discarded alternatives or a failed final iteration row.
  // Their diagnostics belong to the correction, rather than to retained B.
  state._recoveryLog = state._recoveryLog.concat(owned);
  state.pushBinding(
    new CorrectionNode(found.skipEnd - scanStart, recovered, nested),
    scanStart
  );
  state._bindings.push(found.joinNode);
  state._bindingOffsets.push(found.joinOffset);
  inputStream.pos = found.afterSync;
  state._recoveryLog = state._recoveryLog.append(recovered).concat(nested);
  if (outerTrace) {
    if (syncTrace) outerTrace.push(syncTrace);
    state._traceRecovered = true;
  }
  return true;
};

/*
  Scan forward from `scanStart` for the join expression. Candidate positions are
  those whose following spaces reach `searchFrom`, so the skip region still
  ends before any spaces. At each candidate, try this fallible's own
  join first; where it fails and an enclosing active join matches, stop.
  The skipped text and the join expression must cover at least one
  code unit. Comments are stepped over whole, by the ordinary space skipping
  of a syntactic rule.

  A grammar may define a rule named `recoveryToken` that matches one whole
  token, such as a string literal, an identifier or a number. A scan then
  steps from one candidate to the next by one `recoveryToken` match, so a
  join expression or stop marker inside a token is never a candidate. Where it
  does not match with progress, such as at an unterminated string, the scan
  steps one code unit. Without it, every code unit is a candidate. Ordinary
  matching never evaluates it.

  A grammar may define `recoveryStop` to stop a scan inside a nested block
  before the next top-level item. The outermost block ignores it.

  Return the matched join and its offset, or null if no join matches with
  progress before a stop marker or the end of input.
*/
pexprs.Fallible.prototype.scan = function (state, scanStart, searchFrom) {
  const {inputStream} = state;
  const end = inputStream.source.length;
  const nested = state._blockDepth + (isBlock(this) ? 1 : 0) >= 2;
  const enclosing =
    nested && state.grammar.rules.recoveryStop
      ? [...state._syncStack, recoveryStop]
      : state._syncStack;
  const stepsByToken = !!state.grammar.rules.recoveryToken;
  let found = null;
  const origTokenEnd = state._suspendRecovery();
  for (let p = scanStart; p <= end; ) {
    inputStream.pos = p;
    const next = Math.max(state.skipSpacesIfInSyntacticContext(), p);
    if (next < searchFrom) {
      p = nextCandidate(state, next, stepsByToken);
      continue;
    }
    inputStream.pos = p;
    const numBindings = state._bindings.length;
    if (state.eval(this.join)) {
      const afterSync = inputStream.pos;
      const joinNode = state._bindings[numBindings];
      const joinOffset = state._bindingOffsets[numBindings];
      state.truncateBindings(numBindings);
      found = afterSync > scanStart ? {skipEnd: p, afterSync, joinNode, joinOffset} : null;
      break;
    }
    if (enclosing.some(stop => matchesAt(state, stop, p))) {
      found = null;
      break;
    }
    p = nextCandidate(state, next, stepsByToken);
  }
  state._resumeRecovery(origTokenEnd);
  return found;
};
