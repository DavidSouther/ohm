// A read-only snapshot of a MemoTable in the shape `Matcher#_memoTable` had when it was an array of
// PosInfo objects: one element per input position, `undefined` where nothing is memoized, each with
// a `memo` object from memo key to memo record. Tools that inspect memoization, such as memoviz,
// read this. The engine itself uses the MemoTable.

class PosInfo {
  constructor(table, pos, memo, maxExaminedLength, maxRightmostFailureOffset, leftRecursion) {
    this.applicationMemoKeyStack = table.activeKeys(pos).map(key => table.keyNames[key]);
    this.memo = memo;
    this.maxExaminedLength = maxExaminedLength;
    this.maxRightmostFailureOffset = maxRightmostFailureOffset;
    this.currentLeftRecursion = leftRecursion;
    Object.defineProperties(this, {_table: {value: table}, _pos: {value: pos}});
  }

  isActive(application) {
    const key = this._table.keyIds.get(application.toMemoKey());
    return key !== undefined && this._table.isActive(this._pos, key);
  }
}

export function memoTableView(table) {
  const recordsByEntry = new Map();
  const recordFor = entry => {
    if (entry < 0) return undefined;
    let record = recordsByEntry.get(entry);
    if (record) return record;
    record = {
      matchLength: table.matchLength[entry],
      examinedLength: table.examinedLength[entry],
      value: table.values[entry],
      failuresAtRightmostPosition: table.failures[entry],
      rightmostFailureOffset: table.rightmostFailureOffset[entry],
      tokenEndOffset: table.tokenEndOffset[entry],
      recoveryFailureSummary: table.summaries[entry],
      traceEntry: table.traces[entry],
      isRecoveryTainted: table.isTainted(entry),
    };
    recordsByEntry.set(entry, record);
    if (table.isLeftRecursion(entry)) {
      const state = table.recursions.get(entry);
      record.isLeftRecursion = true;
      record.headApplication = state.headApplication;
      record.nextLeftRecursion = recordFor(state.next);
      record.isInvolved = key => state.involved.indexOf(table.keyIds.get(key)) >= 0;
    }
    return record;
  };

  const entriesAt = new Map();
  for (let entry = 0; entry < table.count; entry++) {
    if (!table.isLive(entry)) continue;
    const pos = table.pos[entry];
    if (!entriesAt.has(pos)) entriesAt.set(pos, []);
    entriesAt.get(pos).push(entry);
  }

  const view = new Array(table.length).fill(undefined);
  for (const [pos, entries] of entriesAt) {
    const memo = {};
    let maxExaminedLength = 0;
    let maxRightmostFailureOffset = -1;
    for (const entry of entries) {
      Object.defineProperty(memo, table.keyNames[table.key[entry]], {
        value: recordFor(entry),
        enumerable: true,
        writable: true,
        configurable: true,
      });
      maxExaminedLength = Math.max(maxExaminedLength, table.examinedLength[entry]);
      maxRightmostFailureOffset = Math.max(
        maxRightmostFailureOffset,
        table.rightmostFailureOffset[entry]
      );
    }
    view[pos] = new PosInfo(
      table,
      pos,
      memo,
      maxExaminedLength,
      maxRightmostFailureOffset,
      recordFor(table.currentLeftRecursion(pos))
    );
  }
  return view;
}
