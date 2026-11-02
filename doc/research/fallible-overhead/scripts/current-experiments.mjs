#!/usr/bin/env node
// Operation counts for the checked-out runtime; historical counts use experiments.mjs.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {grammar} from '../../../../packages/ohm-js/index.mjs';
import {MatchState} from '../../../../packages/ohm-js/src/MatchState.js';
import {RecoveryAttemptReplay} from '../../../../packages/ohm-js/src/RecoveryAttemptReplay.js';
import {RecoveryCache} from '../../../../packages/ohm-js/src/RecoveryCache.js';
import {RecoveryEffects} from '../../../../packages/ohm-js/src/RecoveryEffects.js';
import * as pexprs from '../../../../packages/ohm-js/src/pexprs-main.js';

/* global process, URL */
/* eslint no-console: off */

function countEffectNodes(cst) {
  const effects = [];
  const pending = [cst];
  while (pending.length) {
    const node = pending.pop();
    if (node.isCorrection()) {
      if (node._nestedFailureEffects) effects.push(node._nestedFailureEffects);
    } else pending.push(...(node.children || []));
  }
  const seen = new Set();
  while (effects.length) {
    const node = effects.pop();
    if (!node || seen.has(node)) continue;
    seen.add(node);
    effects.push(node.left, node.right);
  }
  return seen.size;
}

function measure(g, input, recover, details = false, expectedSuccess = true) {
  const original = MatchState.prototype.eval;
  const restore = [];
  const versionMaps = new WeakSet();
  let evals = 0;
  let depth = 0;
  let scans = 0;
  let versionWrites = 0;
  let diagnosticMapReads = 0;
  let collecting = false;
  let result;
  function patch(prototype, name, wrap) {
    const prior = prototype[name];
    prototype[name] = wrap(prior);
    restore.push(() => {
      prototype[name] = prior;
    });
  }
  if (details) {
    patch(
      pexprs.Fallible.prototype,
      'scan',
      prior =>
        function (...args) {
          scans++;
          return prior.apply(this, args);
        }
    );
    patch(
      RecoveryAttemptReplay.prototype,
      'changed',
      prior =>
        function (...args) {
          versionMaps.add(this.versions);
          return prior.apply(this, args);
        }
    );
    patch(
      Map.prototype,
      'set',
      prior =>
        function (...args) {
          if (versionMaps.has(this)) versionWrites++;
          return prior.apply(this, args);
        }
    );
    patch(
      Map.prototype,
      'get',
      prior =>
        function (...args) {
          if (collecting) diagnosticMapReads++;
          return prior.apply(this, args);
        }
    );
  }
  MatchState.prototype.eval = function (expr) {
    evals++;
    depth = Math.max(depth, this._applicationStack.length);
    return original.call(this, expr);
  };
  try {
    result = g.match(input, undefined, {recover});
    MatchState.prototype.eval = original;
    assert.equal(result.succeeded(), expectedSuccess);
    // Materialize CST rows before isolating the diagnostic traversal counter.
    const effectNodes = details && result.succeeded() ? countEffectNodes(result._cst) : undefined;
    collecting = true;
    const recoveries = result.getRecoveredFailures().length;
    collecting = false;
    return {
      succeeded: result.succeeded(),
      evals,
      depth,
      passes: result._recovery ? result._recovery.corrections.size + 1 : 1,
      recoveries,
      ...(details ? {scans, versionWrites, diagnosticMapReads, effectNodes} : {}),
    };
  } finally {
    MatchState.prototype.eval = original;
    for (const undo of restore.reverse()) undo();
  }
}

const suffix = grammar('G { s = (&tail any)* end\n tail = any* }');
const suffixRows = [32, 64, 128, 256].map(n => {
  const plain = measure(suffix, 'a'.repeat(n), false);
  const recovering = measure(suffix, 'a'.repeat(n), true);
  return {
    n,
    plainEvals: plain.evals,
    recoverEvals: recovering.evals,
    plainDepth: plain.depth,
    recoverDepth: recovering.depth,
    passes: recovering.passes,
    recoveries: recovering.recoveries,
  };
});

