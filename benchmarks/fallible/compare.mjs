import {treeMetadata} from './lib/trees.mjs';
import {comparisonTrees, outputPath} from './comparison-trees.mjs';
import {spawn} from 'node:child_process';
import {mkdirSync, writeFileSync} from 'node:fs';
import {cpus, loadavg} from 'node:os';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {median, summarize} from './lib/stats.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const [before, after] = comparisonTrees();
const roots = {before, after};
const out = dirname(outputPath('comparison/results.json'));
mkdirSync(join(out, 'raw'), {recursive: true});
const metadata = {
  node: process.version,
  cpu: cpus()[0].model,
  loadStart: loadavg(),
  startedAt: new Date().toISOString(),
  roots,
  profile: {
    scales: [1, 3, 10, 30, 100],
    warmupMs: 30,
    budgetMs: 100,
    minReps: 3,
    maxReps: 30,
    processes: 3,
  },
};
metadata.trees = Object.fromEntries(
  Object.entries(roots).map(([label, root]) => [label, treeMetadata(root)])
);

async function worker(label, mode, repetition, subset = 'all') {
  const flags =
    mode === 'memory'
      ? ['--expose-gc', '--min-semi-space-size=256', '--max-semi-space-size=256']
      : [];
  const args = [
    ...flags,
    join(here, 'comparison-worker.mjs'),
    `--tree=${roots[label]}`,
    '--label=fallible',
    `--mode=${mode}`,
    '--profile=comparison',
    `--subset=${subset}`,
    `--ohmgrammar=${join(roots.before, 'packages/ohm-js/src/ohm-grammar.ohm')}`,
  ];
  console.log(`${label}/${mode}/${subset}/${repetition}`);
  const child = spawn(process.execPath, args, {stdio: ['ignore', 'pipe', 'inherit']});
  let stdout = '';
  child.stdout.on('data', chunk => {
    stdout += chunk;
  });
  await new Promise((yes, no) => {
    child.once('error', no);
    child.once('close', code =>
      code === 0 ? yes() : no(new Error(`${label}/${mode}: ${code}`))
    );
  });
  const value = JSON.parse(stdout.trim().split('\n').at(-1));
  writeFileSync(
    join(out, 'raw', `${label}-${mode}-${subset}-${repetition}.json`),
    JSON.stringify(value)
  );
  return value;
}

const runs = {before: [], after: []};
for (let repetition = 0; repetition < 3; repetition++) {
  for (const label of repetition % 2 ? ['after', 'before'] : ['before', 'after']) {
    for (const subset of ['clean', 'all']) {
      runs[label].push(await worker(label, 'timing', repetition, subset));
    }
  }
}
const counters = {};
const memory = {};
for (const label of ['before', 'after']) {
  counters[label] = await worker(label, 'counters', 0);
  memory[label] = await worker(label, 'memory', 0);
}

const key = r => [r.subset, r.family, r.shape, r.regime, r.config, r.scale].join('|');
function aggregate(label) {
  const cells = new Map();
  for (const run of runs[label]) {
    for (const row of run.matching) {
      const k = key(row);
      if (!cells.has(k)) cells.set(k, {row, samples: [], processMedians: []});
      const cell = cells.get(k);
      cell.samples.push(...row.samples);
      cell.processMedians.push(median(row.samples));
    }
  }
  return cells;
}
const oldCells = aggregate('before');
const newCells = aggregate('after');
const matching = [];
for (const [k, before] of oldCells) {
  const after = newCells.get(k);
  if (!after) throw new Error(`missing after cell ${k}`);
  const oldMedian = median(before.processMedians);
  const newMedian = median(after.processMedians);
  matching.push({
    key: k,
    ...before.row,
    samples: undefined,
    before: {...summarize(before.samples), processMedians: before.processMedians},
    after: {...summarize(after.samples), processMedians: after.processMedians},
    beforeMedianMs: oldMedian,
    afterMedianMs: newMedian,
    speedup: oldMedian / newMedian,
  });
}
metadata.finishedAt = new Date().toISOString();
metadata.loadEnd = loadavg();
for (const [label, root] of Object.entries(roots)) {
  if (JSON.stringify(treeMetadata(root)) !== JSON.stringify(metadata.trees[label])) {
    throw new Error(`${label} source state changed during benchmark`);
  }
}
writeFileSync(
  join(out, 'results.json'),
  JSON.stringify({metadata, matching, counters, memory}, null, 2)
);
const rows = matching.filter(
  r =>
    r.subset === 'all' &&
    r.config === 'bang/recover' &&
    ['valid', 'invalid-single', 'invalid-dense'].includes(r.regime)
);
const fmt = n => n.toFixed(3);
const report = [
  '# Recovery reuse: matched before/after benchmark',
  '',
  'Original engineering workloads, with a bounded profile: scales 1, 3, 10, 30, 100; ' +
    'three alternating-order processes per tree; 30 ms warmup; 100 ms sample budget; ' +
    '3–30 samples per cell. Matching below includes the original match operation; ' +
    '+diag cells are retained in results.json. Counters and memory run separately. ' +
    'No universal complexity claim follows from finite measurements.',
  '',
  '| Workload | Regime | Scale | Before ms | After ms | Speedup |',
  '| --- | --- | ---: | ---: | ---: | ---: |',
  ...rows.map(
    r =>
      `| ${r.family}/${r.shape} | ${r.regime} | ${r.scale} | ` +
      `${fmt(r.beforeMedianMs)} | ${fmt(r.afterMedianMs)} | ${fmt(r.speedup)}x |`
  ),
  '',
  'Full distributions, process medians, plain-input checks, counters and memory ' +
    'samples are in results.json and raw/.',
  '',
];
writeFileSync(join(out, 'report.md'), report.join('\n'));
console.log(`wrote ${out}`);
