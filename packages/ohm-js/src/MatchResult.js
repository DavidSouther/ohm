import * as common from './common.js';
import * as util from './util.js';
import {Interval} from './Interval.js';
import {collectRecoveredFailures} from './RecoveredFailure.js';

// --------------------------------------------------------------------
// Private stuff
// --------------------------------------------------------------------

export class MatchResult {
  constructor(
    matcher,
    input,
    startExpr,
    cst,
    cstOffset,
    rightmostFailurePosition,
    optRecordedFailures
  ) {
    this.matcher = matcher;
    this.input = input;
    this.startExpr = startExpr;
    this._cst = cst;
    this._cstOffset = cstOffset;
    this._rightmostFailurePosition = rightmostFailurePosition;
    this._rightmostFailures = optRecordedFailures;

    // `_recovery`: the RecoveryContext when this result came from a recovering
    // match. `_recoveredFailures`: preset when such a match fails; otherwise
    // computed on demand.
    this._recovery = undefined;
    this._recoveredFailures = undefined;

    if (this.failed()) {
      common.defineLazyProperty(this, 'message', function () {
        const detail = 'Expected ' + this.getExpectedText();
        return this._getLineAndColumn().toString() + detail;
      });
      common.defineLazyProperty(this, 'shortMessage', function () {
        const detail = 'expected ' + this.getExpectedText();
        const errorInfo = this._recovery?.positionIndex
          ? this._recovery.positionIndex.getLineAndColumnNumbers(this.getRightmostFailurePosition())
          : this._getLineAndColumn();
        return 'Line ' + errorInfo.lineNum + ', col ' + errorInfo.colNum + ': ' + detail;
      });
    }
  }

  succeeded() {
    return !!this._cst;
  }

  _getLineAndColumn() {
    const position = this.getRightmostFailurePosition();
    return this._recovery?.positionIndex
      ? this._recovery.positionIndex.getLineAndColumn(position)
      : util.getLineAndColumn(this.input, position);
  }

  failed() {
    return !this.succeeded();
  }

  getRightmostFailurePosition() {
    return this._rightmostFailurePosition;
  }

  getRightmostFailures() {
    if (!this._rightmostFailures) {
      this.matcher.setInput(this.input);
      const matchResultWithFailures = this.matcher._match(this.startExpr, {
        tracing: false,
        positionToRecordFailures: this.getRightmostFailurePosition(),
        // Re-match under the same recovery corrections, or the expected text
        // will not match this result's failure position.
        recovery: this._recovery,
      });
      this._rightmostFailures = matchResultWithFailures.getRightmostFailures();
    }
    return this._rightmostFailures;
  }

  // Returns a fresh array of recovery diagnostics, or [] without recovery.
  // If recovery cannot finish the match, includes the final unrecovered failure.
  getRecoveredFailures() {
    if (!this._recoveredFailures) {
      this._recoveredFailures =
        this.succeeded() && this._recovery ? collectRecoveredFailures(this._cst) : [];
    }
    return this._recoveredFailures.slice();
  }

  // For a recovering match, how its first pass ran: `mode` is 'probe' (without the reuse cache)
  // or 'cached', and `better` is the mode that would have been cheaper in hindsight ('probe' if
  // the first pass succeeded, 'cached' if it failed). Undefined without recovery.
  getFirstPass() {
    const report = this._recovery?.firstPass;
    return report ? {mode: report.mode, better: report.better} : undefined;
  }

  toString() {
    return this.succeeded()
      ? '[match succeeded]'
      : '[match failed at position ' + this.getRightmostFailurePosition() + ']';
  }

  // Return a string summarizing the expected contents of the input stream when
  // the match failure occurred.
  getExpectedText() {
    if (this.succeeded()) {
      throw new Error('cannot get expected text of a successful MatchResult');
    }

    const sb = new common.StringBuffer();
    let failures = this.getRightmostFailures();

    // Filter out the fluffy failures to make the default error messages more useful
    failures = failures.filter(failure => !failure.isFluffy());

    for (let idx = 0; idx < failures.length; idx++) {
      if (idx > 0) {
        if (idx === failures.length - 1) {
          sb.append(failures.length > 2 ? ', or ' : ' or ');
        } else {
          sb.append(', ');
        }
      }
      sb.append(failures[idx].toString());
    }
    return sb.contents();
  }

  getInterval() {
    const pos = this.getRightmostFailurePosition();
    return new Interval(this.input, pos, pos);
  }
}
