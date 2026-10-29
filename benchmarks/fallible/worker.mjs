#!/usr/bin/env node
/**
 * One benchmark worker process, bound to one Ohm source tree.
 *
 *   node worker.mjs --tree=<root> --label=baseline|fallible --mode=<mode>
 *     --profile=smoke|full
 *
 * Modes: timing (matching, construction, incremental), counters (work counters and
 * outcomes, instrumented), memory (needs --expose-gc), load, cold.
 * Prints one JSON document on the last line of stdout.
 */
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {PerformanceObserver, performance} from 'node:perf_hooks';
import v8 from 'node:v8';
import {PROFILES} from './lib/profiles.mjs';
import {summarize} from './lib/stats.mjs';
import * as W from './lib/workloads.mjs';
import {treeMetadata, FALLIBLE_COMMIT, BASELINE_COMMIT} from './lib/trees.mjs';

const args = Object.fromEntries(
  process.argv.slice(2).map(a => {
    const [k, ...v] = a.replace(/^--/, '').split('=');
    return [k, v.join('=') || true];
  })
);
const treeRoot = args.tree;
const {label} = args;
const {mode} = args;
const prof = PROFILES[args.profile || 'smoke'];
// 'clean' runs plain matching, construction and incremental; 'all' runs every configuration.
const subset = args.subset || 'all';
const sharedOhmGrammar = args.ohmgrammar; // one copy of ohm-grammar.ohm for both trees
const pkg = path.join(treeRoot, 'packages/ohm-js');
const now = () => performance.now();

const tImport0 = now();
const ohm = await import(pathToFileURL(path.join(pkg, 'index.mjs')).href);
const importMs = now() - tImport0;
const isBaseline = label === 'baseline';

const grammarCache = new Map();
function getGrammar(family, variant) {
  const k = family + '|' + variant;
  if (!grammarCache.has(k)) grammarCache.set(k, ohm.grammar(W.grammarSource(family, variant)));
  return grammarCache.get(k);
}
const inputCache = new Map();
function getInput(c, scale) {
  const k = `${c.family}|${c.shape}|${c.regime}|${scale}`;
  if (!inputCache.has(k)) inputCache.set(k, W.inputFor(c.family, scale, c.shape, c.regime));
  return inputCache.get(k);
}
function runMatch(c, text) {
  const g = getGrammar(c.family, c.variant);
  return c.recover ? g.match(text, undefined, {recover: true}) : g.match(text);
}

// -------------------------------------------------------------------
// Timing
// -------------------------------------------------------------------

function measure(fn, p, budgetMs = p.budgetMs) {
  const t0 = now();
  fn();
  const cold = now() - t0;
  const wEnd = now() + p.warmupMs;
  let w = 0;
  while (now() < wEnd || w < (cold > 200 ? 0 : 3)) {
    fn();
    w++;
  }
  const samples = [];
  const start = now();
  for (;;) {
    const a = now();
    fn();
    samples.push(now() - a);
    const el = now() - start;
    if (samples.length >= p.maxReps) break;
    if (el >= budgetMs && samples.length >= p.minReps) break;
    if (el >= p.hardCapMs && samples.length >= 3) break;
  }
  return {samples, warmupCalls: w};
}

