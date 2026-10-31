// The packrat memo table of a Matcher.
//
// Memo entries are rows of parallel typed arrays (an "arena"): small integers per entry, and
// plain arrays for the few object-valued fields. An entry is named by its index, and indexes are
// never reused while a match runs, so an index identifies one entry for its whole life. The
// table is found by key id and then position: each key has a row of entry indexes, one slot per
// input position, allocated when the key is first memoized. Key ids are small integers that stand
// for memo-key strings.
//
// The applications that are active at each input position form per-position chains threaded
// through one stack, so entering and leaving an application allocates nothing.

const TAINTED = 1;
const LEFT_RECURSION = 2;

const INITIAL_CAPACITY = 256;
const NONE = -1;

function grownInt32(array, capacity) {
  const grown = new Int32Array(capacity);
  grown.set(array);
  return grown;
}

export class MemoTable {
  constructor() {
    // The number of input positions the table has seen.
    this.length = 0;

    this.keyIds = new Map(); // memo key string -> key id
    this.keyNames = [];

    // Entry columns. `key` is NONE for a removed entry.
    this.count = 0; // entries ever added, including removed ones
    this.live = 0;
    this.capacity = INITIAL_CAPACITY;
    this.pos = new Int32Array(this.capacity);
    this.key = new Int32Array(this.capacity);
    this.flags = new Int32Array(this.capacity);
    this.matchLength = new Int32Array(this.capacity);
    this.examinedLength = new Int32Array(this.capacity);
    this.rightmostFailureOffset = new Int32Array(this.capacity);
    this.tokenEndOffset = new Int32Array(this.capacity);
    this.values = []; // CST node, or false for a failure
    this.failures = []; // failures recorded at the rightmost position, if any
    this.summaries = []; // recovery failure summary
    this.traces = []; // trace entry, only when tracing

    // `rows[key][pos]` is the entry for `key` at `pos`, or NONE.
    this.rows = [];

    // Left recursion: entry -> state, and per position the innermost active left recursion.
    this.recursions = new Map();
    this.recursionHeads = new Int32Array(0).fill(NONE);

    // Applications being evaluated. `heads[pos]` is the innermost one at `pos`; `prev` links to the
    // next outer one at the same position.
    this.heads = new Int32Array(0).fill(NONE);
    this.depth = 0;
    this.stackKey = new Int32Array(64);
    this.stackPrev = new Int32Array(64);
    this.stackPos = new Int32Array(64);
  }

  // ---- Keys ---------------------------------------------------------------------------------

  // The key id of an application, remembered on the application for this table.
  keyIdOf(app) {
    // An application with arguments is a fresh object each time it is substituted, so remembering
    // the id on it would cost more than looking it up.
    if (app.args.length !== 0) return this.internKey(app.toMemoKey());
    if (app._memoKeyTable === this) return app._memoKeyId;
    const id = this.internKey(app.toMemoKey());
    if (app._memoKeyTable === undefined) {
      Object.defineProperties(app, {
        _memoKeyTable: {value: this, writable: true},
        _memoKeyId: {value: id, writable: true},
      });
    } else {
      app._memoKeyTable = this;
      app._memoKeyId = id;
    }
    return id;
  }

  internKey(memoKey) {
    let id = this.keyIds.get(memoKey);
    if (id === undefined) {
      id = this.keyNames.length;
      this.keyIds.set(memoKey, id);
      this.keyNames.push(memoKey);
    }
    return id;
  }

  // ---- Active applications ------------------------------------------------------------------

  // Prepare for a pass over `inputLength` characters. A pass that threw can leave applications
  // and left recursions marked active, so clear them.
  beginPass(inputLength) {
    for (let d = 0; d < this.depth; d++) this.heads[this.stackPos[d]] = NONE;
    this.depth = 0;
    for (const state of this.recursions.values()) {
      if (state.active) this.recursionHeads[state.pos] = NONE;
      state.active = false;
    }
    this._ensurePositions(inputLength + 1);
  }

  _ensurePositions(n) {
    if (n <= this.heads.length) return;
    const size = Math.max(n, this.heads.length * 2);
    const heads = new Int32Array(size).fill(NONE);
    heads.set(this.heads);
    this.heads = heads;
    for (let key = 0; key < this.rows.length; key++) {
      const row = this.rows[key];
      if (row === undefined) continue;
      const grown = new Int32Array(size).fill(NONE);
      grown.set(row);
      this.rows[key] = grown;
    }
    const recursionHeads = new Int32Array(size).fill(NONE);
    recursionHeads.set(this.recursionHeads);
    this.recursionHeads = recursionHeads;
  }

