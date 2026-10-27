/**
 * Evaluator invariants of `B ! C`: bindings, failure scope and messages,
 * memoization, the pass driver, incremental matching and static checks, plus
 * `ohm-js/v18` row-based iteration. test-fallible-acceptance.js covers
 * user-facing behavior.
 */

import test from 'ava';
import * as ohm from '../index.mjs';
import * as v18 from '../src/v18.js';

const RECOVER = {recover: true};

const STMTS = String.raw`
Stmts {
  Block = "{" Stmt* ! &"}" "}"
  Stmt  = Body ! ";"
  Body  = ident
  ident = letter+
}`;

const PLAIN_STMTS = STMTS.replace('Stmt* ! &"}"', 'Stmt* &"}"').replace(
  'Body ! ";"',
  'Body ";"'
);

function kinds(node) {
  return node.children.map(c => c.ctorName);
}

function messages(result) {
  return result.getRecoveredFailures().map(f => f.shortMessage);
}

// --------------------------------------------------------------------
// Bindings: two slots, recovered or not
// --------------------------------------------------------------------

test('a fallible always contributes two bindings', t => {
  const g = ohm.grammar(STMTS);
  t.is(g.rules.Stmt.body.getArity(), 2);
  t.is(g.rules.Block.body.getArity(), 4);

  const clean = g.match('{ a; b; }', undefined, RECOVER);
  t.deepEqual(kinds(clean._cst), ['_terminal', '_iter', '_terminal', '_terminal']);
  t.deepEqual(kinds(clean._cst.children[1].children[0]), ['Body', '_terminal']);

  const recovered = g.match('{ a; b b; c }', undefined, RECOVER);
  t.true(recovered.succeeded());
  t.deepEqual(kinds(recovered._cst), ['_terminal', '_iter', '_fail', '_terminal']);
  const [a, bb] = recovered._cst.children[1].children;
  t.deepEqual(kinds(a), ['Body', '_terminal']);
  t.deepEqual(kinds(bb), ['_fail', '_fail']);
  t.is(bb.children[0].matchLength, 0, 'the guarded slot holds an empty placeholder');
  t.is(bb.children[0].recoveredFailure, undefined);
  t.truthy(bb.children[1].recoveredFailure);
});

test('a guarded `?` keeps nothing', t => {
  const g = ohm.grammar(String.raw`
    G {
      Start = Item*
      Item = Opt? ! ";"
      Opt = "a" "b"
    }`);
  const r = g.match('ab; a c; ab;', undefined, RECOVER);
  t.true(r.succeeded());
  const items = r._cst.children[0].children;
  t.deepEqual(kinds(items[1]), ['_fail', '_fail']);
  t.is(items[1].children[0].matchLength, 0);
  t.deepEqual(messages(r), ['Line 1, col 7: expected "b"']);
});

// --------------------------------------------------------------------
// Failure scope and messages
// --------------------------------------------------------------------

test('a fallible that does not recover reports what `B C` reports', t => {
  const g = ohm.grammar(STMTS);
  const plain = ohm.grammar(PLAIN_STMTS);
  for (const input of ['{ a b', '{ a; b b', '{ a; ', '{ 1']) {
    const r = g.match(input, undefined, RECOVER);
    const p = plain.match(input);
    t.true(r.failed(), `${input}`);
    t.is(r.shortMessage, p.shortMessage, `${input}`);
    t.is(r.getRightmostFailurePosition(), p.getRightmostFailurePosition(), `${input}`);
    t.is(r.getExpectedText(), p.getExpectedText(), `${input}`);
  }
});

