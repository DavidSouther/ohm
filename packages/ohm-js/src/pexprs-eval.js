import {Trace} from './Trace.js';
import * as common from './common.js';
import * as errors from './errors.js';
import {
  FailureNode,
  IterationNode,
  ListNode,
  NonterminalNode,
  SeqNode,
  TerminalNode,
} from './nodes.js';
import * as pexprs from './pexprs-main.js';
import {MAX_CODE_POINT} from './InputStream.js';
import {Interval} from './Interval.js';
import {RecoveredFailure} from './RecoveredFailure.js';

// --------------------------------------------------------------------
// Operations
// --------------------------------------------------------------------

/*
  Evaluate the expression and return `true` if it succeeds, `false` otherwise. This method should
  only be called directly by `State.prototype.eval(expr)`, which also updates the data structures
  that are used for tracing. (Making those updates in a method of `State` enables the trace-specific
  data structures to be "secrets" of that class, which is good for modularity.)

  The contract of this method is as follows:
  * When the return value is `true`,
    - the state object will have `expr.getArity()` more bindings than it did before the call.
  * When the return value is `false`,
    - the state object may have more bindings than it did before the call, and
    - its input stream's position may be anywhere.

  Note that `State.prototype.eval(expr)`, unlike this method, guarantees that neither the state
  object's bindings nor its input stream's position will change if the expression fails to match.
*/
pexprs.PExpr.prototype.eval = common.abstract('eval'); // function(state) { ... }

pexprs.any.eval = function (state) {
  const {inputStream} = state;
  const origPos = inputStream.pos;
  const cp = inputStream.nextCodePoint();
  if (cp !== undefined) {
    state.pushBinding(new TerminalNode(String.fromCodePoint(cp).length), origPos);
    return true;
  } else {
    state.processFailure(origPos, this);
    return false;
  }
};

pexprs.end.eval = function (state) {
  const {inputStream} = state;
  const origPos = inputStream.pos;
  if (inputStream.atEnd()) {
    state.pushBinding(new TerminalNode(0), origPos);
    return true;
  } else {
    state.processFailure(origPos, this);
    return false;
  }
};

pexprs.Terminal.prototype.eval = function (state) {
  const {inputStream} = state;
  const origPos = inputStream.pos;
  if (!inputStream.matchString(this.obj)) {
    state.processFailure(origPos, this);
    return false;
  } else {
    state.pushBinding(new TerminalNode(this.obj.length), origPos);
    return true;
  }
};

pexprs.Range.prototype.eval = function (state) {
  const {inputStream} = state;
  const origPos = inputStream.pos;

  // A range can operate in one of two modes: matching a single, 16-bit _code unit_,
  // or matching a _code point_. (Code points over 0xFFFF take up two 16-bit code units.)
  const cp = this.matchCodePoint ? inputStream.nextCodePoint() : inputStream.nextCharCode();

  // Always compare by code point value to get the correct result in all scenarios.
  // Note that for strings of length 1, codePointAt(0) and charPointAt(0) are equivalent.
  if (cp !== undefined && this.from.codePointAt(0) <= cp && cp <= this.to.codePointAt(0)) {
    state.pushBinding(new TerminalNode(String.fromCodePoint(cp).length), origPos);
    return true;
  } else {
    state.processFailure(origPos, this);
    return false;
  }
};

pexprs.Param.prototype.eval = function (state) {
  return state.eval(state.currentApplication().args[this.index]);
};

pexprs.Lex.prototype.eval = function (state) {
  state.enterLexifiedContext();
  const ans = state.eval(this.expr);
  state.exitLexifiedContext();
  return ans;
};

pexprs.Alt.prototype.eval = function (state) {
  for (let idx = 0; idx < this.terms.length; idx++) {
    if (state.eval(this.terms[idx])) {
      return true;
    }
  }
  return false;
};

pexprs.Seq.prototype.eval = function (state) {
  for (let idx = 0; idx < this.factors.length; idx++) {
    const factor = this.factors[idx];
    if (!state.eval(factor)) {
      return false;
    }
  }
  return true;
};

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

