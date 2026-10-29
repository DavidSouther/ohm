// Markdown tables from results.json (see run.mjs).
import fs from 'node:fs';
import {WORKLOADS} from './workloads.mjs';

const ms = x =>
  x === null || x === undefined || !Number.isFinite(x)
    ? 'n/a'
    : x >= 100
      ? x.toFixed(0)
      : x >= 10
        ? x.toFixed(1)
        : x >= 1
          ? x.toFixed(2)
          : x.toFixed(3);
const pct = x => (Number.isFinite(x) ? `${(x * 100).toFixed(1)}%` : 'n/a');
const ratio = x => (Number.isFinite(x) ? `${x.toFixed(2)}x` : 'n/a');
const kb = x => (x === null || x === undefined ? 'n/a' : (x / 1024).toFixed(0));
const num = x => (x === null || x === undefined ? 'n/a' : x.toLocaleString('en-US'));

function table(head, rows) {
  const line = r => `| ${r.join(' | ')} |`;
  return [line(head), line(head.map(() => '---')), ...rows.map(line)].join('\n') + '\n';
}

/** Noise class: |ratio - 1| within the larger of the two cells' cross-process spread. */
export function classify(a, b) {
  if (!a || !b) return 'n/a';
  const r = a.stats.median / b.stats.median;
  const floor = Math.max(a.procSpread || 0, b.procSpread || 0, 0.02);
  if (Math.abs(r - 1) <= floor) return 'within noise';
  return r > 1 ? 'slower' : 'faster';
}

