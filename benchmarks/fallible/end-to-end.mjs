import {treeMetadata} from './lib/trees.mjs';
import {comparisonTrees, outputPath} from './comparison-trees.mjs';
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {performance} from 'node:perf_hooks';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import * as W from './lib/workloads.mjs';
import {summarize} from './lib/stats.mjs';

const roots = comparisonTrees();
const output = outputPath('end-to-end-results.json');
const apis = await Promise.all(
  roots.map(root => import(pathToFileURL(resolve(root, 'packages/ohm-js/index.mjs'))))
);
const cases = ['valid', 'invalid-single', 'invalid-dense'].flatMap(regime =>
  [10, 100].map(scale => ({family: 'lex', shape: 'lines', regime, scale}))
);
cases.push(
  ...['blocks', 'flat'].map(shape => ({
    family: 'prog',
    shape,
    regime: 'invalid-dense',
    scale: 300,
  }))
);
const rows = [];
for (const {family, shape, regime, scale} of cases) {
  const grammars = apis.map(api => api.grammar(W.grammarSource(family, 'bang')));
  const input = W.inputFor(family, scale, shape, regime);
  const run = which => {
    const result = grammars[which].match(input.text, undefined, {recover: true});
    return [result.succeeded(), result.getRecoveredFailures().length];
  };
  for (const which of [0, 1]) assert.deepEqual(run(which), [true, input.errors]);
  const samples = [[], []];
  for (let repetition = 0; repetition < 3; repetition++) {
    for (const which of repetition % 2 ? [1, 0] : [0, 1]) {
      const start = performance.now();
      const value = run(which);
      samples[which].push(performance.now() - start);
      assert.deepEqual(value, [true, input.errors]);
    }
  }
  rows.push({
    family,
    shape,
    regime,
    scale,
    errors: input.errors,
    inputChars: input.text.length,
    before: summarize(samples[0]),
    after: summarize(samples[1]),
    samples,
    note:
      'match plus getRecoveredFailures; one shared process, one warmup, ' +
      'three alternating samples',
  });
  console.error(`${family}/${shape}/${regime}/${scale}: ${JSON.stringify(samples)}`);
}
const commits = roots.map(root => treeMetadata(root).commit);
const result = {node: process.version, roots, commits, rows};
if (output) writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result));