// The synchronizer as an enclosing stop marker: resolved against the current
// application's parameters, because a scan evaluates it in another context.
function activeSynchronizer(fallible, state) {
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
  A block is a fallible whose guarded side is a `*` or `+` and whose
  synchronizer consumes input, such as `Stmt* ! "}"`. Only a block can recover
  by inserting its missing synchronizer; `Stmt* ! &"}" "}"` cannot, because its
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
    // attempt. The result must not be memoized, because every memoized
    // evaluation has recorded its attempts for the pass driver.
    state._recoveryTaint++;
    return state.eval(this.fallible) && state.eval(this.join);
  }

  const key = recoveryKey(this, state, origPos);
  const origNumBindings = state._bindings.length;
  const logMark = state._recoveryLog.length;
  const sync = activeSynchronizer(this, state);

  // Isolate the attempt's failures so its own farthest failure can be recorded
  // for the pass driver, and its last complete token so a recovery scan can
  // start after it.
  state.pushFailuresInfo();
  state.rightmostFailurePosition = -1;
  const outerTokenEnd = state._tokenEnd;
  state._tokenEnd = origPos;
  state._syncStack.push(sync);
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
  token and ends where the synchronizer matches; its `_fail` node takes the
  synchronizer's slot. The synchronizer is only looked for after `tokenEnd`,
  the end of the last complete token the failed attempt matched, so text
  already matched as a token, such as a string literal, never ends the region.

  When the scan reaches the end of the input or a stop marker, a block
  recovers by inserting its missing synchronizer: the skip region ends there,
  nothing more is consumed, and the recovered failure is marked `missing`. It
  does so only when the fallible or its rule application has consumed input,
  so every recovery inside an iteration still advances it. Otherwise this
  returns false, with bindings and the recovery log as they were.
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
  // Scan steps are not traced; only the matching synchronizer's entry joins the
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
  Scan forward from `scanStart` for the synchronizer. Candidate positions are
  those whose following spaces reach `searchFrom`, so the skip region still
  ends before any spaces. At each candidate, try this fallible's own
  synchronizer first; where it fails and an enclosing active synchronizer
  matches, stop. The skipped text and the synchronizer must cover at least one
  code unit. Comments are stepped over whole, by the ordinary space skipping
  of a syntactic rule.

  Returns `{skipEnd, afterSync}` when the synchronizer matched, `{stoppedAt}`
  when a stop marker or the end of the input ended the scan, and null when
  the synchronizer matched without progress.
*/
pexprs.Fallible.prototype.scan = function (state, scanStart, searchFrom) {
  const {inputStream} = state;
  const enclosing = state._syncStack;
  const end = inputStream.source.length;
  let found = {stoppedAt: end};
  const origTokenEnd = state._tokenEnd;
  state._noRecoveryDepth++;
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
    inputStream.pos = p;
    p = Math.max(state.skipSpacesIfInSyntacticContext(), p) + 1;
  }
  state._noRecoveryDepth--;
  state._tokenEnd = origTokenEnd;
  return found;
};

pexprs.Iter.prototype.eval = function (state) {
  if (state._rowBasedIteration) {
    return this.evalRowBased(state);
  }

  // Column-based iteration (original v17 behavior): produces one IterationNode
  // per column (i.e., per binding in the iterated expression).
  const {inputStream} = state;
  const origPos = inputStream.pos;
  const arity = this.getArity();
  const cols = [];
  const colOffsets = [];
  while (cols.length < arity) {
    cols.push([]);
    colOffsets.push([]);
  }

  let numMatches = 0;
  let prevPos = origPos;
  let idx;
  while (numMatches < this.maxNumMatches && state.eval(this.expr)) {
    if (inputStream.pos === prevPos) {
      throw errors.kleeneExprHasNullableOperand(this, state._applicationStack);
    }
    prevPos = inputStream.pos;
    numMatches++;
    const row = state._bindings.splice(state._bindings.length - arity, arity);
    const rowOffsets = state._bindingOffsets.splice(
      state._bindingOffsets.length - arity,
      arity
    );
    for (idx = 0; idx < row.length; idx++) {
      cols[idx].push(row[idx]);
      colOffsets[idx].push(rowOffsets[idx]);
    }
  }
  if (numMatches < this.minNumMatches) {
    return false;
  }
  let offset = state.posToOffset(origPos);
  let matchLength = 0;
  if (numMatches > 0) {
    const lastCol = cols[arity - 1];
    const lastColOffsets = colOffsets[arity - 1];

    const endOffset =
      lastColOffsets[lastColOffsets.length - 1] + lastCol[lastCol.length - 1].matchLength;
    offset = colOffsets[0][0];
    matchLength = endOffset - offset;
  }
  const isOptional = this instanceof pexprs.Opt;
  for (idx = 0; idx < cols.length; idx++) {
    state._bindings.push(
      new IterationNode(cols[idx], colOffsets[idx], matchLength, isOptional)
    );
    state._bindingOffsets.push(offset);
  }
  return true;
};