function timingMode() {
  const out = {matching: [], construction: [], incremental: []};
  const clean = subset === 'clean';
  // Matching. In the clean subset only the `plain/match` cells run, so that the
  // process has never executed a recovering match (no JIT or inline-cache history
  // from the fallible paths) and is comparable with the baseline tree's process.
  for (const c of W.matchCases(label)) {
    if (clean && c.config !== 'plain/match') continue;
    for (const scale of prof.scales) {
      const input = getInput(c, scale);
      let sink = 0;
      const {samples, warmupCalls} = measure(() => {
        const r = runMatch(c, input.text);
        sink += r.succeeded() ? 1 : 0;
      }, prof);
      out.matching.push({
        ...c,
        subset,
        scale,
        inputChars: input.text.length,
        injected: input.errors,
        warmupCalls,
        samples,
      });
      if (sink < 0) console.log(sink); // keep `sink` alive
    }
  }
  // Failed match with message (forces the rightmost-failure re-match), and the lazy
  // diagnostics of a recovering match.
  const extras = clean
    ? ['plain/match+message']
    : ['bang/match+message', 'bang/recover+diag', 'bangTok/recover+diag'];
  for (const config of extras) {
    if (isBaseline && !clean) continue;
    const [base, op] = config.split('+');
    const variant = base.split('/')[0];
    const c = {
      family: 'prog',
      shape: 'blocks',
      regime: 'invalid-single',
      config,
      variant,
      recover: base.endsWith('/recover'),
    };
    for (const regime of op === 'diag'
      ? ['invalid-single', 'invalid-dense']
      : ['invalid-single']) {
      const cc = {...c, regime};
      for (const scale of prof.scales) {
        const input = getInput(cc, scale);
        const {samples, warmupCalls} = measure(() => {
          const r = runMatch(cc, input.text);
          if (op === 'message') void r.message;
          else r.getRecoveredFailures();
        }, prof);
        out.matching.push({
          ...cc,
          subset,
          scale,
          inputChars: input.text.length,
          injected: input.errors,
          warmupCalls,
          samples,
        });
      }
    }
  }
  if (clean) {
    // Construction and incremental re-match, also in the clean process.
    out.construction = constructionCases().map(cc => {
      const {samples} = measure(
        cc.fn,
        {...prof, minReps: prof.constructReps, warmupMs: Math.min(prof.warmupMs, 150)},
        prof.constructBudgetMs
      );
      return {name: cc.name, op: cc.op, group: cc.group, bytes: cc.bytes, samples};
    });
    for (const scale of prof.incrScales) {
      out.incremental.push(...incrementalCases(scale, prof));
    }
  }
  return out;
}

function constructionCases() {
  const cases = [];
  const add = (group, name, op, fn, bytes) => cases.push({group, name, op, fn, bytes});
  const srcs = [
    ['prog-plain', W.progGrammar('plain')],
    ['ohm-grammar.ohm', fs.readFileSync(sharedOhmGrammar, 'utf8')],
  ];
  if (!isBaseline) srcs.push(['prog-bang', W.progGrammar('bang')]);
  for (const n of prof.synthetic) {
    srcs.push([`syn${n}-plain`, W.syntheticGrammar(n, false)]);
    if (!isBaseline) srcs.push([`syn${n}-bang`, W.syntheticGrammar(n, true)]);
  }
  for (const [name, src] of srcs) {
    add('construction', name, 'ohm.grammar', () => ohm.grammar(src), src.length);
    add(
      'construction',
      name,
      'metagrammar-parse',
      () => ohm.ohmGrammar.match(src),
      src.length
    );
    const g = ohm.grammar(src);
    add('construction', name, 'toRecipe', () => g.toRecipe(), src.length);
    const recipe = (0, eval)(g.toRecipe());
    add('construction', name, 'makeRecipe', () => ohm.makeRecipe(recipe), src.length);
  }
  return cases;
}

function incrementalCases(scale, p) {
  const c = {
    family: 'prog',
    shape: 'blocks',
    regime: 'valid',
    variant: 'plain',
    recover: false,
  };
  const {text} = getInput(c, scale);
  const g = getGrammar('prog', 'plain');
  // A digit near the middle of the input.
  const pos = text.indexOf('+ 1)', Math.floor(text.length / 2));
  const digitPos = pos + 2;
  const rows = [];
  const m = g.matcher();
  m.setInput(text);
  m.match();
  let flip = 0;
  const edit = measure(() => {
    flip ^= 1;
    m.replaceInputRange(digitPos, digitPos + 1, flip ? '7' : '1');
    m.match();
  }, p);
  rows.push({
    name: 'edit-one-char+match',
    scale,
    inputChars: text.length,
    samples: edit.samples,
  });
  const same = measure(() => {
    m.match();
  }, p);
  rows.push({
    name: 'rematch-unchanged',
    scale,
    inputChars: text.length,
    samples: same.samples,
  });
  const fresh = measure(() => {
    g.match(text);
  }, p);
  rows.push({name: 'fresh-match', scale, inputChars: text.length, samples: fresh.samples});
  // Correctness: an incremental match after an edit equals a fresh match of the edited text.
  const m2 = g.matcher();
  m2.setInput(text);
  m2.match();
  const edited = text.slice(0, digitPos) + '7' + text.slice(digitPos + 1);
  m2.replaceInputRange(digitPos, digitPos + 1, '7');
  const inc = m2.match();
  const ref = g.match(edited);
  const equal =
    inc.succeeded() && ref.succeeded() && W.signature(inc._cst) === W.signature(ref._cst);
  for (const r of rows) r.agrees = equal;
  return rows;
}

// -------------------------------------------------------------------
// Counters (instrumented; never used for timing)
// -------------------------------------------------------------------

