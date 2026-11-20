import test from 'ava';
import * as ohm from '../index.mjs';

const RECOVER = {recover: true};

test('default fallible reports its declared join boundary when insertion cannot continue', t => {
  const grammar = ohm.grammar('G { Start = ("name" ! ";") "tail" }');
  const modes = [{}, ...['auto', 'cached', 'probe'].map(firstPass => ({recover: true, firstPass}))];
  for (const options of modes) {
    const result = grammar.match('name wrong', undefined, options);
    t.true(result.failed());
    t.is(result.getRightmostFailurePosition(), 5);
    t.is(result.getDiagnosticPosition(), 4);
    t.is(result.shortMessage, 'Line 1, col 5: expected ";"');
    if (options.recover) {
      const [failure] = result.getRecoveredFailures();
      t.is(failure.position, 5);
      t.is(failure.getDiagnosticPosition(), 4);
      t.false(failure.missing);
    }
  }
});
const STATEMENTS = String.raw`
  G {
    Program = Stmt* ! end
    Stmt = Let | Do | Return
    Let = LetBody ! ";"
    LetBody = "let" name "=" number
    Do = DoBody ! ";"
    DoBody = "do" name "(" name ")"
    Return = "return" ";"
    name = letter alnum*
    number = digit+
  }
`;

function parse(source, input, startRule) {
  const grammar = typeof source === 'string' ? ohm.grammar(source) : source;
  const result = grammar.match(input, startRule, RECOVER);
  return {grammar, result};
}

// Inspect public semantics, including zero-width correction and join intervals.
// Accepting damaged input alone does not establish that its body survived.
function tree(grammar, result) {
  const semantics = grammar.createSemantics().addOperation('snapshot', {
    _nonterminal(...children) {
      return snapshot(this, children);
    },
    _iter(...children) {
      return snapshot(this, children);
    },
    _terminal() {
      return snapshot(this, []);
    },
    _correction() {
      return snapshot(this, []);
    },
  });
  return semantics(result).snapshot();
}

function snapshot(node, children) {
  return {
    kind: node.ctorName,
    text: node.sourceString,
    start: node.source.startIdx,
    end: node.source.endIdx,
    children: children.map(child => child.snapshot()),
  };
}

function nodes(root, kind) {
  return [root, ...root.children.flatMap(child => nodes(child, kind))].filter(
    node => node.kind === kind
  );
}

function assertInsertion(t, failure, position, punctuation) {
  t.true(failure.missing);
  t.is(failure.position, position);
  t.true(failure.shortMessage.includes('expected'));
  t.true(failure.shortMessage.includes(`"${punctuation}"`));
}

function assertInsertedJoin(t, node, position) {
  const [correction, join] = node.children.slice(-2);
  t.deepEqual(
    [correction.kind, correction.text, correction.start, correction.end],
    ['_correction', '', position, position]
  );
  t.deepEqual([join.text, join.start, join.end], ['', position, position]);
}

test('a missing semicolon retains both statements and precedes skipped whitespace', t => {
  const input = 'let a = 1\nlet b = 2;';
  const {grammar, result} = parse(STATEMENTS, input);
  t.true(result.succeeded());
  const failures = result.getRecoveredFailures();
  t.is(failures.length, 1);
  assertInsertion(t, failures[0], input.indexOf('\n'), ';');
  const lets = nodes(tree(grammar, result), 'Let');
  t.deepEqual(
    lets.map(node => node.text),
    ['let a = 1', 'let b = 2;']
  );
  t.deepEqual(
    nodes(lets[0], 'LetBody').map(node => node.text),
    ['let a = 1']
  );
  assertInsertedJoin(t, lets[0], input.indexOf('\n'));
});

test('consecutive missing semicolons retain the do and return statements', t => {
  const input = 'let x = 5\ndo printInt(x)\nreturn;';
  const {grammar, result} = parse(STATEMENTS, input);
  t.true(result.succeeded());
  const failures = result.getRecoveredFailures();
  t.is(failures.length, 2);
  const positions = [input.indexOf('\n'), input.lastIndexOf('\n')];
  failures.forEach((failure, i) => assertInsertion(t, failure, positions[i], ';'));
  const root = tree(grammar, result);
  t.deepEqual(
    nodes(root, 'Stmt').map(node => node.text),
    ['let x = 5', 'do printInt(x)', 'return;']
  );
  assertInsertedJoin(t, nodes(root, 'Let')[0], positions[0]);
  assertInsertedJoin(t, nodes(root, 'Do')[0], positions[1]);
});

