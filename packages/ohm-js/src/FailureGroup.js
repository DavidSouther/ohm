// A FailureGroup holds the failures recorded at the position a failure-only
// rematch is looking for, keyed by `Failure#toKey()`.
export default class FailureGroup {
  constructor() {
    this._failures = Object.create(null);
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
  record(failure) {
    this._insert(failure);
  }

  merge(other) {
    for (const failure of Object.values(other._failures)) this._insert(failure);
  }

  markFailuresIncidental() {
    for (const [key, failure] of Object.entries(this._failures)) {
      if (!failure.isFluffy()) {
        const copy = failure.clone();
        copy.makeFluffy();
        this._failures[key] = copy;
      }
    }
  }

  copy() {
    const copy = new FailureGroup();
    copy.merge(this);
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
