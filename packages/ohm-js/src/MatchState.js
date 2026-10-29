import {InputStream} from './InputStream.js';
import {MatchResult} from './MatchResult.js';
import {Trace} from './Trace.js';
import {mergeFailureSummaries, noFailures} from './RecoveryCache.js';
import {emptyEffects} from './RecoveryEffects.js';
import * as pexprs from './pexprs.js';
import * as util from './util.js';

// --------------------------------------------------------------------
// Private stuff
// --------------------------------------------------------------------

let builtInApplySyntacticBody;

util.awaitBuiltInRules(builtInRules => {
  builtInApplySyntacticBody = builtInRules.rules.applySyntactic.body;
});

const applySpaces = new pexprs.Apply('spaces');

export class MatchState {
  constructor(matcher, startExpr, optPositionToRecordFailures, optRecovery) {
    this.matcher = matcher;
    this.startExpr = startExpr;

    this.grammar = matcher.grammar;
    this.input = matcher.getInput();
    this.inputStream = new InputStream(this.input);
    this.memoTable = matcher._memo;
    this.memoTable.beginPass(this.input.length);
    if (optRecovery) optRecovery.cache.memoTable = this.memoTable;

    this.userData = undefined;
    this.doNotMemoize = false;
    this._rowBasedIteration = false;

    this._bindings = [];
    this._bindingOffsets = [];
    this._applicationStack = [];
    this._posStack = [0];
    this.inLexifiedContextStack = [false];
    this._tokenStart = -1;
    this._tokenStartStack = [];

    this.rightmostFailurePosition = -1;
    this._rightmostFailurePositionStack = [];
    this._recordedFailuresStack = [];

    // Recovery at `B ! C`. `recovery` is the RecoveryContext shared by the
    // passes of a recovering match, or undefined.
    this.recovery = optRecovery;
    // Stop markers: join expressions of the fallibles whose attempt is in
    // progress. A scan stops where any of them matches.
    this._syncStack = [];
    this._syncContext = 0;
    this._syncContextStack = [];
    // Number of blocks whose guarded attempt is active.
    this._blockDepth = 0;
    this._recoveryLog = emptyEffects;
    this._attemptEffects = emptyEffects;
    this._recoveryFailureSummary = noFailures;
    this._recoveryFailureSummaryStack = [];
    this._noRecoveryDepth = 0; // > 0 inside `~`, `&` and recovery scans
    // Changes whenever an evaluation depends on stop markers or skipped
    // recording an attempt. A changed value prevents later reuse of the
    // application's result; left-recursion seeds stay stored for growth and tracing.
    this._recoveryTaint = 0;
    // Marks the next trace entry (the Fallible that just recovered) as recovered.
    this._traceRecovered = false;
    // The end of the last complete token matched in the current application:
    // the farthest position reached by a successful evaluation in a syntactic
    // context, or -1. Matches inside `~`, `&` and recovery scans do not count.
    // Tracked only while recovering.
    this._tokenEnd = -1;
    this._tokenEndStack = [];

    if (optPositionToRecordFailures !== undefined) {
      this.positionToRecordFailures = optPositionToRecordFailures;
      this.recordedFailures = Object.create(null);
    }
  }

  _suspendRecovery() {
    const tokenEnd = this._tokenEnd;
    this._noRecoveryDepth++;
    return tokenEnd;
  }

  _pushRecoverySync(join) {
    this._syncStack.push(join);
    this._syncContextStack.push(this._syncContext);
    this._syncContext = this.recovery.cache.enterContext(this._syncContext, join);
  }

  _popRecoverySync() {
    this._syncStack.pop();
    this._syncContext = this._syncContextStack.pop();
  }

  _resumeRecovery(tokenEnd) {
    this._noRecoveryDepth--;
    this._tokenEnd = tokenEnd;
  }

  posToOffset(pos) {
    return pos - this._posStack[this._posStack.length - 1];
  }

  enterApplication(app, memoKeyId) {
    this._posStack.push(this.inputStream.pos);
    this._applicationStack.push(app);
    this.inLexifiedContextStack.push(false);
    this._tokenStartStack.push(this._tokenStart);
    this._tokenStart = this._tokenStartFor(app);
    this.memoTable.enter(this.inputStream.pos, memoKeyId);
    this._rightmostFailurePositionStack.push(this.rightmostFailurePosition);
    this.rightmostFailurePosition = -1;
    if (this.recovery) {
      this._tokenEndStack.push(this._tokenEnd);
      this._tokenEnd = -1;
    }
  }