const families = [
  [
    'one-error-backtracking',
    'G { S = E end\n E = "(" E ")" "a" -- a\n | "(" E ")" "b" -- b\n | X\n X = "x" ! ";" }',
    '('.repeat(10) + 'y;' + ')b'.repeat(10),
  ],
  [
    'valid-predicate',
    'G { S = E end\n E = &P "(" E ")" "a" -- a\n | &P "(" E ")" "b" -- b\n | "x"\n P = "(" ! any }',
    '('.repeat(10) + 'x' + ')b'.repeat(10),
  ],
  [
    'nested-missing-closers',
    'G { S = Stmt*\n Block = "{" Stmt* ! "}"\n Stmt = Block | Simple\n Simple = "x" ";" }',
    '{'.repeat(10) + 'x;',
  ],
];
const repo = fileURLToPath(new URL('../../../../', import.meta.url));
const flat = grammar('G { s = item* end\n item = "a" ! ";" }');
const flatRows = [16, 32, 64, 128, 256].map(items => {
  const row = measure(flat, 'b;'.repeat(items), true, true);
  assert.equal(row.recoveries, items);
  return {
    items,
    errors: items,
    evals: row.evals,
    scans: row.scans,
    versionWrites: row.versionWrites,
  };
});
let flatPlacementChecks = 0;
for (let items = 0; items <= 7; items++) {
  for (let mask = 0; mask < 2 ** items; mask++) {
    let errors = 0;
    const input = Array.from({length: items}, (_, i) => {
      if (mask & (1 << i)) {
        errors++;
        return 'b;';
      }
      return 'a;';
    }).join('');
    const row = measure(flat, input, true);
    assert.equal(row.passes, errors + 1);
    assert.equal(row.recoveries, errors);
    flatPlacementChecks++;
  }
}
const prediction = marker =>
  grammar(`G {
  s = (&tail "a;")* end
  tail = ("a" ${marker ? '! ' : ''}";") tail -- rec
       | end -- done
}`);
const marked = prediction(true);
const control = prediction(false);
const predicateRows = [16, 32, 64, 128].map(items => {
  const input = 'a;'.repeat(items);
  const plain = measure(marked, input, false);
  const recovering = measure(marked, input, true);
  const controlPlain = measure(control, input, false);
  const controlRecovering = measure(control, input, true);
  assert.equal(controlPlain.evals, controlRecovering.evals);
  return {
    items,
    plainEvals: plain.evals,
    recoverEvals: recovering.evals,
    controlEvals: controlPlain.evals,
    passes: recovering.passes,
    recoveries: recovering.recoveries,
  };
});
const nested = grammar(families[2][1]);
function measureInvalidation(g, input, expectedSuccess = true) {
  const originalIterator = Set.prototype[Symbol.iterator];
  const originalInvalidate = RecoveryCache.prototype.invalidate;
  const originalEval = MatchState.prototype.eval;
  const originalScan = pexprs.Fallible.prototype.scan;
  let operation;
  let evals = 0;
  let scanning = 0;
  let scanEvals = 0;
  let scans = 0;
  let dependencyNodes = 0;
  // In invalidate, every visited record iterates its users Set once. Exclude
  // the initial correction-reader root Set; count execution, not a graph model.
  // eslint-disable-next-line no-extend-native
  Set.prototype[Symbol.iterator] = function () {
    if (operation && this !== operation.roots) dependencyNodes++;
    return originalIterator.call(this);
  };
  RecoveryCache.prototype.invalidate = function (key) {
    const prior = operation;
    operation = {roots: this.correctionReaders.get(key)};
    try {
      return originalInvalidate.call(this, key);
    } finally {
      operation = prior;
    }
  };
  MatchState.prototype.eval = function (expr) {
    evals++;
    if (scanning) scanEvals++;
    return originalEval.call(this, expr);
  };
  pexprs.Fallible.prototype.scan = function (...args) {
    scans++;
    scanning++;
    try {
      return originalScan.apply(this, args);
    } finally {
      scanning--;
    }
  };
  try {
    const result = g.match(input, undefined, {recover: true});
    assert.equal(result.succeeded(), expectedSuccess);
    return {
      succeeded: result.succeeded(),
      n: input.length,
      k: result._recovery.corrections.size,
      evals,
      dependencyNodes,
      scans,
      scanEvals,
      diagnostics: result.getRecoveredFailures().length,
    };
  } finally {
    // eslint-disable-next-line no-extend-native
    Set.prototype[Symbol.iterator] = originalIterator;
    RecoveryCache.prototype.invalidate = originalInvalidate;
    MatchState.prototype.eval = originalEval;
    pexprs.Fallible.prototype.scan = originalScan;
  }
}
const invalidationRows = [8, 16, 32, 64].map(depth => {
  const row = measureInvalidation(nested, '{'.repeat(depth) + 'x;', false);
  return {depth, ...row};
});
const closed = grammar(`G {
  S = Stmt*
  Block = "{" Stmt* ! "}"
  Stmt = Block | Item
  Item = "a" ! ";"
}`);
function closedInput(depth, items, errors, placement = 'spread') {
  const bad = new Set(
    Array.from({length: errors}, (_, i) =>
      placement === 'start'
        ? i
        : placement === 'end'
          ? items - errors + i
          : Math.floor((i * items) / errors)
    )
  );
  return (
    '{'.repeat(depth) +
    Array.from({length: items}, (_, i) => (bad.has(i) ? 'b;' : 'a;')).join('') +
    '}'.repeat(depth)
  );
}
const closedMatrix = [];
for (const depth of [0, 1, 4, 8, 16, 32]) {
  for (const errors of [0, 1, 4, 16]) {
    const row = measureInvalidation(closed, closedInput(depth, 32, errors));
    assert.equal(row.k, errors);
    assert.equal(row.diagnostics, errors);
    closedMatrix.push({depth, ...row});
  }
}
const closedRows = closedMatrix
  .filter(row => [4, 8, 16, 32].includes(row.depth) && [1, 16].includes(row.k))
  .map(({depth, n, k, evals, dependencyNodes}) => ({depth, n, k, evals, dependencyNodes}));