  enter(pos, key) {
    if (pos >= this.heads.length) this._ensurePositions(pos + 1);
    if (pos >= this.length) this.length = pos + 1;
    const d = this.depth++;
    if (d === this.stackKey.length) {
      this.stackKey = grownInt32(this.stackKey, d * 2);
      this.stackPrev = grownInt32(this.stackPrev, d * 2);
      this.stackPos = grownInt32(this.stackPos, d * 2);
    }
    this.stackKey[d] = key;
    this.stackPos[d] = pos;
    this.stackPrev[d] = this.heads[pos];
    this.heads[pos] = d;
  }

  exit(pos) {
    this.heads[pos] = this.stackPrev[--this.depth];
  }

  isActive(pos, key) {
    if (pos >= this.heads.length) return false;
    for (let d = this.heads[pos]; d !== NONE; d = this.stackPrev[d]) {
      if (this.stackKey[d] === key) return true;
    }
    return false;
  }

  // The keys of the applications active at `pos`, outermost first.
  activeKeys(pos) {
    const keys = [];
    if (pos < this.heads.length) {
      for (let d = this.heads[pos]; d !== NONE; d = this.stackPrev[d]) keys.push(this.stackKey[d]);
    }
    return keys.reverse();
  }

  // ---- Entries ------------------------------------------------------------------------------

  // Returns the entry for `key` at `pos`, or -1.
  find(pos, key) {
    const row = this.rows[key];
    return row === undefined || pos >= row.length ? NONE : row[pos];
  }

  isLive(entry) {
    return this.key[entry] !== NONE;
  }

  isTainted(entry) {
    return (this.flags[entry] & TAINTED) !== 0;
  }

  setTainted(entry, tainted) {
    if (tainted) this.flags[entry] |= TAINTED;
    else this.flags[entry] &= ~TAINTED;
  }

  // Adds an entry, replacing any entry for the same position and key, and returns its index.
  add(
    pos,
    key,
    matchLength,
    examinedLength,
    value,
    failures,
    rightmostFailureOffset,
    tokenEndOffset
  ) {
    if (pos >= this.heads.length) this._ensurePositions(pos + 1);
    if (pos >= this.length) this.length = pos + 1;
    let row = this.rows[key];
    if (row === undefined) row = this.rows[key] = this._newRow();
    if (row[pos] !== NONE) this.remove(row[pos]);
    if (this.count === this.capacity) this._growEntries();

    const e = this.count++;
    this.live++;
    this.pos[e] = pos;
    this.key[e] = key;
    this.flags[e] = 0;
    this.matchLength[e] = matchLength;
    this.examinedLength[e] = examinedLength;
    this.rightmostFailureOffset[e] = rightmostFailureOffset;
    this.tokenEndOffset[e] = tokenEndOffset;
    this.values[e] = value;
    // Failures and summaries are rare, so their arrays only grow once one is stored.
    if (failures !== undefined) this.failures[e] = failures;
    row[pos] = e;
    return e;
  }

  remove(entry) {
    if (this.key[entry] === NONE) return;
    this.rows[this.key[entry]][this.pos[entry]] = NONE;
    this._kill(entry);
  }

  _kill(entry) {
    this.key[entry] = NONE;
    this.values[entry] = undefined;
    if (this.failures.length > entry) this.failures[entry] = undefined;
    if (this.summaries.length > entry) this.summaries[entry] = undefined;
    if (this.traces.length > entry) this.traces[entry] = undefined;
    if (this.recursions.size > 0) this.recursions.delete(entry);
    this.live--;
  }

  _growEntries() {
    this.capacity *= 2;
    for (const name of [
      'pos',
      'key',
      'flags',
      'matchLength',
      'examinedLength',
      'rightmostFailureOffset',
      'tokenEndOffset',
    ]) {
      this[name] = grownInt32(this[name], this.capacity);
    }
  }

  _newRow() {
    return new Int32Array(this.heads.length).fill(NONE);
  }

  // Rebuilds the rows, after entries were dropped or moved.
  _reindex() {
    let max = 0;
    for (let e = 0; e < this.count; e++) {
      if (this.key[e] !== NONE && this.pos[e] >= max) max = this.pos[e] + 1;
    }
    this._ensurePositions(max);
    for (const row of this.rows) if (row !== undefined) row.fill(NONE);
    for (let e = 0; e < this.count; e++) {
      if (this.key[e] === NONE) continue;
      const key = this.key[e];
      if (this.rows[key] === undefined) this.rows[key] = this._newRow();
      this.rows[key][this.pos[e]] = e;
    }
  }

  // ---- Left recursion -----------------------------------------------------------------------

  // The innermost active left recursion at `pos`, as an entry, or -1.
  currentLeftRecursion(pos) {
    return pos < this.recursionHeads.length ? this.recursionHeads[pos] : NONE;
  }

  isLeftRecursion(entry) {
    return (this.flags[entry] & LEFT_RECURSION) !== 0;
  }

