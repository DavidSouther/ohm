// A FailureGroup holds the failures recorded at the position a failure-only
// rematch is looking for, keyed by `Failure#toKey()`, together with the
// evidence for a diagnostic position earlier than that failure position.
//
// Only strong failures (see `Failure#isFluffy`) contribute to that evidence.
// `proposedDiagnosticPosition` is undefined while unassigned, an input index
// when every strong failure agrees on it, and null after a disagreement,
// including a strong failure with a proposal meeting one without. An
// enclosing join can fill an unassigned proposal and must keep a disagreement.
export default class FailureGroup {
  get hasStrongFailures() { return this._hasStrongFailures; }
  get proposedDiagnosticPosition() { return this._proposedDiagnosticPosition; }
  get minPrecedingImplicitSpaceLength() { return this._minPrecedingImplicitSpaceLength; }

  constructor() {
    this._failures = Object.create(null);
    this._hasStrongFailures = false;
    this._proposedDiagnosticPosition = undefined;
    this._minPrecedingImplicitSpaceLength = Infinity;
  }

  // Stored failures can be shared across groups. Changes replace the affected
  // entry with a copy, and exported failures are detached.
  _insert(failure) {
    const key = failure.toKey();
    const prior = this._failures[key];
    if (!prior) {
      this._failures[key] = failure;
    } else {
      const strong = prior.isFluffy() && !failure.isFluffy();
      const nonlexical = prior.isLexical() && !failure.isLexical();
      if (strong || nonlexical) {
        const copy = prior.clone();
        if (strong) copy.clearFluffy();
        if (nonlexical) copy.lexical = false;
        this._failures[key] = copy;
      }
    }
  }

  // `failure` must not be referenced elsewhere.
  record(failure, precedingImplicitSpaceLength) {
    if (!failure.isFluffy()) {
      if (this._proposedDiagnosticPosition !== undefined) this._proposedDiagnosticPosition = null;
      this._hasStrongFailures = true;
      this._minPrecedingImplicitSpaceLength = Math.min(
        this._minPrecedingImplicitSpaceLength, precedingImplicitSpaceLength
      );
    }
    this._insert(failure);
  }

  merge(other, offset = 0, precedingImplicitSpaceLength = other.minPrecedingImplicitSpaceLength) {
    if (other.hasStrongFailures) {
      const proposal = other.proposedDiagnosticPosition;
      const shiftedProposal = Number.isInteger(proposal) ? proposal + offset : proposal;
      if (this._hasStrongFailures && this._proposedDiagnosticPosition !== shiftedProposal) {
        this._proposedDiagnosticPosition = null;
      } else if (!this._hasStrongFailures) {
        this._proposedDiagnosticPosition = shiftedProposal;
      }
      this._hasStrongFailures = true;
      this._minPrecedingImplicitSpaceLength = Math.min(
        this._minPrecedingImplicitSpaceLength, precedingImplicitSpaceLength
      );
    }
    for (const failure of Object.values(other._failures)) this._insert(failure);
  }

  proposeDiagnosticPosition(position) {
    if (this._hasStrongFailures && this._proposedDiagnosticPosition === undefined) {
      this._proposedDiagnosticPosition = position;
    }
  }

  markFailuresIncidental() {
    for (const [key, failure] of Object.entries(this._failures)) {
      if (!failure.isFluffy()) {
        const copy = failure.clone();
        copy.makeFluffy();
        this._failures[key] = copy;
      }
    }
    this._hasStrongFailures = false;
    this._proposedDiagnosticPosition = undefined;
    this._minPrecedingImplicitSpaceLength = Infinity;
  }

  // Memo entries store the proposal relative to the rule application.
  copyAtOffset(offset) {
    const copy = new FailureGroup();
    copy.merge(this, offset);
    return copy;
  }

  toMap() {
    const map = Object.create(null);
    for (const [key, failure] of Object.entries(this._failures)) map[key] = failure.clone();
    return map;
  }

  toArray() {
    return Object.values(this._failures).map(failure => failure.clone());
  }
}
