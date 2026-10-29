import {emptyEffects} from './RecoveryEffects.js';

// A segment's transformation stays valid while no attempt in its source range
// changes. Ranges conservatively cover different fallibles at the same position.
export class RecoveryAttemptReplay {
  constructor(attempts, inputLength, stats) {
    this.attempts = attempts;
    this.stats = stats;
    this.base = 1;
    while (this.base <= inputLength) this.base *= 2;
    this.version = 0;
    this.versions = new Map();
    this.applied = new WeakMap();
  }

  changed(position) {
    const version = ++this.version;
    for (let index = this.base + position; index >= 1; index = Math.floor(index / 2)) {
      this.versions.set(index, version);
    }
  }

  latest(start, end) {
    let left = this.base + start;
    let right = this.base + end;
    let version = 0;
    while (left <= right) {
      if (left % 2) version = Math.max(version, this.versions.get(left++) || 0);
      if (!(right % 2)) version = Math.max(version, this.versions.get(right--) || 0);
      left = Math.floor(left / 2);
      right = Math.floor(right / 2);
    }
    return version;
  }

  update(attempt, shift) {
    const prior = this.attempts.get(attempt.key);
    const depth = attempt.depth + shift;
    if (
      prior &&
      prior.start === attempt.start &&
      prior.rightmost === attempt.rightmost &&
      prior.depth === depth
    ) {
      return;
    }
    this.attempts.set(attempt.key, {...attempt, depth});
    if (prior && prior.start !== attempt.start) this.changed(prior.start);
    this.changed(attempt.start);
  }

  apply(effects) {
    const pending = [{node: effects, shift: 0, complete: false}];
    while (pending.length) {
      const entry = pending.pop();
      const {node, shift, complete} = entry;
      if (node === emptyEffects) continue;
      let versions = this.applied.get(node);
      if (!versions) this.applied.set(node, (versions = new Map()));
      if (complete) {
        versions.set(shift, this.version);
        continue;
      }
      this.stats.attemptEffectsVisited++;
      const applied = versions.get(shift);
      if (applied !== undefined && this.latest(node.minStart, node.maxStart) <= applied) {
        this.stats.attemptEffectsSkipped++;
        continue;
      }
      pending.push({...entry, complete: true});
      if (node.kind === 'concat') {
        pending.push(
          {node: node.right, shift, complete: false},
          {node: node.left, shift, complete: false}
        );
      } else if (node.kind === 'shift') {
        pending.push({node: node.left, shift: shift + node.value, complete: false});
      } else if (node.kind === 'value') {
        this.update(node.value, shift);
      } else {
        node.forEachUnique((attempt, nestedShift) => {
          this.stats.attemptEffectsVisited++;
          this.update(attempt, shift + nestedShift);
        });
      }
    }
  }

  release() {
    this.versions.clear();
    this.applied = new WeakMap();
  }
}
