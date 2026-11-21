/* eslint-disable max-len, ava/assertion-arguments */
import test from 'ava';
import * as ohm from '../index.mjs';

const modes = [{}, ...['auto', 'probe', 'cached'].map(firstPass => ({recover: true, firstPass}))];
function assertOutcome(t, g, input, expected, label) {
  for (const options of modes) {
    const result = g.match(input, undefined, options);
    t.true(result.failed(), `${label} ${JSON.stringify(options)}`);
    t.is(result.getDiagnosticPosition(), expected, `${label} ${JSON.stringify(options)}`);
  }
  t.is(g.trace(input, undefined, {recover: true}).result.getDiagnosticPosition(), expected, `${label} trace`);
}

test('left recursion and memoized lookahead preserve retained terminal anchor', t => {
  const lr = ohm.grammar('G { Start = Expr ! ";" Expr = Expr "+" atom -- plus\n | atom -- atom\n atom = letter }');
  assertOutcome(t, lr, 'a + b wrong', 5, 'left recursion');
  const memo = ohm.grammar('G { Start = (&Word Word) ! ";" Word = "name" }');
  assertOutcome(t, memo, 'name\n wrong', 4, 'memoized lookahead');
});

test('strong and fluffy failures with the same expectation retain grammar provenance', t => {
  const g = ohm.grammar('G { Start = ("name" ";"?) ! ";" }');
  assertOutcome(t, g, 'name\n wrong', 4, 'same-key optional');
});

test('edits and reused matcher agree with a fresh matcher on absolute anchor', t => {
  const g = ohm.grammar('G { Start = Prefix Thing Prefix = "a"* Thing = "x" ! ";" }');
  const m = g.matcher().setInput('aax wrong');
  const initial = m.match();
  t.is(initial.getDiagnosticPosition(), 3);
  m.replaceInputRange(0, 0, 'aaaa');
  const shifted = m.match();
  const fresh = g.match('aaaaaax wrong');
  t.is(shifted.getRightmostFailurePosition(), fresh.getRightmostFailurePosition());
  t.is(shifted.getDiagnosticPosition(), 7);
  t.is(shifted.getDiagnosticPosition(), fresh.getDiagnosticPosition());
  t.is(initial.getDiagnosticPosition(), 3);
  for (const firstPass of ['auto', 'cached', 'probe']) {
    const recovered = m.match(undefined, {recover: true, firstPass});
    t.is(recovered.getDiagnosticPosition(), 7, firstPass);
  }
});

test('join analysis shares repeated rule applications', t => {
  for (const depth of [4, 8, 12]) {
    const rules = Array.from({length: depth}, (_, i) => `R${i} = R${i + 1} | R${i + 1}`);
    const g = ohm.grammar(`G { Start = "a" ! R0\n ${rules.join('\n')}\n R${depth} = "x" }`);
    const result = g.match('a z');
    let reads = 0;
    g.rules = new Proxy(g.rules, {
      get(target, key, receiver) {
        if (typeof key === 'string' && /^R\d+$/.test(key)) reads++;
        return Reflect.get(target, key, receiver);
      },
    });
    t.is(result.getDiagnosticPosition(), 1);
    t.true(reads <= 8 * (depth + 1), `depth ${depth}: ${reads} rule lookups`);
  }
});

test('parameterized and recursive joins stay conservative', t => {
  const parameterized = ohm.grammar(`G {
    Start = First | Second
    First = "a" Item<";">
    Second = "b" Item<&";">
    Item<j> = "n" ! j
  }`);
  const recursive = ohm.grammar(`G {
    Start = "a" ! Join
    Join = Join "x" -- more
         | "end" -- end
  }`);
  for (const options of [{}, ...['cached', 'probe', 'auto'].map(firstPass => ({recover: true, firstPass}))]) {
    t.is(parameterized.match('a n wrong', undefined, options).getDiagnosticPosition(), 3);
    t.is(parameterized.match('b n wrong', undefined, options).getDiagnosticPosition(), 4);
    t.is(recursive.match('a z', undefined, options).getDiagnosticPosition(), 2);
  }
});

test('parameterized join analysis stops at its visit budget', t => {
  const depth = 9;
  const rules = Array.from({length: depth}, (_, i) =>
    `R${i}<x> = R${i + 1}<WrapA${i}<x>> | R${i + 1}<WrapB${i}<x>>\n` +
    `WrapA${i}<x> = x\nWrapB${i}<x> = x`);
  const g = ohm.grammar(`G { Start = "a" ! R0<"x">\n ${rules.join('\n')}\nR${depth}<x> = x }`);
  const result = g.match('a bad');
  let reads = 0;
  g.rules = new Proxy(g.rules, {
    get(target, key, receiver) {
      if (typeof key === 'string' && /^(R\d+|Wrap[AB]\d+)$/.test(key)) reads++;
      return Reflect.get(target, key, receiver);
    },
  });
  // Exhaustion is conservative; the bound includes the parser's own rematch.
  t.is(result.getDiagnosticPosition(), 2);
  t.true(reads <= 3000, `${reads} rule lookups`);
});

