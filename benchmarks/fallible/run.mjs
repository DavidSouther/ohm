#!/usr/bin/env node
/**
 * Orchestrator: runs the Fallible overhead benchmark end to end.
 *
 *   node benchmarks/fallible/run.mjs --profile=smoke|full --out <dir>
 *     [--baseline <root>] [--fallible <root>]
 *
 * Writes <out>/results.json, <out>/report-tables.md, <out>/matching.csv and raw per-process
 * data under <out>/raw/. Exits 1 if any sanity assertion fails.
 */
import {execFileSync, spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {PROFILES} from './lib/profiles.mjs';
import {median, relSpread, slope, summarize} from './lib/stats.mjs';
import * as W from './lib/workloads.mjs';
import {writeReport} from './lib/report.mjs';
import {
  BASELINE_COMMIT,
  resolveTrees,
  treeMetadata,
  assertHistoricalCounters,
} from './lib/trees.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const opt = (name, dflt) => {
  const eq = argv.find(a => a.startsWith(`--${name}=`));
  if (eq) return eq.split('=').slice(1).join('=');
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};
const profile = PROFILES[opt('profile', 'smoke')];
const out = path.resolve(opt('out', path.join(here, `out-${profile.name}`)));
const {baseline: baselineRoot, fallible: fallibleRoot} = resolveTrees({
  baseline: opt('baseline'),
  fallible: opt('fallible'),
});
// This runner's pass and scan assertions describe the historical engine.
assertHistoricalCounters(baselineRoot, 'baseline');
assertHistoricalCounters(fallibleRoot, 'fallible');
fs.mkdirSync(path.join(out, 'raw'), {recursive: true});

const log = (...a) => console.log(`[bench ${new Date().toISOString().slice(11, 19)}]`, ...a);

const trees = Object.fromEntries(
  Object.entries({baseline: baselineRoot, fallible: fallibleRoot}).map(([label, root]) => {
    const {commit, branch, status} = treeMetadata(root);
    return [label, {root, commit, branch, statusBefore: status}];
  })
);
const sanity = [];
const check = (name, ok, detail = '') => {
  sanity.push({name, ok: !!ok, detail: String(detail)});
  if (!ok) log('SANITY FAIL:', name, detail);
};
check(
  'baseline-detached-at-pinned-commit',
  trees.baseline.commit.startsWith(BASELINE_COMMIT) && trees.baseline.branch === 'HEAD',
  `${trees.baseline.commit} ${trees.baseline.branch}`
);

// ---- environment ---------------------------------------------------------------------
const topProcs = () => {
  try {
    return execFileSync('ps', ['-Ao', 'pcpu,comm', '-r'], {encoding: 'utf8'})
      .split('\n')
      .slice(1, 7)
      .map(l => l.trim());
  } catch {
    return [];
  }
};
const meta = {
  profile: profile.name,
  node: process.version,
  v8: process.versions.v8,
  platform: `${os.platform()} ${os.release()} ${os.arch()}`,
  cpu: os.cpus()[0].model,
  cpus: os.cpus().length,
  memGB: Math.round(os.totalmem() / 2 ** 30),
  loadavgStart: os.loadavg(),
  topProcsStart: topProcs(),
  startedAt: new Date().toISOString(),
  trees: {
    baseline: {commit: trees.baseline.commit, branch: trees.baseline.branch},
    fallible: {commit: trees.fallible.commit, branch: trees.fallible.branch},
  },
  profileParams: profile,
  memoryFlags: ['--expose-gc', '--min-semi-space-size=256', '--max-semi-space-size=256'],
};

// ---- worker runner -------------------------------------------------------------------
const ohmGrammarPath = path.join(baselineRoot, 'packages/ohm-js/src/ohm-grammar.ohm');
function worker(label, mode, extra = [], nodeFlags = []) {
  const r = spawnSync(
    process.execPath,
    [
      ...nodeFlags,
      path.join(here, 'worker.mjs'),
      `--tree=${trees[label].root}`,
      `--label=${label}`,
      `--mode=${mode}`,
      `--profile=${profile.name}`,
      `--ohmgrammar=${ohmGrammarPath}`,
      ...extra,
    ],
    {encoding: 'utf8', maxBuffer: 512 * 2 ** 20}
  );
  if (r.status !== 0) {
    console.error(r.stderr);
    throw new Error(`worker ${label}/${mode} failed with status ${r.status}`);
  }
  const lines = r.stdout.trim().split('\n');
  return JSON.parse(lines[lines.length - 1]);
}

