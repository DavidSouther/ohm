/*
  A failure that a recovery point skipped over. `interval` is the skip region
  (empty for the final failure of a parse that recovery cannot finish), and
  `position`, `shortMessage` and the expected failures are those of the pass
  that permitted the recovery: that pass's farthest failure.
*/
export class RecoveredFailure {
  constructor(interval, position, passResult) {
    this.interval = interval;
    this.position = position;
    this._passResult = passResult;
    this.shortMessage = passResult.shortMessage;
  }

  getExpectedText() {
    return this._passResult.getExpectedText();
  }

  getRightmostFailures() {
    return this._passResult.getRightmostFailures();
  }
}

export function byPosition(a, b) {
  return a.position - b.position;
}

// Every recovery read from a CST, in failure position order.
export function collectRecoveredFailures(cst) {
  const found = [];
  const walk = node => {
    if (node.isFailure()) {
      if (node.recoveredFailure) {
        found.push(node.recoveredFailure, ...node.nestedFailures);
      }
      return;
    }
    const {children} = node;
    if (children) {
      for (const child of children) walk(child);
    }
  };
  walk(cst);
  return found.sort(byPosition);
}
