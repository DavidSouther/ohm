import {Trace} from './Trace.js';
import * as common from './common.js';
import * as errors from './errors.js';
import {IterationNode, ListNode, NonterminalNode, SeqNode, TerminalNode} from './nodes.js';
import * as pexprs from './pexprs-main.js';
import {MAX_CODE_POINT} from './InputStream.js';

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
    // Avoid using `splice` which allocates an array; use repeated `pop` which is faster
    // in hot loops and preserves insertion order by filling from the end.
    const row = new Array(arity);
    const rowOffsets = new Array(arity);
    for (let j = arity - 1; j >= 0; j--) {
      row[j] = state._bindings.pop();
      rowOffsets[j] = state._bindingOffsets.pop();
    }
    for (idx = 0; idx < arity; idx++) {
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

  // Predicates inspect input without committing recovery.
  state._suspendRecovery();
  const ans = state.eval(this.expr);
  state._resumeRecovery();

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
  state._suspendRecovery();
  const ans = state.eval(this.expr);
  state._resumeRecovery();
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

  const {memoTable} = state;
  const {pos} = state.inputStream;
  const keyId = memoTable.keyIdOf(app);
  if (memoTable.isActive(pos, keyId)) {
    // This rule is already active at this position, i.e., it is left-recursive.
    return app.handleCycle(state, keyId);
  }

  const entry = memoTable.find(pos, keyId);
  if (entry >= 0) {
    if (memoTable.isTainted(entry)) {
      memoTable.remove(entry);
    } else if (memoTable.shouldUseMemoizedResult(pos, entry)) {
      if (state.hasNecessaryInfo(entry)) {
        return state.useMemoizedResult(pos, entry);
      }
      memoTable.remove(entry);
    }
  }
  return app.reallyEval(state, keyId);
};

pexprs.Apply.prototype.handleCycle = function (state, keyId) {
  const {memoTable} = state;
  const {pos} = state.inputStream;
  const currentLeftRecursion = memoTable.currentLeftRecursion(pos);
  let entry = memoTable.find(pos, keyId);

  if (currentLeftRecursion >= 0 && memoTable.headKey(currentLeftRecursion) === keyId) {
    // We already know about this left recursion, but it's possible there are "involved
    // applications" that we don't already know about, so...
    memoTable.updateInvolvedKeys(pos, entry);
  } else if (entry < 0) {
    // New left recursion detected! Memoize a failure to try to get a seed parse.
    entry = memoTable.add(pos, keyId, 0, 0, false, undefined, -1, -1);
    memoTable.startLeftRecursion(pos, entry, keyId, this);
  }
  return state.useMemoizedResult(pos, entry);
};

