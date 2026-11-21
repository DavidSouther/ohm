import {DiagnosticSnapshot} from './DiagnosticSnapshot.js';

// A recovery correction or final unrecovered failure. The diagnostic is
// captured as a snapshot at construction, so later passes cannot change it.
export class RecoveredFailure {
  constructor(interval, position, passResult, missing = false) {
    this.interval = interval;
    this.position = position;
    this.missing = missing;
    this._diagnostic = DiagnosticSnapshot.fromResult(
      passResult,
      passResult._recovery?.positionIndex
    );
    this.shortMessage = this._diagnostic.shortMessage;
  }

  getDiagnosticPosition() {
    return this._diagnostic.getDiagnosticPosition();
  }

  getExpectedText() {
    return this._diagnostic.getExpectedText();
  }

  getRightmostFailures() {
    return this._diagnostic.getRightmostFailures();
  }
}

function byPosition(a, b) {
  return a.position - b.position;
}

// Report identical diagnostics once while preserving distinct skip regions.
export function distinctByPosition(failures) {
  const seen = new Set();
  const found = [];
  for (const f of failures) {
    const k = `${f.interval.startIdx}:${f.interval.endIdx}:${f.position}:${f.shortMessage}`;
    if (!seen.has(k)) {
      seen.add(k);
      found.push(f);
    }
  }
  return found.sort(byPosition);
}

// A `_correction` node also carries the recoveries made inside the attempt it replaced,
// whose nodes were discarded.
export function collectRecoveredFailures(cst) {
  const found = [];
  const walk = node => {
    if (node.isCorrection()) {
      if (node.recoveredFailure) {
        found.push(node.recoveredFailure);
        if (node._nestedFailureEffects) {
          node._nestedFailureEffects.forEachUnique(failure => found.push(failure));
        } else {
          found.push(...node.nestedFailures);
        }
      }
      return;
    }
    const {children} = node;
    if (children) {
      for (const child of children) walk(child);
    }
  };
  walk(cst);
  return distinctByPosition(found);
}