// Row-based iteration: produces a single ListNode whose children are
// SeqNodes (for arity > 1) or plain nodes (for arity === 1).
pexprs.Iter.prototype.evalRowBased = function (state) {
  const {inputStream} = state;
  const origPos = inputStream.pos;
  const isOptional = this instanceof pexprs.Opt;

  const rows = [];
  const rowOffsets = [];
  let arity = -1;
  let numMatches = 0;
  let prevPos = origPos;

  while (numMatches < this.maxNumMatches) {
    const origLen = state._bindings.length;
    if (!state.eval(this.expr)) break;
    if (inputStream.pos === prevPos) {
      throw errors.kleeneExprHasNullableOperand(this, state._applicationStack);
    }
    prevPos = inputStream.pos;
    numMatches++;

    if (arity === -1) arity = state._bindings.length - origLen;
    const children = state._bindings.splice(origLen, arity);
    const childOffsets = state._bindingOffsets.splice(origLen, arity);

    if (arity > 1) {
      const rowStart = childOffsets[0];
      const lastChild = children[arity - 1];
      const rowEnd = childOffsets[arity - 1] + lastChild.matchLength;
      const relOffsets = childOffsets.map(o => o - rowStart);
      rows.push(new SeqNode(children, relOffsets, rowEnd - rowStart));
      rowOffsets.push(rowStart);
    } else if (arity === 1) {
      rows.push(children[0]);
      rowOffsets.push(childOffsets[0]);
    }
  }
  if (arity === -1) arity = this.expr.getArity();
  if (numMatches < this.minNumMatches) {
    return false;
  }

  if (arity === 0) return true;

  const offset = numMatches > 0 ? rowOffsets[0] : state.posToOffset(origPos);
  let matchLength = 0;
  if (numMatches > 0) {
    const lastRow = rows[rows.length - 1];
    matchLength = rowOffsets[rows.length - 1] + lastRow.matchLength - offset;
  }

  state._bindings.push(new ListNode(rows, rowOffsets, matchLength, isOptional));
  state._bindingOffsets.push(offset);
  return true;
};

pexprs.Not.prototype.eval = function (state) {
  /*
    TODO:
    - Right now we're just throwing away all of the failures that happen inside a `not`, and
      recording `this` as a failed expression.
    - Double negation should be equivalent to lookahead, but that's not the case right now wrt
      failures. E.g., ~~'foo' produces a failure for ~~'foo', but maybe it should produce
      a failure for 'foo' instead.
  */

  const {inputStream} = state;
  const origPos = inputStream.pos;
  state.pushFailuresInfo();

  // A predicate discards its CST, so a recovery inside `~` or `&` would have no
  // `_fail` node; no fallible recovers here.
  const origTokenEnd = state._tokenEnd;
  state._noRecoveryDepth++;
  const ans = state.eval(this.expr);
  state._noRecoveryDepth--;
  state._tokenEnd = origTokenEnd;

  state.popFailuresInfo();
  if (ans) {
    state.processFailure(origPos, this);
    return false;
  }

  inputStream.pos = origPos;
  return true;
};

