/**
 * Acceptance test for `B ! C` recovery.
 *
 * Story: a grammar author marks `Part` as a recovery point. Without asking
 * for recovery, the grammar matches exactly as if `!` were a plain sequence.
 * Asking for recovery, one match reports every broken part, including a part
 * broken at its first character, with the message a plain match gives for
 * that mistake alone, and the CST holds a `_correction` node for each broken part.
 * Recovery never changes a valid parse, never preempts an alternative that
 * matches, never runs past an enclosing stop marker, and always consumes
 * input.
 */

/* eslint-disable max-len, ava/assertion-arguments -- expected messages and trees are long literals; t.deepEqual messages carry the input */
import test from 'ava';
import * as ohm from '../index.mjs';

const FALLIBLE = String.raw`
Chips {
  Chip = "CHIP" name "{" Part* "}"
  Part = PartBody ! ";"
  PartBody = name "(" name ")"
  name = letter alnum*
}`;

const PLAIN = FALLIBLE.replace('PartBody ! ";"', 'PartBody ";"');
const LOOKAHEAD = FALLIBLE.replace('Part = PartBody ! ";"', 'Part = PartBody ! &";" ";"');

const VALID = 'CHIP A { N(a); M(b); }';
const BROKEN = 'CHIP A { N(a b); M(c); X(; }';
const UNCLOSED = 'CHIP A { N(a); M(b';
const FIRST_TOKEN = 'CHIP A { 1N(a); M(c); }';
const MISSING = 'CHIP A { ; M(c); }';
const INPUTS = [VALID, BROKEN, UNCLOSED, FIRST_TOKEN, MISSING];

const FIRST_TOKEN_MESSAGE = 'Line 1, col 10: expected "}" or a letter';

// An iteration followed by a closer, bounded by a stop marker.
const BLOCKS = String.raw`
Blocks {
  Prog = Sub*
  Sub = "sub" "{" Stmt* ! &"}" "}"
  Stmt = StmtBody ! ";"
  StmtBody = Let | Do
  Let = "let" letter
  Do = "do" letter
}`;
const BLOCKS_PLAIN = BLOCKS.replace('Stmt* ! &"}"', 'Stmt* &"}"').replace(
  'StmtBody ! ";"',
  'StmtBody ";"'
);

// A Fallible in the first alternative of a choice.
const CHOICE = String.raw`
Choice {
  Prog = Stmt*
  Stmt = (Let ! ";") -- guarded
       | (Do ";") -- plain
  Let = "let" letter
  Do = "do" letter
}`;
const CHOICE_PLAIN = CHOICE.replace('(Let ! ";")', '(Let ";")');

const RECOVER = {recover: true};

const EXPECTED_RECOVERIES = [
  {startIdx: 9, endIdx: 15, position: 13, message: 'Line 1, col 14: expected ")"'},
  {startIdx: 23, endIdx: 25, position: 25, message: 'Line 1, col 26: expected a letter'},
];

function recoveries(result) {
  return result.getRecoveredFailures().map(f => ({
    startIdx: f.interval.startIdx,
    endIdx: f.interval.endIdx,
    position: f.position,
    message: f.shortMessage,
  }));
}

function outcome(result) {
  return result.succeeded()
    ? {succeeded: true, recovered: recoveries(result)}
    : {succeeded: false, message: result.shortMessage};
}

function run(source, input, options) {
  return outcome(ohm.grammar(source).match(input, undefined, options));
}

// CST shape through a semantics operation, so `_correction` dispatch and arity are exercised.
function cstShape(source, input, options) {
  const g = ohm.grammar(source);
  const r = g.match(input, undefined, options);
  if (r.failed()) return null;
  const s = g.createSemantics().addOperation('shape', {
    _nonterminal(...children) {
      return {ctorName: this.ctorName, children: children.map(c => c.shape())};
    },
    _terminal() {
      return this.sourceString;
    },
    _iter(...children) {
      return children.map(c => c.shape());
    },
    _correction() {
      return {ctorName: '_correction', skipped: this.sourceString};
    },
  });
  return s(r).shape();
}

