// Grammars, input generators, and equivalence helpers for the Fallible benchmark.
// Everything is deterministic (no randomness).

// ---------------------------------------------------------------------
// The `Prog` grammar family: identical except for `!` and recoveryToken.
// ---------------------------------------------------------------------

const PROG_TEMPLATE = String.raw`
Prog {
  Prog = Fn*
  Fn = "fn" ident "(" ListOf<ident, ","> ")" Block
  Block = "{" Stmt* @BLOCK@ "}"
  Stmt = Body @STMT@ ";"
  Body = Let | Return | If | Assign | CallStmt
  Let = "let" ident "=" Expr
  Return = "return" Expr
  If = "if" "(" Expr ")" Block
  Assign = ident "=" Expr
  CallStmt = ident "(" ListOf<Expr, ","> ")"
  Expr = AddExp
  AddExp = AddExp "+" MulExp  -- plus
         | AddExp "-" MulExp  -- minus
         | MulExp
  MulExp = MulExp "*" PriExp  -- times
         | MulExp "/" PriExp  -- div
         | PriExp
  PriExp = "(" Expr ")"  -- paren
         | ident "(" ListOf<Expr, ","> ")"  -- call
         | number
         | ident
  keyword = ("fn" | "let" | "return" | "if") ~alnum
  ident = ~keyword letter alnum*
  number = digit+
  @TOKEN@
}`;

export function progGrammar(variant) {
  const bang = variant === 'bang' || variant === 'bangTok';
  const tok = variant === 'bangTok' || variant === 'plainTok';
  return PROG_TEMPLATE.replace('@BLOCK@', bang ? '! &"}"' : '&"}"')
    .replace('@STMT@', bang ? '!' : '')
    .replace('@TOKEN@', tok ? 'recoveryToken = number | ident | any' : '');
}

// ---------------------------------------------------------------------
// Statements. Ten per function (the `if` holds two more, nested).
// ---------------------------------------------------------------------

const GOOD = [
  i => `let v${i} = a + b * ${i};`,
  i => `x${i} = (a - ${i}) / 2;`,
  i => `foo(a, b + ${i}, f(1, 2));`,
  i => `if (a) { let t${i} = ${i}; u${i} = t${i} + 1; };`,
  i => `return a + b - ${i};`,
  i => `let w${i} = g(a, b) * 3 + ${i};`,
  i => `y${i} = a;`,
  i => 'bar();',
  i => `let z${i} = ((a + 1) * (b - 2)) / ${i + 1};`,
  i => `k${i} = 1 + 2 + 3 + ${i};`,
];

// Each broken statement yields exactly one recovered failure in isolation
// (checked by the sanity assertions, not assumed).
const BAD = [
  i => `let v${i} = ;`, // missing operand
  i => `x${i} = 1 2;`, // extra token before the synchronizer
  i => `foo(a, ${i};`, // unclosed call
];

export const STMTS_PER_FN = GOOD.length;

/**
 * Builds a program of `scale` functions with ten statements each ('blocks'),
 * or one function with `10 * scale` statements ('flat'). `broken` is a Set of
 * global statement indexes to corrupt. Returns {text, errors}.
 */
export function makeProgram(scale, shape, broken = new Set()) {
  const total = scale * STMTS_PER_FN;
  const stmts = [];
  let errors = 0;
  let b = 0;
  for (let k = 0; k < total; k++) {
    if (broken.has(k)) {
      stmts.push(BAD[b++ % BAD.length](k));
      errors++;
    } else {
      stmts.push(GOOD[k % GOOD.length](k));
    }
  }
  if (shape === 'flat') {
    return {text: `fn main(a, b) {\n${stmts.map(s => '  ' + s).join('\n')}\n}\n`, errors};
  }
  const fns = [];
  for (let f = 0; f < scale; f++) {
    const body = stmts.slice(f * STMTS_PER_FN, (f + 1) * STMTS_PER_FN);
    fns.push(`fn f${f}(a, b) {\n${body.map(s => '  ' + s).join('\n')}\n}`);
  }
  return {text: fns.join('\n') + '\n', errors};
}

/** Regimes: valid, invalid-single (one error, middle), invalid-dense (one per ten statements). */
export function makeInput(scale, shape, regime) {
  const total = scale * STMTS_PER_FN;
  let broken = new Set();
  if (regime === 'invalid-single') {
    // Avoid the `if` statements (index % 10 === 3) so that the error is a top-level one.
    let k = Math.floor(total / 2);
    while (k % STMTS_PER_FN === 3) k++;
    broken = new Set([k]);
  } else if (regime === 'invalid-dense') {
    for (let f = 0; f < scale; f++) broken.add(f * STMTS_PER_FN + 5);
  }
  return makeProgram(scale, shape, broken);
}

// ---------------------------------------------------------------------
// Synthetic grammars for construction cost: N rules, optionally with `!`.
// ---------------------------------------------------------------------