pexprs.Lookahead.prototype.eval = function (state) {
  const {inputStream} = state;
  const origPos = inputStream.pos;
  const origTokenEnd = state._tokenEnd;
  state._noRecoveryDepth++;
  const ans = state.eval(this.expr);
  state._noRecoveryDepth--;
  state._tokenEnd = origTokenEnd;
  if (ans) {
    inputStream.pos = origPos;
    return true;
  } else {
    return false;
  }
};

pexprs.Apply.prototype.eval = function (state) {
  const caller = state.currentApplication();
  const actuals = caller ? caller.args : [];
  const app = this.substituteParams(actuals);

  const posInfo = state.getCurrentPosInfo();
  if (posInfo.isActive(app)) {
    // This rule is already active at this position, i.e., it is left-recursive.
    return app.handleCycle(state);
  }

  const memoKey = app.toMemoKey();
  const memoRec = posInfo.memo[memoKey];

  if (memoRec && posInfo.shouldUseMemoizedResult(memoRec)) {
    if (state.hasNecessaryInfo(memoRec)) {
      return state.useMemoizedResult(state.inputStream.pos, memoRec);
    }
    delete posInfo.memo[memoKey];
  }
  return app.reallyEval(state);
};

pexprs.Apply.prototype.handleCycle = function (state) {
  const posInfo = state.getCurrentPosInfo();
  const {currentLeftRecursion} = posInfo;
  const memoKey = this.toMemoKey();
  let memoRec = posInfo.memo[memoKey];

  if (currentLeftRecursion && currentLeftRecursion.headApplication.toMemoKey() === memoKey) {
    // We already know about this left recursion, but it's possible there are "involved
    // applications" that we don't already know about, so...
    memoRec.updateInvolvedApplicationMemoKeys();
  } else if (!memoRec) {
    // New left recursion detected! Memoize a failure to try to get a seed parse.
    memoRec = posInfo.memoize(memoKey, {
      matchLength: 0,
      examinedLength: 0,
      value: false,
      rightmostFailureOffset: -1,
    });
    posInfo.startLeftRecursion(this, memoRec);
  }
  return state.useMemoizedResult(state.inputStream.pos, memoRec);
};

pexprs.Apply.prototype.reallyEval = function (state) {
  const {inputStream} = state;
  const origPos = inputStream.pos;
  const origPosInfo = state.getCurrentPosInfo();
  const ruleInfo = state.grammar.rules[this.ruleName];
  const {body} = ruleInfo;
  const {description} = ruleInfo;

  state.enterApplication(origPosInfo, this);

  if (description) {
    state.pushFailuresInfo();
  }

  // Reset the input stream's examinedLength property so that we can track
  // the examined length of this particular application.
  const origInputStreamExaminedLength = inputStream.examinedLength;
  inputStream.examinedLength = 0;

  // Never memoize a result that depends on enclosing stop markers or that
  // skipped recording a fallible's attempt; see `_recoveryTaint`.
  const origRecoveryTaint = state._recoveryTaint;

  let value = this.evalOnce(body, state);
  const currentLR = origPosInfo.currentLeftRecursion;
  const memoKey = this.toMemoKey();
  const isHeadOfLeftRecursion = currentLR && currentLR.headApplication.toMemoKey() === memoKey;
  let memoRec;

  if (state.doNotMemoize) {
    state.doNotMemoize = false;
  } else if (isHeadOfLeftRecursion) {
    value = this.growSeedResult(body, state, origPos, currentLR, value);
    origPosInfo.endLeftRecursion();
    memoRec = currentLR;
    memoRec.examinedLength = inputStream.examinedLength - origPos;
    memoRec.rightmostFailureOffset = state._getRightmostFailureOffset();
    origPosInfo.memoize(memoKey, memoRec); // updates origPosInfo's maxExaminedLength
  } else if (
    (!currentLR || !currentLR.isInvolved(memoKey)) &&
    state._recoveryTaint === origRecoveryTaint
  ) {
    // This application is not involved in left recursion and is not recovery-tainted,
    // so it's ok to memoize it.
    memoRec = origPosInfo.memoize(memoKey, {
      matchLength: inputStream.pos - origPos,
      examinedLength: inputStream.examinedLength - origPos,
      value,
      failuresAtRightmostPosition: state.cloneRecordedFailures(),
      rightmostFailureOffset: state._getRightmostFailureOffset(),
      tokenEndOffset: state._tokenEnd < 0 ? -1 : state._tokenEnd - origPos,
    });
  }
  const succeeded = !!value;

  if (description) {
    state.popFailuresInfo();
    if (!succeeded) {
      state.processFailure(origPos, this);
    }
    if (memoRec) {
      memoRec.failuresAtRightmostPosition = state.cloneRecordedFailures();
      memoRec.rightmostFailureOffset = state._getRightmostFailureOffset();
    }
  }

  // Record trace information in the memo table, so that it is available if the memoized result
  // is used later.
  if (state.isTracing() && memoRec) {
    const entry = state.getTraceEntry(origPos, this, succeeded, succeeded ? [value] : []);
    if (isHeadOfLeftRecursion) {
      common.assert(entry.terminatingLREntry != null || !succeeded);
      entry.isHeadOfLeftRecursion = true;
    }
    memoRec.traceEntry = entry;
  }

  // Fix the input stream's examinedLength -- it should be the maximum examined length
  // across all applications, not just this one.
  inputStream.examinedLength = Math.max(
    inputStream.examinedLength,
    origInputStreamExaminedLength
  );

  state.exitApplication(origPosInfo, value);

  return succeeded;
};

