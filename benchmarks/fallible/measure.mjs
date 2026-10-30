#!/usr/bin/env node
/**
 * Time and retained-memory comparison of several checkouts of ohm-js.
 *
 *   node benchmarks/fallible/measure.mjs time   [--procs=7] <root>...
 *   node benchmarks/fallible/measure.mjs memory [--procs=3] <root>...
 *
 * Each <root> is a checkout (or worktree) of the repository; its
 * packages/ohm-js/index.mjs is loaded as is, so no build step is needed. Every
 * sample runs in a fresh process, and processes alternate between the roots in a
 * rotating order. A case a root cannot run (for example `B ! C` grammars on a
 * checkout without recovery points) is reported as `n/a`.
 *
 * `time` prints the median over processes of each process's median match time.
 * `memory` prints the heap retained per result after a forced GC, with the
 * results of a run held live, plus the process's peak RSS.
 *
 * Workloads come from lib/workloads.mjs: the `Prog` (blocks of statements) and
 * `Lex` (one token per line) grammar families, in a `plain` variant without
 * recovery points and a `bang` variant with them.
 */
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath, pathToFileURL, URL} from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const median = a => [...a].sort((x, y) => x - y)[a.length >> 1];

// family, shape, regime, scale, variant, recover, reps (timing) / held results (memory)
const TIME_CASES = [
  ['prog', 'blocks', 'valid', 30, 'plain', 0, 40],
  ['prog', 'flat', 'valid', 30, 'plain', 0, 40],
  ['lex', 'lines', 'valid', 30, 'plain', 0, 20],
  ['prog', 'blocks', 'valid', 30, 'bang', 0, 40],
  ['prog', 'blocks', 'valid', 30, 'bang', 1, 20],
  ['prog', 'blocks', 'invalid-single', 30, 'bang', 1, 20],
  ['prog', 'blocks', 'invalid-dense', 100, 'bang', 1, 6],
  ['lex', 'lines', 'valid', 30, 'bang', 1, 6],
  ['lex', 'lines', 'invalid-single', 30, 'bang', 1, 6],
  ['lex', 'lines', 'invalid-dense', 30, 'bang', 1, 6],
];
const MEMORY_CASES = [
  ['prog', 'blocks', 'valid', 100, 'plain', 0, 20],
  ['lex', 'lines', 'valid', 30, 'plain', 0, 20],
  ['prog', 'blocks', 'valid', 100, 'bang', 1, 20],
  ['prog', 'blocks', 'invalid-dense', 30, 'bang', 1, 20],
];

const label = c => `${c[0]}/${c[1]}/${c[2]} s${c[3]} ${c[4]}${c[5] ? '+recover' : ''}`;

async function child(mode, root, family, shape, regime, scale, variant, recover, count) {
  const load = file => import(pathToFileURL(file).href);
  const ohm = await load(path.join(root, 'packages/ohm-js/index.mjs'));
  const W = await load(path.join(here, 'lib/workloads.mjs'));
  let g;
  try {
    g = ohm.grammar(W.grammarSource(family, variant));
  } catch {
    console.log('n/a');
    return;
  }
  const {text} = W.inputFor(family, Number(scale), shape, regime);
  const opts = recover === '1' ? {recover: true} : undefined;
  const once = () => g.match(text, undefined, opts);
  for (let i = 0; i < 3; i++) once();
  if (mode === 'time') {
    const ts = [];
    for (let i = 0; i < Number(count); i++) {
      const t = process.hrtime.bigint();
      once();
      ts.push(Number(process.hrtime.bigint() - t) / 1e6);
    }
    console.log(median(ts));
  } else {
    const used = () => process.memoryUsage().heapUsed;
    const settle = () => {
      globalThis.gc();
      globalThis.gc();
    };
    settle();
    const before = used();
    const held = [];
    for (let i = 0; i < Number(count); i++) held.push(once());
    settle();
    const perResult = (used() - before) / held.length;
    console.log(JSON.stringify({perResult, maxRss: process.resourceUsage().maxRSS * 1024}));
    if (held.length === 0) console.log('unreachable');
  }
}

function run(mode, root, c) {
  const flags = mode === 'memory' ? ['--expose-gc'] : [];
  const argv = [...flags, fileURLToPath(import.meta.url), '--child', mode, root, ...c.map(String)];
  return execFileSync(process.execPath, argv, {encoding: 'utf8'}).trim().split('\n')[0];
}

const fmt = (v, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : 'n/a');

function parent() {
  const [mode, ...rest] = process.argv.slice(2);
  const procsArg = rest.find(a => a.startsWith('--procs='));
  const roots = rest.filter(a => !a.startsWith('--'));
  const procs = Number(procsArg?.split('=')[1] ?? (mode === 'time' ? 7 : 3));
  const names = roots.map(r => path.basename(r));
  const cases = mode === 'time' ? TIME_CASES : MEMORY_CASES;
  const unit = mode === 'time' ? 'ms' : 'MiB/result';
  console.log(`| case | ${names.map(n => `${n} (${unit})`).join(' | ')} | last/first | last/previous |`);
  console.log(`|---|${names.map(() => '---:').join('|')}|---:|---:|`);
  for (const c of cases) {
    const samples = roots.map(() => []);
    const rss = roots.map(() => []);
    for (let i = 0; i < procs; i++) {
      for (let k = 0; k < roots.length; k++) {
        const idx = (k + i) % roots.length;
        const out = run(mode, roots[idx], c);
        if (out === 'n/a') continue;
        if (mode === 'time') {
          samples[idx].push(Number(out));
        } else {
          const r = JSON.parse(out);
          samples[idx].push(r.perResult / 2 ** 20);
          rss[idx].push(r.maxRss / 2 ** 20);
        }
      }
    }
    const meds = samples.map(s => (s.length ? median(s) : NaN));
    const cells = meds.map((m, i) =>
      mode === 'memory' && rss[i].length ? `${fmt(m)} (rss ${fmt(median(rss[i]), 0)})` : fmt(m)
    );
    const last = meds.at(-1);
    const first = meds.find(Number.isFinite);
    const prev = meds.slice(0, -1).findLast(Number.isFinite);
    const ratio = (a, b) => (Number.isFinite(a) && Number.isFinite(b) ? fmt(a / b, 3) : 'n/a');
    console.log(`| ${label(c)} | ${cells.join(' | ')} | ${ratio(last, first)} | ${ratio(last, prev)} |`);
  }
}

if (process.argv[2] === '--child') {
  await child(...process.argv.slice(3));
} else {
  parent();
}
