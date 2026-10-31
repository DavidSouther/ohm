import {IterationNode, ListNode, SeqNode} from './nodes.js';
import * as pexprs from './pexprs-main.js';
import {emptyEffects} from './RecoveryEffects.js';
import {kleeneExprHasNullableOperand} from './errors.js';
import {recoveryAnalysis} from './RecoveryAnalysis.js';
import {RecoveryAttemptReplay} from './RecoveryAttemptReplay.js';
import {recoveriesOf, setRecoveries} from './RecoveryOwnership.js';

export const noFailures = {position: -1, failures: []};

// Two failures are the same expectation when their keys match; `toKey()` is
// `toString()#type`, so equal types reduce to comparing the text.
function sameFailure(a, b) {
  return a.type === b.type ? a.text === b.text : a.toKey() === b.toKey();
}

// Failure objects in a summary are never mutated in place, so merged summaries share them and
// only clone the one whose fluffy flag must change.
const SMALL_MERGE = 64;

// Failure order follows MatchState.eval: the newest expression's failures
// precede those accumulated before it; a strong expectation wins over fluff.
export function mergeFailureSummaries(newer, older) {
  if (newer.position > older.position) return newer;
  if (older.position > newer.position) return older;
  if (!newer.failures.length) return older;
  if (!older.failures.length) return newer;
  if (newer.failures.length * older.failures.length > SMALL_MERGE) {
    return mergeLargeSummaries(newer, older);
  }
  const failures = newer.failures.slice();
  for (const failure of older.failures) {
    let at = failures.length - 1;
    while (at >= 0 && !sameFailure(failures[at], failure)) at--;
    if (at < 0) {
      failures.push(failure);
    } else if (!failure.isFluffy() && failures[at].isFluffy()) {
      const copy = failures[at].clone();
      copy.clearFluffy();
      failures[at] = copy;
    }
  }
  return {position: newer.position, failures};
}

// Keyed by `toKey()` so that large expectation sets stay linear.
function mergeLargeSummaries(newer, older) {
  const failures = newer.failures.map(f => f.clone());
  const byKey = new Map(failures.map(f => [f.toKey(), f]));
  for (const failure of older.failures) {
    const prior = byKey.get(failure.toKey());
    if (!prior) {
      const copy = failure.clone();
      byKey.set(copy.toKey(), copy);
      failures.push(copy);
    } else if (!failure.isFluffy()) {
      prior.clearFluffy();
    }
  }
  return {position: newer.position, failures};
}

function fluffy(summary) {
  return {
    position: summary.position,
    failures: summary.failures.map(f => {
      const copy = f.clone();
      copy.makeFluffy();
      return copy;
    }),
  };
}

function record() {
  return {
    dirty: true,
    active: false,
    volatile: false,
    children: new Set(),
    users: new Set(),
    correctionReads: new Set(),
    attempts: emptyEffects,
    memoEntry: -1, // the native memo entry made while this record was current
    // Identity of the evaluation context; set only on records kept in `RecoveryCache.records`.
    eid: 0,
    owner: 0,
    start: 0,
    pos: 0,
    depth: 0,
    flags: 0,
    block: 0,
    sync: 0,
    next: null,
  };
}

function hashContext(eid, owner, start, pos, depth, flags, block, sync) {
  let h = 0x811c9dc5 | 0;
  h = Math.imul(h ^ eid, 0x9e3779b1);
  h = Math.imul((h ^ (h >>> 15)) ^ owner, 0x9e3779b1);
  h = Math.imul((h ^ (h >>> 15)) ^ start, 0x9e3779b1);
  h = Math.imul((h ^ (h >>> 15)) ^ pos, 0x9e3779b1);
  h = Math.imul((h ^ (h >>> 15)) ^ depth, 0x9e3779b1);
  h = Math.imul((h ^ (h >>> 15)) ^ flags, 0x9e3779b1);
  h = Math.imul((h ^ (h >>> 15)) ^ block, 0x9e3779b1);
  h = Math.imul((h ^ (h >>> 15)) ^ sync, 0x9e3779b1);
  return (h ^ (h >>> 15)) & 0x3fffffff; // Keep the Map key a small integer.
}

