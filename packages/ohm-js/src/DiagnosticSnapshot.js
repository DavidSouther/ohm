export class DiagnosticSnapshot {
  static fromResult(result, positions) {
    if (result instanceof DiagnosticSnapshot) return result;
    const failures = result.getRightmostFailures().map(failure => Object.freeze(failure.clone()));
    const expectedText = result.getExpectedText();
    const position = result.getRightmostFailurePosition();
    const location = positions && positions.getLineAndColumnNumbers(position);
    const shortMessage = location
      ? `Line ${location.lineNum}, col ${location.colNum}: expected ${expectedText}`
      : result.shortMessage;
    return new DiagnosticSnapshot(position, failures, expectedText, shortMessage);
  }

  constructor(position, failures, expectedText, shortMessage) {
    this.position = position;
    this._failures = Object.freeze(failures);
    this._expectedText = expectedText;
    this.shortMessage = shortMessage;
    Object.freeze(this);
  }

  getExpectedText() {
    return this._expectedText;
  }

  getRightmostFailures() {
    return this._failures.map(failure => failure.clone());
  }

  getRightmostFailurePosition() {
    return this.position;
  }
}