  exitApplication(optNode) {
    const origPos = this._posStack.pop();
    this._applicationStack.pop();
    this.inLexifiedContextStack.pop();
    this._tokenStart = this._tokenStartStack.pop();
    this.memoTable.exit(origPos);

    this.rightmostFailurePosition = Math.max(
      this.rightmostFailurePosition,
      this._rightmostFailurePositionStack.pop()
    );
    if (this.recovery) {
      this._tokenEnd = Math.max(this._tokenEnd, this._tokenEndStack.pop());
    }

    if (optNode) {
      this.pushBinding(optNode, origPos);
    }
  }

  enterLexifiedContext() {
    this.inLexifiedContextStack.push(true);
    this._tokenStartStack.push(this._tokenStart);
    if (this._tokenStart < 0) this._tokenStart = this.inputStream.pos;
  }

  exitLexifiedContext() {
    this.inLexifiedContextStack.pop();
    this._tokenStart = this._tokenStartStack.pop();
  }

  _tokenStartFor(app) {
    if (app.isSyntactic()) return -1;
    return this._tokenStart < 0 ? this.inputStream.pos : this._tokenStart;
  }

  _isLexicalFailureAt(pos) {
    return this._tokenStart >= 0 && this._tokenStart < pos;
  }

  _failureOf(expr, pos) {
    const failure = expr.toFailure(this.grammar);
    failure.lexical = this._isLexicalFailureAt(pos);
    return failure;
  }

  currentApplication() {
    return this._applicationStack[this._applicationStack.length - 1];
  }

  inSyntacticContext() {
    const currentApplication = this.currentApplication();
    if (currentApplication) {
      return currentApplication.isSyntactic() && !this.inLexifiedContext();
    } else {
      // The top-level context is syntactic if the start application is.
      return this.startExpr.factors[0].isSyntactic();
    }
  }

  inLexifiedContext() {
    return this.inLexifiedContextStack[this.inLexifiedContextStack.length - 1];
  }

  skipSpaces() {
    this.pushFailuresInfo();
    this.eval(applySpaces);
    this.popBinding();
    this.popFailuresInfo();
    return this.inputStream.pos;
  }

  skipSpacesIfInSyntacticContext() {
    return this.inSyntacticContext() ? this.skipSpaces() : this.inputStream.pos;
  }

  maybeSkipSpacesBefore(expr) {
    if (expr.allowsSkippingPrecedingSpace() && expr !== applySpaces) {
      return this.skipSpacesIfInSyntacticContext();
    } else {
      return this.inputStream.pos;
    }
  }

  pushBinding(node, origPos) {
    this._bindings.push(node);
    this._bindingOffsets.push(this.posToOffset(origPos));
  }

  popBinding() {
    this._bindings.pop();
    this._bindingOffsets.pop();
  }

  numBindings() {
    return this._bindings.length;
  }

  truncateBindings(newLength) {
    // Yes, this is this really faster than setting the `length` property (tested with
    // bin/es5bench on Node v6.1.0).
    // Update 2021-10-25: still true on v14.15.5 — it's ~20% speedup on es5bench.
    while (this._bindings.length > newLength) {
      this.popBinding();
    }
  }

  processFailure(pos, expr) {
    this.rightmostFailurePosition = Math.max(this.rightmostFailurePosition, pos);

    if (this.recovery && !this.trace) {
      const app = this.currentApplication();
      const resolved = app ? expr.substituteParams(app.args) : expr;
      const failures = this.recovery.cache.failuresOf(
        resolved, resolved === expr, this.grammar, this._isLexicalFailureAt(pos)
      );
      const summary = {position: pos, failures};
      this._recoveryFailureSummary = mergeFailureSummaries(
        summary,
        this._recoveryFailureSummary
      );
    }

    if (this.recordedFailures && pos === this.positionToRecordFailures) {
      const app = this.currentApplication();
      if (app) {
        // Substitute parameters with the actual pexprs that were passed to
        // the current rule.
        expr = expr.substituteParams(app.args);
      } else {
        // This branch is only reached for the "end-check" that is
        // performed after the top-level application. In that case,
        // expr === pexprs.end so there is no need to substitute
        // parameters.
      }

      this.recordFailure(this._failureOf(expr, pos), false);
    }
  }

  recordFailure(failure, shouldCloneIfNew) {
    const key = failure.toKey();
    if (!this.recordedFailures[key]) {
      this.recordedFailures[key] = shouldCloneIfNew ? failure.clone() : failure;
    } else {
      const prior = this.recordedFailures[key];
      if (prior.isFluffy() && !failure.isFluffy()) prior.clearFluffy();
      if (!failure.isLexical()) prior.lexical = false;
    }
  }