function iterationBindings(prefix, arity, rowBased, optional, stats, ownerStart) {
  const count = prefix?.count || 0;
  if (rowBased && arity === 0) return {nodes: [], offsets: []};
  const first = prefix?.first;
  const offset = first ? first.offsets[0] : 0;
  const lastOffset = prefix?.offsets.at(-1) || 0;
  const length = count ? lastOffset + prefix.bindings.at(-1).matchLength - offset : 0;
  let materialized;
  const materialize = () => {
    if (materialized) return materialized;
    const rows = new Array(count);
    let current = prefix;
    for (let i = count - 1; i >= 0; i--) {
      rows[i] = current;
      current = current.previous;
    }
    stats.materializedRows += count;
    const columns = Array.from({length: rowBased ? 1 : arity}, () => []);
    const offsets = Array.from({length: columns.length}, () => []);
    for (const row of rows) {
      if (rowBased) {
        const start = row.offsets[0];
        const end = row.offsets.at(-1) + row.bindings.at(-1).matchLength;
        columns[0].push(
          arity === 1
            ? row.bindings[0]
            : new SeqNode(
                row.bindings,
                row.offsets.map(value => value - start),
                end - start
              )
        );
        offsets[0].push(start - ownerStart);
      } else {
        for (let i = 0; i < arity; i++) {
          columns[i].push(row.bindings[i]);
          offsets[i].push(row.offsets[i] - ownerStart);
        }
      }
    }
    materialized = {columns, offsets};
    for (let column = 0; column < nodes.length; column++) {
      Object.defineProperties(nodes[column], {
        children: {
          value: columns[column],
          writable: true,
          enumerable: true,
          configurable: true,
        },
        childOffsets: {
          value: offsets[column],
          writable: true,
          enumerable: true,
          configurable: true,
        },
      });
    }
    return materialized;
  };
  const nodes = [];
  for (let column = 0; column < (rowBased ? 1 : arity); column++) {
    const node = rowBased
      ? new ListNode([], [], length, optional)
      : new IterationNode([], [], length, optional);
    Object.defineProperties(node, {
      children: {
        configurable: true,
        get: () => materialize().columns[column],
        set: children => {
          materialize();
          node.children = children;
        },
      },
      childOffsets: {
        configurable: true,
        get: () => materialize().offsets[column],
        set: offsets => {
          materialize();
          node.childOffsets = offsets;
        },
      },
    });
    let owned = emptyEffects;
    if (rowBased) {
      for (const effects of prefix?.owned || []) owned = owned.concat(effects);
    } else {
      owned = prefix?.owned[column] || emptyEffects;
    }
    setRecoveries(node, owned);
    nodes.push(node);
  }
  return {nodes, offsets: nodes.map(() => offset)};
}

export class RecoveryCache {
  constructor(context) {
    this.context = context;
    this.records = new Map(); // context hash -> chain of records
    this.memoTable = null; // the matcher's memo table, set by each pass
    this.memoRecords = new Map(); // native memo entry -> recovery record
    this.correctionReaders = new Map();
    this.expressionIds = new WeakMap();
    this.applicationIds = new Map();
    this.failureLists = new WeakMap(); // expression -> shared one-failure list
    this.nextId = 1; // 0 means "no owner"
    this.contexts = new Map();
    this.current = null;
    this.lastRecord = null;
    this.analysis = null;
    this.lrDepth = 0;
    this.disabled = false;
    this.stats = {
      evaluated: 0,
      reused: 0,
      resumedRows: 0,
      materializedRows: 0,
      attemptEffectsVisited: 0,
      attemptEffectsSkipped: 0,
    };
    this.attemptReplay = new RecoveryAttemptReplay(
      context.attempts,
      context.positionIndex.input.length,
      this.stats
    );
  }

  enterContext(parent, join) {
    const key = `${parent}:${join.toString()}`;
    let id = this.contexts.get(key);
    if (id === undefined) this.contexts.set(key, (id = this.contexts.size + 1));
    return id;
  }

  // The one-failure list for an expression that failed. Summaries share these lists and the
  // failures in them, so nothing mutates either in place. An expression made by parameter
  // substitution is new each time, so only expressions used as written (`cacheable`) are kept.
  failuresOf(expr, cacheable, grammar) {
    if (!cacheable) return [expr.toFailure(grammar)];
    let failures = this.failureLists.get(expr);
    if (!failures) this.failureLists.set(expr, (failures = [expr.toFailure(grammar)]));
    return failures;
  }

