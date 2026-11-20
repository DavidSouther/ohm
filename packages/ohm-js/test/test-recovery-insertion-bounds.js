import test from 'ava';
import * as ohm from '../index.mjs';
import {MatchState} from '../src/MatchState.js';
import * as p from '../src/pexprs-main.js';

const RECOVER = {recover: true, firstPass: 'cached'};

// RecoveryInsertion's sandbox is a MatchState subclass. Count the actual
// evaluator work performed there, separately from the ordinary recovery pass.
function measured(grammar, input, options = RECOVER) {
  const original = MatchState.prototype.eval;
  const counts = {probe: 0, ordinary: 0};
  MatchState.prototype.eval = function (expr) {
    counts[this.constructor === MatchState ? 'ordinary' : 'probe']++;
    return original.call(this, expr);
  };
  try {
    return {result: grammar.match(input, undefined, options), ...counts};
  } finally {
    MatchState.prototype.eval = original;
  }
}

function summary(result) {
  return {
    succeeded: result.succeeded(),
    failures: result.getRecoveredFailures().map(f => ({
      missing: f.missing,
      position: f.position,
      interval: [f.interval.startIdx, f.interval.endIdx],
      message: f.shortMessage,
    })),
    tree: result.succeeded() ? shape(result._cst) : null,
  };
}

function shape(node) {
  return [node.ctorName, node.matchLength, (node.children || []).map(shape)];
}

for (const [label, body, input] of [
  ['zero-width', '""', 'next'],
  ['implicit whitespace before an empty', '""', ' next'],
  ['implicit whitespace with only lookahead bindings', '&"next" ""', ' next'],
  ['failed', '"x" "y"', 'xnext'],
]) {
  test(`${label} guarded material does not authorize insertion`, t => {
    const rule = label.startsWith('implicit') ? 'Start' : 'start';
    const grammar = ohm.grammar(`G { ${rule} = (${body}) ! ";" "next" }`);
    const result = grammar.match(input, undefined, RECOVER);
    t.true(result.failed());
    t.false(result.getRecoveredFailures().some(f => f.missing));
  });
}

for (const [label, source, input, anchor] of [
  [
    'abandoned guard alternative',
    `G {
    Start = Guard ! ";" "next"
    Guard = "x" "next" "z" -- long
          | "x" -- short
  }`,
    'x next',
    1,
  ],
  ['nullable rule suffix', 'G { Start = ("a" Empty) ! ";" "b" Empty = "" }', 'a \n b', 1],
  ['empty terminal suffix', 'G { Start = ("a" "") ! ";" "b" }', 'a \n b', 1],
  ['direct lookahead of whitespace', 'G { Start = ("a" #(&" ") "") ! ";" "b" }', 'a \n b', 1],
  [
    'direct lookahead beyond nullable tail',
    'G { Start = ("a" &"b" "") ! ";" "b" }',
    'a \n b',
    1,
  ],
  ['lookahead in a rule', 'G { Start = Guard ! ";" "b" Guard = "a" &"b" "" }', 'a \n b', 1],
  ['reused empty rule', 'G { Start = ("a" &Empty Empty) ! ";" "b" Empty = "" }', 'a \n b', 1],
  ['explicit whitespace rule', 'G { Start = ("a" #spaces) ! ";" "b" }', 'a  b', 3],
  ['explicit whitespace token', 'G { Start = ("a" #" ") ! ";" "b" }', 'a  b', 2],
]) {
  test(`${label} anchors insertion after retained tokens in every mode`, t => {
    const grammar = ohm.grammar(source);
    const semantics = grammar.createSemantics().addOperation('intervals', {
      _nonterminal(...children) {
        return children
          .slice(-3, -1)
          .map(node => [node.source.startIdx, node.source.endIdx, node.sourceString]);
      },
    });
    for (const firstPass of ['cached', 'probe', 'auto']) {
      for (const trace of [false, true]) {
        const options = {recover: true, firstPass};
        const result = trace
          ? grammar.trace(input, undefined, options).result
          : grammar.match(input, undefined, options);
        t.true(result.succeeded(), `${firstPass}, trace=${trace}`);
        if (result.failed()) continue;
        const failures = result.getRecoveredFailures();
        t.is(failures.length, 1);
        t.true(failures[0].missing);
        t.is(failures[0].position, anchor);
        t.is(failures[0].shortMessage, `Line 1, col ${anchor + 1}: expected ";"`);
        t.deepEqual(semantics(result).intervals(), [
          [anchor, anchor, ''],
          [anchor, anchor, ''],
        ]);
      }
    }
  });
}