test.serial('recovery prefix replay restores attempted terminal progress', async t => {
  const {RecoveryCache} = await import('../src/RecoveryCache.js');
  const original = RecoveryCache.prototype.iterate;
  let replay;
  RecoveryCache.prototype.iterate = function (state, expr) {
    const iteration = this.current.iterationState;
    const start = iteration && Math.min(iteration.dirtyFrom, iteration.rows.length);
    const prefix = start ? iteration.rows[start - 1] : undefined;
    if (!prefix || replay) return original.call(this, state, expr);
    const originalEval = state.eval;
    state.eval = function (child) {
      if (!replay) {
        replay = {expected: prefix.attemptedTerminalEnd, actual: this.terminalProgress.attemptedEnd};
      }
      return originalEval.call(this, child);
    };
    try {
      return original.call(this, state, expr);
    } finally {
      state.eval = originalEval;
    }
  };
  try {
    const grammar = ohm.grammar('G { Start = "a" ! Join Join = Item* "z" Item = "x" ! ";" }');
    const result = grammar.match('a x; x ?; z', undefined, {recover: true, firstPass: 'cached'});
    t.true(result.succeeded());
    t.true(result._recovery.cache.stats.resumedRows > 0);
    t.truthy(replay);
    t.true(replay.expected > 0);
    t.is(replay.actual, replay.expected);
  } finally {
    RecoveryCache.prototype.iterate = original;
  }
});


test('long acyclic joins do not exhaust a fixed analysis budget', t => {
  const depth = 300;
  const rules = Array.from({length: depth}, (_, i) => `R${i} = R${i + 1}`);
  const g = ohm.grammar(`G { Start = "a" ! R0\n ${rules.join('\n')}\nR${depth} = "x" }`);
  for (const options of [{}, {recover: true, firstPass: 'cached'}]) {
    const result = g.match('a wrong', undefined, options);
    t.is(result.getRightmostFailurePosition(), 2);
    t.is(result.getDiagnosticPosition(), 1);
  }
});


test('finite nested applications of one parameterized rule prove consuming', t => {
  const g = ohm.grammar('G { Start = "a" ! Box<Box<";">> Box<x> = x }');
  for (const options of [{}, ...['cached', 'probe', 'auto'].map(firstPass => ({recover: true, firstPass}))]) {
    const result = g.match('a wrong', undefined, options);
    t.is(result.getRightmostFailurePosition(), 2);
    t.is(result.getDiagnosticPosition(), 1);
  }
});


test('unknown left-recursive join progress keeps the raw position', t => {
  const simple = ohm.grammar('G { Start = "a" ! Join Join = letter }');
  const recursive = ohm.grammar(`G {
    Start = "a" ! Join
    Join = Join "+" letter -- more
         | letter -- one
  }`);
  for (const options of [{}, ...['cached', 'probe', 'auto'].map(firstPass => ({recover: true, firstPass}))]) {
    const known = simple.match('a ?', undefined, options);
    const unknown = recursive.match('a ?', undefined, options);
    t.is(known.getRightmostFailurePosition(), 2);
    t.is(unknown.getRightmostFailurePosition(), 2);
    t.is(known.getDiagnosticPosition(), 1);
    t.is(unknown.getDiagnosticPosition(), 2);
  }
});

test.serial('parameter expansion does not serialize or substitute expanded join expressions', async t => {
  const {Apply, Alt} = await import('../src/pexprs-main.js');
  const depth = 20;
  const rules = Array.from({length: depth}, (_, i) => `R${i}<x> = R${i + 1}<(x | x)>`);
  const g = ohm.grammar(`G { Start = "a" ! Join<"x"> Join<x> = ~"z" R0<x>
    ${rules.join('\n')} R${depth}<x> = x }`);
  const result = g.match('a z');
  const methods = [[Apply.prototype, 'toMemoKey'], [Apply.prototype, 'substituteParams'],
    [Alt.prototype, 'substituteParams']];
  const originals = methods.map(([prototype, method]) => prototype[method]);
  let calls = 0;
  for (const [index, [prototype, method]] of methods.entries()) {
    prototype[method] = function (...args) {
      if (new Error().stack.includes('definitelyConsumes')) calls++;
      return originals[index].apply(this, args);
    };
  }
  try {
    t.true([1, 2].includes(result.getDiagnosticPosition()));
    t.is(calls, 0);
  } finally {
    for (const [index, [prototype, method]] of methods.entries()) prototype[method] = originals[index];
  }
});