pexprs.Apply.prototype.reallyEval = function (state, keyId) {
  const {inputStream, memoTable} = state;
  const origPos = inputStream.pos;
  const ruleInfo = state.grammar.rules[this.ruleName];
  const {body} = ruleInfo;
  const {description} = ruleInfo;

  state.enterApplication(this, keyId);

  if (description) {
    state.pushFailuresInfo();
  }

  // Reset the input stream's examinedLength property so that we can track
  // the examined length of this particular application.
  const origInputStreamExaminedLength = inputStream.examinedLength;
  inputStream.examinedLength = 0;

  // Never reuse a result that depends on enclosing stop markers or that
  // skipped recording a fallible's attempt; see `_recoveryTaint`.
  const origRecoveryTaint = state._recoveryTaint;

  let value = this.evalOnce(body, state);
  const currentLR = memoTable.currentLeftRecursion(origPos);
  const isHeadOfLeftRecursion = currentLR >= 0 && memoTable.headKey(currentLR) === keyId;
  let memoEntry = -1;

  if (state.doNotMemoize) {
    state.doNotMemoize = false;
  } else if (isHeadOfLeftRecursion) {
    value = this.growSeedResult(body, state, origPos, currentLR, value);
    memoTable.endLeftRecursion(origPos);
    memoEntry = currentLR;
    memoTable.examinedLength[memoEntry] = inputStream.examinedLength - origPos;
    memoTable.rightmostFailureOffset[memoEntry] = state._getRightmostFailureOffset();
    // The seed must remain available during growth, and its trace entry is
    // needed until the enclosing evaluation finishes. Prevent later reuse if
    // this completed result depends on the recovery context.
    memoTable.setTainted(memoEntry, state._recoveryTaint !== origRecoveryTaint);
  } else if (
    (currentLR < 0 || !memoTable.isInvolved(currentLR, keyId)) &&
    state._recoveryTaint === origRecoveryTaint
  ) {
    memoEntry = memoTable.add(
      origPos,
      keyId,
      inputStream.pos - origPos,
      inputStream.examinedLength - origPos,
      value,
      state.cloneRecordedFailures(),
      state._getRightmostFailureOffset(),
      -1
    );
  }
  const succeeded = !!value;

  if (description) {
    state.popFailuresInfo();
    if (!succeeded) {
      state.processFailure(origPos, this);
    }
    if (memoEntry >= 0) {
      memoTable.failures[memoEntry] = state.cloneRecordedFailures();
      memoTable.rightmostFailureOffset[memoEntry] = state._getRightmostFailureOffset();
    }
  }

  // Record trace information in the memo table, so that it is available if the memoized result
  // is used later.
  if (state.isTracing() && memoEntry >= 0) {
    const entry = state.getTraceEntry(origPos, this, succeeded, succeeded ? [value] : []);
    if (isHeadOfLeftRecursion) {
      common.assert(entry.terminatingLREntry != null || !succeeded);
      entry.isHeadOfLeftRecursion = true;
    }
    memoTable.traces[memoEntry] = entry;
  }

  // Fix the input stream's examinedLength -- it should be the maximum examined length
  // across all applications, not just this one.
  inputStream.examinedLength = Math.max(
    inputStream.examinedLength,
    origInputStreamExaminedLength
  );

  state.exitApplication(value);

  return succeeded;
};

pexprs.Apply.prototype.evalOnce = function (expr, state) {
  const {inputStream} = state;
  const origPos = inputStream.pos;
  const origLen = state._bindings.length;

  if (state.eval(expr)) {
    const arity = state._bindings.length - origLen;
    // Avoid Array.prototype.splice allocation in hot path; use pop into preallocated arrays
    const bindings = new Array(arity);
    const offsets = new Array(arity);
    for (let j = arity - 1; j >= 0; j--) {
      bindings[j] = state._bindings.pop();
      offsets[j] = state._bindingOffsets.pop();
    }
    const matchLength = inputStream.pos - origPos;
    return new NonterminalNode(this.ruleName, bindings, offsets, matchLength);
  } else {
    return false;
  }
};

pexprs.Apply.prototype.growSeedResult = function (body, state, origPos, lrEntry, newValue) {
  if (!newValue) {
    return false;
  }

  const {inputStream, memoTable} = state;

  while (true) {
    memoTable.matchLength[lrEntry] = inputStream.pos - origPos;
    memoTable.values[lrEntry] = newValue;
    memoTable.failures[lrEntry] = state.cloneRecordedFailures();

    if (state.isTracing()) {
      // Before evaluating the body again, add a trace node for this application to the memo entry.
      // Its only child is a copy of the trace node from `newValue`, which will always be the last
      // element in `state.trace`.
      const seedTrace = state.trace[state.trace.length - 1];
      memoTable.traces[lrEntry] = new Trace(
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
    if (inputStream.pos - origPos <= memoTable.matchLength[lrEntry]) {
      break;
    }
    if (state.isTracing()) {
      state.trace.splice(-2, 1); // Drop the trace for the old seed.
    }
  }
  if (state.isTracing()) {
    // The last entry is for an unused result -- pop it and save it in the "real" entry.
    memoTable.traces[lrEntry].recordLRTermination(state.trace.pop(), newValue);
  }
  inputStream.pos = origPos + memoTable.matchLength[lrEntry];
  return memoTable.values[lrEntry];
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