for (const [label, source, input, anchor, skipped] of [
  [
    'zero-width real inner join',
    'G { Start = Inner ! ":" "b" Inner = "a" ! &"b" }',
    'axb',
    1,
    'x',
  ],
  ['opted-out inner join', 'G { Start = Inner ! ":" "b" Inner = "a" !~ ";" }', 'ax;b', 3, 'x'],
  [
    'ordinary inner join',
    'G { Start = Inner ! "}" "next" Inner = "a" ! ";" }',
    'a ?; next',
    4,
    '?',
  ],
  [
    'wrapped nullable join',
    'G { Start = Inner ! "}" "next" Inner = "a" ! Semi Semi = ";" Empty Empty = "" }',
    'a ?; next',
    4,
    '?',
  ],
  [
    'wrapped predicate join',
    'G { Start = Inner ! "}" "next" Inner = "a" ! Semi Semi = ";" &"next" "" }',
    'a ?; next',
    4,
    '?',
  ],
  [
    'wrapped explicit whitespace join',
    'G { Start = Inner ! "}" "next" Inner = "a" ! Semi Semi = ";" #" " "" }',
    'a ?; next',
    5,
    '?',
  ],
  [
    'abandoned join alternative',
    `G { Start = Inner ! "}" "next" Inner = "a" ! Semi
    Semi = ";" "next" "z" -- long
         | ";" -- short
  }`,
    'a ?; next',
    4,
    '?',
  ],
  [
    'join cached first under lookahead',
    `G { Start = &Probe Inner ! "}" "next"
      Probe = "a" "?" Semi
      Inner = "a" ! Semi
      Semi = ";" &"next" ""
    }`,
    'a ?; next',
    4,
    '?',
  ],
  [
    'join with trailing comment',
    `G { Start = Inner ! "}" "next" Inner = "a" ! Semi Semi = ";" Empty Empty = ""
    space += "/*" (~"*/" any)* "*/" -- comment
  }`,
    'a ?; /*comment*/ next',
    4,
    '?',
  ],
]) {
  test(`${label} retains scanned real-join tokens for enclosing insertion`, t => {
    const grammar = ohm.grammar(source);
    const semantics = grammar.createSemantics().addOperation('intervals', {
      _nonterminal(...children) {
        return children
          .slice(-3, -1)
          .map(node => [node.source.startIdx, node.source.endIdx, node.sourceString]);
      },
    });
    for (const firstPass of ['cached', 'probe', 'auto']) {
      for (const trace of [false, true]) {
        const options = {recover: true, firstPass};
        const result = trace
          ? grammar.trace(input, undefined, options).result
          : grammar.match(input, undefined, options);
        t.true(result.succeeded(), `${firstPass}, trace=${trace}`);
        if (result.failed()) continue;
        const failures = result.getRecoveredFailures();
        t.is(failures.length, 2);
        const missing = failures.filter(f => f.missing);
        t.is(missing.length, 1);
        t.is(missing[0].position, anchor);
        const punctuation = source.includes('! ":"') ? '":"' : '"}"';
        t.is(missing[0].shortMessage, `Line 1, col ${anchor + 1}: expected ${punctuation}`);
        t.deepEqual(
          failures.filter(f => !f.missing).map(f => f.interval.contents),
          [skipped]
        );
        t.deepEqual(semantics(result).intervals(), [
          [anchor, anchor, ''],
          [anchor, anchor, ''],
        ]);
      }
    }
  });
}

test('nonliteral next-item joins cannot provide provisional prefix evidence', t => {
  const grammar = ohm.grammar(`G {
    S = "{" Item* ! "}"
    Item = "{" Item* ! "}" -- block
         | letter ! (";" | "!") -- simple
  }`);
  for (const firstPass of ['cached', 'probe', 'auto']) {
    for (const trace of [false, true]) {
      const options = {recover: true, firstPass};
      const result = trace
        ? grammar.trace('{a;{b;c}d;}', undefined, options).result
        : grammar.match('{a;{b;c}d;}', undefined, options);
      t.true(result.succeeded());
      t.deepEqual(
        result.getRecoveredFailures().map(f => [f.missing, f.interval.contents]),
        [[false, 'c']]
      );
    }
  }
});