test('each recovered failure carries the message of the pass that permitted it', t => {
  const g = ohm.grammar(STMTS);
  const plain = ohm.grammar(PLAIN_STMTS);
  const r = g.match('{ a b; c d; e; }', undefined, RECOVER);
  t.true(r.succeeded());
  const failures = r.getRecoveredFailures();
  t.is(failures.length, 2);

  // The first entry equals the plain match's error.
  const first = plain.match('{ a b; c d; e; }');
  t.is(failures[0].shortMessage, first.shortMessage);
  t.is(failures[0].position, first.getRightmostFailurePosition());
  t.is(failures[0].getExpectedText(), first.getExpectedText());
  t.deepEqual(
    failures[0].getRightmostFailures().map(f => f.toString()),
    first.getRightmostFailures().map(f => f.toString())
  );

  // The second equals the plain match's error once the first mistake is fixed.
  const second = plain.match('{ a; c d; e; }');
  t.is(failures[1].shortMessage, second.shortMessage.replace('col 8', 'col 10'));
  t.is(failures[1].interval.contents, 'c d');
  t.is(failures[0].interval.contents, 'a b');
});

test('getRecoveredFailures is empty without recovery', t => {
  const g = ohm.grammar(STMTS);
  t.deepEqual(g.match('{ a; }').getRecoveredFailures(), []);
  t.deepEqual(g.match('{ a; }', undefined, RECOVER).getRecoveredFailures(), []);
  t.deepEqual(g.match('{ a b; }').getRecoveredFailures(), []);
});

test('a parse recovery cannot finish lists its recoveries, then the final failure', t => {
  const g = ohm.grammar(STMTS);
  const r = g.match('{ a b; c d; e', undefined, RECOVER);
  t.true(r.failed());
  t.is(r.shortMessage, ohm.grammar(PLAIN_STMTS).match('{ a b; c d; e').shortMessage);
  const failures = r.getRecoveredFailures();
  t.deepEqual(
    failures.map(f => [f.interval.startIdx, f.interval.endIdx, f.position]),
    [
      [2, 5, 4],
      [7, 10, 9],
      [13, 13, 13],
    ]
  );
  t.is(failures[2].shortMessage, 'Line 1, col 14: expected ";"');
});

// --------------------------------------------------------------------
// Memoization
// --------------------------------------------------------------------

test('a fallible inside `&` or `~` never recovers', t => {
  const g = ohm.grammar(String.raw`
    G {
      Start = &Line "x" any*
      Line = Body ! ";"
      Body = "a"
    }`);
  const r = g.match('xb;', undefined, RECOVER);
  t.true(r.failed());
  t.is(r.shortMessage, g.match('xb;').shortMessage);

  const n = ohm.grammar(String.raw`
    G {
      Start = ~Line any*
      Line = Body ! ";"
      Body = "a"
    }`);
  t.true(n.match('b;', undefined, RECOVER).succeeded());
  t.deepEqual(n.match('b;', undefined, RECOVER).getRecoveredFailures(), []);
});

test('a lookahead result is never memoized in place of a recovery', t => {
  const g = ohm.grammar(String.raw`
    G {
      Start = (&Item)? Item*
      Item = Body ! ";"
      Body = letter
    }`);
  const r = g.match('1;a;', undefined, RECOVER);
  t.true(r.succeeded());
  const plain = ohm.grammar('G { Start = (&Item)? Item*\n Item = Body ";"\n Body = letter }');
  t.deepEqual(messages(r), [plain.match('1;a;').shortMessage]);
});

test('recovery is deterministic across calls on fresh matchers', t => {
  const g = ohm.grammar(STMTS);
  const input = '{ a b; c; d d d; e }';
  const first = g.match(input, undefined, RECOVER);
  const second = g.match(input, undefined, RECOVER);
  t.deepEqual(messages(first), messages(second));
  t.is(messages(first).length, 3);
});

test('completed left recursion does not reuse a recovered result', t => {
  const g = ohm.grammar(String.raw`
    G {
      Start = E
      E = E "+" Item -- plus
        | Item
      Item = letter ! ";"
    }`);
  for (const method of ['match', 'trace']) {
    const matcher = g.matcher().setInput('1;');
    const recovered = matcher[method](undefined, RECOVER);
    const result = method === 'trace' ? recovered.result : recovered;
    t.true(result.succeeded());
    t.is(result.getRecoveredFailures().length, 1);
    t.true(matcher.match().failed());
    t.true(g.match('1;').failed());
    const valid = g[method]('a;+b;+c;', undefined, RECOVER);
    const validResult = method === 'trace' ? valid.result : valid;
    t.true(validResult.succeeded());
    t.deepEqual(validResult.getRecoveredFailures(), []);
  }
});