// Structure of a rule body, without source locations.
function bodyShape(rhs) {
  const g = ohm.grammar(String.raw`
G {
  Start = ${rhs}
  Stmt = "s" ";"
  Close = "}"
  Other = "o"
  A = "a"
  B = "b"
  C = "c"
  Line = "l"
  Semi = ";"
}`);
  return JSON.stringify(g.rules.Start.body, (k, v) =>
    k === 'source'
      ? undefined
      : v instanceof Object && !Array.isArray(v)
        ? {kind: v.constructor.name, ...v}
        : v
  );
}

test('syntax: `!` is looser than `*`, `&` and `~`, and tighter than sequence', t => {
  // Whitespace around `!` is optional, and `!&` is two tokens.
  t.is(bodyShape('Line!Semi'), bodyShape('Line ! Semi'));
  t.is(bodyShape('Line! Semi'), bodyShape('Line ! Semi'));
  t.is(bodyShape('((Stmt*)!&Close) Close'), bodyShape('Stmt* ! &Close Close'));

  // Precedence.
  t.is(bodyShape('A B ! C'), bodyShape('A (B ! C)'));
  t.is(bodyShape('Stmt* ! &Close Other'), bodyShape('(Stmt* ! &Close) Other'));
  t.is(bodyShape('A ! C+'), bodyShape('A ! (C+)'));
  t.is(bodyShape('A A A A | B ! C C'), bodyShape('A A A A | (B ! C) C'));

  // Errors: no chains, no trailing `!`, and a left side that cannot recover.
  t.throws(() => bodyShape('A ! B ! C'));
  t.throws(() => bodyShape('(A ! B) ! C'), {message: /arity/});
  t.throws(() => bodyShape('A !'));
  t.throws(() => bodyShape('~A ! C'));
  t.throws(() => bodyShape('&A ! C'));

  // A quoted "!" is still a terminal.
  t.notThrows(() => bodyShape('A "!" B'));

  // toString round-trips: printing a body and parsing it again gives the same structure.
  for (const rhs of ['Stmt* ! &Close Close', 'A B ! C', 'A ! C+']) {
    const printed = ohm
      .grammar(`G { Start = ${rhs}\n Stmt = "s"\n Close = "}"\n A = "a"\n B = "b"\n C = "c" }`)
      .rules.Start.body.toString();
    t.is(bodyShape(printed), bodyShape(rhs), printed);
  }
});

function withoutAbsence(tree) {
  if (Array.isArray(tree))
    { return tree.filter(x => !Array.isArray(x) || x.length).map(withoutAbsence); }
  if (tree && tree.children) return {...tree, children: withoutAbsence(tree.children)};
  return tree;
}

test('without recover, `!` matches as a plain sequence', t => {
  for (const input of INPUTS) {
    t.deepEqual(run(FALLIBLE, input), run(PLAIN, input), input);
    t.deepEqual(
      withoutAbsence(cstShape(FALLIBLE, input)),
      withoutAbsence(cstShape(PLAIN, input)),
      input
    );
  }
});

test('with recover, one match reports every broken part', t => {
  t.deepEqual(run(FALLIBLE, VALID, RECOVER), {succeeded: true, recovered: []});
  t.deepEqual(
    withoutAbsence(cstShape(FALLIBLE, VALID, RECOVER)),
    withoutAbsence(cstShape(PLAIN, VALID))
  );

  t.deepEqual(run(FALLIBLE, BROKEN, RECOVER), {
    succeeded: true,
    recovered: EXPECTED_RECOVERIES,
  });

  const chip = cstShape(FALLIBLE, BROKEN, RECOVER);
  const parts = chip.children[3];
  // Each Part has three slots: the guarded PartBody (or an empty placeholder)
  // the correction region, and the actual synchronizer `;`.
  t.deepEqual(
    parts.map(p =>
      p.children.map(c =>
        typeof c === 'string'
          ? c
          : `${c.ctorName}${c.skipped !== undefined ? `<${c.skipped}>` : ''}`
      )
    ),
    [
      ['undefined', '_correction<N(a b)>', ';'],
      ['PartBody', 'undefined', ';'],
      ['undefined', '_correction<X(>', ';'],
    ]
  );

  // A parse that recovery cannot finish reports what a plain match reports.
  t.deepEqual(run(FALLIBLE, UNCLOSED, RECOVER), run(PLAIN, UNCLOSED));
});