test('wrapped punctuation retains its constructor with zero-width CST intervals', t => {
  const grammar = ohm.grammar('G { Start = "x" ! Semi "next"\n Semi = Punct\n Punct = ";" }');
  const input = 'x next';
  const result = grammar.match(input, undefined, RECOVER);
  t.true(result.succeeded());
  const inspect = grammar.createSemantics().addOperation('join', {
    Start(_body, correction, semi, _next) {
      return [correction, semi, semi.child(0), semi.child(0).child(0)].map(node => [
        node.ctorName,
        node.sourceString,
        node.source.startIdx,
        node.source.endIdx,
      ]);
    },
  });
  t.deepEqual(inspect(result).join(), [
    ['_correction', '', 1, 1],
    ['Semi', '', 1, 1],
    ['Punct', '', 1, 1],
    ['_terminal', '', 1, 1],
  ]);
});

test('insertion retains every guarded slot and the existing semantic action arity', t => {
  const grammar = ohm.grammar('G { Start = ("x" digit+) ! ";" "next" }');
  const result = grammar.match('x12 next', undefined, RECOVER);
  t.true(result.succeeded());
  const semantics = grammar.createSemantics().addOperation('parts', {
    Start(x, digits, correction, semi, next) {
      return [
        arguments.length,
        x.sourceString,
        digits.sourceString,
        correction.sourceString,
        semi.sourceString,
        next.sourceString,
      ];
    },
  });
  t.deepEqual(semantics(result).parts(), [5, 'x', '12', '', '', 'next']);
});

test('insertion sites at the same position agree across cache and trace modes', t => {
  const source = 'G { Start = ("x" ! ";") "a" -- first\n | ("x" ! ";") "b" -- second }';
  for (const input of ['xa', 'xb']) {
    const grammar = ohm.grammar(source);
    const outcomes = ['cached', 'probe', 'auto'].map(firstPass =>
      summary(grammar.match(input, undefined, {recover: true, firstPass}))
    );
    const trace = grammar.trace(input, undefined, RECOVER);
    t.true(outcomes[0].succeeded);
    t.is(outcomes[0].failures.length, 1);
    t.true(outcomes[0].failures[0].missing);
    t.deepEqual(outcomes[1], outcomes[0]);
    t.deepEqual(outcomes[2], outcomes[0]);
    t.deepEqual(summary(trace.result), outcomes[0]);
  }
});

test('parameter contexts at the same position cannot reuse another continuation', t => {
  const source = 'G { Start = Entry<"a"> | Entry<"b">\n Entry<next> = ("x" ! ";") next }';
  for (const input of ['xa', 'xb']) {
    const grammar = ohm.grammar(source);
    const cached = summary(grammar.match(input, undefined, RECOVER));
    t.true(cached.succeeded);
    t.is(cached.failures.length, 1);
    t.true(cached.failures[0].missing);
    t.deepEqual(
      summary(grammar.match(input, undefined, {recover: true, firstPass: 'probe'})),
      cached
    );
    t.deepEqual(summary(grammar.trace(input, undefined, RECOVER).result), cached);
  }
});

test.serial(
  'dense missing joins add linear sandbox evaluator work through 2048 statements',
  t => {
    const grammar = ohm.grammar('G { Start = Stmt* ! end\n Stmt = "x" ! ";" }');
    const rows = [32, 64, 128, 256, 512, 2048].map(n => {
      const row = measured(grammar, 'x '.repeat(n));
      t.true(row.result.succeeded(), `${n} statements`);
      t.is(row.result.getRecoveredFailures().length, n);
      t.true(row.probe > 0);
      return {n, probe: row.probe, ordinary: row.ordinary};
    });
    for (let i = 1; i < rows.length; i++) {
      const previous = rows[i - 1];
      const current = rows[i];
      const scale = current.n / previous.n;
      t.true(current.probe <= previous.probe * scale * 1.25, `${JSON.stringify(rows)}`);
      t.true(current.ordinary <= previous.ordinary * scale * 1.5, `${JSON.stringify(rows)}`);
    }
  }
);

test.serial(
  'a long damaged stretch resynchronizes without probing unrelated first tokens',
  t => {
    const grammar = ohm.grammar('G { Start = "x" ! ";" "next" }');
    const rows = [32, 128, 512, 2048].map(n => {
      const row = measured(grammar, `x ${'?'.repeat(n)} next`);
      t.true(row.result.succeeded());
      const [failure] = row.result.getRecoveredFailures();
      t.true(failure.missing);
      t.is(failure.position, 1);
      t.is(failure.interval.contents, '?'.repeat(n));
      return {n, probe: row.probe, ordinary: row.ordinary};
    });
    t.true(rows[0].probe > 0);
    t.true(
      rows.every(row => row.probe === rows[0].probe),
      `${JSON.stringify(rows)}`
    );
    t.true(rows.at(-1).ordinary < rows[0].ordinary * 80, `${JSON.stringify(rows)}`);
  }
);