export function syntheticGrammar(nRules, withBang) {
  const bang = withBang ? '!' : '';
  const lines = ['Syn {', '  Start = R0'];
  for (let i = 0; i < nRules; i++) {
    const next = i + 1 < nRules ? `R${i + 1}` : '"end"';
    lines.push(`  R${i} = A ${bang} ";" B* ${withBang ? '! &"}"' : '&"}"'} "}" ${next}?`);
  }
  lines.push('  A = letter+', '  B = digit+', '}');
  return lines.join('\n');
}

// ---------------------------------------------------------------------
// Equivalence helpers (public API only, so they run on both trees).
// ---------------------------------------------------------------------

/**
 * Hash constructor names and child topology, including source intervals when present.
 * Raw CST nodes have no source: their lengths, offsets and recovery fields are omitted.
 */
export function signature(node) {
  const parts = [];
  const walk = n => {
    parts.push(n.ctorName, n.source ? `${n.source.startIdx}-${n.source.endIdx}` : '');
    if (n.children) {
      parts.push('[');
      for (const c of n.children) walk(c);
      parts.push(']');
    }
  };
  walk(node);
  // A 32-bit FNV-1a over the signature keeps the stored value small.
  let h = 0x811c9dc5;
  const s = parts.join(',');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${s.length}:${h.toString(16)}`;
}

export function countNodes(node) {
  let n = 0;
  const walk = x => {
    n++;
    if (x.children) for (const c of x.children) walk(c);
  };
  walk(node);
  return n;
}

// ---------------------------------------------------------------------
// The `Lex` family: lexical rules only (no implicit space skipping).
// ---------------------------------------------------------------------

export const LINES_PER_SCALE = 100;

export function lexGrammar(variant) {
  const bang = variant === 'bang';
  return String.raw`
Lex {
  lines = line* end
  line = row ${bang ? '!' : ''} "\n"
  row = cell ("," cell)*
  cell = word | num
  word = letter alnum*
  num = digit+
}`;
}

export function makeLexInput(scale, regime) {
  const n = scale * LINES_PER_SCALE;
  const broken = new Set();
  if (regime === 'invalid-single') broken.add(Math.floor(n / 2));
  if (regime === 'invalid-dense') for (let k = 5; k < n; k += 10) broken.add(k);
  const lines = [];
  for (let k = 0; k < n; k++) {
    lines.push(broken.has(k) ? `abc,;,${k}` : `abc,${k},def${k},12`);
  }
  return {text: lines.join('\n') + '\n', errors: broken.size};
}

// ---------------------------------------------------------------------
// Workload and configuration tables shared by every worker mode.
// ---------------------------------------------------------------------

export function grammarSource(family, variant) {
  return family === 'lex' ? lexGrammar(variant) : progGrammar(variant);
}

export function inputFor(family, scale, shape, regime) {
  return family === 'lex' ? makeLexInput(scale, regime) : makeInput(scale, shape, regime);
}

/** family x shape x regime. */
export const WORKLOADS = [
  {family: 'prog', shape: 'blocks', regime: 'valid'},
  {family: 'prog', shape: 'flat', regime: 'valid'},
  {family: 'prog', shape: 'blocks', regime: 'invalid-single'},
  {family: 'prog', shape: 'flat', regime: 'invalid-single'},
  {family: 'prog', shape: 'blocks', regime: 'invalid-dense'},
  {family: 'prog', shape: 'flat', regime: 'invalid-dense'},
  {family: 'lex', shape: 'lines', regime: 'valid'},
  {family: 'lex', shape: 'lines', regime: 'invalid-single'},
  {family: 'lex', shape: 'lines', regime: 'invalid-dense'},
];

/**
 * Configurations. `variant` selects the grammar text; `recover` the match option.
 * `baselineOk` configurations also run on the baseline tree (no options passed).
 * `tok` configurations apply to the `prog` family only.
 */
export const VARIANT_CONFIGS = [
  {id: 'plain/match', variant: 'plain', recover: false, baselineOk: true},
  {id: 'plain/recover', variant: 'plain', recover: true},
  {id: 'bang/match', variant: 'bang', recover: false},
  {id: 'bang/recover', variant: 'bang', recover: true},
  {id: 'bangTok/recover', variant: 'bangTok', recover: true, progOnly: true},
];

/** Expands the tables into the list of cells for one tree. */
export function matchCases(tree) {
  const cases = [];
  for (const w of WORKLOADS) {
    for (const c of VARIANT_CONFIGS) {
      if (tree === 'baseline' && !c.baselineOk) continue;
      if (c.progOnly && w.family !== 'prog') continue;
      cases.push({...w, config: c.id, variant: c.variant, recover: c.recover});
    }
  }
  return cases;
}

export const caseKey = c => `${c.family}|${c.shape}|${c.regime}|${c.config}`;