// ---- timing processes (alternating order) -------------------------------------------
const timingRuns = {baseline: [], fallible: []};
for (let p = 0; p < profile.procs; p++) {
  const order = p % 2 === 0 ? ['baseline', 'fallible'] : ['fallible', 'baseline'];
  for (const label of order) {
    for (const sub of ['clean', 'all']) {
      log(`timing process ${p + 1}/${profile.procs} on ${label} (${sub})`);
      const res = worker(label, 'timing', [`--subset=${sub}`]);
      fs.writeFileSync(
        path.join(out, 'raw', `timing-${label}-${sub}-${p}.json`),
        JSON.stringify(res)
      );
      timingRuns[label].push(res);
    }
  }
}

// ---- single-shot modes --------------------------------------------------------------
const countersByTree = {};
const memoryByTree = {};
const breakdownByTree = {};
const memFlags = meta.memoryFlags;
for (const label of ['baseline', 'fallible']) {
  log(`counters on ${label}`);
  countersByTree[label] = worker(label, 'counters').counters;
  log(`breakdown on ${label}`);
  breakdownByTree[label] = worker(label, 'breakdown').breakdown;
  log(`memory on ${label}`);
  memoryByTree[label] = worker(label, 'memory', [], memFlags).memory;
}
const loadRuns = {baseline: [], fallible: []};
const coldCases = [
  'prog|blocks|valid|plain/match',
  'prog|blocks|valid|bang/match',
  'prog|blocks|valid|bang/recover',
  'prog|blocks|invalid-dense|bang/recover',
];
const coldRuns = [];
for (let i = 0; i < Math.max(profile.loadLaunches, profile.coldLaunches); i++) {
  const order = i % 2 === 0 ? ['baseline', 'fallible'] : ['fallible', 'baseline'];
  for (const label of order) {
    if (i < profile.loadLaunches) loadRuns[label].push(worker(label, 'load').load[0].importMs);
    if (i < profile.coldLaunches) {
      for (const cc of coldCases) {
        if (label === 'baseline' && !cc.endsWith('|plain/match')) continue;
        coldRuns.push({
          tree: label,
          ...worker(label, 'cold', [`--case=${cc}`, '--scale=10']).cold[0],
        });
      }
    }
  }
}

// ---- aggregation -------------------------------------------------------------------
const regimeLabel = c =>
  c.regime === 'valid' ? (c.variant === 'plain' ? 'plain-valid' : 'bang-valid') : c.regime;
const cellKey = r => `${r.subset}|${r.family}|${r.shape}|${r.regime}|${r.config}|${r.scale}`;

function pool(label, section, keyFn) {
  const cells = new Map();
  for (const run of timingRuns[label]) {
    for (const r of run[section]) {
      const k = keyFn(r);
      if (!cells.has(k)) cells.set(k, {proto: r, perProc: [], all: []});
      const c = cells.get(k);
      c.perProc.push(median(r.samples));
      c.all.push(...r.samples);
    }
  }
  return cells;
}

const matching = [];
for (const label of ['baseline', 'fallible']) {
  const cells = pool(label, 'matching', cellKey);
  for (const [, c] of cells) {
    const r = c.proto;
    matching.push({
      tree: label,
      subset: r.subset,
      family: r.family,
      shape: r.shape,
      workloadRegime: r.regime,
      regime: regimeLabel(r),
      config: r.config,
      variant: r.variant,
      recover: r.recover,
      scale: r.scale,
      inputChars: r.inputChars,
      injected: r.injected,
      stats: summarize(c.all),
      procMedians: c.perProc,
      procSpread: relSpread(c.perProc),
      medianOfProcMedians: median(c.perProc),
    });
  }
}
// Growth exponents per series.
const seriesKey = r =>
  `${r.tree}|${r.subset}|${r.family}|${r.shape}|${r.workloadRegime}|${r.config}`;
const series = new Map();
for (const r of matching) {
  if (!series.has(seriesKey(r))) series.set(seriesKey(r), []);
  series.get(seriesKey(r)).push(r);
}
for (const rows of series.values()) {
  rows.sort((a, b) => a.scale - b.scale);
  const g = slope(rows.map(r => [r.scale, r.stats.median]));
  const tail =
    rows.length >= 2 ? slope(rows.slice(-2).map(r => [r.scale, r.stats.median])) : NaN;
  for (const r of rows) {
    r.growthExponent = g;
    r.tailExponent = tail;
  }
}
matching.sort((a, b) => cellKey(a).localeCompare(cellKey(b)) || a.tree.localeCompare(b.tree));