pexprs.Apply.prototype.evalOnce = function (expr, state) {
  const {inputStream} = state;
  const origPos = inputStream.pos;
  const origLen = state._bindings.length;

  if (state.eval(expr)) {
    const arity = state._bindings.length - origLen;
    const bindings = state._bindings.splice(origLen, arity);
    const offsets = state._bindingOffsets.splice(origLen, arity);
    const matchLength = inputStream.pos - origPos;
    return new NonterminalNode(this.ruleName, bindings, offsets, matchLength);
  } else {
    return false;
  }
};

pexprs.Apply.prototype.growSeedResult = function (body, state, origPos, lrMemoRec, newValue) {
  if (!newValue) {
    return false;
  }

  const {inputStream} = state;

  while (true) {
    lrMemoRec.matchLength = inputStream.pos - origPos;
    lrMemoRec.value = newValue;
    lrMemoRec.failuresAtRightmostPosition = state.cloneRecordedFailures();

    if (state.isTracing()) {
      // Before evaluating the body again, add a trace node for this application to the memo entry.
      // Its only child is a copy of the trace node from `newValue`, which will always be the last
      // element in `state.trace`.
      const seedTrace = state.trace[state.trace.length - 1];
      lrMemoRec.traceEntry = new Trace(
        state.input,
        origPos,
        inputStream.pos,
        this,
        true,
        [newValue],
        [seedTrace.clone()]
      );
    }
    inputStream.pos = origPos;
    newValue = this.evalOnce(body, state);
    if (inputStream.pos - origPos <= lrMemoRec.matchLength) {
      break;
    }
    if (state.isTracing()) {
      state.trace.splice(-2, 1); // Drop the trace for the old seed.
    }
  }
  if (state.isTracing()) {
    // The last entry is for an unused result -- pop it and save it in the "real" entry.
    lrMemoRec.traceEntry.recordLRTermination(state.trace.pop(), newValue);
  }
  inputStream.pos = origPos + lrMemoRec.matchLength;
  return lrMemoRec.value;
};

pexprs.UnicodeChar.prototype.eval = function (state) {
  const {inputStream} = state;
  const origPos = inputStream.pos;
  const cp = inputStream.nextCodePoint();
  if (cp !== undefined && cp <= MAX_CODE_POINT) {
    const ch = String.fromCodePoint(cp);
    if (this.pattern.test(ch)) {
      state.pushBinding(new TerminalNode(ch.length), origPos);
      return true;
    }
  }
  state.processFailure(origPos, this);
  return false;
};
