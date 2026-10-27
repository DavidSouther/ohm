#!/usr/bin/env node
/**
 * CPU profile of a recovering match, aggregated by function self time.
 *   node --cpu-prof --cpu-prof-dir=<dir> benchmarks/fallible/profile.mjs
 *     <family> <shape> <regime> <scale> <reps>
 *   node benchmarks/fallible/profile.mjs --summarize <file.cpuprofile>
 */
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {resolveTrees} from './lib/trees.mjs';
import * as W from './lib/workloads.mjs';

if (process.argv[2] === '--summarize') {
  const prof = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
  const byId = new Map(prof.nodes.map(n => [n.id, n]));
  const self = new Map();
  const dt = prof.timeDeltas;
  prof.samples.forEach((id, i) => {
    const n = byId.get(id);
    const frame = n.callFrame;
    const filename = frame.url.split('/').slice(-1)[0];
    const k = `${frame.functionName || '(anon)'} ${filename}:${frame.lineNumber + 1}`;
    self.set(k, (self.get(k) || 0) + (dt[i] || 0));
  });
  const total = [...self.values()].reduce((a, b) => a + b, 0);
  const rows = [...self.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, Number(process.argv[4] || 14));
  for (const [k, v] of rows) {
    console.log(`${((v / total) * 100).toFixed(1).padStart(5)}%  ${k}`);
  }
} else {
  const args = process.argv.slice(2);
  const override = args.find(a => a.startsWith('--fallible='));
  const [family, shape, regime, scale, reps] = args.filter(a => !a.startsWith('--'));
  const {fallible} = resolveTrees({fallible: override?.slice('--fallible='.length)});
  const ohm = await import(
    pathToFileURL(path.join(fallible, 'packages/ohm-js/index.mjs')).href
  );
  const g = ohm.grammar(W.grammarSource(family, 'bang'));
  const input = W.inputFor(family, Number(scale), shape, regime);
  for (let i = 0; i < Number(reps); i++) {
    g.match(input.text, undefined, {recover: true}).succeeded();
  }
}