test('a missing semicolon before the block closer keeps the statement', t => {
  const source = STATEMENTS.replace('Program = Stmt* ! end', 'Program = "{" Stmt* ! "}"');
  const input = '{ let a = 1 }';
  const {grammar, result} = parse(source, input);
  t.true(result.succeeded());
  t.is(result.getRecoveredFailures().length, 1);
  assertInsertion(t, result.getRecoveredFailures()[0], input.indexOf('1') + 1, ';');
  const root = tree(grammar, result);
  const statement = nodes(root, 'Let')[0];
  t.is(statement.text, 'let a = 1');
  assertInsertedJoin(t, statement, input.indexOf('1') + 1);
  t.is(root.children.at(-1).text, '}');
});

test('a missing while opener retains its body and consumes its real closer once', t => {
  const source = STATEMENTS.replace(
    'Program = Stmt* ! end',
    'Program = While Return\n While = ("while" "(" name ")") ! "{" Stmt* ! "}"'
  );
  const input = 'while (x)\n  let y = 1;\n}\nreturn;';
  const {grammar, result} = parse(source, input);
  t.true(result.succeeded());
  t.is(result.getRecoveredFailures().length, 1);
  assertInsertion(t, result.getRecoveredFailures()[0], input.indexOf(')') + 1, '{');
  const root = tree(grammar, result);
  const loop = nodes(root, 'While')[0];
  t.deepEqual(
    nodes(loop, 'LetBody').map(node => node.text),
    ['let y = 1']
  );
  const correction = nodes(loop, '_correction')[0];
  t.deepEqual([correction.text, correction.start, correction.end], ['', 9, 9]);
  t.is(loop.children.at(-1).text, '}');
  t.deepEqual(
    nodes(root, 'Return').map(node => node.text),
    ['return;']
  );
});

test('HDL parts retain the part after a missing semicolon', t => {
  const source = String.raw`HDL {
    Parts = Part* ! end
    Part = PartBody ! ";"
    PartBody = name "(" Wires ")"
    Wires = ListOf<Wire, ",">
    Wire = name "=" name
    name = letter alnum*
  }`;
  const input = 'Not(in=a, out=b)\nAnd(a=b, b=c, out=out);';
  const {grammar, result} = parse(source, input);
  t.true(result.succeeded());
  t.is(result.getRecoveredFailures().length, 1);
  assertInsertion(t, result.getRecoveredFailures()[0], input.indexOf('\n'), ';');
  const parts = nodes(tree(grammar, result), 'Part');
  t.deepEqual(
    parts.map(node => node.text),
    ['Not(in=a, out=b)', 'And(a=b, b=c, out=out);']
  );
  assertInsertedJoin(t, parts[0], input.indexOf('\n'));
});

test('for-header insertion occurs at 1:11 and retains all three clauses', t => {
  const source = String.raw`ForHeader {
    Header = "for" "(" (Init ! ";") (Cond ! ";") Update ")"
    Init = name "=" digit+
    Cond = name "<" name
    Update = name "++"
    name = letter alnum*
  }`;
  const input = 'for (i = 0 i < n; i++)';
  const {grammar, result} = parse(source, input);
  t.true(result.succeeded());
  t.is(result.getRecoveredFailures().length, 1);
  const failure = result.getRecoveredFailures()[0];
  assertInsertion(t, failure, 10, ';');
  t.regex(failure.shortMessage, /^Line 1, col 11:/);
  const root = tree(grammar, result);
  t.deepEqual(
    ['Init', 'Cond', 'Update'].map(kind => nodes(root, kind)[0].text),
    ['i = 0', 'i < n', 'i++']
  );
});

test('unexpected text resynchronizes at the next statement and reports the missing join', t => {
  const input = 'let a = 1 xyz let b = 2;';
  const {grammar, result} = parse(STATEMENTS, input);
  t.true(result.succeeded());
  const failures = result.getRecoveredFailures();
  // Skipped text and the missing join may share a diagnostic or be reported separately.
  t.true(failures.length === 1 || failures.length === 2);
  const missing = failures.find(failure => failure.missing);
  t.truthy(missing);
  assertInsertion(t, missing, 9, ';');
  const skipped = failures.find(failure => failure.interval.contents === 'xyz');
  t.truthy(skipped);
  t.deepEqual([skipped.interval.startIdx, skipped.interval.endIdx], [10, 13]);
  const root = tree(grammar, result);
  t.deepEqual(
    nodes(root, 'LetBody').map(node => node.text),
    ['let a = 1', 'let b = 2']
  );
  t.is(nodes(root, 'Let')[1].text, 'let b = 2;');
});

