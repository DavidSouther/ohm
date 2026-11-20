export class DiagnosticSnapshot {
  static fromResult(result, positions) {
    if (result instanceof DiagnosticSnapshot) return result;
    const failures = result.getRightmostFailures().map(failure => Object.freeze(failure.clone()));
    const expectedText = result.getExpectedText();
    const position = result.getRightmostFailurePosition();
    const diagnosticPosition = result.getDiagnosticPosition?.() ?? position;
    const location = positions && positions.getLineAndColumnNumbers(diagnosticPosition);
    const shortMessage = location
      ? `Line ${location.lineNum}, col ${location.colNum}: expected ${expectedText}`
      : result.shortMessage;
    return new DiagnosticSnapshot(
      position, failures, expectedText, shortMessage, diagnosticPosition
    );
  }

  constructor(position, failures, expectedText, shortMessage, diagnosticPosition = position) {
    this.position = position;
    this.diagnosticPosition = diagnosticPosition;
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

  getDiagnosticPosition() {
    return this.diagnosticPosition;
  }

  getRightmostFailurePosition() {
    return this.position;
  }
}