  recordFailures(failures, shouldCloneIfNew) {
    Object.keys(failures).forEach(key => {
      this.recordFailure(failures[key], shouldCloneIfNew);
    });
  }

  cloneRecordedFailures() {
    if (!this.recordedFailures) {
      return undefined;
    }

    const ans = Object.create(null);
    Object.keys(this.recordedFailures).forEach(key => {
      ans[key] = this.recordedFailures[key].clone();
    });
    return ans;
  }

  getRightmostFailurePosition() {
    return this.rightmostFailurePosition;
  }

  _getRightmostFailureOffset() {
    return this.rightmostFailurePosition >= 0
      ? this.posToOffset(this.rightmostFailurePosition)
      : -1;
  }

  // Returns the memoized trace entry for `expr` at `pos`, if one exists, `null` otherwise.
  getMemoizedTraceEntry(pos, expr) {
    const {memoTable} = this;
    if (expr instanceof pexprs.Apply) {
      const entry = memoTable.find(pos, memoTable.keyIdOf(expr));
      if (entry >= 0 && memoTable.traces[entry]) {
        const traceEntry = memoTable.traces[entry].cloneWithExpr(expr);
        traceEntry.isMemoized = true;
        return traceEntry;
      }
    }
    return null;
  }

  // Returns a new trace entry, with the currently active trace array as its children.
  getTraceEntry(pos, expr, succeeded, bindings) {
    if (expr instanceof pexprs.Apply) {
      const app = this.currentApplication();
      const actuals = app ? app.args : [];
      expr = expr.substituteParams(actuals);
    }
    return (
      this.getMemoizedTraceEntry(pos, expr) ||
      new Trace(this.input, pos, this.inputStream.pos, expr, succeeded, bindings, this.trace)
    );
  }

  isTracing() {
    return !!this.trace;
  }

  hasNecessaryInfo(entry) {
    const {memoTable} = this;
    if (this.trace && !memoTable.traces[entry]) {
      return false;
    }

    if (
      this.recordedFailures &&
      this.inputStream.pos + memoTable.rightmostFailureOffset[entry] ===
        this.positionToRecordFailures
    ) {
      return !!memoTable.failures[entry];
    }

    return true;
  }

  // Failures at a reused lexical application's start depend on its caller's token.
  _reusedFailures(failures, position, origPos, app) {
    if (position !== origPos || app.isSyntactic()) return failures;
    const lexical = this._isLexicalFailureAt(origPos);
    return failures.map(failure => {
      const copy = failure.clone();
      copy.lexical = lexical;
      return copy;
    });
  }

  useMemoizedResult(origPos, entry, app) {
    const {memoTable} = this;
    if (this.recovery && !this.trace) {
      const record = this.recovery.cache.memoRecords.get(entry);
      if (record) this.recovery.cache.depend(record);
      const stored = memoTable.summaries[entry];
      if (stored) {
        const position = origPos + memoTable.rightmostFailureOffset[entry];
        const failures = stored.position === position
          ? this._reusedFailures(stored.failures, position, origPos, app) : [];
        this._recoveryFailureSummary = mergeFailureSummaries(
          {position, failures},
          this._recoveryFailureSummary
        );
      }
    }
    if (this.trace) {
      this.trace.push(memoTable.traces[entry]);
    }

    const tokenEndOffset = memoTable.tokenEndOffset[entry];
    if (this.recovery && tokenEndOffset >= 0) {
      this._tokenEnd = Math.max(this._tokenEnd, origPos + tokenEndOffset);
    }

    const memoRecRightmostFailurePosition =
      this.inputStream.pos + memoTable.rightmostFailureOffset[entry];
    this.rightmostFailurePosition = Math.max(
      this.rightmostFailurePosition,
      memoRecRightmostFailurePosition
    );
    if (
      this.recordedFailures &&
      this.positionToRecordFailures === memoRecRightmostFailurePosition &&
      memoTable.failures[entry]
    ) {
      const failures = this._reusedFailures(
        Object.values(memoTable.failures[entry]), memoRecRightmostFailurePosition, origPos, app
      );
      this.recordFailures(failures, true);
    }

    this.inputStream.examinedLength = Math.max(
      this.inputStream.examinedLength,
      memoTable.examinedLength[entry] + origPos
    );

    const value = memoTable.values[entry];
    if (value) {
      this.inputStream.pos += memoTable.matchLength[entry];
      this.pushBinding(value, origPos);
      return true;
    }
    return false;
  }

