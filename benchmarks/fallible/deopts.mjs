#!/usr/bin/env node
/**
 * Summarize V8 deoptimizations from a `--trace-deopt --trace-deopt-verbose` log.
 *   node --trace-deopt --trace-deopt-verbose benchmarks/fallible/profile.mjs ... > deopt.log
 *   node benchmarks/fallible/deopts.mjs deopt.log [--cpuprofile file.cpuprofile] [topN]
 * With --cpuprofile, each function's total self time is shown next to its deopt count,
 * so deopts in hot functions stand out.
 */
import fs from 'node:fs';

const args = process.argv.slice(2);
const profIdx = args.indexOf('--cpuprofile');
const profFile = profIdx >= 0 ? args.splice(profIdx, 2)[1] : null;
const [logFile, top = '20'] = args;
const lines = fs.readFileSync(logFile, 'utf8').split('\n');

const bailout =
  // eslint-disable-next-line max-len
  /^\[bailout \(kind: ([\w-]+), reason: ([^)]*)\): begin\. deoptimizing \S+ <JSFunction ([^ ]*) .*?, \S+ <Code (\w+)>/;
const deopts = [];
for (let i = 0; i < lines.length; i++) {
  const m = bailout.exec(lines[i]);
  if (!m) continue;
  const at = /;;; deoptimize at <([^>]*)>/.exec(lines[i + 1] || '');
  const loc = at ? at[1].split(' inlined at ')[0] : '';
  deopts.push({
    kind: m[1],
    reason: m[2],
    fn: m[3] || '(anon)',
    tier: m[4],
    loc: loc ? loc.replace(/^file:.*\//, '').replace(/^.*\//, '') : '?',
  });
}

const selfTime = new Map();
if (profFile) {
  const prof = JSON.parse(fs.readFileSync(profFile, 'utf8'));
  const byId = new Map(prof.nodes.map(n => [n.id, n]));
  const totals = new Map();
  prof.samples.forEach((id, i) => {
    const f = byId.get(id).callFrame;
    const k = `${f.functionName || '(anon)'}`;
    totals.set(k, (totals.get(k) || 0) + (prof.timeDeltas[i] || 0));
  });
  const all = [...totals.values()].reduce((a, b) => a + b, 0);
  for (const [k, v] of totals) selfTime.set(k, v / all);
}

const count = (rows, keyFn) => {
  const m = new Map();
  for (const r of rows) m.set(keyFn(r), (m.get(keyFn(r)) || 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
};
const optimizations = lines.filter(l => /^\[completed optimizing /.test(l)).length;
const n = Number(top);

console.log(`${deopts.length} deopts, ${optimizations} optimizations completed\n`);
console.log('By reason:');
for (const [k, v] of count(deopts, d => `${d.kind} / ${d.reason}`).slice(0, n)) {
  console.log(`${String(v).padStart(6)}  ${k}`);
}
console.log('\nBy tier:');
for (const [k, v] of count(deopts, d => d.tier)) console.log(`${String(v).padStart(6)}  ${k}`);
console.log('\nBy function (deopts, function self time, top reasons):');
for (const [fn, v] of count(deopts, d => d.fn).slice(0, n)) {
  const reasons = count(
    deopts.filter(d => d.fn === fn),
    d => d.reason
  )
    .slice(0, 3)
    .map(([r, c]) => `${r}×${c}`)
    .join(', ');
  const t = selfTime.has(fn) ? `${(selfTime.get(fn) * 100).toFixed(1)}%`.padStart(6) : '     -';
  console.log(`${String(v).padStart(6)}  ${t}  ${fn}  [${reasons}]`);
}
console.log('\nBy deopt site (source location):');
for (const [k, v] of count(deopts, d => `${d.loc}  ${d.fn}  (${d.reason})`).slice(0, n)) {
  console.log(`${String(v).padStart(6)}  ${k}`);
}