test('with recover, a part broken at its first character recovers', t => {
  t.deepEqual(run(FALLIBLE, FIRST_TOKEN, RECOVER), {
    succeeded: true,
    recovered: [{startIdx: 9, endIdx: 14, position: 9, message: FIRST_TOKEN_MESSAGE}],
  });
  // A bare `;` is a missing part: nothing is skipped and the synchronizer is consumed.
  t.deepEqual(run(FALLIBLE, MISSING, RECOVER), {
    succeeded: true,
    recovered: [{startIdx: 9, endIdx: 9, position: 9, message: FIRST_TOKEN_MESSAGE}],
  });
});

test('recovery stops at an enclosing stop marker', t => {
  const valid = 'sub { let x; } sub { do y; }';
  t.deepEqual(run(BLOCKS, valid, RECOVER), {succeeded: true, recovered: []});
  t.deepEqual(
    withoutAbsence(cstShape(BLOCKS, valid, RECOVER)),
    withoutAbsence(cstShape(BLOCKS_PLAIN, valid))
  );

  // A first-token typo before a `;` recovers just that statement.
  t.deepEqual(run(BLOCKS, 'sub { lt y; do x; } sub { do z; }', RECOVER).recovered, [
    {
      startIdx: 6,
      endIdx: 10,
      position: 6,
      message: 'Line 1, col 7: expected "}", "do", or "let"',
    },
  ]);

  // With no `;` before the closer, the statement's scan stops at `}` and the
  // block's fallible recovers instead. It keeps `let x;`, its skip region
  // starts where the statements stopped, and the closer and the next block survive.
  const broken = 'sub { let x; lt y } sub { do z; }';
  t.deepEqual(run(BLOCKS, broken, RECOVER).recovered, [
    {
      startIdx: 13,
      endIdx: 17,
      position: 13,
      message: 'Line 1, col 14: expected "}", "do", or "let"',
    },
  ]);
  const subs = cstShape(BLOCKS, broken, RECOVER).children[0];
  t.is(subs.length, 2);
  // The kept statements fill the guarded slot; the skip region fills the stop marker's slot.
  t.deepEqual(
    subs[0].children[2].map(s => s.ctorName),
    ['Stmt']
  );
  t.deepEqual(subs[0].children[3], {ctorName: '_correction', skipped: 'lt y'});
  t.deepEqual(
    withoutAbsence(subs[1]),
    withoutAbsence(cstShape(BLOCKS_PLAIN, 'sub { do z; }').children[0][0])
  );

  // A recovery inside the kept statements stays in its own node, and the list
  // is in failure position order, so the first entry equals the plain match's error.
  t.deepEqual(run(BLOCKS, 'sub { let ; lt y } sub { do z; }', RECOVER).recovered, [
    {startIdx: 6, endIdx: 9, position: 10, message: 'Line 1, col 11: expected a letter'},
    {
      startIdx: 12,
      endIdx: 16,
      position: 12,
      message: 'Line 1, col 13: expected "}", "do", or "let"',
    },
  ]);
});

// Recovery keeps valid prior work: a guarded `*` keeps the elements it
// matched, and the skip region fills the synchronizer's slot.
const EXACT = String.raw`
Exact {
  Block = "{" Stmt* ! &"}" "}"
  Stmt  = Body ! ";"
  Body  = ident
  ident = letter+
}`;

const NESTED = String.raw`
Nested {
  Block  = "{" Stmt* ! &"}" "}"
  Stmt   = Block | Simple
  Simple = Body ! ";"
  Body   = ident
  ident  = letter+
}`;

const PLUS = EXACT.replace('Stmt* !', 'Stmt+ !');