test('left recursion inside lookahead does not suppress recovery attempts', t => {
  const g = ohm.grammar(String.raw`
    G {
      Start = (&E)? E
      E = E "+" Item -- plus
        | Item
      Item = letter ! ";"
    }`);
  for (const method of ['match', 'trace']) {
    const recovered = g[method]('1;', undefined, RECOVER);
    const result = method === 'trace' ? recovered.result : recovered;
    t.true(result.succeeded());
    t.deepEqual(messages(result), [g.match('1;').shortMessage]);
  }
});

// --------------------------------------------------------------------
// Pass driver: every error, no cap
// --------------------------------------------------------------------

const HDL = String.raw`
Hdl {
  Chip = "CHIP" name "{" Parts "}"
  Parts = "PARTS:" Part* ! &"}"
  Part = PartBody ! ";"
  PartBody = name "(" ListOf<Wire, ","> ")"
  Wire = name "=" name
  name = letter alnum*
}`;

function chip(numParts, broken) {
  const parts = [];
  for (let i = 0; i < numParts; i++) {
    parts.push(broken.has(i) ? `  Nand(a=a b=b, out=w${i});` : `  Nand(a=a, b=b, out=w${i});`);
  }
  return `CHIP Big {\n PARTS:\n${parts.join('\n')}\n}\n`;
}

function spread(numParts, count) {
  const broken = new Set();
  for (let i = 0; i < count; i++) broken.add(Math.floor((i * numParts) / count));
  return broken;
}

for (const count of [100, 300]) {
  test(`a 13 KB chip with ${count} broken parts reports every error`, t => {
    const g = ohm.grammar(HDL);
    const input = chip(480, spread(480, count));
    t.true(input.length > 13000);
    const r = g.match(input, undefined, RECOVER);
    t.true(r.succeeded());
    const failures = r.getRecoveredFailures();
    t.is(failures.length, count);
    t.true(failures.every(f => f.shortMessage.endsWith('expected ")" or ","')));
    t.true(failures.every((f, i) => i === 0 || failures[i - 1].position < f.position));
    t.is(failures[0].shortMessage, g.match(input).shortMessage);
  });
}

// --------------------------------------------------------------------
// Incremental matching
// --------------------------------------------------------------------

test('Matcher#match and Matcher#trace take the recover option', t => {
  const g = ohm.grammar(STMTS);
  const m = g.matcher();
  m.setInput('{ a b; }');
  const r = m.match(undefined, RECOVER);
  t.true(r.succeeded());
  t.is(r.getRecoveredFailures().length, 1);
  t.true(m.trace(undefined, RECOVER).succeeded);
});

test('a matcher with a stale or plain memo table refuses to recover', t => {
  const g = ohm.grammar(STMTS);

  const stale = g.matcher();
  stale.setInput('{ a; }');
  stale.match(undefined, RECOVER);
  stale.replaceInputRange(2, 3, 'b b');
  t.throws(() => stale.match(undefined, RECOVER), {message: /recover/});

  const plain = g.matcher();
  plain.setInput('{ a b; }');
  plain.match();
  t.throws(() => plain.match(undefined, RECOVER), {message: /recover/});

  const again = g.matcher();
  again.setInput('{ a b; }');
  t.is(again.match(undefined, RECOVER).getRecoveredFailures().length, 1);
  t.is(again.match(undefined, RECOVER).getRecoveredFailures().length, 1);
});

// --------------------------------------------------------------------
// Static checks
// --------------------------------------------------------------------

test('both operands must have arity 1', t => {
  t.throws(() => ohm.grammar('G { S = "a" ! ("b" "c") }'), {message: /synchronizer.*arity/});
  t.throws(() => ohm.grammar('G { S = ("a" ! "b") ! "c" }'), {message: /guarded.*arity/});
  t.throws(() => ohm.grammar('G { S = ("a" "b") ! "c" }'), {message: /wrap it in a rule/});
  t.throws(() => ohm.grammar('G { S = ~"a" ! "c" }'), {message: /never consumes input/});
  t.throws(() => ohm.grammar('G { S = &"a" ! "c" }'), {message: /never consumes input/});
  t.notThrows(() => ohm.grammar('G { S = "a"* ! &"c" "c" }'));
});

