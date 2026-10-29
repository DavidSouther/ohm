#!/usr/bin/env node
/**
 * Paired (interleaved) comparison on the fallible tree: configurations alternate sample by
 * sample inside one process, so machine drift and JIT state are shared. Reports the median of
 * per-iteration ratios and its spread across processes.
 *
 *   node benchmarks/fallible/paired.mjs --profile=smoke|full --out <dir>
 *
 * Sets: `nonrecover` (plain/match vs bang/match; no recovering code runs in the process),
 * `recover` (plain/match vs plain/recover vs bang/recover), `construct` (grammar source with
 * and without `!`). Writes <out>/results-paired.json and <out>/report-paired.md.
 */
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {PROFILES} from './lib/profiles.mjs';
import {median, quantile, relSpread} from './lib/stats.mjs';
import {resolveTrees, treeMetadata} from './lib/trees.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const opt = (n, d) => {
  const eq = argv.find(a => a.startsWith(`--${n}=`));
  if (eq) return eq.split('=').slice(1).join('=');
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};
const profile = PROFILES[opt('profile', 'smoke')];
const out = path.resolve(opt('out', path.join(here, `out-${profile.name}`)));
const {baseline: baselineRoot, fallible: fallibleRoot} = resolveTrees({
  baseline: opt('baseline'),
  fallible: opt('fallible'),
});
const trees = {baseline: treeMetadata(baselineRoot), fallible: treeMetadata(fallibleRoot)};
fs.mkdirSync(path.join(out, 'raw'), {recursive: true});
const tag = opt('tag', '');
const log = (...a) => console.log(`[paired ${new Date().toISOString().slice(11, 19)}]`, ...a);

const runs = [];
for (let p = 0; p < profile.procs; p++) {
  for (const set of opt('sets', 'nonrecover,recover,construct,dual').split(',')) {
    log(`process ${p + 1}/${profile.procs}, set ${set}`);
    const r = spawnSync(
      process.execPath,
      [
        path.join(here, 'worker.mjs'),
        `--tree=${fallibleRoot}`,
        `--tree2=${baselineRoot}`,
        '--label=fallible',
        '--mode=paired',
        `--set=${set}`,
        `--order=${p % 2 === 0 ? 'bf' : 'fb'}`,
        `--ohmgrammar=${path.join(baselineRoot, 'packages/ohm-js/src/ohm-grammar.ohm')}`,
        `--profile=${profile.name}`,
      ],
      {encoding: 'utf8', maxBuffer: 512 * 2 ** 20}
    );
    if (r.status !== 0) {
      console.error(r.stderr);
      process.exit(1);
    }
    const lines = r.stdout.trim().split('\n');
    const res = JSON.parse(lines[lines.length - 1]);
    fs.writeFileSync(
      path.join(out, 'raw', `paired${tag}-${set}-${p}.json`),
      JSON.stringify(res)
    );
    runs.push({set, p, rows: res.paired});
  }
}

// Pool: per row key, per process the median of per-iteration ratios (config i over config 0).
const cells = new Map();
for (const run of runs) {
  for (const r of run.rows) {
    const key =
      r.kind === 'match'
        ? `match|${r.family}|${r.shape}|${r.scale}|${r.labels.join(',')}`
        : `construct|${r.name}|${r.labels.join(',')}`;
    if (!cells.has(key)) {
      cells.set(key, {
        proto: r,
        perProc: r.labels.map(() => []),
        ratios: r.labels.map(() => []),
        medians: r.labels.map(() => []),
      });
    }
    const c = cells.get(key);
    const n = Math.min(...r.samples.map(s => s.length));
    for (let i = 0; i < r.labels.length; i++) {
      const rat = [];
      for (let k = 0; k < n; k++) rat.push(r.samples[i][k] / r.samples[0][k]);
      c.perProc[i].push(median(rat));
      c.ratios[i].push(...rat);
      c.medians[i].push(median(r.samples[i]));
    }
  }
}
const rows = [];
for (const [, c] of cells) {
  const r = c.proto;
  for (let i = 1; i < r.labels.length; i++) {
    const sorted = [...c.ratios[i]].sort((a, b) => a - b);
    rows.push({
      kind: r.kind,
      family: r.family,
      shape: r.shape,
      name: r.name,
      scale: r.scale,
      inputChars: r.inputChars,
      reference: r.labels[0],
      config: r.labels[i],
      n: sorted.length,
      ratioMedian: quantile(sorted, 0.5),
      ratioP25: quantile(sorted, 0.25),
      ratioP75: quantile(sorted, 0.75),
      procRatioMedians: c.perProc[i],
      procSpread: relSpread(c.perProc[i]),
      referenceMedianMs: median(c.medians[0]),
      configMedianMs: median(c.medians[i]),
    });
  }
}
fs.writeFileSync(
  path.join(out, `results-paired${tag}.json`),
  JSON.stringify({profile: profile.name, node: process.version, trees, rows}, null, 1)
);

