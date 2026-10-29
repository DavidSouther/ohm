import {comparisonTrees, outputPath} from './comparison-trees.mjs';
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {performance} from 'node:perf_hooks';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {summarize} from './lib/stats.mjs';
import {signature} from './lib/workloads.mjs';

const roots = comparisonTrees();
const output = outputPath('hdl-results.json');
const apis = await Promise.all(
  roots.map(root => import(pathToFileURL(resolve(root, 'packages/ohm-js/index.mjs'))))
);
const states = await Promise.all(
  roots.map(root => import(pathToFileURL(resolve(root, 'packages/ohm-js/src/MatchState.js'))))
);
const source = String.raw`Hdl {
  Chip = "CHIP" name "{" Parts "}"
  Parts = "PARTS:" Part* ! &"}"
  Part = PartBody ! ";"
  PartBody = name "(" ListOf<Wire, ","> ")"
  Wire = name "=" name
  name = letter alnum*
}`;
const grammars = apis.map(api => api.grammar(source));
const rows = [];
const inputs = [];
for (const errors of [0, 1, 8, 64, 240]) {
  const broken = new Set(
    Array.from({length: errors}, (_, i) => Math.floor((i * 240) / errors))
  );
  const parts = Array.from({length: 240}, (_, i) =>
    broken.has(i) ? `  Nand(a=a b=b, out=w${i});` : `  Nand(a=a, b=b, out=w${i});`
  );
  const input = `CHIP Big {\n PARTS:\n${parts.join('\n')}\n}\n`;
  inputs.push(input);
  const run = which => {
    const result = grammars[which].match(input, undefined, {recover: true});
    assert(result.succeeded());
    assert.equal(result.getRecoveredFailures().length, errors);
    return result;
  };
  const warm = which => {
    const result = run(which);
    return {
      signature: signature(result._cst),
      diagnostics: result
        .getRecoveredFailures()
        .map(f => [
          f.position,
          f.interval.startIdx,
          f.interval.endIdx,
          f.shortMessage,
          f.getExpectedText(),
        ]),
    };
  };
  for (let repetition = 0; repetition < 3; repetition++) assert.deepEqual(warm(0), warm(1));
  const samples = [[], []];
  for (let repetition = 0; repetition < 5; repetition++) {
    for (const which of repetition % 2 ? [1, 0] : [0, 1]) {
      const start = performance.now();
      run(which);
      samples[which].push(performance.now() - start);
    }
  }
  rows.push({
    parts: 240,
    errors,
    inputChars: input.length,
    before: summarize(samples[0]),
    after: summarize(samples[1]),
    samples,
  });
  console.error(`HDL parts240/errors${errors}: ${JSON.stringify(samples)}`);
}
// Instrument only after every timing cell, so prototype changes cannot alter
// the JIT history of later timed cells.
for (let index = 0; index < rows.length; index++) {
  const evaluations = [];
  for (const which of [0, 1]) {
    const original = states[which].MatchState.prototype.eval;
    let count = 0;
    states[which].MatchState.prototype.eval = function (expr) {
      count++;
      return original.call(this, expr);
    };
    try {
      const result = grammars[which].match(inputs[index], undefined, {recover: true});
      assert.equal(result.getRecoveredFailures().length, rows[index].errors);
    } finally {
      states[which].MatchState.prototype.eval = original;
    }
    evaluations.push(count);
  }
  rows[index].evaluations = evaluations;
}
const result = {
  node: process.version,
  roots,
  method:
    'Paper HDL family, fixed 240 parts, match plus diagnostics, three warmups, ' +
    'five alternating samples in one process; counters run after all timing cells',
  rows,
};
writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result));