test('a failed guarded body uses ordinary skip recovery without insertion', t => {
  const {grammar, result} = parse(STATEMENTS, 'let a = = 1;');
  t.true(result.succeeded());
  const failures = result.getRecoveredFailures();
  t.is(failures.length, 1);
  t.false(Boolean(failures[0].missing));
  t.is(failures[0].interval.contents, 'let a = = 1');
  const statement = nodes(tree(grammar, result), 'Let')[0];
  t.deepEqual(nodes(statement, 'LetBody'), []);
  t.is(statement.children.at(-1).text, ';');
});

for (const [label, join] of [
  ['alternation joins', '(Semi | Bang | Comma)'],
  ['per-site opt-out', ';'],
]) {
  test(`${label} retain ordinary skip-to-join behavior`, t => {
    const source = STATEMENTS.replace(
      'Let = LetBody ! ";"',
      label === 'per-site opt-out' ? 'Let = LetBody !~ ";"' : `Let = LetBody ! ${join}`
    ).replace('number = digit+', 'number = digit+\n Semi = ";"\n Bang = "!"\n Comma = ","');
    const {grammar, result} = parse(source, 'let a = 1 let b = 2;');
    t.true(result.succeeded());
    t.is(result.getRecoveredFailures().length, 1);
    t.false(Boolean(result.getRecoveredFailures()[0].missing));
    const root = tree(grammar, result);
    t.is(nodes(root, 'Let').length, 1);
    t.is(nodes(root, '_correction')[0].text, 'let b = 2');
  });
}

test('nested blocks inherit the nearest repetition continuation', t => {
  const source = STATEMENTS.replace(
    'Program = Stmt* ! end',
    'Program = "{" Stmt* ! "}"\n Block = "{" Stmt* ! "}"'
  ).replace('Stmt = Let | Do | Return', 'Stmt = Block | Let | Do | Return');
  const input = '{ { let a = 1 } let b = 2; }';
  const {grammar, result} = parse(source, input);
  t.true(result.succeeded());
  t.is(result.getRecoveredFailures().length, 1);
  assertInsertion(t, result.getRecoveredFailures()[0], input.indexOf('1') + 1, ';');
  const root = tree(grammar, result);
  const block = nodes(root, 'Block')[0];
  t.deepEqual(
    nodes(block, 'LetBody').map(node => node.text),
    ['let a = 1']
  );
  t.deepEqual(
    nodes(root, 'LetBody').map(node => node.text),
    ['let a = 1', 'let b = 2']
  );
  t.is(block.children.at(-1).text, '}');
});

test('a parameterized continuation recognizes the actual argument', t => {
  const source = String.raw`Parameterized {
    Program = Line<"next">
    Line<next> = Body ! ";" next
    Body = "value" digit+
  }`;
  const input = 'value 1 next';
  const {grammar, result} = parse(source, input);
  t.true(result.succeeded());
  t.is(result.getRecoveredFailures().length, 1);
  assertInsertion(t, result.getRecoveredFailures()[0], 7, ';');
  const root = tree(grammar, result);
  t.deepEqual(
    nodes(root, 'Body').map(node => node.text),
    ['value 1']
  );
  t.is(nodes(root, 'Line')[0].children.at(-1).text, 'next');
});

test('inherited statements use the extended grammar continuation', t => {
  const grammars = ohm.grammars(`${STATEMENTS}\n Extended <: G {
    Stmt += Print
    Print = "print" name ";"
  }`);
  const input = 'let a = 1\nprint a;';
  const {grammar, result} = parse(grammars.Extended, input);
  t.true(result.succeeded());
  t.is(result.getRecoveredFailures().length, 1);
  assertInsertion(t, result.getRecoveredFailures()[0], input.indexOf('\n'), ';');
  const root = tree(grammar, result);
  t.deepEqual(
    nodes(root, 'LetBody').map(node => node.text),
    ['let a = 1']
  );
  t.deepEqual(
    nodes(root, 'Print').map(node => node.text),
    ['print a;']
  );
});

test('case-insensitive guarded terminals retain the insertion boundary', t => {
  const grammar = ohm.grammar(`G {
    Program = Stmt* ! end
    Stmt = caseInsensitive<"let"> ! ";"
  }`);
  for (const firstPass of ['auto', 'cached', 'probe']) {
    const result = grammar.match('LET LET;', undefined, {recover: true, firstPass});
    t.true(result.succeeded(), `${firstPass}`);
    const failures = result.getRecoveredFailures();
    t.is(failures.length, 1, `${firstPass}`);
    assertInsertion(t, failures[0], 3, ';');
    t.deepEqual(nodes(tree(grammar, result), 'Stmt').map(node => node.text), ['LET', 'LET;']);
    const traced = grammar.trace('LET LET;', undefined, {recover: true, firstPass}).result;
    t.true(traced.succeeded(), `${firstPass}`);
    assertInsertion(t, traced.getRecoveredFailures()[0], 3, ';');
  }
});
