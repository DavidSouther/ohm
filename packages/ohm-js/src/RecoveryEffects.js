// Immutable ordered effects can be shared by memo records and iteration prefixes.
// Explicit array access expands occurrences; diagnostic collection visits shared
// segments once, preserving the first occurrence of each diagnostic.
export class RecoveryEffects {
  constructor(kind, left, right, value) {
    this.kind = kind;
    this.left = left;
    this.right = right;
    this.value = value;
    const position = kind === 'value' && value?.key ? value.start : undefined;
    this.minStart = position ?? left?.minStart ?? Infinity;
    this.maxStart = position ?? left?.maxStart ?? -Infinity;
    if (kind === 'concat') {
      this.minStart = Math.min(this.minStart, right.minStart);
      this.maxStart = Math.max(this.maxStart, right.maxStart);
    }
  }

  append(value) {
    return this.concat(new RecoveryEffects('value', null, null, value));
  }

  concat(other) {
    if (this === emptyEffects) return other;
    if (other === emptyEffects) return this;
    return new RecoveryEffects('concat', this, other);
  }

  shift(depth) {
    return !depth || this === emptyEffects
      ? this
      : new RecoveryEffects('shift', this, null, depth);
  }

  filter(predicate) {
    return this === emptyEffects ? this : new RecoveryEffects('filter', this, null, predicate);
  }

  since(mark) {
    const parts = [];
    let node = this;
    while (node !== mark && node !== emptyEffects) {
      if (node.kind !== 'concat') {
        if (mark === emptyEffects) parts.push(node);
        else throw new Error('Recovery effect mark is no longer a prefix');
        break;
      }
      parts.push(node.right);
      node = node.left;
    }
    let result = emptyEffects;
    for (let i = parts.length - 1; i >= 0; i--) result = result.concat(parts[i]);
    return result;
  }

  visit(callback, unique, reverse = false) {
    const seen = new Map();
    const predicates = new Map();
    let nextPredicate = 0;
    const stack = [{node: this, shift: 0, filters: [], filterKey: ''}];
    while (stack.length) {
      const entry = stack.pop();
      const {node, shift, filters, filterKey} = entry;
      if (node === emptyEffects) continue;
      if (unique) {
        const key = `${shift}:${filterKey}`;
        let contexts = seen.get(node);
        if (contexts?.has(key)) continue;
        if (!contexts) seen.set(node, (contexts = new Set()));
        contexts.add(key);
      }
      if (node.kind === 'concat') {
        const first = reverse ? node.right : node.left;
        const second = reverse ? node.left : node.right;
        stack.push({...entry, node: second}, {...entry, node: first});
      } else if (node.kind === 'shift') {
        stack.push({...entry, node: node.left, shift: shift + node.value});
      } else if (node.kind === 'filter') {
        let id = predicates.get(node.value);
        if (id === undefined) predicates.set(node.value, (id = nextPredicate++));
        stack.push({
          node: node.left,
          shift,
          filters: [...filters, node.value],
          filterKey: `${filterKey},${id}`,
        });
      } else if (filters.every(predicate => predicate(node.value))) {
        callback(node.value, shift);
      }
    }
  }

  forEachUnique(callback, reverse = false) {
    this.visit(callback, true, reverse);
  }

  toArray() {
    const values = [];
    this.visit(value => values.push(value), false);
    return values;
  }
}

export const emptyEffects = new RecoveryEffects('empty');