test('a fallible is nullable only when `B C` is', t => {
  t.throws(() => ohm.grammar('G { S = ("a"? ! "b"?)* }'), {message: /Nullable/});
  t.notThrows(() => ohm.grammar('G { S = ("a"? ! "b")* }'));
  t.notThrows(() => ohm.grammar('G { S = ("a" ! "b"?)* }'));
});

test('a trailing `!` has a clear message', t => {
  t.throws(() => ohm.grammar('G { S = "a" !\n T = "b" }'), {message: /synchronizer/});
  t.throws(() => ohm.grammar('G { S = "a" ! }'), {message: /synchronizer/});
});

test('toString parenthesizes a fallible', t => {
  const g = ohm.grammar('G { S = "{" "a"* ! &"}" "}" }');
  t.is(g.rules.S.body.toString(), '("{" ("a"* ! &"}") "}")');
});

test('`!` is an operator token', t => {
  const r = ohm.ohmGrammar.match('A ! B', 'tokens');
  t.true(r.succeeded());
  const s = ohm.ohmGrammar.createSemantics().addOperation('kinds', {
    tokens(ts) {
      return ts.children.map(c => c.kinds());
    },
    token(x) {
      return x.ctorName;
    },
  });
  t.deepEqual(
    s(r)
      .kinds()
      .filter(k => k !== 'any'),
    ['ident', 'operator', 'ident']
  );
});

test('a recipe round trips a fallible', t => {
  const g = ohm.grammar(STMTS);
  const g2 = ohm.makeRecipe(eval(g.toRecipe()));
  t.is(g2.rules.Block.body.toString(), g.rules.Block.body.toString());
  t.deepEqual(
    messages(g2.match('{ a b; }', undefined, RECOVER)),
    messages(g.match('{ a b; }', undefined, RECOVER))
  );
});

// --------------------------------------------------------------------
// The `_fail` action
// --------------------------------------------------------------------

test('`_fail` has arity 0 and reads its failure from the node', t => {
  const g = ohm.grammar(STMTS);
  t.throws(() => g.createSemantics().addOperation('x', {_fail(f) {}}), {
    message: /_fail.*arity/,
  });

  const s = g.createSemantics().addOperation('errs', {
    _nonterminal(...children) {
      return children.flatMap(c => c.errs());
    },
    _iter(...children) {
      return children.flatMap(c => c.errs());
    },
    _terminal() {
      return [];
    },
    _fail() {
      return this.recoveredFailure ? [this.recoveredFailure.shortMessage] : ['placeholder'];
    },
  });
  t.deepEqual(s(g.match('{ a b; c }', undefined, RECOVER)).errs(), [
    'placeholder',
    'Line 1, col 5: expected ";"',
    'Line 1, col 10: expected ";"',
  ]);
});

test('`_nonterminal` and `_default` never receive a `_fail` node', t => {
  const g = ohm.grammar(STMTS);
  const s = g.createSemantics().addOperation('count', {
    _nonterminal(...children) {
      return children.reduce((n, c) => n + c.count(), 1);
    },
    _iter(...children) {
      return children.reduce((n, c) => n + c.count(), 0);
    },
    _terminal() {
      return 0;
    },
  });
  t.is(s(g.match('{ a; }', undefined, RECOVER)).count(), 6);
  t.throws(() => s(g.match('{ a b; }', undefined, RECOVER)).count(), {
    message: /Missing semantic action for _fail/,
  });
});

// --------------------------------------------------------------------
// Tracing
// --------------------------------------------------------------------

