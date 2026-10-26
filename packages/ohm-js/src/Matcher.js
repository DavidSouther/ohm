import {grammarDoesNotSupportIncrementalParsing, matcherCannotRecover} from './errors.js';
import {MatchState} from './MatchState.js';
import {matchRecovering} from './Recovery.js';
import * as pexprs from './pexprs.js';

export class Matcher {
  constructor(grammar) {
    this.grammar = grammar;
    this._memoTable = [];
    this._input = '';
    this._isMemoTableStale = false;
    // 'plain' or 'recover'. Plain matches memoize without recording recovery
    // attempts, so their entries are unusable for recovery.
    this._memoMode = undefined;
  }

  _resetMemoTable() {
    this._memoTable = [];
    this._isMemoTableStale = false;
  }

  _prepareForRecovery() {
    if (this._isMemoTableStale) {
      throw matcherCannotRecover('its input changed after an earlier match');
    }
    if (this._memoMode === 'plain') {
      throw matcherCannotRecover('its memo table comes from a match without recovery');
    }
    // A fresh RecoveryContext has no attempts for previously memoized entries.
    this._resetMemoTable();
    this._memoMode = 'recover';
  }

  _invalidateMemoEntries(invalidatedIdx, endPos) {
    const {_memoTable: memoTable} = this;
    const limit = Math.min(endPos, memoTable.length);
    for (let pos = 0; pos < limit; pos++) {
      const posInfo = memoTable[pos];
      if (posInfo) posInfo.clearObsoleteEntries(pos, invalidatedIdx);
    }
  }

  getInput() {
    return this._input;
  }

  setInput(str) {
    if (this._input !== str) {
      this.replaceInputRange(0, this._input.length, str);
    }
    return this;
  }

  replaceInputRange(startIdx, endIdx, str) {
    const prevInput = this._input;
    const memoTable = this._memoTable;
    if (
      startIdx < 0 ||
      startIdx > prevInput.length ||
      endIdx < 0 ||
      endIdx > prevInput.length ||
      startIdx > endIdx
    ) {
      throw new Error('Invalid indices: ' + startIdx + ' and ' + endIdx);
    }

    // update input
    this._input = prevInput.slice(0, startIdx) + str + prevInput.slice(endIdx);
    if (this._input !== prevInput && memoTable.length > 0) {
      this._isMemoTableStale = true;
    }

    // update memo table (similar to the above)
    const restOfMemoTable = memoTable.slice(endIdx);
    memoTable.length = startIdx;
    for (let idx = 0; idx < str.length; idx++) {
      memoTable.push(undefined);
    }
    for (const posInfo of restOfMemoTable) {
      memoTable.push(posInfo);
    }

    this._invalidateMemoEntries(startIdx, startIdx);

    return this;
  }

  match(optStartApplicationStr, options = {}) {
    return this._match(this._getStartExpr(optStartApplicationStr), {
      incremental: options.incremental ?? true,
      recover: !!options.recover,
      tracing: false,
    });
  }

  trace(optStartApplicationStr, options = {}) {
    return this._match(this._getStartExpr(optStartApplicationStr), {
      incremental: options.incremental ?? true,
      recover: !!options.recover,
      tracing: true,
    });
  }

  _match(startExpr, options = {}) {
    const opts = {
      tracing: false,
      incremental: true,
      positionToRecordFailures: undefined,
      recover: false, // run the recovery pass driver
      recovery: undefined, // one pass of a recovering match (a RecoveryContext)
      ...options,
    };
    if (opts.recover) {
      return matchRecovering(this, startExpr, opts);
    }
    if (!opts.incremental) {
      this._resetMemoTable();
    } else if (this._isMemoTableStale && !this.grammar.supportsIncrementalParsing) {
      throw grammarDoesNotSupportIncrementalParsing(this.grammar);
    }

    if (!opts.recovery) {
      this._memoMode = 'plain';
    }
    const state = new MatchState(
      this,
      startExpr,
      opts.positionToRecordFailures,
      opts.recovery
    );
    return opts.tracing ? state.getTrace() : state.getMatchResult();
  }

  /*
    Returns the starting expression for this Matcher's associated grammar. If
    `optStartApplicationStr` is specified, it is a string expressing a rule application in the
    grammar. If not specified, the grammar's default start rule will be used.
  */
  _getStartExpr(optStartApplicationStr) {
    const applicationStr = optStartApplicationStr || this.grammar.defaultStartRule;
    if (!applicationStr) {
      throw new Error('Missing start rule argument -- the grammar has no default start rule.');
    }

    const startApp = this.grammar.parseApplication(applicationStr);
    return new pexprs.Seq([startApp, pexprs.end]);
  }
}