const construction = [];
for (const label of ['baseline', 'fallible']) {
  const cells = pool(label, 'construction', r => `${r.name}|${r.op}`);
  for (const [, c] of cells) {
    construction.push({
      tree: label,
      name: c.proto.name,
      op: c.proto.op,
      bytes: c.proto.bytes,
      stats: summarize(c.all),
      procSpread: relSpread(c.perProc),
    });
  }
}
const incremental = [];
for (const label of ['baseline', 'fallible']) {
  const cells = pool(label, 'incremental', r => `${r.name}|${r.scale}`);
  for (const [, c] of cells) {
    incremental.push({
      tree: label,
      name: c.proto.name,
      scale: c.proto.scale,
      inputChars: c.proto.inputChars,
      agrees: c.proto.agrees,
      stats: summarize(c.all),
      procSpread: relSpread(c.perProc),
    });
  }
}

const counters = [];
for (const label of ['baseline', 'fallible']) {
  for (const r of countersByTree[label]) {
    counters.push({tree: label, ...r, regime: regimeLabel(r), workloadRegime: r.regime});
  }
}
const memory = [];
for (const label of ['baseline', 'fallible']) {
  for (const r of memoryByTree[label]) {
    memory.push({
      tree: label,
      family: r.family,
      shape: r.shape,
      workloadRegime: r.regime,
      regime: regimeLabel(r),
      config: r.config,
      scale: r.scale,
      inputChars: r.inputChars,
      allocBytesMedian: r.allocBytes.length ? median(r.allocBytes) : null,
      retainedBytesMedian: median(r.retainedBytes),
      allocBytes: r.allocBytes,
      retainedBytes: r.retainedBytes,
      discarded: r.discarded,
      reps: r.reps,
    });
  }
}
const load = ['baseline', 'fallible'].map(label => ({
  tree: label,
  stats: summarize(loadRuns[label]),
  samples: loadRuns[label],
}));
const cold = [];
for (const label of ['baseline', 'fallible']) {
  const byCase = new Map();
  for (const r of coldRuns.filter(r => r.tree === label)) {
    const k = `${r.family}|${r.shape}|${r.regime}|${r.config}`;
    if (!byCase.has(k)) byCase.set(k, []);
    byCase.get(k).push(r);
  }
  for (const [k, rs] of byCase) {
    cold.push({
      tree: label,
      case: k,
      scale: rs[0].scale,
      buildMs: median(rs.map(r => r.buildMs)),
      call1: median(rs.map(r => r.calls[0])),
      call2: median(rs.map(r => r.calls[1])),
      call6: median(rs.map(r => r.calls[5])),
      n: rs.length,
    });
  }
}

// ---- sanity assertions -------------------------------------------------------------
const strip = s =>
  s
    .replace(/recoveryToken[^\n]*\n/, '')
    .replace(/!/g, '')
    .replace(/\s+/g, ' ');
check(
  'grammars-identical-up-to-bang',
  strip(W.progGrammar('plain')) === strip(W.progGrammar('bang')) &&
    strip(W.progGrammar('bang')) === strip(W.progGrammar('bangTok')) &&
    strip(W.lexGrammar('plain')) === strip(W.lexGrammar('bang'))
);