// Renders a block the way a grammar author's semantic actions see it.
function blockView(source, input) {
  const g = ohm.grammar(source);
  const r = g.match(input, undefined, RECOVER);
  const statement = (body, correction, _semi) => {
    const tail = correction.ctorName === '_correction' ? ' ' + correction.show() : '';
    return `Stmt(${body.show()}${tail})`;
  };
  const actions = {
    Block(_open, stmts, correction, _stop, _close) {
      const kept = stmts.children.map(c => c.show()).join(' ');
      const slot = correction.ctorName === '_correction' ? ' | ' + correction.show() : '';
      return `Block[${kept}${slot}]`;
    },
    Body(id) {
      return id.sourceString;
    },
    _iter(...children) {
      return children.length ? children.map(c => c.show()).join(' ') : 'EMPTY';
    },
    _correction() {
      return this.sourceString === ''
        ? 'EMPTY'
        : `FAIL<${this.sourceString.replace(/\s+/g, ' ')}>`;
    },
  };
  if ('Simple' in g.rules) {
    actions.Stmt = x => x.show();
    actions.Simple = statement;
  } else {
    actions.Stmt = statement;
  }
  const errors = r.getRecoveredFailures().map(f => f.shortMessage);
  if (r.failed()) return {failed: r.shortMessage, errors};
  const s = g.createSemantics().addOperation('show', actions);
  return {tree: s(r).show(), errors};
}

test('recovery keeps valid prior work', t => {
  const cases = [
    // aaa and bbb are kept, xxx fills the stop marker's slot, and `}` matches normally.
    [
      EXACT,
      '{\naaa;\nbbb;\nxxx\n}',
      'Block[Stmt(aaa) Stmt(bbb) | FAIL<xxx>]',
      ['Line 5, col 1: expected ";"'],
    ],
    // Error at the first statement: nothing to keep.
    [EXACT, '{\nxxx\n}', 'Block[ | FAIL<xxx>]', ['Line 3, col 1: expected ";"']],
    // A first-token typo recovers at its own `;`; later statements are kept.
    [
      EXACT,
      '{\n1aa;\nbbb;\n}',
      'Block[Stmt(EMPTY FAIL<1aa>) Stmt(bbb)]',
      ['Line 2, col 1: expected "}" or a letter'],
    ],
    // An error in the middle recovers at its `;`; statements on both sides are kept.
    [
      EXACT,
      '{\naaa;\nb b;\nccc;\n}',
      'Block[Stmt(aaa) Stmt(b FAIL<b>) Stmt(ccc)]',
      ['Line 3, col 3: expected ";"'],
    ],
    // An empty block is valid.
    [EXACT, '{\n}', 'Block[]', []],
    // Every independent error in one block is reported from one parse.
    [
      EXACT,
      '{\naaa;\nb b;\nc c;\nddd;\nxxx\n}',
      'Block[Stmt(aaa) Stmt(b FAIL<b>) Stmt(c FAIL<c>) Stmt(ddd) | FAIL<xxx>]',
      [
        'Line 3, col 3: expected ";"',
        'Line 4, col 3: expected ";"',
        'Line 7, col 1: expected ";"',
      ],
    ],
    // Nested blocks: each block keeps its own prefix.
    [
      NESTED,
      '{\naaa;\n{\nbbb;\nxxx\n}\nccc;\n}',
      'Block[Stmt(aaa) Block[Stmt(bbb) | FAIL<xxx>] Stmt(ccc)]',
      ['Line 6, col 1: expected ";"'],
    ],
    [
      NESTED,
      '{\naaa;\n{\nbbb;\n}\nyyy\n}',
      'Block[Stmt(aaa) Block[Stmt(bbb)] | FAIL<yyy>]',
      ['Line 7, col 1: expected ";"'],
    ],
    [NESTED, '{\naaa;\n{\n}\n}', 'Block[Stmt(aaa) Block[]]', []],
    // A guarded `+` keeps its prefix too; with no element matched, its slot holds an empty iteration.
    [PLUS, '{\naaa;\nxxx\n}', 'Block[Stmt(aaa) | FAIL<xxx>]', ['Line 4, col 1: expected ";"']],
    [PLUS, '{\nxxx\n}', 'Block[ | FAIL<xxx>]', ['Line 3, col 1: expected ";"']],
  ];
  for (const [source, input, tree, errors] of cases) {
    t.deepEqual(blockView(source, input), {tree, errors}, input);
  }
});