  applicationId(memoKey) {
    let id = this.applicationIds.get(memoKey);
    if (id === undefined) this.applicationIds.set(memoKey, (id = this.nextId++));
    return id;
  }

  find(hash, eid, owner, start, pos, depth, flags, block, sync) {
    for (let node = this.records.get(hash); node; node = node.next) {
      if (
        node.eid === eid &&
        node.owner === owner &&
        node.start === start &&
        node.pos === pos &&
        node.depth === depth &&
        node.flags === flags &&
        node.block === block &&
        node.sync === sync
      ) {
        return node;
      }
    }
    return undefined;
  }

  depend(child) {
    if (this.current && this.current !== child) {
      this.current.children.add(child);
      child.users.add(this.current);
    }
  }

  readCorrection(key) {
    if (this.current) {
      this.current.correctionReads.add(key);
      let users = this.correctionReaders.get(key);
      if (!users) this.correctionReaders.set(key, (users = new Set()));
      users.add(this.current);
    }
    return this.context.corrections.get(key);
  }

  writeAttempt(state, attempt) {
    const effects = emptyEffects.append(attempt);
    state._attemptEffects = state._attemptEffects.concat(effects);
    if (this.current) this.current.attempts = this.current.attempts.concat(effects);
  }

  detach(node) {
    for (const child of node.children) child.users.delete(node);
    node.children.clear();
    for (const key of node.correctionReads) {
      const users = this.correctionReaders.get(key);
      users?.delete(node);
      if (!users?.size) this.correctionReaders.delete(key);
    }
    node.correctionReads.clear();
  }

  invalidate(key) {
    const pending = [...(this.correctionReaders.get(key) || [])];
    const seen = new Set();
    while (pending.length) {
      const node = pending.pop();
      if (seen.has(node)) continue;
      seen.add(node);
      node.dirty = true;
      if (node.iteration) {
        node.iteration.dirtyFrom = Math.min(node.iteration.dirtyFrom, node.index);
      }
      if (node.memoEntry >= 0) this.memoTable.remove(node.memoEntry);
      for (const user of node.users) pending.push(user);
    }
  }

  leftRecursion() {
    for (let node = this.current; node; node = node.parent) node.volatile = true;
  }