async function countersMode() {
  const src = n => pathToFileURL(path.join(pkg, 'src', n)).href;
  const {MatchState} = await import(src('MatchState.js'));
  const {Matcher} = await import(src('Matcher.js'));
  const {PosInfo} = await import(src('PosInfo.js'));
  const pexprs = await import(src('pexprs.js'));
  let rec = null;
  try {
    rec = await import(src('Recovery.js'));
  } catch {
    rec = null;
  }

  const metadata = treeMetadata(treeRoot);
  const pinned = metadata.commit.startsWith(isBaseline ? BASELINE_COMMIT : FALLIBLE_COMMIT);
  // These two counts estimate work in the original full-scan implementation.
  // A newer engine's indexes change that work; report unavailable rather than inventing counts.
  const historicalScans = pinned && !metadata.status.includes('packages/ohm-js/');
  const C = {};
  const reset = () => {
    for (const k of Object.keys(C)) if (C[k] !== null) C[k] = 0;
  };
  const init = () => {
    Object.assign(C, {
      evals: 0,
      applyReallyEval: 0,
      memoHits: 0,
      memoStores: 0,
      matchCalls: 0,
      matchStates: 0,
      scanCalls: 0,
      recoverCalls: 0,
      evalsInScan: 0,
      evalsInRecover: 0,
      chooseAttemptScanned: historicalScans ? 0 : null,
      invalidateWalked: historicalScans ? 0 : null,
      fallibleEvals: 0,
    });
  };
  init();
  const wrap = (obj, name, fn) => {
    const orig = obj[name];
    if (typeof orig !== 'function') return false;
    obj[name] = function (...a) {
      return fn.call(this, orig, a);
    };
    return true;
  };
  wrap(MatchState.prototype, 'eval', function (orig, a) {
    C.evals++;
    return orig.apply(this, a);
  });
  wrap(MatchState.prototype, 'getMatchResult', function (orig, a) {
    C.matchStates++;
    return orig.apply(this, a);
  });
  wrap(MatchState.prototype, 'useMemoizedResult', function (orig, a) {
    C.memoHits++;
    return orig.apply(this, a);
  });
  wrap(pexprs.Apply.prototype, 'reallyEval', function (orig, a) {
    C.applyReallyEval++;
    return orig.apply(this, a);
  });
  wrap(PosInfo.prototype, 'memoize', function (orig, a) {
    C.memoStores++;
    return orig.apply(this, a);
  });
  wrap(Matcher.prototype, '_match', function (orig, a) {
    C.matchCalls++;
    return orig.apply(this, a);
  });
  wrap(Matcher.prototype, '_invalidateMemoEntries', function (orig, a) {
    if (C.invalidateWalked !== null) {
      C.invalidateWalked += Math.min(a[1], this._memoTable.length);
    }
    return orig.apply(this, a);
  });
  if (pexprs.Fallible) {
    wrap(pexprs.Fallible.prototype, 'eval', function (orig, a) {
      C.fallibleEvals++;
      return orig.apply(this, a);
    });
    wrap(pexprs.Fallible.prototype, 'scan', function (orig, a) {
      C.scanCalls++;
      const e0 = C.evals;
      try {
        return orig.apply(this, a);
      } finally {
        C.evalsInScan += C.evals - e0;
      }
    });
    wrap(pexprs.Fallible.prototype, 'recover', function (orig, a) {
      C.recoverCalls++;
      const e0 = C.evals;
      const s0 = C.evalsInScan;
      try {
        return orig.apply(this, a);
      } finally {
        C.evalsInRecover += C.evals - e0 - (C.evalsInScan - s0);
      }
    });
  }
  if (rec && rec.RecoveryContext) {
    wrap(rec.RecoveryContext.prototype, 'chooseAttempt', function (orig, a) {
      if (C.chooseAttemptScanned !== null) C.chooseAttemptScanned += this.attempts.size;
      return orig.apply(this, a);
    });
  }

  const rows = [];
  // Build every grammar before counting, so that grammar construction (which itself
  // runs matches on the meta-grammar) is not attributed to the first match.
  for (const c of W.matchCases(label)) getGrammar(c.family, c.variant);
  for (const c of W.matchCases(label)) {
    for (const scale of prof.counterScales) {
      const input = getInput(c, scale);
      reset();
      const r = runMatch(c, input.text);
      const succeeded = r.succeeded();
      const counts = {...C};
      let recovered = null;
      let passes = null;
      if (r._recovery) {
        passes = r._recovery.permitted.size + 1;
      }
      let finalEmpty = null;
      if (typeof r.getRecoveredFailures === 'function') {
        const fs_ = r.getRecoveredFailures();
        recovered = fs_.length;
        if (!succeeded) {
          finalEmpty = fs_.length === 1 && fs_[0].interval.startIdx === fs_[0].interval.endIdx;
        }
      }
      let sig = null;
      let nodes = null;
      if (succeeded) {
        sig = W.signature(r._cst);
        nodes = W.countNodes(r._cst);
      }
      rows.push({
        ...c,
        scale,
        injected: input.errors,
        succeeded,
        sig,
        nodes,
        recovered,
        finalEmpty,
        passes,
        message: succeeded ? null : r.shortMessage,
        counts,
      });
    }
  }
  return {counters: rows};
}