test('a parse recovery cannot finish reports every error it found', t => {
  // Two broken parts and no closing brace: both recoveries, then the final failure.
  const r = ohm.grammar(FALLIBLE).match('CHIP A { N(a b); X(; M(c', undefined, RECOVER);
  t.true(r.failed());
  t.is(r.shortMessage, ohm.grammar(PLAIN).match('CHIP A { N(a b); X(; M(c').shortMessage);
  t.deepEqual(
    r.getRecoveredFailures().map(f => f.shortMessage),
    [
      'Line 1, col 14: expected ")"',
      'Line 1, col 20: expected a letter',
      'Line 1, col 25: expected ")"',
    ]
  );
});

test('a synchronizer must have arity 1', t => {
  t.throws(() => bodyShape('A ! (B C)'), {message: /arity/});
  t.notThrows(() => bodyShape('A ! &Close'));
});

test('a guarded rule application or sequence keeps nothing', t => {
  // `Part = PartBody ! ";"`: a partly matched PartBody has no well-formed node,
  // so its slot holds an empty placeholder and the whole region from the start
  // of PartBody is the skip region, in the `;` slot.
  const chip = cstShape(FALLIBLE, BROKEN, RECOVER);
  t.deepEqual(chip.children[3][0].children, [
    [],
    {ctorName: '_correction', skipped: 'N(a b)'},
    ';',
  ]);
});

test('recovery never preempts an alternative that matches', t => {
  const valid = 'do x; let y;';
  t.deepEqual(run(CHOICE, valid, RECOVER), {succeeded: true, recovered: []});
  t.deepEqual(
    withoutAbsence(cstShape(CHOICE, valid, RECOVER)),
    withoutAbsence(cstShape(CHOICE_PLAIN, valid))
  );

  const broken = 'do x; dx y; let z;';
  t.deepEqual(run(CHOICE, broken, RECOVER).recovered, [
    {
      startIdx: 6,
      endIdx: 10,
      position: 6,
      message: 'Line 1, col 7: expected end of input, "do", or "let"',
    },
  ]);
  const stmts = cstShape(CHOICE, broken, RECOVER).children[0];
  t.deepEqual(
    stmts.map(s => s.children[0].children[0].ctorName || '_iter'),
    ['Do', '_iter', 'Let']
  );
});

test('every recovery consumes input, so recovery terminates', t => {
  // A zero-width synchronizer cannot recover a missing part; the match fails as plain.
  t.deepEqual(run(LOOKAHEAD, MISSING, RECOVER), run(PLAIN, MISSING));

  // Thirty stray separators give thirty recoveries, each consuming its `;`.
  const strays = 'sub { ' + '; '.repeat(30) + '}';
  const {succeeded, recovered} = run(BLOCKS, strays, RECOVER);
  t.true(succeeded);
  t.is(recovered.length, 30);
  t.true(recovered.every((r, i) => r.position === 6 + 2 * i));
});

test('`B ! &C` stops before the synchronizer and recovers the same mistakes', t => {
  for (const input of INPUTS) {
    t.deepEqual(run(LOOKAHEAD, input), run(PLAIN, input), input);
  }
  t.deepEqual(run(LOOKAHEAD, BROKEN, RECOVER).recovered, EXPECTED_RECOVERIES);
});

test('an operation without a `_correction` action throws on a recovered node', t => {
  const g = ohm.grammar(FALLIBLE);
  const s = g.createSemantics().addOperation('count', {
    Chip(_c, _n, _o, parts, _cl) {
      return parts.children.reduce((sum, p) => sum + p.count(), 0);
    },
    Part(body, correction, _semi) {
      return correction.ctorName === '_correction' ? correction.count() : body.count();
    },
    PartBody(_name, _open, _arg, _close) {
      return 1;
    },
  });
  t.is(s(g.match(VALID, undefined, RECOVER)).count(), 2);
  t.throws(() => s(g.match(BROKEN, undefined, RECOVER)).count(), {message: /_correction/});
});