test('a fallible that recovered is marked in the trace', t => {
  const g = ohm.grammar(STMTS);
  const trace = g.trace('{ a b; }', undefined, RECOVER);
  t.true(trace.succeeded);
  const recovered = [];
  trace.walk(node => {
    if (node.isRecovered) recovered.push(node);
  });
  t.is(recovered.length, 1);
  const [entry] = recovered;
  t.is(entry.expr.constructor.name, 'Fallible');
  t.true(entry.succeeded);
  // Its children are the failed attempt and the successful synchronizer.
  t.deepEqual(
    entry.children.filter(c => !c.isImplicitSpaces).map(c => [c.displayString, c.succeeded]),
    [
      ['Body', true],
      ['";"', false],
      ['";"', true],
    ]
  );
  t.regex(trace.toString(), /\(recovered\)/);

  const plain = g.trace('{ a b; }');
  t.false(plain.succeeded);
});

// --------------------------------------------------------------------
// v18 CST view (ohm-js/v18)
// --------------------------------------------------------------------

test('v18 CST view: the kept prefix is a list and the slots are unchanged', t => {
  const g = v18.grammar(STMTS);
  // `&"}"` keeps its binding as a synchronizer, so the slots match column mode.
  t.is(g.rules.Block.body.getArity(true), 4);

  const rootKinds = match => match.getCstRoot().children.map(c => c.ctorName);

  const clean = g.match('{ a; b; }', undefined, RECOVER);
  t.deepEqual(rootKinds(clean), ['_terminal', '_list', '_terminal', '_terminal']);

  const r = g.match('{ a; b; c }', undefined, RECOVER);
  t.true(r.succeeded());
  const root = r.getCstRoot();
  t.deepEqual(rootKinds(r), ['_terminal', '_list', '_fail', '_terminal']);
  t.deepEqual(
    root.children[1].children.map(c => c.ctorName),
    ['Stmt', 'Stmt']
  );
  t.deepEqual(messages(r), ['Line 1, col 11: expected ";"']);

  const plus = v18.grammar(STMTS.replace('Stmt* !', 'Stmt+ !'));
  const nothingKept = plus.match('{ c }', undefined, RECOVER);
  t.deepEqual(rootKinds(nothingKept), ['_terminal', '_list', '_fail', '_terminal']);
  t.is(nothingKept.getCstRoot().children[1].children.length, 0);

  // The v18 CST view shows the `_fail` nodes.
  t.is(root.children[2].sourceString, 'c');
  t.is(root.children[2].recoveredFailure.shortMessage, 'Line 1, col 11: expected ";"');
});

test('v18 CST view: an iterated fallible gives one row per element', t => {
  const g = v18.grammar(String.raw`
    G {
      Start = (Body ! ";")*
      Body = letter
    }`);
  const r = g.match('a;1;b;', undefined, RECOVER);
  t.true(r.succeeded());
  const rows = r.getCstRoot().children[0].children;
  t.deepEqual(
    rows.map(row => row.ctorName),
    ['_seq', '_seq', '_seq']
  );
  t.deepEqual(
    rows[1].children.map(c => c.ctorName),
    ['_fail', '_fail']
  );
  const plain = ohm.grammar('G { Start = (Body ";")*\n Body = letter }');
  t.deepEqual(messages(r), [plain.match('a;1;b;').shortMessage]);
});

// --------------------------------------------------------------------
// Unbalanced blocks and delimiters inside tokens
// --------------------------------------------------------------------

const CALLS = String.raw`
Calls {
  Body   = "{" Stmt* ! "}"
  Stmt   = Call ! ";"
  Call   = ident "(" Arg ")"
  Arg    = string | ident
  string = "\"" (~"\"" ~"\n" any)* "\""
  ident  = letter+
}`;

function skipped(result) {
  return result.getRecoveredFailures().map(f => f.interval.contents);
}

test('a synchronizer inside a matched string literal never ends a skip region', t => {
  const g = ohm.grammar(CALLS);
  const r = g.match('{\nf("a;b" x);\ng(y);\nh(;\n}', undefined, RECOVER);
  t.true(r.succeeded());
  t.deepEqual(skipped(r), ['f("a;b" x)', 'h(']);
});