// -------------------------------------------------------------------
// Memory
// -------------------------------------------------------------------

async function memoryMode() {
  if (typeof globalThis.gc !== 'function') throw new Error('memory mode requires --expose-gc');
  const gcEntries = [];
  const obs = new PerformanceObserver(list => {
    for (const e of list.getEntries()) gcEntries.push([e.startTime, e.startTime + e.duration]);
  });
  obs.observe({entryTypes: ['gc']});
  const used = () => v8.getHeapStatistics().used_heap_size;
  const rows = [];
  const cases = W.matchCases(label).filter(c => c.family === 'prog' && c.shape === 'blocks');
  for (const c of cases) {
    for (const scale of prof.memScales) {
      const input = getInput(c, scale);
      runMatch(c, input.text); // warm code and grammar caches
      const alloc = [];
      const retained = [];
      let discarded = 0;
      for (let i = 0; i < prof.memReps; i++) {
        globalThis.gc();
        await new Promise(r => setTimeout(r, 5));
        const base = used();
        const tA = now();
        let res = runMatch(c, input.text);
        const after = used();
        const tB = now();
        await new Promise(r => setTimeout(r, 5));
        const gcDuring = gcEntries.filter(([a, b]) => b >= tA && a <= tB).length;
        globalThis.gc();
        const kept = used() - base;
        if (gcDuring > 0) {
          discarded++;
        } else {
          alloc.push(after - base);
        }
        retained.push(kept);
        if (!res) console.log('unreachable');
        res = null;
      }
      rows.push({
        ...c,
        scale,
        inputChars: input.text.length,
        allocBytes: alloc,
        retainedBytes: retained,
        discarded,
        reps: prof.memReps,
      });
    }
  }
  obs.disconnect();
  return {memory: rows};
}

// -------------------------------------------------------------------
// Cold start: first calls in a fresh process
// -------------------------------------------------------------------

function coldMode() {
  const rows = [];
  const [family, shape, regime, config] = (args.case || '').split('|');
  const cfg = W.VARIANT_CONFIGS.find(v => v.id === config);
  const c = {family, shape, regime, config, variant: cfg.variant, recover: cfg.recover};
  const scale = Number(args.scale || 10);
  const input = W.inputFor(family, scale, shape, regime);
  const tg0 = now();
  getGrammar(family, c.variant);
  const buildMs = now() - tg0;
  const calls = [];
  for (let i = 0; i < 6; i++) {
    const t0 = now();
    runMatch(c, input.text).succeeded();
    calls.push(now() - t0);
  }
  rows.push({...c, scale, importMs, buildMs, calls});
  return {cold: rows};
}

// -------------------------------------------------------------------
// Construction phase breakdown (instrumented; informational)
// -------------------------------------------------------------------

async function breakdownMode() {
  const {GrammarDecl} = await import(pathToFileURL(path.join(pkg, 'src/GrammarDecl.js')).href);
  let buildMs = 0;
  const orig = GrammarDecl.prototype.build;
  GrammarDecl.prototype.build = function (...a) {
    const t = now();
    try {
      return orig.apply(this, a);
    } finally {
      buildMs += now() - t;
    }
  };
  const rows = [];
  const srcs = [
    ['prog-plain', W.progGrammar('plain')],
    ['syn100-plain', W.syntheticGrammar(100, false)],
  ];
  if (!isBaseline) {
    srcs.push(
      ['prog-bang', W.progGrammar('bang')],
      ['syn100-bang', W.syntheticGrammar(100, true)]
    );
  }
  for (const [name, src] of srcs) {
    const totals = [];
    const decl = [];
    const parse = [];
    for (let i = 0; i < 60; i++) {
      buildMs = 0;
      const t0 = now();
      ohm.grammar(src);
      const total = now() - t0;
      if (i >= 20) {
        totals.push(total);
        decl.push(buildMs);
      }
      const p0 = now();
      ohm.ohmGrammar.match(src);
      if (i >= 20) parse.push(now() - p0);
    }
    rows.push({
      name,
      total: summarize(totals),
      declBuild: summarize(decl),
      parse: summarize(parse),
    });
  }
  GrammarDecl.prototype.build = orig;
  return {breakdown: rows};
}