test.serial('expensive plausible prefixes have bounded sandbox work per scan position', t => {
  const grammar = ohm.grammar('G { Start = "x" ! ";" Tail\n Tail = "a"* "!" }');
  const rows = [32, 64, 128, 256, 512, 2048].map(n => {
    const row = measured(grammar, `x${'a'.repeat(n)}?`);
    t.true(row.result.failed());
    return {n, probe: row.probe};
  });
  for (const row of rows) {
    t.true(row.probe > 0);
    t.true(row.probe <= 1100 * (row.n + 2), `${JSON.stringify(rows)}`);
  }
  const last = rows.at(-1);
  const previous = rows.at(-2);
  t.true(last.probe < previous.probe * 5, `${JSON.stringify(rows)}`);
});

test('a negative predicate at the sandbox edge cannot provide artificial EOF evidence', t => {
  const grammar = ohm.grammar('G { Start = "x" ! ";" Tail\n Tail = "a"* ~"b" }');
  const result = grammar.match(`x${'a'.repeat(300)}b`, undefined, RECOVER);
  // Only the physical EOF can satisfy this continuation. Resynchronization
  // may skip the damaged suffix to reach it, but must not retain a prefix
  // accepted solely because the sandbox input ended before the real b.
  t.true(result.succeeded());
  const [failure] = result.getRecoveredFailures();
  t.true(failure.missing);
  t.deepEqual([failure.interval.startIdx, failure.interval.endIdx], [1, 302]);
});

test.serial('successful plain matches never enter insertion context or probe work', t => {
  const original = p.Fallible.prototype.eval;
  const originalTracked = MatchState.prototype.evalWithTerminalProgress;
  let recoveringEvaluations = 0;
  MatchState.prototype.evalWithTerminalProgress = function (expr, progress) {
    recoveringEvaluations++;
    return originalTracked.call(this, expr, progress);
  };
  let recoveringEntries = 0;
  p.Fallible.prototype.eval = function (state) {
    if (state.recovery) recoveringEntries++;
    return original.call(this, state);
  };
  try {
    const grammar = ohm.grammar('G { Start = Stmt* ! end\n Stmt = "x" ! ";" }');
    const {result, probe} = measured(grammar, 'x; '.repeat(100), {});
    t.true(result.succeeded());
    t.is(recoveringEntries, 0);
    t.is(recoveringEvaluations, 0);
    t.is(probe, 0);
  } finally {
    p.Fallible.prototype.eval = original;
    MatchState.prototype.evalWithTerminalProgress = originalTracked;
  }
});

test.serial('parameterized continuation preprocessing is bounded before substitution', t => {
  const depth = 20;
  const rules = Array.from({length: depth}, (_, i) => `R${i}<x> = R${i + 1}<(x | x)>`);
  const grammar = ohm.grammar(`G { Start = ("a" ! ";") R0<"x">
    ${rules.join('\n')} R${depth}<x> = x }`);
  const original = p.Alt.prototype.substituteParams;
  let substitutions = 0;
  p.Alt.prototype.substituteParams = function (...args) {
    substitutions++;
    return original.apply(this, args);
  };
  try {
    const result = grammar.match('a z', undefined, RECOVER);
    t.true(result.failed());
    t.true(substitutions > 0);
    t.true(substitutions <= 4096, `${substitutions} alternative substitutions`);
  } finally {
    p.Alt.prototype.substituteParams = original;
  }
});

test('an authored sequence visits each factor only a bounded number of times', t => {
  const count = 256;
  const grammar = ohm.grammar(`G { Start = ("a" ! ";") ${'"x" '.repeat(count)} }`);
  const sequence = grammar.rules.Start.body;
  let reads = 0;
  sequence.factors = new Proxy(sequence.factors, {
    get(target, key, receiver) {
      if (typeof key === 'string' && /^\d+$/.test(key)) reads++;
      return Reflect.get(target, key, receiver);
    },
  });
  const result = grammar.match(`a;${'x'.repeat(count)}`, undefined, RECOVER);
  t.true(result.succeeded());
  t.true(reads >= count);
  t.true(reads < count * 12, `${reads} factor reads for ${count} trailing terms`);
});