const localityRows = [8, 16, 32, 64].map(depth => {
  const deep = measureInvalidation(
    closed,
    '{'.repeat(depth) + 'a;' + 'b;'.repeat(8) + '}'.repeat(depth)
  );
  const top = measureInvalidation(
    closed,
    '{'.repeat(depth) + 'a;' + '}'.repeat(depth) + 'b;'.repeat(8)
  );
  assert.equal(deep.n, top.n);
  assert.equal(deep.k, 8);
  assert.equal(top.k, 8);
  return {
    depth,
    n: deep.n,
    k: deep.k,
    deepNodes: deep.dependencyNodes,
    topLevelNodes: top.dependencyNodes,
  };
});
const scanRows = [];
for (const depth of [4, 16]) {
  for (const span of [8, 128]) {
    const row = measureInvalidation(
      closed,
      '{'.repeat(depth) + 'b'.repeat(span) + ';' + '}'.repeat(depth)
    );
    assert.equal(row.k, 1);
    scanRows.push({
      depth,
      span,
      n: row.n,
      k: row.k,
      scanEvals: row.scanEvals,
      dependencyNodes: row.dependencyNodes,
    });
  }
}
const mixedDepths = [0, 1, 4, 8, 16];
const mixed = measureInvalidation(
  closed,
  mixedDepths.map(d => '{'.repeat(d) + 'b;' + '}'.repeat(d)).join('')
);
const padding = [16, 64, 256, 1024].map(items => ({
  items,
  ...measureInvalidation(closed, closedInput(8, items, 8)),
}));
const placements = ['start', 'spread', 'end'].map(placement => ({
  placement,
  ...measureInvalidation(closed, closedInput(8, 64, 16, placement)),
}));
const partialClosers = [];
for (const depth of [8, 16, 32, 64]) {
  for (const missing of [1, 4, 8]) {
    const row = measureInvalidation(
      nested,
      '{'.repeat(depth) + 'x;' + '}'.repeat(depth - missing),
      false
    );
    partialClosers.push({depth, missing, ...row});
  }
}
const diagnosticRows = [4, 8, 12, 16].map(depth => {
  const input = '{'.repeat(depth) + 'x;';
  const row = measure(nested, input, true, true, false);
  const original = RecoveryEffects.prototype.filterAfter;
  let legacy;
  try {
    // Replay only the former closure-filter policy on the corrected runtime.
    RecoveryEffects.prototype.filterAfter = function (position) {
      return this.filter(f => f.interval.endIdx > position || f.interval.startIdx > position);
    };
    legacy = measure(nested, input, true, true, false);
  } finally {
    RecoveryEffects.prototype.filterAfter = original;
  }
  assert.equal(legacy.evals, row.evals);
  assert.equal(legacy.recoveries, row.recoveries);
  return {
    depth,
    evals: row.evals,
    legacyMapReads: legacy.diagnosticMapReads,
    diagnosticMapReads: row.diagnosticMapReads,
    legacyEffectNodes: legacy.effectNodes,
    effectNodes: row.effectNodes,
    recoveries: row.recoveries,
  };
});
console.log(
  JSON.stringify(
    {
      _meta: {
        runtime: 'current checkout',
        checkoutCommit: execFileSync('git', ['rev-parse', 'HEAD'], {
          cwd: repo,
          encoding: 'utf8',
        }).trim(),
        node: process.version,
        flatPlacementChecks,
        dimensionalControls: {
          closedMatrixCells: closedMatrix.length,
          mixedDepths,
          mixed,
          padding,
          placements,
          partialClosers,
        },
        legacyPolicyControl:
          'former closure-filter policy on the current runtime; not a historical runtime',
      },
      suffixLookahead: {rows: suffixRows},
      flatIndependent: {rows: flatRows},
      predicateMarker: {rows: predicateRows},
      nestedDiagnostics: {rows: diagnosticRows},
      nestedInvalidation: {rows: invalidationRows},
      closedDepthErrors: {rows: closedRows},
      errorDepthLocality: {rows: localityRows},
      scanDistance: {rows: scanRows},
      adversarial: {
        rows: families.map(([family, source, input]) => ({
          family,
          ...measure(grammar(source), input, true, false, family !== 'nested-missing-closers'),
        })),
      },
    },
    null,
    2
  )
);