// -------------------------------------------------------------------
// Paired (interleaved) measurements, fallible tree only
// -------------------------------------------------------------------

/**
 * Times several thunks in strict rotation (A, B, C, A, B, C, ...), so that drift in machine
 * state affects all of them equally and per-iteration ratios are meaningful.
 */
function measureRotation(fns, p) {
  const cold = fns.map(f => {
    const t = now();
    f();
    return now() - t;
  });
  const wEnd = now() + p.warmupMs;
  let w = 0;
  while (now() < wEnd || w < (Math.max(...cold) > 200 ? 0 : 3)) {
    for (const f of fns) f();
    w++;
  }
  const samples = fns.map(() => []);
  const start = now();
  for (;;) {
    for (let i = 0; i < fns.length; i++) {
      const a = now();
      fns[i]();
      samples[i].push(now() - a);
    }
    const el = now() - start;
    const n = samples[0].length;
    if (n >= p.maxReps) break;
    if (el >= p.budgetMs * fns.length && n >= p.minReps) break;
    if (el >= p.hardCapMs * fns.length && n >= 3) break;
  }
  return samples;
}

function pairedMode() {
  const {set} = args;
  const rows = [];
  if (set === 'nonrecover' || set === 'recover') {
    const configs =
      set === 'nonrecover'
        ? ['plain/match', 'bang/match']
        : ['plain/match', 'plain/recover', 'bang/recover'];
    for (const w of W.WORKLOADS.filter(w => w.regime === 'valid')) {
      for (const scale of prof.scales) {
        const input = W.inputFor(w.family, scale, w.shape, w.regime);
        const cs = configs.map(id => {
          const v = W.VARIANT_CONFIGS.find(v => v.id === id);
          return {...w, config: id, variant: v.variant, recover: v.recover};
        });
        for (const c of cs) getGrammar(c.family, c.variant);
        let sink = 0;
        const samples = measureRotation(
          cs.map(c => () => {
            sink += runMatch(c, input.text).succeeded() ? 1 : 0;
          }),
          prof
        );
        if (sink < 0) console.log(sink);
        rows.push({
          kind: 'match',
          family: w.family,
          shape: w.shape,
          regime: w.regime,
          scale,
          inputChars: input.text.length,
          labels: configs,
          samples,
        });
      }
    }
  } else if (set === 'construct') {
    const pairs = [['prog', W.progGrammar('plain'), W.progGrammar('bang')]];
    for (const n of prof.synthetic) {
      pairs.push([`syn${n}`, W.syntheticGrammar(n, false), W.syntheticGrammar(n, true)]);
    }
    pairs.push(['lex', W.lexGrammar('plain'), W.lexGrammar('bang')]);
    for (const [name, a, b] of pairs) {
      const samples = measureRotation([() => ohm.grammar(a), () => ohm.grammar(b)], {
        ...prof,
        minReps: prof.constructReps,
        warmupMs: Math.min(prof.warmupMs, 150),
        budgetMs: prof.constructBudgetMs,
      });
      rows.push({
        kind: 'construct',
        name,
        chars: [a.length, b.length],
        labels: ['plain', 'bang'],
        samples,
      });
    }
  }
  return {paired: rows};
}

/**
 * Both trees in one process (separate module instances, so no shared JIT feedback), measured
 * in strict alternation. Labels are normalised to [baseline, fallible].
 */