const byCounterKey = new Map(counters.map(r => [`${r.tree}|${caseKeyOf(r)}|${r.scale}`, r]));
function caseKeyOf(r) {
  return `${r.family}|${r.shape}|${r.workloadRegime}|${r.config}`;
}
{
  // Same CST on valid input in every configuration of both trees.
  const groups = new Map();
  for (const r of counters.filter(r => r.workloadRegime === 'valid')) {
    const k = `${r.family}|${r.shape}|${r.scale}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  const bad = [];
  for (const [k, rs] of groups) {
    if (!rs.every(r => r.succeeded)) bad.push(`${k}: not all succeeded`);
    if (new Set(rs.map(r => r.sig)).size !== 1) bad.push(`${k}: signatures differ`);
  }
  check(
    'same-cst-valid',
    bad.length === 0 && groups.size > 0,
    bad.join('; ') || `${groups.size} groups`
  );

  const valids = counters.filter(
    r => r.workloadRegime === 'valid' && r.recover && r.tree === 'fallible'
  );
  check(
    'recover-valid-single-pass-no-failures',
    valids.every(r => r.passes === 1 && r.recovered === 0),
    `${valids.length} rows`
  );
}
{
  const inv = counters.filter(r => r.workloadRegime !== 'valid');
  const plain = inv.filter(r => r.config === 'plain/match');
  check(
    'plain-fails-invalid',
    plain.length > 0 && plain.every(r => !r.succeeded),
    `${plain.length} rows`
  );
  const mismatched = [];
  for (const r of plain.filter(r => r.tree === 'fallible')) {
    const b = byCounterKey.get(`baseline|${caseKeyOf(r)}|${r.scale}`);
    const bang = byCounterKey.get(
      `fallible|${r.family}|${r.shape}|${r.workloadRegime}|bang/match|${r.scale}`
    );
    if (b && b.message !== r.message) mismatched.push(`base!=fb ${caseKeyOf(r)}@${r.scale}`);
    if (bang && bang.message !== r.message) {
      mismatched.push(`bang!=plain ${caseKeyOf(r)}@${r.scale}`);
    }
  }
  check('bang-match-equals-plain-message', mismatched.length === 0, mismatched.join('; '));

  const rec = inv.filter(
    r =>
      r.tree === 'fallible' && (r.config === 'bang/recover' || r.config === 'bangTok/recover')
  );
  const badCount = rec.filter(r => !r.succeeded || r.recovered !== r.injected);
  check(
    'recovered-failure-count',
    rec.length > 0 && badCount.length === 0,
    badCount
      .map(r => `${caseKeyOf(r)}@${r.scale}: injected ${r.injected} recovered ${r.recovered}`)
      .join('; ') || `${rec.length} rows`
  );
  const badPass = rec.filter(
    r =>
      r.passes !== r.recovered + 1 ||
      r.counts.matchStates - (r.counts.matchCalls - 1) !== r.passes
  );
  check(
    'passes-equal-failures-plus-one',
    badPass.length === 0,
    badPass.map(r => `${caseKeyOf(r)}@${r.scale}: ${r.passes}`).join('; ')
  );
  const pr = inv.filter(r => r.tree === 'fallible' && r.config === 'plain/recover');
  check(
    'plain-recover-fails-one-pass',
    pr.length > 0 &&
      pr.every(r => !r.succeeded && r.passes === 1 && r.recovered === 1 && r.finalEmpty),
    `${pr.length} rows`
  );
}
for (const label of ['baseline', 'fallible']) {
  const t = trees[label];
  check(
    label === 'fallible' ? 'tracked-source-untouched' : 'baseline-tree-untouched',
    treeMetadata(t.root).status === t.statusBefore,
    `${label}: status unchanged`
  );
}
{
  const total = memory.reduce((a, r) => a + r.reps, 0);
  const disc = memory.reduce((a, r) => a + r.discarded, 0);
  check(
    'memory-not-gc-dominated',
    total > 0 && disc / total < 0.5,
    `${disc}/${total} samples discarded`
  );
  check(
    'incremental-agrees',
    incremental.length > 0 && incremental.every(r => r.agrees),
    `${incremental.length} rows`
  );
  // Completeness: every expected matching cell exists on both trees with the pooled sample count.
  const plainCells = tree => W.matchCases(tree).filter(c => c.config === 'plain/match').length;
  const expected = {
    baseline:
      (W.matchCases('baseline').length + plainCells('baseline')) * profile.scales.length,
    fallible:
      (W.matchCases('fallible').length + plainCells('fallible')) * profile.scales.length,
  };
  const have = {
    baseline: matching.filter(r => r.tree === 'baseline' && !r.config.includes('+')).length,
    fallible: matching.filter(r => r.tree === 'fallible' && !r.config.includes('+')).length,
  };
  check(
    'cells-complete',
    have.baseline === expected.baseline && have.fallible === expected.fallible,
    JSON.stringify({expected, have})
  );
}

meta.loadavgEnd = os.loadavg();
meta.topProcsEnd = topProcs();
meta.finishedAt = new Date().toISOString();

const results = {
  meta,
  sanity,
  construction,
  breakdown: breakdownByTree,
  load,
  cold,
  matching,
  counters,
  memory,
  incremental,
};
fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(results, null, 1));
fs.writeFileSync(
  path.join(out, 'matching.csv'),
  [
    'tree,family,shape,regime,config,scale,inputChars,n,median_ms,p25_ms,' +
      'p75_ms,p90_ms,mad_ms,procSpread,growthExponent',
    ...matching.map(r =>
      [
        r.tree,
        r.family,
        r.shape,
        r.regime,
        r.config,
        r.scale,
        r.inputChars,
        r.stats.n,
        r.stats.median,
        r.stats.p25,
        r.stats.p75,
        r.stats.p90,
        r.stats.mad,
        r.procSpread,
        r.growthExponent,
      ].join(',')
    ),
  ].join('\n') + '\n'
);
writeReport(results, path.join(out, 'report-tables.md'));
const failed = sanity.filter(c => !c.ok);
log(`sanity: ${sanity.length - failed.length}/${sanity.length} passed`);
log('results:', path.join(out, 'results.json'));
process.exit(failed.length ? 1 : 0);