const f = x => x.toFixed(3);
const lines = [
  '# Paired (interleaved) comparisons, fallible tree\n',
  'Ratio = config / reference per iteration, median over pooled iterations ' +
    '(IQR in brackets); `proc spread` = (max - min) / median of the ' +
    'per-process median ratios.\n',
];
const T = (head, rs) =>
  [
    `| ${head.join(' | ')} |`,
    `| ${head.map(() => '---').join(' | ')} |`,
    ...rs.map(r => `| ${r.join(' | ')} |`),
  ].join('\n') + '\n';
const isDual = r => r.reference === 'baseline';
lines.push('## Matching on valid input, within the fallible tree\n');
lines.push(
  T(
    [
      'workload',
      'scale',
      'reference',
      'config',
      'ref ms',
      'config ms',
      'ratio',
      'IQR',
      'n',
      'proc spread',
    ],
    rows
      .filter(r => r.kind === 'match' && !isDual(r))
      .map(r => [
        `${r.family}/${r.shape}`,
        r.scale,
        r.reference,
        r.config,
        f(r.referenceMedianMs),
        f(r.configMedianMs),
        `${f(r.ratioMedian)}x`,
        `${f(r.ratioP25)}-${f(r.ratioP75)}`,
        r.n,
        `${(r.procSpread * 100).toFixed(1)}%`,
      ])
  )
);
lines.push(
  '## Regression check, both trees in one process, interleaved: fallible / ' +
    'baseline, `!`-free grammar\n'
);
lines.push(
  T(
    ['workload', 'scale', 'baseline ms', 'fallible ms', 'ratio', 'IQR', 'n', 'proc spread'],
    rows
      .filter(r => r.kind === 'match' && isDual(r))
      .map(r => [
        `${r.family}/${r.shape}`,
        r.scale,
        f(r.referenceMedianMs),
        f(r.configMedianMs),
        `${f(r.ratioMedian)}x`,
        `${f(r.ratioP25)}-${f(r.ratioP75)}`,
        r.n,
        `${(r.procSpread * 100).toFixed(1)}%`,
      ])
  )
);
lines.push('## Construction, both trees in one process, interleaved: fallible / baseline\n');
lines.push(
  T(
    ['source (operation)', 'baseline ms', 'fallible ms', 'ratio', 'IQR', 'n', 'proc spread'],
    rows
      .filter(r => r.kind === 'construct' && isDual(r))
      .map(r => [
        r.name,
        f(r.referenceMedianMs),
        f(r.configMedianMs),
        `${f(r.ratioMedian)}x`,
        `${f(r.ratioP25)}-${f(r.ratioP75)}`,
        r.n,
        `${(r.procSpread * 100).toFixed(1)}%`,
      ])
  )
);
lines.push('## Construction: source with `!` over its `!`-free twin\n');
lines.push(
  T(
    ['source', 'ratio', 'IQR', 'n', 'proc spread', 'plain ms', 'bang ms'],
    rows
      .filter(r => r.kind === 'construct' && !isDual(r))
      .map(r => [
        r.name,
        `${f(r.ratioMedian)}x`,
        `${f(r.ratioP25)}-${f(r.ratioP75)}`,
        r.n,
        `${(r.procSpread * 100).toFixed(1)}%`,
        f(r.referenceMedianMs),
        f(r.configMedianMs),
      ])
  )
);
fs.writeFileSync(path.join(out, `report-paired${tag}.md`), lines.join('\n'));
log('wrote', path.join(out, `results-paired${tag}.json`));