test('an unterminated string recovers at its own line', t => {
  const g = ohm.grammar(CALLS);
  const r = g.match('{\nf("abc);\ng(y);\nh(;\n}', undefined, RECOVER);
  t.true(r.succeeded());
  t.deepEqual(skipped(r), ['f("abc)', 'h(']);
});

const NESTED = String.raw`
Nested {
  Outer = "{" Item* ! "}"
  Item  = Inner | Stmt
  Inner = "(" Stmt* ! ")"
  Stmt  = Body ! ";"
  Body  = letter+
}`;

test('a block missing its closer at the end of the input recovers by inserting it', t => {
  const g = ohm.grammar(CALLS);
  const source = '{\nf(x);\ng(y);';
  const plain = g.match(source);
  const r = g.match(source, undefined, RECOVER);
  t.true(r.succeeded());
  const [missing] = r.getRecoveredFailures();
  t.is(r.getRecoveredFailures().length, 1);
  t.is(missing.shortMessage, plain.shortMessage);
  t.true(missing.missing);
  t.is(missing.interval.contents, '');
});

test('a nested block missing its closer is closed at an enclosing synchronizer', t => {
  const g = ohm.grammar(NESTED);
  const r = g.match('{ a; ( b; c; } ', undefined, RECOVER);
  t.true(r.succeeded());
  t.deepEqual(
    r.getRecoveredFailures().map(f => [f.position, f.missing]),
    [[13, true]]
  );
});

test('two blocks missing their closers report one entry each', t => {
  const g = ohm.grammar(NESTED);
  const r = g.match('{ a; ( b;', undefined, RECOVER);
  t.true(r.succeeded());
  t.is(r.getRecoveredFailures().length, 2);
});

test('a block marked with a stop marker escalates instead of inserting', t => {
  const g = ohm.grammar(STMTS);
  const r = g.match('{ a; b;', undefined, RECOVER);
  t.true(r.failed());
});

const UNITS = String.raw`
Units {
  File = Unit* ! end
  Unit = unit ident "{" Stmt* ! "}"
  Stmt = Body ! ";"
  Body = ident ident?
  unit = "unit" ~alnum
  ident = ~unit letter+
  recoveryStop = unit
}`;

test('recoveryStop closes a nested block that lost its closer', t => {
  const g = ohm.grammar(UNITS);
  const source = 'unit a { x; y;\nunit b { zz z z; }';
  const r = g.match(source, undefined, RECOVER);
  t.true(r.succeeded());
  t.deepEqual(
    r.getRecoveredFailures().map(f => [source.slice(f.position, f.position + 6), f.missing]),
    [
      ['unit b', true],
      ['z; }', false],
    ]
  );
});

test('recoveryStop is inert without recovery and ignored at the outermost block', t => {
  const g = ohm.grammars(UNITS).Units;
  const plain = ohm.grammar(UNITS.replace('recoveryStop = unit', ''));
  const source = 'unit a { x y z; } unit b { w; }';
  t.is(g.match(source).shortMessage, plain.match(source).shortMessage);
  const outer = g.match('unit a { x; } x y z unit b { w; }', undefined, RECOVER);
  t.true(outer.succeeded());
  t.deepEqual(
    outer.getRecoveredFailures().map(f => f.interval.contents),
    ['x y z unit b { w; }']
  );
});

// --------------------------------------------------------------------
// Token-wise scanning with `recoveryToken`
// --------------------------------------------------------------------

const TOKENS = String.raw`
Tokens {
  Body    = "{" Stmt* ! "}"
  Stmt    = Call ! ";"
  Call    = ident "(" ListOf<Arg, ","> ")"
  Arg     = string | ident
  string  = "\"" (~"\"" ~"\n" any)* "\""
  ident   = letter+
  space  += comment
  comment = "//" (~"\n" any)*
  recoveryToken = string | ident
}`;

const CHARS = TOKENS.replace('recoveryToken = string | ident', '');

function scanBoth(source) {
  const tokens = ohm.grammar(TOKENS);
  const chars = ohm.grammar(CHARS);
  return {
    tokens: tokens.match(source, undefined, RECOVER),
    chars: chars.match(source, undefined, RECOVER),
  };
}

