#!/usr/bin/env node
// Reproduces every operation count quoted in ../paper.md.
//   node scripts/experiments.mjs            -> JSON on stdout
//   node scripts/experiments.mjs --pretty   -> one line per row
// Counts: `evals` = MatchState#eval calls; `passes` = primary match runs;
// `msg` = failure-message match runs (positionToRecordFailures set).
/* global process */
/* eslint no-console: off */
import {counters, fallibleFingerprint, FALLIBLE_COMMIT, BASELINE_COMMIT} from './counter.mjs';

async function main() {
  const {branch, baseline} = await counters();

  const R = {recover: true};
  const out = {};
  const ratio = (a, b) => (b ? (a / b).toFixed(2) : '-');

  // ---------------------------------------------------------------- grammars
  const HDL = String.raw`Hdl {
  Chip = "CHIP" name "{" Parts "}"
  Parts = "PARTS:" Part* ! &"}"
  Part = PartBody ! ";"
  PartBody = name "(" ListOf<Wire, ","> ")"
  Wire = name "=" name
  name = letter alnum*
}`;
  const HDL_PLAIN = HDL.replace('Part* ! &"}"', 'Part* &"}"').replace(
    'PartBody ! ";"',
    'PartBody ";"'
  );
  // The desugaring δ(B ! C) = (B C): a parenthesized, unflattened sequence.
  const HDL_DESUGARED = HDL.replace('Part* ! &"}"', '(Part* &"}")').replace(
    'PartBody ! ";"',
    '(PartBody ";")'
  );

  function chip(n, broken = new Set()) {
    const parts = [];
    for (let i = 0; i < n; i++) {
      parts.push(
        broken.has(i) ? `  Nand(a=a b=b, out=w${i});` : `  Nand(a=a, b=b, out=w${i});`
      );
    }
    return `CHIP Big {\n PARTS:\n${parts.join('\n')}\n}\n`;
  }
  function spread(n, k) {
    const b = new Set();
    for (let i = 0; i < k; i++) b.add(Math.floor((i * n) / k));
    return b;
  }

  // ------------------------------------------- E0: zero-fallible grammars, G1 + G2
  {
    const rows = [];
    for (const [name, src] of [
      ['HDL (no !)', HDL_PLAIN],
      ['HDL (with !)', HDL],
    ]) {
      const b = name.includes('with')
        ? null
        : baseline.measure(() => baseline.ohm.grammar(src));
      const f = branch.measure(() => branch.ohm.grammar(src));
      rows.push({
        phase: 'construct',
        grammar: name,
        baseline: b ? b.evals : '-',
        branch: f.evals,
      });
    }
    const gb = baseline.ohm.grammar(HDL_PLAIN);
    const gf = branch.ohm.grammar(HDL_PLAIN);
    for (const n of [60, 240]) {
      const input = chip(n);
      const b = baseline.measure(() => gb.match(input));
      const f = branch.measure(() => gf.match(input));
      rows.push({
        phase: `match n=${input.length}`,
        grammar: 'HDL (no !)',
        baseline: b.evals,
        branch: f.evals,
      });
    }
    out.E0 = {description: 'evaluation counts, baseline vs branch', rows};
  }

  // ------------------------------------------- E1: valid input, fallible grammar
  {
    const gp = branch.ohm.grammar(HDL_DESUGARED);
    const gh = branch.ohm.grammar(HDL);
    const rows = [];
    for (const n of [60, 120, 240]) {
      const input = chip(n);
      const desugared = branch.measure(() => gp.match(input)).evals;
      const plain = branch.measure(() => gh.match(input)).evals;
      const rec = branch.measure(() => gh.match(input, undefined, R));
      rows.push({
        n: input.length,
        desugared,
        'plain mode': plain,
        'recover mode': rec.evals,
        passes: rec.passes,
      });
    }
    out.E1 = {description: 'valid HDL input', rows};
  }

  // ------------------------------------------- E2: flat list, k errors (typical case)
  {
    const gh = branch.ohm.grammar(HDL);
    const rows = [];
    const parts = 240;
    let base;
    for (const k of [0, 1, 2, 4, 8, 16, 32, 64]) {
      const input = chip(parts, spread(parts, k));
      const r = branch.measure(() => gh.match(input, undefined, R));
      base = base ?? r.evals;
      rows.push({
        k,
        passes: r.passes,
        msg: r.messagePasses,
        evals: r.evals,
        'evals/base': ratio(r.evals, base),
        reported: r.value.getRecoveredFailures().length,
      });
    }
    out.E2 = {description: `HDL chip with ${parts} parts, k broken parts`, rows};
    // Least-squares fit of the excess evaluations, evals(k) - evals(0) = a*k + b*k^2, over k >= 1.
    const pts = rows.filter(r => r.k > 0).map(r => [r.k, r.evals - base]);
    let s11 = 0;
    let s12 = 0;
    let s22 = 0;
    let t1 = 0;
    let t2 = 0;
    for (const [k, y] of pts) {
      s11 += k * k;
      s12 += k ** 3;
      s22 += k ** 4;
      t1 += k * y;
      t2 += k * k * y;
    }
    const det = s11 * s22 - s12 * s12;
    const a = (t1 * s22 - t2 * s12) / det;
    const b = (s11 * t2 - s12 * t1) / det;
    const maxRel = Math.max(
      ...pts.filter(([k]) => k >= 8).map(([k, y]) => Math.abs(a * k + b * k * k - y) / y)
    );
    out.E2fit = {
      description: 'least-squares fit of E2 excess evaluations',
      rows: [
        {
          a: a.toFixed(0),
          b: b.toFixed(1),
          'max rel. error (k>=8)': (100 * maxRel).toFixed(1) + '%',
        },
      ],
    };
  }

  // ------------------------------------------- E3: one recovery under backtracking
  {
    const g = branch.ohm.grammar(String.raw`G {
  S = E end
  E = "(" E ")" "a" -- a
    | "(" E ")" "b" -- b
    | X
  X = "x" ! ";"
}`);
    const rows = [];
    let prev;
    for (const d of [1, 2, 4, 6, 8, 10]) {
      const valid = '('.repeat(d) + 'x;' + ')b'.repeat(d);
      const broken = '('.repeat(d) + 'y;' + ')b'.repeat(d);
      const p = branch.measure(() => g.match(valid)).evals;
      const r = branch.measure(() => g.match(broken, undefined, R));
      rows.push({
        d,
        'valid, plain': p,
        'one error, recover': r.evals,
        passes: r.passes,
        'ratio vs d-2': prev ? ratio(r.evals, prev) : '-',
      });
      prev = r.evals;
    }
    out.E3 = {
      description: 'single recovery below a two-way backtracking nest of depth d',
      rows,
    };
  }

  // ------------------------------------------- E4: nested blocks missing closers
  {
    const g = branch.ohm.grammar(String.raw`G {
  S = Stmt*
  Block = "{" Stmt* ! "}"
  Stmt = Block | Simple
  Simple = "x" ";"
}`);
    const rows = [];
    let prev;
    for (const d of [1, 2, 4, 6, 8, 10]) {
      const valid = '{'.repeat(d) + 'x;' + '}'.repeat(d);
      const broken = '{'.repeat(d) + 'x;';
      const v = branch.measure(() => g.match(valid, undefined, R)).evals;
      const r = branch.measure(() => g.match(broken, undefined, R));
      rows.push({
        d,
        'valid, recover': v,
        'd missing, recover': r.evals,
        passes: r.passes,
        msg: r.messagePasses,
        reported: r.value.getRecoveredFailures().length,
        'ratio vs d-2': prev ? ratio(r.evals, prev) : '-',
      });
      prev = r.evals;
    }
    out.E4 = {description: 'd nested blocks, each missing its closer', rows};
  }

  // ------------------------------------------- E5: fallible under a predicate, valid input
  {
    const g = branch.ohm.grammar(String.raw`G {
  S = E end
  E = &P "(" E ")" "a" -- a
    | &P "(" E ")" "b" -- b
    | "x"
  P = "(" ! any
}`);
    const rows = [];
    let prev;
    for (const d of [1, 2, 4, 6, 8, 10]) {
      const valid = '('.repeat(d) + 'x' + ')b'.repeat(d);
      const p = branch.measure(() => g.match(valid)).evals;
      const r = branch.measure(() => g.match(valid, undefined, R));
      rows.push({
        d,
        'plain mode': p,
        'recover mode': r.evals,
        passes: r.passes,
        'ratio vs d-2': prev ? ratio(r.evals, prev) : '-',
      });
      prev = r.evals;
    }
    out.E5 = {description: 'fallible inside &, valid input', rows};
  }

  // ------------------------------------------- E6: left recursion with k errors
  {
    const g = branch.ohm.grammar(String.raw`G {
  S = E end
  E = E "+" Item -- plus
    | Item
  Item = letter ! ";"
}`);
    const rows = [];
    const m = 64;
    for (const k of [0, 1, 2, 4, 8, 16]) {
      const bad = spread(m, k);
      const items = [];
      for (let i = 0; i < m; i++) items.push(bad.has(i) ? '1;' : 'a;');
      const input = items.join('+');
      const r = branch.measure(() => g.match(input, undefined, R));
      rows.push({
        k,
        passes: r.passes,
        msg: r.messagePasses,
        evals: r.evals,
        reported: r.value.getRecoveredFailures().length,
      });
    }
    out.E6 = {description: `left-recursive sum of ${m} items, k broken`, rows};
  }

  // ------------------------------------------- E7: pass count Θ(n) family (Corollary 3)
  {
    const g = branch.ohm.grammar(String.raw`G {
  S = Item* end
  Item = "a" ! ";"
}`);
    const rows = [];
    for (const k of [1, 4, 16, 64]) {
      const input = 'b;'.repeat(k) + 'a;'.repeat(k);
      const r = branch.measure(() => g.match(input, undefined, R));
      rows.push({
        n: input.length,
        k,
        passes: r.passes,
        reported: r.value.getRecoveredFailures().length,
      });
    }
    out.E7 = {description: 'k broken items among 2k, Item = "a" ! ";"', rows};
  }

  out._meta = {
    branchHead: FALLIBLE_COMMIT.slice(0, 8),
    branchCommit: FALLIBLE_COMMIT,
    branchSource: 'benchmarks/fallible/fixtures/fallible-before-reuse',
    branchFingerprint: fallibleFingerprint(),
    baseline: BASELINE_COMMIT,
    node: process.version,
  };

  if (process.argv.includes('--pretty')) {
    for (const [id, exp] of Object.entries(out)) {
      if (id === '_meta') continue;
      console.log(`${id}: ${exp.description}`);
      for (const row of exp.rows) console.log('  ' + JSON.stringify(row));
    }
    console.log(JSON.stringify(out._meta));
  } else {
    console.log(JSON.stringify(out));
  }
}
main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
