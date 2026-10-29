import assert from 'node:assert/strict';
import {readFileSync, writeFileSync} from 'node:fs';
import {resolve, join} from 'node:path';
import {median, summarize} from './lib/stats.mjs';

const directory = resolve(process.argv[2]);
const result = JSON.parse(readFileSync(join(directory, 'results.json')));
const raw = (label, subset, repetition) =>
  JSON.parse(
    readFileSync(join(directory, 'raw', `${label}-timing-${subset}-${repetition}.json`))
  );
const cases = new Map();
const loads = {before: [], after: []};
for (const label of ['before', 'after']) {
  for (let repetition = 0; repetition < 3; repetition++) {
    for (const subset of ['clean', 'all']) {
      const run = raw(label, subset, repetition);
      loads[label].push(run.importMs);
      if (subset !== 'clean') continue;
      for (const section of ['construction', 'incremental']) {
        for (const row of run[section]) {
          const key = [section, row.name, row.op, row.scale].join('|');
          if (!cases.has(key)) {
            cases.set(key, {
              section,
              name: row.name,
              op: row.op,
              scale: row.scale,
              before: [],
              after: [],
              samplesBefore: [],
              samplesAfter: [],
            });
          }
          const cell = cases.get(key);
          cell[label].push(median(row.samples));
          cell[label === 'before' ? 'samplesBefore' : 'samplesAfter'].push(...row.samples);
          if (section === 'incremental') assert.equal(row.agrees, true);
        }
      }
    }
  }
}
const ancillary = [...cases.values()].map(row => ({
  ...row,
  beforeMedianMs: median(row.before),
  afterMedianMs: median(row.after),
  ratioAfterBefore: median(row.after) / median(row.before),
  beforeDistribution: summarize(row.samplesBefore),
  afterDistribution: summarize(row.samplesAfter),
  samplesBefore: undefined,
  samplesAfter: undefined,
}));
const counterKey = r => [r.family, r.shape, r.regime, r.config, r.scale].join('|');
const oldCounters = result.counters.before.counters;
const newCounters = new Map(result.counters.after.counters.map(row => [counterKey(row), row]));
const invariants = [
  'injected',
  'succeeded',
  'sig',
  'nodes',
  'recovered',
  'finalEmpty',
  'passes',
  'message',
];
for (const old of oldCounters) {
  const updated = newCounters.get(counterKey(old));
  assert(updated, counterKey(old));
  for (const field of invariants) {
    assert.deepEqual(updated[field], old[field], `${counterKey(old)} ${field}`);
  }
}
const memoryKey = r => [r.family, r.shape, r.regime, r.config, r.scale].join('|');
const newMemory = new Map(result.memory.after.memory.map(row => [memoryKey(row), row]));
const memory = result.memory.before.memory.map(old => {
  const updated = newMemory.get(memoryKey(old));
  return {
    key: memoryKey(old),
    beforeAllocatedBytes: median(old.allocBytes),
    afterAllocatedBytes: median(updated.allocBytes),
    beforeRetainedBytes: median(old.retainedBytes),
    afterRetainedBytes: median(updated.retainedBytes),
    beforeDiscarded: old.discarded,
    afterDiscarded: updated.discarded,
    beforeSamples: old.allocBytes.length,
    afterSamples: updated.allocBytes.length,
  };
});
const tailSlopes = [];
for (const family of ['prog', 'lex']) {
  for (const shape of family === 'prog' ? ['blocks', 'flat'] : ['lines']) {
    const rows = result.matching.filter(
      row =>
        row.subset === 'all' &&
        row.family === family &&
        row.shape === shape &&
        row.regime === 'invalid-dense' &&
        row.config === 'bang/recover'
    );
    const lo = rows.find(row => row.scale === 30);
    const hi = rows.find(row => row.scale === 100);
    const denominator = Math.log(hi.inputChars / lo.inputChars);
    tailSlopes.push({
      family,
      shape,
      scales: [30, 100],
      before: Math.log(hi.beforeMedianMs / lo.beforeMedianMs) / denominator,
      after: Math.log(hi.afterMedianMs / lo.afterMedianMs) / denominator,
    });
  }
}
const analysis = {
  metadata: result.metadata,
  outcomeChecks: {cells: oldCounters.length, invariants, passed: true},
  ancillary,
  moduleLoad: {beforeMs: median(loads.before), afterMs: median(loads.after), samples: loads},
  memory,
  tailSlopes,
};
writeFileSync(join(directory, 'analysis.json'), JSON.stringify(analysis, null, 2) + '\n');
const selected = result.matching.filter(
  row => row.scale === 100 && row.subset === 'all' && row.config === 'bang/recover'
);
console.log(
  JSON.stringify(
    {
      outcomeChecks: analysis.outcomeChecks,
      tailSlopes,
      selected: selected.map(row => ({
        family: row.family,
        shape: row.shape,
        regime: row.regime,
        before: row.beforeMedianMs,
        after: row.afterMedianMs,
        speedup: row.speedup,
      })),
      memory,
      construction: ancillary.filter(
        row => row.section === 'construction' && row.op === 'ohm.grammar'
      ),
      incremental: ancillary.filter(row => row.section === 'incremental'),
      moduleLoad: analysis.moduleLoad,
    },
    null,
    2
  )
);