async function dualMode() {
  const ohmB = await import(
    pathToFileURL(path.join(args.tree2, 'packages/ohm-js/index.mjs')).href
  );
  const libs = {fallible: ohm, baseline: ohmB};
  const order = args.order === 'fb' ? ['fallible', 'baseline'] : ['baseline', 'fallible'];
  const rows = [];
  const normalise = samples => {
    const by = Object.fromEntries(order.map((t, i) => [t, samples[i]]));
    return [by.baseline, by.fallible];
  };
  for (const w of W.WORKLOADS.filter(w => w.regime === 'valid')) {
    const src = W.grammarSource(w.family, 'plain');
    const g = {baseline: ohmB.grammar(src), fallible: ohm.grammar(src)};
    for (const scale of prof.scales) {
      const input = W.inputFor(w.family, scale, w.shape, w.regime);
      let sink = 0;
      const samples = measureRotation(
        order.map(t => () => {
          sink += g[t].match(input.text).succeeded() ? 1 : 0;
        }),
        prof
      );
      if (sink < 0) console.log(sink);
      rows.push({
        kind: 'match',
        family: w.family,
        shape: w.shape,
        regime: w.regime,
        scale,
        inputChars: input.text.length,
        labels: ['baseline', 'fallible'],
        samples: normalise(samples),
      });
    }
  }
  const srcs = [
    ['prog-plain', W.progGrammar('plain')],
    ['ohm-grammar.ohm', fs.readFileSync(sharedOhmGrammar, 'utf8')],
    ['lex-plain', W.lexGrammar('plain')],
  ];
  for (const n of prof.synthetic) srcs.push([`syn${n}-plain`, W.syntheticGrammar(n, false)]);
  for (const [name, src] of srcs) {
    const cp = {
      ...prof,
      minReps: prof.constructReps,
      warmupMs: Math.min(prof.warmupMs, 150),
      budgetMs: prof.constructBudgetMs,
    };
    rows.push({
      kind: 'construct',
      name: `${name} (ohm.grammar)`,
      chars: [src.length],
      labels: ['baseline', 'fallible'],
      samples: normalise(
        measureRotation(
          order.map(t => () => libs[t].grammar(src)),
          cp
        )
      ),
    });
    rows.push({
      kind: 'construct',
      name: `${name} (metagrammar parse)`,
      chars: [src.length],
      labels: ['baseline', 'fallible'],
      samples: normalise(
        measureRotation(
          order.map(t => () => libs[t].ohmGrammar.match(src)),
          cp
        )
      ),
    });
  }
  return {paired: rows};
}

/**
 * Controlled micro-grammars on both trees in one process, to attribute the regression
 * check's per-construct costs: predicate (`~`), lookahead (`&`), application per element,
 * and a bare `any` loop.
 */
async function microMode() {
  const ohmB = await import(
    pathToFileURL(path.join(args.tree2, 'packages/ohm-js/index.mjs')).href
  );
  const order = args.order === 'fb' ? ['fallible', 'baseline'] : ['baseline', 'fallible'];
  const bodies = {
    'any-loop': r => `${r}* end`,
    'not-per-char': r => '(~"#" any)* end',
    'lookahead-per-char': r => '(&"a" any)* end',
    'apply-per-char': r => 'T* end  T = any',
    'apply+not-per-char': r => 'T* end  T = ~"#" any',
  };
  const text = 'a'.repeat(prof.name === 'full' ? 20000 : 2000);
  const rows = [];
  for (const kind of ['lexical', 'syntactic']) {
    for (const [name, body] of Object.entries(bodies)) {
      const start = kind === 'lexical' ? 's' : 'S';
      const tname = kind === 'lexical' ? 't' : 'T';
      const expression = body('any').replace(/\bT\b/g, tname);
      const src = `M { ${start} = ${expression} }`;
      const g = {baseline: ohmB.grammar(src), fallible: ohm.grammar(src)};
      let sink = 0;
      const samples = measureRotation(
        order.map(t => () => {
          sink += g[t].match(text).succeeded() ? 1 : 0;
        }),
        prof
      );
      if (sink < 0) console.log(sink);
      const by = Object.fromEntries(order.map((t, i) => [t, samples[i]]));
      rows.push({
        kind: 'match',
        family: 'micro',
        shape: `${kind}: ${name}`,
        regime: 'valid',
        scale: 1,
        inputChars: text.length,
        labels: ['baseline', 'fallible'],
        samples: [by.baseline, by.fallible],
        src,
      });
    }
  }
  return {paired: rows};
}

const handlers = {
  paired: async () =>
    args.set === 'dual' ? dualMode() : args.set === 'micro' ? microMode() : pairedMode(),
  timing: async () => timingMode(),
  counters: countersMode,
  memory: memoryMode,
  cold: async () => coldMode(),
  breakdown: breakdownMode,
  load: async () => ({load: [{importMs}]}),
};
const result = await handlers[mode]();
process.stdout.write(
  '\n' + JSON.stringify({label, mode, node: process.version, importMs, ...result}) + '\n'
);
