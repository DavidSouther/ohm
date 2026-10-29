const height = node => node ? node.height : 0;
const maximum = node => node ? node.maxRightmost : -Infinity;

function update(node) {
  node.height = 1 + Math.max(height(node.left), height(node.right));
  node.maxRightmost = Math.max(node.entry.rightmost, maximum(node.left), maximum(node.right));
  return node;
}

function rotateLeft(node) {
  const root = node.right;
  node.right = root.left;
  root.left = update(node);
  return update(root);
}

function rotateRight(node) {
  const root = node.left;
  node.left = root.right;
  root.right = update(node);
  return update(root);
}

function balance(node) {
  update(node);
  if (height(node.left) - height(node.right) > 1) {
    if (height(node.left.left) < height(node.left.right)) node.left = rotateLeft(node.left);
    return rotateRight(node);
  }
  if (height(node.right) - height(node.left) > 1) {
    if (height(node.right.right) < height(node.right.left)) node.right = rotateRight(node.right);
    return rotateLeft(node);
  }
  return node;
}

function insert(node, entry, compare) {
  if (!node) {
    return {entry, left: null, right: null, height: 1, maxRightmost: entry.rightmost};
  }
  if (compare(entry, node.entry) < 0) node.left = insert(node.left, entry, compare);
  else node.right = insert(node.right, entry, compare);
  return balance(node);
}

function remove(node, entry, compare) {
  if (!node) return null;
  const order = compare(entry, node.entry);
  if (order < 0) node.left = remove(node.left, entry, compare);
  else if (order > 0) node.right = remove(node.right, entry, compare);
  else {
    if (!node.left) return node.right;
    if (!node.right) return node.left;
    let successor = node.right;
    while (successor.left) successor = successor.left;
    node.entry = successor.entry;
    node.right = remove(node.right, successor.entry, compare);
  }
  return balance(node);
}

const byStart = (a, b) => a.start - b.start || a.rank - b.rank;
const byFailure = (a, b) => a.rightmost - b.rightmost || b.start - a.start ||
  b.depth - a.depth || a.rank - b.rank;

function firstAt(node, position) {
  let found;
  while (node) {
    if (node.entry.rightmost < position) node = node.right;
    else {
      if (node.entry.rightmost === position) found = node.entry;
      node = node.left;
    }
  }
  return found;
}

function after(node, entry) {
  let found;
  while (node) {
    if (byFailure(node.entry, entry) > 0) {
      found = node.entry;
      node = node.left;
    } else node = node.right;
  }
  return found;
}

// Attempt coordinates and depth remain immutable until replaced through set().
// Separate indexes preserve Map insertion rank without retaining obsolete writes.
export class RecoveryAttempts {
  constructor() {
    this._entries = new Map();
    this._byFailure = null;
    this._byStart = null;
    this._nextRank = 0;
  }

  get size() {
    return this._entries.size;
  }

  get(key) {
    return this._entries.get(key)?.value;
  }

  has(key) {
    return this._entries.has(key);
  }

  set(key, value) {
    const previous = this._entries.get(key);
    if (previous) this._removeIndexes(previous);
    const entry = {
      key, value, start: value.start, rightmost: value.rightmost, depth: value.depth,
      rank: previous ? previous.rank : this._nextRank++,
    };
    this._entries.set(key, entry);
    this._byFailure = insert(this._byFailure, entry, byFailure);
    this._byStart = insert(this._byStart, entry, byStart);
    return this;
  }

  _removeIndexes(entry) {
    this._byFailure = remove(this._byFailure, entry, byFailure);
    this._byStart = remove(this._byStart, entry, byStart);
  }

  delete(key) {
    const entry = this._entries.get(key);
    if (!entry) return false;
    this._removeIndexes(entry);
    return this._entries.delete(key);
  }

  clear() {
    this._entries.clear();
    this._byFailure = null;
    this._byStart = null;
  }

  *values() {
    for (const entry of this._entries.values()) yield entry.value;
  }

  *entries() {
    for (const [key, entry] of this._entries) yield [key, entry.value];
  }

  [Symbol.iterator]() {
    return this.entries();
  }

  choose(position, permitted) {
    let entry = firstAt(this._byFailure, position);
    // Permitted entries are normally retired at grant time. Retain exact skip
    // behavior for any remaining permitted entry without scanning other positions.
    while (entry && entry.rightmost === position) {
      if (!permitted.has(entry.value.key)) return entry.value;
      entry = after(this._byFailure, entry);
    }
    return undefined;
  }

  invalidateAt(point) {
    const removed = [];
    const stack = [this._byStart];
    while (stack.length) {
      const node = stack.pop();
      if (!node || node.maxRightmost < point) continue;
      stack.push(node.left);
      if (node.entry.start > point) continue;
      if (node.entry.rightmost >= point) removed.push(node.entry);
      stack.push(node.right);
    }
    for (const entry of removed) this.delete(entry.key);
    return removed.map(entry => entry.value);
  }
}
