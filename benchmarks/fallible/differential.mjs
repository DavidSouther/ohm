import {comparisonTrees, outputPath} from './comparison-trees.mjs';
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import * as W from './lib/workloads.mjs';

const [beforeRoot, afterRoot] = comparisonTrees();
const output = outputPath('differential-results.json');
const load = (root, version) =>
  import(
    pathToFileURL(
      resolve(root, 'packages/ohm-js', version === 'v18' ? 'src/v18.js' : 'index.mjs')
    ).href
  );
const diagnostic = f => ({
  start: f.interval.startIdx,
  end: f.interval.endIdx,
  position: f.position,
  missing: f.missing,
  message: f.shortMessage,
  expected: f.getExpectedText(),
  failures: f
    .getRightmostFailures()
    .map(x => [x.toString(), x.getType(), x.isFluffy(), x.getPExpr().toString()]),
});
const tree = n =>
  n
    ? {
        kind: n.ctorName,
        length: n.matchLength,
        offsets: n.childOffsets,
        optional: n.optional,
        recovery: n.recoveredFailure ? diagnostic(n.recoveredFailure) : undefined,
        nested: n.nestedFailures?.map(diagnostic),
        children: n.children?.map(tree),
      }
    : undefined;
const snapshot = r => ({
  succeeded: r.succeeded(),
  position: r.getRightmostFailurePosition(),
  failureMessage: r.failed() ? r.message : undefined,
  failureExpected: r.failed() ? r.getExpectedText() : undefined,
  diagnostics: r.getRecoveredFailures().map(diagnostic),
  cst: tree(r._cst),
});
function outcome(grammar, input, tracing = false) {
  try {
    const value = grammar[tracing ? 'trace' : 'match'](input, undefined, {recover: true});
    return snapshot(tracing ? value.result : value);
  } catch (error) {
    return {
      thrown: {name: error.name, message: error.message, shortMessage: error.shortMessage},
    };
  }
}

function combinations(alphabet, limit) {
  const all = [''];
  let level = [''];
  for (let n = 1; n <= limit; n++) {
    level = level.flatMap(prefix => alphabet.map(x => prefix + x));
    all.push(...level);
  }
  return all;
}

const families = [
  ['lexical-items', 'G { s = item* item = "a" ! ";" }', combinations(['a;', 'b;'], 7)],
  [
    'irrelevant-attempt-prefix',
    'G { s = item*\n item = ("z" ! "q") | (body ! ";")\n body = "a" "b" }',
    combinations(['ab;', 'a?;'], 7),
  ],
  [
    'predicate',
    'G { S = (&Item)? Item*\n Item = letter ! ";" }',
    combinations(['a;', '1;', 'b;', ';'], 4),
  ],
  [
    'described-block',
    'G { S = "{" Item* ! "}"\n Item (a statement) = letter ! ";" }',
    combinations(['a;', '1;', 'b;'], 4).flatMap(s => ['{' + s + '}', '{' + s]),
  ],
  [
    'parameter-iteration',
    'G { S = R<"a"> "!" -- a\n | R<"b"> "?" -- b\n R<x> = x* ! ";" }',
    combinations(['a', 'b', ';', '!', '?'], 4),
  ],
  [
    'parameter-join',
    'G { S = R<"a", ";"> "!" -- a\n | R<"a", ":"> "?" -- b\n R<x, c> = x ! c }',
    combinations(['a', 'b', ';', ':', '?'], 4),
  ],
  [
    'enclosing-joins',
    'G { S = (R ! "]") "a" -- a\n | (R ! "}") "b" -- b\n R = "x" ! ";" }',
    combinations(['x', 'y', ';', ']', '}', 'a', 'b'], 3),
  ],
  [
    'left-recursion',
    'G { S = E\n E = E "+" Item -- plus\n | Item\n Item = letter ! ";" }',
    combinations(['a;', '1;', 'b;'], 4).map(s => s.match(/.{2}/g)?.join('+') || ''),
  ],
  [
    'backtracking',
    'G { S = E end\n E = "(" E ")" "a" -- a\n | "(" E ")" "b" -- b\n | X\n X = "x" ! ";" }',
    Array.from({length: 11}, (_, d) => '('.repeat(d) + 'y;' + ')b'.repeat(d)),
  ],
  [
    'valid-predicate',
    'G { S = E end\n E = &P "(" E ")" "a" -- a\n | &P "(" E ")" "b" -- b\n | "x"\n P = "(" ! any }',
    Array.from({length: 11}, (_, d) => '('.repeat(d) + 'x' + ')b'.repeat(d)),
  ],
  [
    'missing-closers',
    'G { S = Stmt*\n Block = "{" Stmt* ! "}"\n Stmt = Block | Simple\n Simple = "x" ";" }',
    Array.from({length: 8}, (_, d) => '{'.repeat(d + 1) + 'x;'),
  ],
  [
    'line-coordinates',
    'G { S = Item*\n Item = letter ! ";" }',
    ['a;\r\n1;\r\nb;', 'a;\r1;\rb;', 'a;\n😀;\nb;', '1;\r\n2;\n3;\r4;'],
  ],
];

