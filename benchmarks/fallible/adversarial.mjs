import {comparisonTrees, outputPath} from './comparison-trees.mjs';
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const roots = comparisonTrees();
const cases = [
  [
    'one-error-backtracking',
    'G { S = E end\n E = "(" E ")" "a" -- a\n | "(" E ")" "b" -- b\n | X\n X = "x" ! ";" }',
    '('.repeat(10) + 'y;' + ')b'.repeat(10),
  ],
  [
    'valid-predicate',
    'G { S = E end\n E = &P "(" E ")" "a" -- a\n | &P "(" E ")" "b" -- b\n | "x"\n P = "(" ! any }',
    '('.repeat(10) + 'x' + ')b'.repeat(10),
  ],
  [
    'nested-missing-closers',
    'G { S = Stmt*\n Block = "{" Stmt* ! "}"\n Stmt = Block | Simple\n Simple = "x" ";" }',
    '{'.repeat(10) + 'x;',
  ],
];
const rows = [];
for (const root of roots) {
  const api = await import(pathToFileURL(resolve(root, 'packages/ohm-js/index.mjs')));
  const {MatchState} = await import(
    pathToFileURL(resolve(root, 'packages/ohm-js/src/MatchState.js'))
  );
  for (const [name, source, input] of cases) {
    const grammar = api.grammar(source);
    const original = MatchState.prototype.eval;
    let evaluations = 0;
    MatchState.prototype.eval = function (expr) {
      evaluations++;
      return original.call(this, expr);
    };
    let result;
    try {
      result = grammar.match(input, undefined, {recover: true});
    } finally {
      MatchState.prototype.eval = original;
    }
    assert(result.succeeded());
    rows.push({
      root,
      name,
      depth: 10,
      evaluations,
      passes: result._recovery.permitted.size + 1,
      diagnostics: result.getRecoveredFailures().map(f => [f.position, f.shortMessage]),
    });
  }
}
for (const [name] of cases) {
  const pair = rows.filter(row => row.name === name);
  assert.deepEqual(pair[0].diagnostics, pair[1].diagnostics);
  assert.equal(pair[0].passes, pair[1].passes);
}
const output = {node: process.version, roots, rows};
writeFileSync(outputPath('adversarial-results.json'), JSON.stringify(output, null, 2) + '\n');
console.log(JSON.stringify(output, null, 2));
