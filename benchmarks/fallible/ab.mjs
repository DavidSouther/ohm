#!/usr/bin/env node
/**
 * Alternating A/B timing of two checkouts, one fresh process per sample.
 *   node benchmarks/fallible/ab.mjs <rootA> <rootB> [procs=7]
 * Child mode: ab.mjs --child <root> <family> <shape> <regime> <scale> <recover> <reps>
 */
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath, pathToFileURL, URL} from 'node:url';

const median = a => [...a].sort((x, y) => x - y)[a.length >> 1];
const here = fileURLToPath(new URL('.', import.meta.url));
if (process.argv[2] === '--child') {
  const [root, family, shape, regime, scale, recover, reps] = process.argv.slice(3);
  const load = file => import(pathToFileURL(file).href);
  const ohm = await load(path.join(root, 'packages/ohm-js/index.mjs'));
  const W = await load(path.join(here, 'lib/workloads.mjs'));
  const g = ohm.grammar(W.grammarSource(family, 'bang'));
  const {text} = W.inputFor(family, Number(scale), shape, regime);
  const opts = recover === '1' ? {recover: true} : undefined;
  const once = () => g.match(text, undefined, opts).succeeded();
  for (let i = 0; i < 3; i++) once();
  const ts = [];
  for (let i = 0; i < Number(reps); i++) {
    const t = process.hrtime.bigint();
    once();
    ts.push(Number(process.hrtime.bigint() - t) / 1e6);
  }
  console.log(median(ts));
} else {
  const [a, b, procs = '7'] = process.argv.slice(2);
  const cases = [
    ['prog', 'blocks', 'valid', 30, 1, 20],
    ['prog', 'blocks', 'valid', 30, 0, 40],
    ['prog', 'blocks', 'invalid-dense', 100, 1, 6],
    ['lex', 'lines', 'invalid-dense', 30, 1, 6],
  ];
  for (const c of cases) {
    const res = {A: [], B: []};
    for (let i = 0; i < Number(procs); i++) {
      const order = i % 2 ? [['B', b], ['A', a]] : [['A', a], ['B', b]];
      for (const [k, root] of order) {
        const argv = [here + 'ab.mjs', '--child', root, ...c.map(String)];
        const out = execFileSync(process.execPath, argv, {encoding: 'utf8'});
        res[k].push(Number(out));
      }
    }
    const [ma, mb] = [median(res.A), median(res.B)];
    const label = `${c.slice(0, 3).join('/')} s${c[3]} ${c[4] ? 'recover' : 'plain  '}`;
    const ratio = (mb / ma).toFixed(3);
    console.log(`${label}  A ${ma.toFixed(2)} ms  B ${mb.toFixed(2)} ms  B/A ${ratio}`);
  }
}