  evaluate(state, expr) {
    if (this.disabled || (!(expr instanceof pexprs.Apply) && !(expr instanceof pexprs.Iter))) {
      return this.evaluateInline(state, expr);
    }
    const analysis = this.analysis || (this.analysis = recoveryAnalysis(state.grammar));
    if (!analysis.containsFallible(expr) && !(analysis.spaces && state.inSyntacticContext())) {
      const parent = this.current;
      this.current = null;
      try {
        return this.evaluateInline(state, expr);
      } finally {
        this.current = parent;
      }
    }
    const owner = state.currentApplication();
    let app = null;
    let appKey = '';
    if (expr instanceof pexprs.Apply) {
      app = expr.substituteParams(owner?.args || []);
      appKey = app.toMemoKey();
      const {memoTable} = state;
      const {pos} = state.inputStream;
      const keyId = memoTable.keyIdOf(app);
      const native = memoTable.find(pos, keyId);
      if (
        native >= 0 &&
        !memoTable.isTainted(native) &&
        !memoTable.isActive(pos, keyId) &&
        memoTable.shouldUseMemoizedResult(pos, native) &&
        state.hasNecessaryInfo(native)
      ) {
        return this.evaluateInline(state, expr);
      }
    }
    const parent = this.current;
    let eid;
    let ownerId = 0;
    let start = -1;
    if (app) {
      eid = this.applicationId(appKey);
    } else {
      eid = this.expressionIds.get(expr);
      if (eid === undefined) this.expressionIds.set(expr, (eid = this.nextId++));
      ownerId = owner ? this.applicationId(owner.toMemoKey()) : 0;
      start = state._posStack.at(-1);
    }
    const {pos} = state.inputStream;
    const depth = state._applicationStack.length;
    const flags =
      (state._noRecoveryDepth > 0 ? 1 : 0) |
      (state.inSyntacticContext() ? 2 : 0) |
      (state.inLexifiedContext() ? 4 : 0);
    const {_blockDepth: block, _syncContext: sync} = state;
    const hash = hashContext(eid, ownerId, start, pos, depth, flags, block, sync);
    let node = this.find(hash, eid, ownerId, start, pos, depth, flags, block, sync);
    const allowed = !this.lrDepth;
    if (!node || node.active || !allowed) {
      // An existing record is never replaced: it is reused, or this evaluation is volatile.
      const isNew = !node;
      node = record();
      if (allowed && isNew) {
        node.eid = eid;
        node.owner = ownerId;
        node.start = start;
        node.pos = pos;
        node.depth = depth;
        node.flags = flags;
        node.block = block;
        node.sync = sync;
        node.next = this.records.get(hash) || null;
        this.records.set(hash, node);
      } else {
        node.volatile = true;
      }
    }
    this.depend(node);
    if (!node.dirty && !node.volatile) {
      this.stats.reused++;
      this.apply(state, node);
      this.lastRecord = node;
      return node.success;
    }

    this.stats.evaluated++;
    this.detach(node);
    node.active = true;
    node.parent = parent;
    node.attempts = emptyEffects;
    node.expression = expr;
    const bindings = state._bindings.length;
    const taint = state._recoveryTaint;
    const oldSummary = state._recoveryFailureSummary;
    const oldLog = state._recoveryLog;
    const oldAttempts = state._attemptEffects;
    const oldTokenEnd = state._tokenEnd;
    const oldExamined = state.inputStream.examinedLength;
    node.depth = state._applicationStack.length;
    state._recoveryFailureSummary = noFailures;
    state._recoveryLog = emptyEffects;
    state._attemptEffects = emptyEffects;
    state._tokenEnd = -1;
    state.inputStream.examinedLength = 0;
    this.current = node;
    let success;
    try {
      success = state.evalUncached(expr);
    } finally {
      this.current = parent;
      node.active = false;
      node.parent = null;
    }
    let summary = state._recoveryFailureSummary;
    if (success && state.inputStream.pos === summary.position) summary = fluffy(summary);
    node.success = success;
    node.end = state.inputStream.pos;
    node.bindings = state._bindings.slice(bindings);
    const base = state._posStack.at(-1);
    node.offsets = state._bindingOffsets.slice(bindings).map(offset => offset + base);
    node.summary = summary;
    node.log = state._recoveryLog;
    node.tokenEnd = state._tokenEnd;
    node.examined = state.inputStream.examinedLength;
    node.tainted = state._recoveryTaint !== taint;
    if (expr instanceof pexprs.Apply && !node.tainted) node.attempts = emptyEffects;
    node.dirty = false;
    state._recoveryFailureSummary = mergeFailureSummaries(summary, oldSummary);
    state._recoveryLog = oldLog.concat(node.log);
    state._attemptEffects = oldAttempts.concat(state._attemptEffects);
    state._tokenEnd = Math.max(oldTokenEnd, node.tokenEnd);
    state.inputStream.examinedLength = Math.max(oldExamined, node.examined);
    if (parent) parent.attempts = parent.attempts.concat(node.attempts);
    this.lastRecord = node;
    return success;
  }

  evaluateInline(state, expr) {
    const previous = state._recoveryFailureSummary;
    state._recoveryFailureSummary = noFailures;
    const success = state.evalUncached(expr);
    let summary = state._recoveryFailureSummary;
    if (success && state.inputStream.pos === summary.position) summary = fluffy(summary);
    state._recoveryFailureSummary = mergeFailureSummaries(summary, previous);
    return success;
  }

  apply(state, node) {
    const attempts = node.attempts.shift(state._applicationStack.length - node.depth);
    state._attemptEffects = state._attemptEffects.concat(attempts);
    if (this.current) this.current.attempts = this.current.attempts.concat(attempts);
    state._recoveryLog = state._recoveryLog.concat(node.log);
    state._recoveryFailureSummary = mergeFailureSummaries(
      node.summary,
      state._recoveryFailureSummary
    );
    state.rightmostFailurePosition = Math.max(
      state.rightmostFailurePosition,
      node.summary.position
    );
    state._tokenEnd = Math.max(state._tokenEnd, node.tokenEnd);
    state.inputStream.examinedLength = Math.max(
      state.inputStream.examinedLength,
      node.examined
    );
    if (node.tainted) state._recoveryTaint++;
    state.inputStream.pos = node.end;
    if (node.success) {
      for (let i = 0; i < node.bindings.length; i++) {
        state.pushBinding(node.bindings[i], node.offsets[i]);
      }
    }
  }