  // `headKey` of the left recursion that `entry` seeds.
  headKey(entry) {
    return this.recursions.get(entry).headKey;
  }

  // Marks `entry`, the seed memoized at `pos` for the application with key `headKey`, as the
  // innermost left recursion at `pos`. Applications that are active above the head are "involved".
  startLeftRecursion(pos, entry, headKey, headApplication) {
    const keys = this.activeKeys(pos);
    const first = keys.indexOf(headKey) + 1;
    this.flags[entry] |= LEFT_RECURSION;
    this.recursions.set(entry, {
      pos,
      headKey,
      headApplication,
      active: true,
      next: this.recursionHeads[pos],
      first,
      involved: keys.slice(first),
    });
    this.recursionHeads[pos] = entry;
  }

  endLeftRecursion(pos) {
    const state = this.recursions.get(this.recursionHeads[pos]);
    state.active = false;
    this.recursionHeads[pos] = state.next;
  }

  isInvolved(entry, key) {
    return this.recursions.get(entry).involved.indexOf(key) >= 0;
  }

  updateInvolvedKeys(pos, entry) {
    const {first, involved} = this.recursions.get(entry);
    const keys = this.activeKeys(pos);
    for (let i = first; i < keys.length; i++) {
      if (involved.indexOf(keys[i]) < 0) involved.push(keys[i]);
    }
  }

  // Whether the memoized result `entry` at `pos` may be used now. The result of a left recursion
  // may not be used while one of its involved applications is active at the position. This is not
  // asked of the head of a left recursion, whose seed is always used.
  shouldUseMemoizedResult(pos, entry) {
    if (!this.isLeftRecursion(entry)) return true;
    const {involved} = this.recursions.get(entry);
    for (let d = this.heads[pos]; d !== NONE; d = this.stackPrev[d]) {
      if (involved.indexOf(this.stackKey[d]) >= 0) return false;
    }
    return true;
  }

  // ---- Editing the input --------------------------------------------------------------------

  // The input changes: `[startIdx, endIdx)` is replaced by `insertLength` characters, and the new
  // input has `inputLength` characters. Entries inside the replaced range are dropped and later
  // ones move. Call this only between matches, because it may renumber entries.
  replaceRange(startIdx, endIdx, insertLength, inputLength) {
    const delta = insertLength - (endIdx - startIdx);
    for (let e = 0; e < this.count; e++) {
      if (this.key[e] === NONE) continue;
      if (this.pos[e] >= endIdx) this.pos[e] += delta;
      else if (this.pos[e] >= startIdx) this._kill(e);
    }
    this.length = Math.max(0, this.length + delta);
    this.depth = 0;
    this.heads = new Int32Array(inputLength + 1).fill(NONE);
    this.recursionHeads = new Int32Array(inputLength + 1).fill(NONE);
    this.rows = [];
    for (const [e, state] of this.recursions) state.pos = this.pos[e];
    this._compact();
  }

  // Drops the entries before `endPos` that examined input beyond `invalidatedIdx`.
  invalidate(invalidatedIdx, endPos) {
    const limit = Math.min(endPos, this.length);
    for (let e = 0; e < this.count; e++) {
      if (this.key[e] === NONE) continue;
      if (this.pos[e] < limit && this.pos[e] + this.examinedLength[e] > invalidatedIdx) {
        this.remove(e);
      }
    }
  }

  // Squeezes removed entries out and rebuilds the index, if many entries were removed.
  _compact() {
    const dead = this.count - this.live;
    if (dead <= this.live || dead < INITIAL_CAPACITY) {
      this._reindex();
      return;
    }
    const moved = new Map();
    let j = 0;
    for (let e = 0; e < this.count; e++) {
      if (this.key[e] === NONE) continue;
      if (j !== e) {
        this.pos[j] = this.pos[e];
        this.key[j] = this.key[e];
        this.flags[j] = this.flags[e];
        this.matchLength[j] = this.matchLength[e];
        this.examinedLength[j] = this.examinedLength[e];
        this.rightmostFailureOffset[j] = this.rightmostFailureOffset[e];
        this.tokenEndOffset[j] = this.tokenEndOffset[e];
        this.values[j] = this.values[e];
        if (this.failures.length > e) this.failures[j] = this.failures[e];
        if (this.summaries.length > e) this.summaries[j] = this.summaries[e];
        if (this.traces.length > e) this.traces[j] = this.traces[e];
      }
      moved.set(e, j);
      j++;
    }
    this.values.length = j;
    for (const column of [this.failures, this.summaries, this.traces]) {
      if (column.length > j) column.length = j;
    }
    this.count = j;
    if (this.recursions.size > 0) {
      const recursions = new Map();
      for (const [e, state] of this.recursions) recursions.set(moved.get(e), state);
      this.recursions = recursions;
    }
    this._reindex();
  }
}
