import {Interval} from './Interval.js';
import {RecoveredFailure} from './RecoveredFailure.js';
import {FailureNode, IterationNode, ListNode} from './nodes.js';
import * as pexprs from './pexprs-main.js';

// --------------------------------------------------------------------
// Fallible: `B ! C`
// --------------------------------------------------------------------

/*
  Without recovery, a fallible is the sequence `B C`. During a recovering
  match (`state.recovery` is set), it records each failed attempt for the pass
  driver, and recovers only at a point a failed pass permitted.
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

/*
  A block has a guarded `*` or `+` and a join expression that is not a direct
  lookahead, such as `Stmt* ! "}"`. Only this structural form can recover by
  inserting its missing join expression; `Stmt* ! &"}" "}"` cannot, because its
  closer lies outside the fallible.
*/
function isBlock(fallible) {
  return (
    fallible.fallible instanceof pexprs.Iter &&
    !(fallible.fallible instanceof pexprs.Opt) &&
    !(fallible.join instanceof pexprs.Lookahead)
  );
}

function emptyIteration(state) {
  return state._rowBasedIteration
    ? new ListNode([], [], 0, false)
    : new IterationNode([], [], 0, false);
}

pexprs.Fallible.prototype.eval = function (state) {
  const ctx = state.recovery;
  if (!ctx) {
    return state.eval(this.fallible) && state.eval(this.join);
  }
  const {inputStream} = state;
  const origPos = inputStream.pos;
  if (state._noRecoveryDepth > 0) {
    // Inside `~`, `&` and recovery scans, a fallible is `B C` and records no
    // attempt. Prevent later reuse of this result, which has no attempts
    // for the pass driver.
    state._recoveryTaint++;
    return state.eval(this.fallible) && state.eval(this.join);
  }

  const key = recoveryKey(this, state, origPos);
  const origNumBindings = state._bindings.length;
  const logMark = state._recoveryLog.length;
  const sync = activeJoin(this, state);

  // Isolate the attempt's failures so its own farthest failure can be recorded
  // for the pass driver, and its last complete token so a recovery scan can
  // start after it.
  state.pushFailuresInfo();
  state.rightmostFailurePosition = -1;
  const outerTokenEnd = state._tokenEnd;
  state._tokenEnd = origPos;
  state._syncStack.push(sync);

  // Try the guarded expression and its join before considering recovery.
  const ok = state.eval(this.fallible) && state.eval(this.join);

  state._syncStack.pop();
  const tokenEnd = state._tokenEnd;
  state._tokenEnd = Math.max(outerTokenEnd, tokenEnd);
  const attemptRightmost = state.rightmostFailurePosition;
  const attemptFailures = state.recordedFailures;
  state.popFailuresInfo();

  const permit = ok ? undefined : ctx.permitted.get(key);
  if (permit) {
    state._recoveryTaint++;
    state.truncateBindings(origNumBindings);
    // A recovery discards the attempt's failures; the enclosing record is
    // already restored.
    if (this.recover(state, origPos, sync, permit, logMark, tokenEnd)) {
      return true;
    }
    state.truncateBindings(origNumBindings);
    inputStream.pos = origPos;
  } else if (!ok) {
    ctx.attempts.set(key, {
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
  return ok;
};

/*
  Recover a permitted fallible whose attempt failed. A guarded `*` or `+`
  keeps the elements it matched; any other guarded expression keeps nothing
  and its slot holds an empty placeholder. The skip region starts at the next
  token and ends where the join expression matches; its `_fail` node takes the
  join expression's slot. The join is only looked for after `tokenEnd`,
  the end of the last complete token the failed attempt matched, so text
  already matched as a token, such as a string literal, never ends the region.

  When the scan reaches the end of the input or a stop marker, a block
  recovers by inserting its missing join expression: the skip region ends there,
  nothing more is consumed, and the recovered failure is marked `missing`. It
  requires input consumed within this fallible or earlier in its rule
  application. On false, the recovery log is restored.
*/
pexprs.Fallible.prototype.recover = function (
  state,
  origPos,
  sync,
  permit,
  logMark,
  tokenEnd
) {
  const {inputStream} = state;
  const attemptLog = state._recoveryLog.splice(logMark);
  // Scan steps are not traced; only the matching join expression's entry joins the
  // Fallible's children.
  const outerTrace = state.trace;
  if (outerTrace) {
    state.trace = [];
  }
  state.pushFailuresInfo();

  inputStream.pos = origPos;
  const keepsPrefix =
    this.fallible instanceof pexprs.Iter && !(this.fallible instanceof pexprs.Opt);
  if (keepsPrefix) {
    // Evaluate the guarded iteration again, under the same permissions and
    // stop markers, so it keeps what this pass matched.
    state._syncStack.push(sync);
    const kept = state.eval(this.fallible);
    state._syncStack.pop();
    if (!kept) {
      inputStream.pos = origPos;
      state.pushBinding(emptyIteration(state), origPos);
    }
  }
  const scanStart = state.skipSpacesIfInSyntacticContext();
  let found = this.scan(state, scanStart, Math.max(scanStart, tokenEnd));
  state.popFailuresInfo();

  let syncTrace;
  if (found && found.stoppedAt !== undefined) {
    const appStart = state._posStack[state._posStack.length - 1];
    const consumed = found.stoppedAt > origPos || origPos > appStart;
    found =
      isBlock(this) && consumed
        ? {skipEnd: found.stoppedAt, afterSync: found.stoppedAt, missing: true}
        : null;
  } else if (outerTrace && found) {
    syncTrace = state.trace[state.trace.length - 1];
  }
  if (outerTrace) {
    state.trace = outerTrace;
  }
  if (!found) {
    state._recoveryLog.length = logMark;
    state._recoveryLog.push(...attemptLog);
    return false;
  }

  const recovered = new RecoveredFailure(
    new Interval(inputStream.source, scanStart, found.skipEnd),
    permit.position,
    permit.result,
    !!found.missing
  );
  // Recoveries inside kept elements stay in their own nodes. A zero-width one
  // at `scanStart` closed the last kept element.
  const nested = keepsPrefix
    ? attemptLog.filter(f => f.interval.endIdx > scanStart || f.interval.startIdx > scanStart)
    : attemptLog;
  if (!keepsPrefix) {
    state.pushBinding(new FailureNode(0), scanStart);
  }
  state.pushBinding(new FailureNode(found.skipEnd - scanStart, recovered, nested), scanStart);
  inputStream.pos = found.afterSync;
  state._recoveryLog.push(recovered, ...nested);
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

  Returns `{skipEnd, afterSync}` when the join expression matched, `{stoppedAt}`
  when a stop marker or the end of the input ended the scan, and null when
  the join expression matched without progress.
*/
pexprs.Fallible.prototype.scan = function (state, scanStart, searchFrom) {
  const {inputStream} = state;
  const end = inputStream.source.length;
  const enclosing = state._syncStack;
  let found = {stoppedAt: end};
  const origTokenEnd = state._suspendRecovery();
  for (let p = scanStart; p <= end; ) {
    inputStream.pos = p;
    const next = Math.max(state.skipSpacesIfInSyntacticContext(), p);
    if (next < searchFrom) {
      p = next + 1;
      continue;
    }
    inputStream.pos = p;
    const numBindings = state._bindings.length;
    if (state.eval(this.join)) {
      const afterSync = inputStream.pos;
      state.truncateBindings(numBindings);
      found = afterSync > scanStart ? {skipEnd: p, afterSync} : null;
      break;
    }
    if (enclosing.some(stop => matchesAt(state, stop, p))) {
      found = {stoppedAt: p};
      break;
    }
    p = next + 1;
  }
  state._resumeRecovery(origTokenEnd);
  return found;
};