const counts = [];
for (const version of ['v17', 'v18']) {
  const oldApi = await load(beforeRoot, version);
  const newApi = await load(afterRoot, version);
  for (const [name, grammarSource, inputs] of families) {
    const oldGrammar = oldApi.grammar(grammarSource);
    const newGrammar = newApi.grammar(grammarSource);
    for (const input of inputs) {
      const oldResult = outcome(oldGrammar, input);
      const newResult = outcome(newGrammar, input);
      assert.deepEqual(newResult, oldResult, `${version}/${name}: ${JSON.stringify(input)}`);
    }
    for (const input of inputs.slice(0, 3)) {
      assert.deepEqual(
        outcome(newGrammar, input, true),
        outcome(oldGrammar, input, true),
        `${version}/${name}/trace: ${JSON.stringify(input)}`
      );
    }
    counts.push({version, name, matches: inputs.length, traces: Math.min(3, inputs.length)});
    console.error(`checked ${version}/${name}: ${inputs.length}`);
  }
  for (const family of ['prog', 'lex']) {
    for (const variant of family === 'prog' ? ['bang', 'bangTok'] : ['bang']) {
      const oldGrammar = oldApi.grammar(W.grammarSource(family, variant));
      const newGrammar = newApi.grammar(W.grammarSource(family, variant));
      let matches = 0;
      for (const shape of family === 'prog' ? ['blocks', 'flat'] : ['lines']) {
        for (const regime of ['valid', 'invalid-single', 'invalid-dense']) {
          for (const scale of [1, 3, 10]) {
            const {text} = W.inputFor(family, scale, shape, regime);
            assert.deepEqual(
              outcome(newGrammar, text),
              outcome(oldGrammar, text),
              `${version}/${family}/${variant}/${shape}/${regime}/${scale}`
            );
            matches++;
          }
        }
      }
      counts.push({version, name: `${family}/${variant}`, matches, traces: 0});
    }
  }
  let statefulMatches = 0;
  let statefulTraces = 0;
  const oldIndentation = (await load(beforeRoot, 'v17')).ExperimentalIndentationSensitive;
  const newIndentation = (await load(afterRoot, 'v17')).ExperimentalIndentationSensitive;
  for (const rule of [
    'Start = indent "x" dedent',
    'Start = indent indent "x" dedent',
    'Start = indent Item* dedent\n Item = letter ! ";"',
  ]) {
    const source = `G <: IndentationSensitive { ${rule} }`;
    const oldGrammar = oldApi.grammar(source, {IndentationSensitive: oldIndentation});
    const newGrammar = newApi.grammar(source, {IndentationSensitive: newIndentation});
    for (const input of ['  x', '    x', 'x', '  a;', '  1;', '  a;\n  1;', '  a; b;']) {
      assert.deepEqual(
        outcome(newGrammar, input),
        outcome(oldGrammar, input),
        `${version}/stateful/${rule}: ${JSON.stringify(input)}`
      );
      statefulMatches++;
      assert.deepEqual(
        outcome(newGrammar, input, true),
        outcome(oldGrammar, input, true),
        `${version}/stateful-trace/${rule}: ${JSON.stringify(input)}`
      );
      statefulTraces++;
    }
  }
  counts.push({
    version,
    name: 'stateful-indentation',
    matches: statefulMatches,
    traces: statefulTraces,
  });
}
const result = {
  beforeRoot,
  afterRoot,
  counts,
  matches: counts.reduce((sum, row) => sum + row.matches, 0),
  traces: counts.reduce((sum, row) => sum + row.traces, 0),
};
if (output) writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result));