test('recoveryToken: a synchronizer inside a string after the failure is skipped whole', t => {
  const {tokens, chars} = scanBoth('{\nf(x y, "a;b");\ng(y);\nh(;\n}');
  t.deepEqual(skipped(tokens), ['f(x y, "a;b")', 'h(']);
  t.deepEqual(skipped(chars), ['f(x y, "a', 'b")', 'h(']);
});

test('recoveryToken: an enclosing closer inside a string after the failure is skipped whole', t => {
  const {tokens, chars} = scanBoth('{\nf(x y, "a}b");\ng(y);\n}');
  t.true(tokens.succeeded());
  t.deepEqual(skipped(tokens), ['f(x y, "a}b")']);
  t.notDeepEqual(skipped(chars), skipped(tokens));
});

test('recoveryToken: a recoveryStop inside a string after the failure is skipped whole', t => {
  const grammar = String.raw`
    Units {
      File = Unit* ! end
      Unit = unit ident "{" Stmt* ! "}"
      Stmt = Body ! ";"
      Body = ident (ident | string)?
      unit = "unit" ~alnum
      ident = ~unit letter+
      string = "\"" (~"\"" ~"\n" any)* "\""
      recoveryStop = unit
      recoveryToken = string | letter+
    }`;
  const source = 'unit a { x y "unit b"; z; }\nunit c { w; }';
  const tokens = ohm.grammar(grammar).match(source, undefined, RECOVER);
  const chars = ohm
    .grammar(grammar.replace('recoveryToken = string | letter+', ''))
    .match(source, undefined, RECOVER);
  t.deepEqual(
    tokens.getRecoveredFailures().map(f => [f.interval.contents, f.missing]),
    [['x y "unit b"', false]]
  );
  t.true(chars.getRecoveredFailures().some(f => f.missing));
});

test('recoveryToken: an unterminated string falls back to stepping one character', t => {
  const {tokens, chars} = scanBoth('{\nf("abc);\ng(y);\nh(;\n}');
  t.deepEqual(skipped(tokens), ['f("abc)', 'h(']);
  t.deepEqual(skipped(chars), skipped(tokens));
});

test('recoveryToken: comments are skipped whole and `//` inside a string is no comment', t => {
  const comment = scanBoth('{\nf(x y // a;b\n);\ng(y);\n}');
  t.deepEqual(skipped(comment.tokens), ['f(x y // a;b\n)']);
  t.deepEqual(skipped(comment.chars), skipped(comment.tokens));
  const inString = scanBoth('{\nf(x y, "a//b");\ng(y);\n}');
  t.deepEqual(skipped(inString.tokens), ['f(x y, "a//b")']);
  t.deepEqual(skipped(inString.chars), ['f(x y, "a//b");\ng(y)']);
});

test('recoveryToken: first errors are unchanged, with and without recovery', t => {
  const tokens = ohm.grammar(TOKENS);
  const chars = ohm.grammar(CHARS);
  for (const source of [
    '{\nf(x y, "a;b");\ng(y);\n}',
    '{\nf(x y, "a}b");\ng(y);\n}',
    '{\nf("abc);\ng(y);\n}',
    '{\nf(x y // a;b\n);\n}',
    '{\nf(x);\ng(y);',
    '{ f(x); } g',
  ]) {
    t.is(tokens.match(source).shortMessage, chars.match(source).shortMessage);
    t.deepEqual(messages(tokens.match(source, undefined, RECOVER)).slice(0, 1), [
      chars.match(source).shortMessage,
    ]);
  }
});

test('identical recovered failures at one position are reported once', t => {
  const g = ohm.grammar(String.raw`
    Blocks {
      Block = "{" Item* ! "}"
      Item  = Block | Stmt
      Stmt  = Body ! ";"
      Body  = letter+
    }`);
  const r = g.match('{ a; { b;', undefined, RECOVER);
  t.true(r.succeeded());
  t.deepEqual(
    r.getRecoveredFailures().map(f => [f.position, f.shortMessage, f.missing]),
    [[9, 'Line 1, col 10: expected "}"', true]]
  );
});