  // Evaluate `expr` and return `true` if it succeeded, `false` otherwise. On success, `bindings`
  // will have `expr.getArity()` more elements than before, and the input stream's position may
  // have increased. On failure, `bindings` and position will be unchanged.
  eval(expr) {
    if (this.recovery && !this.trace) return this.recovery.cache.evaluate(this, expr);
    return this.evalUncached(expr);
  }

  evalUncached(expr) {
    const {inputStream} = this;
    const origNumBindings = this._bindings.length;
    const origUserData = this.userData;

    let origRecordedFailures;
    if (this.recordedFailures) {
      origRecordedFailures = this.recordedFailures;
      this.recordedFailures = Object.create(null);
    }

    const origPos = inputStream.pos;
    const memoPos = this.maybeSkipSpacesBefore(expr);

    let origTrace;
    if (this.trace) {
      origTrace = this.trace;
      this.trace = [];
    }

    // Do the actual evaluation.
    const ans = expr.eval(this);

    if (this.trace) {
      const bindings = this._bindings.slice(origNumBindings);
      const traceEntry = this.getTraceEntry(memoPos, expr, ans, bindings);
      traceEntry.isImplicitSpaces = expr === applySpaces;
      traceEntry.isRootNode = expr === this.startExpr;
      if (this._traceRecovered) {
        traceEntry.isRecovered = true;
        this._traceRecovered = false;
      }
      origTrace.push(traceEntry);
      this.trace = origTrace;
    }

    if (ans) {
      if (this.recovery && inputStream.pos > this._tokenEnd && this.inSyntacticContext()) {
        this._tokenEnd = inputStream.pos;
      }
      if (this.recordedFailures && inputStream.pos === this.positionToRecordFailures) {
        Object.keys(this.recordedFailures).forEach(key => {
          this.recordedFailures[key].makeFluffy();
        });
      }
    } else {
      // Reset the position, bindings, and userData.
      inputStream.pos = origPos;
      this.truncateBindings(origNumBindings);
      this.userData = origUserData;
    }

    if (this.recordedFailures) {
      this.recordFailures(origRecordedFailures, false);
    }

    // The built-in applySyntactic rule needs special handling: we want to skip
    // trailing spaces, just as with the top-level application of a syntactic rule.
    if (expr === builtInApplySyntacticBody) {
      this.skipSpaces();
    }

    return ans;
  }

  getMatchResult() {
    this.grammar._setUpMatchState(this);
    if (
      this.recovery &&
      (this.userData !== undefined || this.inputStream.constructor !== InputStream)
    ) {
      this.recovery.cache.disabled = true;
    }
    this.eval(this.startExpr);
    let rightmostFailures;
    if (this.recordedFailures) {
      rightmostFailures = Object.keys(this.recordedFailures).map(
        key => this.recordedFailures[key]
      );
    } else if (this.recovery && !this.trace) {
      // Summaries share their failure lists, so hand the result its own array.
      rightmostFailures = this._recoveryFailureSummary.failures.slice();
    }
    const cst = this._bindings[0];
    if (cst) {
      cst.grammar = this.grammar;
    }
    return new MatchResult(
      this.matcher,
      this.input,
      this.startExpr,
      cst,
      this._bindingOffsets[0],
      this.rightmostFailurePosition,
      rightmostFailures
    );
  }

  getTrace() {
    this.trace = [];
    const matchResult = this.getMatchResult();

    // The trace node for the start rule is always the last entry. If it is a syntactic rule,
    // the first entry is for an application of 'spaces'.
    // TODO(pdubroy): Clean this up by introducing a special `Match<startAppl>` rule, which will
    // ensure that there is always a single root trace node.
    const rootTrace = this.trace[this.trace.length - 1];
    rootTrace.result = matchResult;
    return rootTrace;
  }

  pushFailuresInfo() {
    this._rightmostFailurePositionStack.push(this.rightmostFailurePosition);
    this._recordedFailuresStack.push(this.recordedFailures);
    this._recoveryFailureSummaryStack.push(this._recoveryFailureSummary);
  }

  popFailuresInfo() {
    this.rightmostFailurePosition = this._rightmostFailurePositionStack.pop();
    this.recordedFailures = this._recordedFailuresStack.pop();
    this._recoveryFailureSummary = this._recoveryFailureSummaryStack.pop();
  }
}