export function writeReport(R, file) {
  const out = [];
  const m = R.meta;
  const p = m.profileParams;
  out.push(`# Fallible overhead: report tables (${m.profile} profile)\n`);
  out.push('## Environment\n');
  out.push(
    table(
      ['item', 'value'],
      [
        ['Node / V8', `${m.node} / ${m.v8}`],
        ['platform', `${m.platform}, ${m.cpu}, ${m.cpus} logical CPUs, ${m.memGB} GB`],
        ['baseline', `${m.trees.baseline.commit.slice(0, 8)} (${m.trees.baseline.branch})`],
        ['fallible', `${m.trees.fallible.commit.slice(0, 8)} (${m.trees.fallible.branch})`],
        [
          'load average (1/5/15 min) at start',
          m.loadavgStart.map(x => x.toFixed(2)).join(' / '),
        ],
        ['load average at end', m.loadavgEnd.map(x => x.toFixed(2)).join(' / ')],
        ['busiest processes at start (%CPU command)', m.topProcsStart.slice(0, 4).join('; ')],
        ['busiest processes at end', m.topProcsEnd.slice(0, 4).join('; ')],
        ['started / finished', `${m.startedAt} / ${m.finishedAt}`],
        [
          'method',
          `${p.procs} alternating-order processes per tree; per cell: first call (cold), ` +
            `warmup >= ${p.warmupMs} ms, then >= ${p.minReps} timed calls within ` +
            `${p.budgetMs} ms (cap ${p.maxReps}); pooled over processes; ` +
            `scales ${p.scales.join(', ')}`,
        ],
      ]
    )
  );

  // ---- sanity
  out.push('## Sanity\n');
  out.push(
    table(
      ['check', 'result', 'detail'],
      R.sanity.map(c => [c.name, c.ok ? 'PASS' : 'FAIL', c.detail.slice(0, 160)])
    )
  );

  // ---- construction
  out.push('## Construction\n');
  out.push(
    'Median ms per call (IQR as a share of the median). `ratio` is fallible ' +
      '/ baseline on the same source; `bang vs plain` is the `!` source over ' +
      'its `!`-free twin on the fallible tree.\n'
  );
  const cons = new Map();
  for (const r of R.construction) cons.set(`${r.tree}|${r.name}|${r.op}`, r);
  const names = [...new Set(R.construction.map(r => r.name))];
  const ops = ['ohm.grammar', 'metagrammar-parse', 'toRecipe', 'makeRecipe'];
  const rows = [];
  for (const n of names) {
    for (const op of ops) {
      const b = cons.get(`baseline|${n}|${op}`);
      const f = cons.get(`fallible|${n}|${op}`);
      if (!b && !f) continue;
      const twinName = n.endsWith('-bang') ? n.replace('-bang', '-plain') : null;
      const twin = twinName ? cons.get(`fallible|${twinName}|${op}`) : null;
      rows.push([
        n,
        op,
        (b || f).bytes,
        b ? `${ms(b.stats.median)} (${pct(b.stats.iqrRel)})` : 'n/a',
        f ? `${ms(f.stats.median)} (${pct(f.stats.iqrRel)})` : 'n/a',
        b && f ? ratio(f.stats.median / b.stats.median) : 'n/a',
        b && f ? classify(f, b) : 'n/a',
        twin && f ? ratio(f.stats.median / twin.stats.median) : 'n/a',
      ]);
    }
  }
  out.push(
    table(
      [
        'source',
        'operation',
        'chars',
        'baseline ms',
        'fallible ms',
        'ratio',
        'class',
        'bang vs plain',
      ],
      rows
    )
  );
  out.push('### Construction phase breakdown (instrumented, 40 samples)\n');
  const bd = [];
  for (const tree of ['baseline', 'fallible']) {
    for (const r of R.breakdown[tree]) {
      bd.push([
        tree,
        r.name,
        ms(r.total.median),
        ms(r.parse.median),
        ms(r.declBuild.median),
        ms(r.total.median - r.parse.median - r.declBuild.median),
      ]);
    }
  }
  out.push(
    'Columns: total `ohm.grammar`; metagrammar parse of the source; ' +
      '`GrammarDecl.build` (analysis passes and `Grammar` construction); ' +
      'remainder (semantic actions and `Builder`). Timer wrappers add ' +
      'overhead; ratios, not absolutes, are informative.\n'
  );
  out.push(
    table(
      ['tree', 'source', 'total ms', 'parse ms', 'decl.build ms', 'actions+builder ms'],
      bd
    )
  );

  out.push('### Load and cold start\n');
  out.push(
    table(
      ['tree', 'import `index.mjs` median ms', 'IQR', 'launches'],
      R.load.map(l => [l.tree, ms(l.stats.median), pct(l.stats.iqrRel), l.stats.n])
    )
  );
  out.push('Cold: first calls in a fresh process at scale 10 (median over launches).\n');
  out.push(
    table(
      ['tree', 'case', 'grammar build ms', '1st match ms', '2nd ms', '6th ms', 'launches'],
      R.cold.map(c => [
        c.tree,
        c.case,
        ms(c.buildMs),
        ms(c.call1),
        ms(c.call2),
        ms(c.call6),
        c.n,
      ])
    )
  );

  // ---- matching
  out.push('## Matching\n');
  out.push(
    'Cells show median ms, then the ratio to the baseline tree matching the ' +
      'valid input of the same size with the plain grammar. Invalid-input rows ' +
      'therefore state the cost of an input of the same size, not of the same ' +
      'text. Fail rows (`plain/match`, `bang/match` on invalid input) stop at ' +
      'the first error. `n/a` marks configurations that do not exist on the ' +
      'baseline.\n'
  );
  // `plain/match` cells come from the clean processes (no recovering match ever ran there);
  // every other configuration comes from the all-configurations processes.
  const sub = config =>
    config === 'plain/match' || config === 'plain/match+message' ? 'clean' : 'all';
  const M = new Map();
  for (const r of R.matching) {
    M.set(
      `${r.tree}|${r.subset}|${r.family}|${r.shape}|${r.workloadRegime}|${r.config}|${r.scale}`,
      r
    );
  }
  const scales = [...new Set(R.matching.map(r => r.scale))].sort((a, b) => a - b);
  const get = (tree, w, config, scale, subset = sub(config)) =>
    M.get(`${tree}|${subset}|${w.family}|${w.shape}|${w.regime}|${config}|${scale}`);
  const configCols = [
    ['baseline', 'plain/match'],
    ['fallible', 'plain/match'],
    ['fallible', 'plain/recover'],
    ['fallible', 'bang/match'],
    ['fallible', 'bang/recover'],
    ['fallible', 'bangTok/recover'],
  ];
  for (const w of WORKLOADS) {
    out.push(`### ${w.family} / ${w.shape} / ${w.regime}\n`);
    const refW = {...w, regime: 'valid'};
    const rowsM = scales.map(s => {
      const ref = get('baseline', refW, 'plain/match', s);
      const any =
        get('fallible', w, 'bang/recover', s) || get('fallible', w, 'plain/match', s);
      const cells = configCols.map(([tree, cfg]) => {
        const r = get(tree, w, cfg, s);
        if (!r) return 'n/a';
        return `${ms(r.stats.median)} (${ratio(r.stats.median / ref.stats.median)})`;
      });
      return [s, any ? any.inputChars : '', ...cells];
    });
    const growth = configCols.map(([tree, cfg]) => {
      const r = get(tree, w, cfg, scales[0]);
      return r ? `${r.growthExponent.toFixed(2)} / ${r.tailExponent.toFixed(2)}` : 'n/a';
    });
    rowsM.push(['growth exp. (all / last two)', '', ...growth]);
    out.push(
      table(
        [
          'scale',
          'chars',
          'base plain/match',
          'fb plain/match',
          'fb plain/recover',
          'fb bang/match',
          'fb bang/recover',
          'fb bangTok/recover',
        ],
        rowsM
      )
    );
  }

  out.push('### Regression check: identical grammar without `!` (fallible / baseline)\n');
  const reg = [];
  for (const w of WORKLOADS) {
    for (const s of scales) {
      const b = get('baseline', w, 'plain/match', s);
      const f = get('fallible', w, 'plain/match', s);
      if (!b || !f) continue;
      const fa = get('fallible', w, 'plain/match', s, 'all');
      const ba = get('baseline', w, 'plain/match', s, 'all');
      reg.push([
        `${w.family}/${w.shape}/${w.regime}`,
        s,
        ms(b.stats.median),
        ms(f.stats.median),
        ratio(f.stats.median / b.stats.median),
        pct(Math.max(b.procSpread, f.procSpread)),
        classify(f, b),
        fa && ba ? ratio(fa.stats.median / ba.stats.median) : 'n/a',
      ]);
    }
  }
  out.push(
    'Primary columns use the clean processes (only `plain/match` cells ' +
      'executed). The last column repeats the ratio from the ' +
      'all-configurations processes, where the fallible process has also run ' +
      'recovering cells before: the difference between the two ratios is the ' +
      'cost of JIT history in a mixed process, not of the engine change.\n'
  );
  out.push(
    table(
      [
        'workload',
        'scale',
        'baseline ms',
        'fallible ms',
        'ratio',
        'cross-process spread (max)',
        'class',
        'ratio in mixed process',
      ],
      reg
    )
  );

  out.push('### Overhead of `!` without and with recovery on valid input (fallible tree)\n');
  const ov = [];
  for (const w of WORKLOADS.filter(w => w.regime === 'valid')) {
    for (const s of scales) {
      const base = get('fallible', w, 'plain/match', s, 'all');
      const row = [`${w.family}/${w.shape}`, s, ms(base.stats.median)];
      for (const cfg of ['plain/recover', 'bang/match', 'bang/recover', 'bangTok/recover']) {
        const r = get('fallible', w, cfg, s);
        row.push(
          r ? `${ratio(r.stats.median / base.stats.median)} (${classify(r, base)})` : 'n/a'
        );
      }
      ov.push(row);
    }
  }
  out.push(
    'Ratios are to `plain/match` measured in the same (all-configurations) ' +
      'fallible process, same input, but not interleaved; see report-paired.md ' +
      'for interleaved ratios.\n'
  );
  out.push(
    table(
      [
        'workload',
        'scale',
        'plain/match ms',
        'plain/recover',
        'bang/match',
        'bang/recover',
        'bangTok/recover',
      ],
      ov
    )
  );

  out.push(
    '### Failed match with message (forces the rightmost-failure re-match), ' +
      'prog/blocks/invalid-single\n'
  );
  const fm = [];
  for (const s of scales) {
    const b = M.get(`baseline|clean|prog|blocks|invalid-single|plain/match+message|${s}`);
    const f = M.get(`fallible|clean|prog|blocks|invalid-single|plain/match+message|${s}`);
    const g = M.get(`fallible|all|prog|blocks|invalid-single|bang/match+message|${s}`);
    if (b && f && g) {
      fm.push([
        s,
        ms(b.stats.median),
        ms(f.stats.median),
        ratio(f.stats.median / b.stats.median),
        classify(f, b),
        ms(g.stats.median),
        ratio(g.stats.median / f.stats.median),
      ]);
    }
  }
  out.push(
    table(
      ['scale', 'baseline ms', 'fb plain ms', 'ratio', 'class', 'fb bang ms', 'bang/plain'],
      fm
    )
  );

  out.push(
    '### Recovering match plus lazy diagnostics (`getRecoveredFailures()`), prog/blocks\n'
  );
  const dg = [];
  for (const regime of ['invalid-single', 'invalid-dense']) {
    for (const s of scales) {
      const r = M.get(`fallible|all|prog|blocks|${regime}|bang/recover|${s}`);
      const d = M.get(`fallible|all|prog|blocks|${regime}|bang/recover+diag|${s}`);
      if (r && d) {
        dg.push([
          regime,
          s,
          ms(r.stats.median),
          ms(d.stats.median),
          ratio(d.stats.median / r.stats.median),
        ]);
      }
    }
  }
  out.push(
    table(['regime', 'scale', 'bang/recover ms', 'bang/recover + diagnostics ms', 'ratio'], dg)
  );

  // ---- counters
  out.push('## Counters\n');
  out.push(
    'Deterministic work counts for one match (instrumented run, not timed). ' +
      '`evals` = `MatchState.eval` calls; `apps` = `Apply.reallyEval` calls ' +
      '(memo misses); `hits`/`stores` = memo hits and stores; `states` = ' +
      '`MatchState` pass instances; `rematch` = `Matcher._match` calls (1 + ' +
      'one rightmost-failure re-match per failed pass); `recover` and `scan` = ' +
      'calls; `scanEv` = evals inside scans; `recEv` = evals in `recover` ' +
      'outside scans (prefix re-evaluation); `choose` = attempts visited by ' +
      '`chooseAttempt`; `inval` = positions walked by memo invalidation; `rec` ' +
      '= recovered failures reported; `passes` = permits + 1 (cross-checked ' +
      'against `states - (rematch - 1)`). `hits` and `stores` include ' +
      'left-recursion seed reads and stores (the expression rules are ' +
      'left-recursive) and do not count tainted or invalidated entries ' +
      'dropped.\n'
  );
  const crow = R.counters
    .filter(c => !(c.family === 'prog' && c.shape === 'flat') || c.workloadRegime !== 'valid')
    .map(c => [
      c.tree,
      `${c.family}/${c.shape}/${c.workloadRegime}`,
      c.config,
      c.scale,
      c.injected,
      c.succeeded ? 'ok' : 'FAIL',
      num(c.counts.evals),
      num(c.counts.applyReallyEval),
      num(c.counts.memoHits),
      num(c.counts.memoStores),
      num(c.counts.matchStates),
      num(c.counts.matchCalls),
      num(c.counts.recoverCalls),
      num(c.counts.scanCalls),
      num(c.counts.evalsInScan),
      num(c.counts.evalsInRecover),
      num(c.counts.chooseAttemptScanned),
      num(c.counts.invalidateWalked),
      c.recovered === null ? '-' : c.recovered,
      c.passes === null ? '-' : c.passes,
    ]);
  out.push(
    table(
      [
        'tree',
        'workload',
        'config',
        'scale',
        'inj',
        'result',
        'evals',
        'apps',
        'hits',
        'stores',
        'states',
        'rematch',
        'recover',
        'scan',
        'scanEv',
        'recEv',
        'choose',
        'inval',
        'rec',
        'passes',
      ],
      crow
    )
  );

  // ---- memory
  out.push('## Memory\n');
  out.push(
    'prog/blocks only. `alloc` = heap growth during one match with a 256 MB ' +
      'semi-space (no scavenge; samples that saw a GC are discarded). ' +
      '`retained` = heap growth after a forced GC with the result alive (CST ' +
      'plus the memo table held by the matcher). KB, median over repetitions. ' +
      'Ratio is to the baseline tree plain/match valid at the same scale.\n'
  );
  const MM = new Map(
    R.memory.map(r => [`${r.tree}|${r.workloadRegime}|${r.config}|${r.scale}`, r])
  );
  const mrows = R.memory.map(r => {
    const ref = MM.get(`baseline|valid|plain/match|${r.scale}`);
    return [
      r.tree,
      `${r.workloadRegime}`,
      r.config,
      r.scale,
      r.inputChars,
      kb(r.allocBytesMedian),
      kb(r.retainedBytesMedian),
      ref && r.workloadRegime === 'valid'
        ? `${ratio(r.allocBytesMedian / ref.allocBytesMedian)} / ` +
          ratio(r.retainedBytesMedian / ref.retainedBytesMedian)
        : '-',
      `${r.discarded}/${r.reps}`,
    ];
  });
  out.push(
    table(
      [
        'tree',
        'regime',
        'config',
        'scale',
        'chars',
        'alloc KB',
        'retained KB',
        'alloc / retained vs baseline',
        'GC-discarded',
      ],
      mrows
    )
  );

  // ---- incremental
  out.push('## Incremental\n');
  out.push(
    'Plain grammar, prog/blocks/valid. `edit-one-char+match` replaces one ' +
      'digit in the middle and re-matches on the same matcher; ' +
      '`rematch-unchanged` re-matches with the memo table intact; ' +
      '`fresh-match` builds a new matcher.\n'
  );
  const IM = new Map(R.incremental.map(r => [`${r.tree}|${r.name}|${r.scale}`, r]));
  const irows = [];
  for (const r of R.incremental.filter(r => r.tree === 'fallible')) {
    const b = IM.get(`baseline|${r.name}|${r.scale}`);
    irows.push([
      r.name,
      r.scale,
      r.inputChars,
      b ? ms(b.stats.median) : 'n/a',
      ms(r.stats.median),
      b ? ratio(r.stats.median / b.stats.median) : 'n/a',
      b ? classify(r, b) : 'n/a',
      r.agrees && (!b || b.agrees) ? 'yes' : 'NO',
    ]);
  }
  out.push(
    table(
      [
        'operation',
        'scale',
        'chars',
        'baseline ms',
        'fallible ms',
        'ratio',
        'class',
        'edit == fresh',
      ],
      irows
    )
  );

  fs.writeFileSync(file, out.join('\n'));
}