  flushAttempts(effects) {
    this.attemptReplay.apply(effects);
  }

  iterate(state, expr) {
    const node = this.current;
    const origin = state.inputStream.pos;
    let iteration = node.iterationState;
    if (!iteration) {
      iteration = node.iterationState = {rows: [], frontier: null, dirtyFrom: 0};
    }
    const {rows} = iteration;
    const start = Math.min(iteration.dirtyFrom, rows.length);
    for (let i = start; i < rows.length; i++) {
      this.detach(rows[i].watcher);
      rows[i].watcher.users.clear();
    }
    rows.length = start;
    if (iteration.frontier) {
      this.detach(iteration.frontier);
      iteration.frontier.users.clear();
      iteration.frontier = null;
    }
    let prefix = start ? rows[start - 1] : null;
    let arity = expr.expr.getArity();
    if (prefix) {
      this.stats.resumedRows += prefix.count;
      state.inputStream.pos = prefix.end;
      state._recoveryFailureSummary = prefix.summary;
      state.rightmostFailurePosition = Math.max(
        state.rightmostFailurePosition,
        prefix.summary.position
      );
      state._recoveryLog = state._recoveryLog.concat(prefix.log);
      state._attemptEffects = state._attemptEffects.concat(prefix.attempts);
      node.attempts = node.attempts.concat(prefix.attempts);
      state._tokenEnd = Math.max(state._tokenEnd, prefix.tokenEnd);
      state.inputStream.examinedLength = Math.max(
        state.inputStream.examinedLength,
        prefix.examined
      );
    }
    while (rows.length < expr.maxNumMatches) {
      const watcher = record();
      watcher.iteration = iteration;
      watcher.index = rows.length;
      watcher.users.add(node);
      const previousPosition = state.inputStream.pos;
      const bindings = state._bindings.length;
      this.current = watcher;
      const success = state.eval(expr.expr);
      this.current = node;
      if (!success) {
        iteration.frontier = watcher;
        node.attempts = node.attempts.concat(watcher.attempts);
        break;
      }
      if (state.inputStream.pos === previousPosition) {
        throw kleeneExprHasNullableOperand(expr, state._applicationStack);
      }
      const values = state._bindings.splice(bindings);
      const base = state._posStack.at(-1);
      const offsets = state._bindingOffsets.splice(bindings).map(value => value + base);
      arity = values.length;
      prefix = {
        previous: prefix,
        first: prefix?.first,
        count: rows.length + 1,
        bindings: values,
        offsets,
        end: state.inputStream.pos,
        summary: state._recoveryFailureSummary,
        log: state._recoveryLog,
        attempts: (prefix?.attempts || emptyEffects).concat(watcher.attempts),
        tokenEnd: state._tokenEnd,
        examined: state.inputStream.examinedLength,
        watcher,
      };
      prefix.first = prefix.first || prefix;
      prefix.output = {
        previous: prefix.previous?.output,
        first: prefix.previous?.output.first,
        count: prefix.count,
        bindings: values,
        offsets,
        owned: values.map((value, column) =>
          (prefix.previous?.output.owned[column] || emptyEffects).concat(recoveriesOf(value))
        ),
      };
      prefix.output.first = prefix.output.first || prefix.output;
      rows.push(prefix);
      node.attempts = node.attempts.concat(watcher.attempts);
    }
    iteration.dirtyFrom = rows.length;
    if (rows.length < expr.minNumMatches) return false;
    const result = iterationBindings(
      prefix?.output,
      arity,
      state._rowBasedIteration,
      expr instanceof pexprs.Opt,
      this.stats,
      state._posStack.at(-1)
    );
    for (let i = 0; i < result.nodes.length; i++) {
      state.pushBinding(result.nodes[i], prefix ? result.offsets[i] : origin);
    }
    return true;
  }

  // Drop the cache's own indexes. Nothing outside the cache references a record (CST
  // iteration nodes capture detached `output` rows), so the record graph becomes garbage
  // without being walked.
  release() {
    this.records.clear();
    this.memoRecords.clear();
    this.memoTable = null;
    this.correctionReaders.clear();
    this.contexts.clear();
    this.attemptReplay.release();
    this.current = null;
    this.lastRecord = null;
  }
}
