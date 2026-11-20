# Error recovery with Fallible

Fallible expressions let a grammar recognize useful parts of an input containing syntax errors. In `guarded ! join`, the guarded expression is what may fail while parsing, and the join is a boundary where parsing should continue. Good joins are simple recognizable delimiters, such as a statement's semicolon or a block's closing brace.

Without recovery, this expression recognizes the same input as `guarded join`. With `{recover: true}` as a match option, Ohm first tries to match both expressions normally. If either `guarded` or `join` fails, it can recover at Fallible expressions by keeping matched guarded material and skipping damaged input until a `join` matches. When a complete guarded expression is followed by code that belongs after a missing punctuation join, recovery can insert that join instead.

Consult [syntax reference](./syntax-reference.md#fallible-) for grammar restrictions. The [API reference](./api-reference.md#match-options) describes options, diagnostics, and semantic actions. The recipes below build on one small grammar.

## Recover a statement

Put the Fallible expression inside a repeated item to recover individual statements and continue with later ones:

```js
const ohm = require('ohm-js');
const statements = ohm.grammar(String.raw`
  Statements {
    Start = Stmt*
    Stmt = letter+ ! ";"
  }
`);
const input = 'abc 12; def;';
statements.match(input).failed(); // true
const result = statements.match(input, undefined, {recover: true});
result.succeeded(); // true
result.getRecoveredFailures().map(f => f.interval.contents); // ['12']
```

<!-- @markscript
  assert(statements.match(input).failed());
  assert(result.succeeded());
  assert.deepEqual(result.getRecoveredFailures().map(f => f.interval.contents), ['12']);
  assert.equal(result.getRecoveredFailures()[0].position, 4);
  assert(statements.match('abc; def;', undefined, {recover: true}).succeeded());
  assert.deepEqual(statements.match('abc; def;', undefined, {recover: true}).getRecoveredFailures(), []);
  const finalSemicolon = statements.match('abc', undefined, {recover: true});
  assert(finalSemicolon.succeeded());
  assert.deepEqual(finalSemicolon.getRecoveredFailures().map(f => [f.missing, f.position]), [[true, 3]]);
-->

Here `letter+` matched `abc`, and the join failed at `12`. Recovery skips `12`, consumes the semicolon, and continues with `def;`. Inspect `getRecoveredFailures()` even when `succeeded()` is true. Each diagnostic's `interval` describes the skipped input. For a skip, its `position` gives the rightmost failure index in that recovery pass. For a repetition in the guard, the skipped input can begin before that index.

When the guard matches and a consuming join fails before consuming a token, `getDiagnosticPosition()` can use the end of the guard's last matched token. On a failed match, `getInterval()` uses that diagnostic position. The design is described in [Diagnostic positions](design/diagnostic-positions.md). Ambiguous failures and joins whose consumption cannot be established use the rightmost failure position. An inferred insertion uses its insertion anchor even when the diagnostic includes other expectations.

## Use the retained input

Every Fallible contributes its guarded material, a correction slot, and the join as action arguments. The following operation returns retained fragments for an editor:

```js
const fragments = statements.createSemantics().addOperation('fragments', {
  Start(items) {
    return items.children.map(item => item.fragments());
  },
  Stmt(letters, correction, semicolon) {
    return letters.sourceString;
  }
});
fragments(result).fragments(); // ['abc', 'def']
```

<!-- @markscript
  assert.deepEqual(fragments(result).fragments(), ['abc', 'def']);
  assert.deepEqual(fragments(statements.match('abc; def;')).fragments(), ['abc', 'def']);
-->

This action deliberately keeps partial statements. An AST builder might instead mark or discard a statement when `correction.recoveredFailure` is present. The action reads nodes directly; an operation that traverses correction nodes can provide a zero-argument `_correction` action, and otherwise gets `undefined` there. See [Fallible actions](./api-reference.md#fallible-actions).

## Guard several values

The guarded expression may produce several values, like a sequence. The action then receives one argument per guarded value, followed by the correction slot and the join:

```js
const assignments = ohm.grammar(String.raw`
  Assignments {
    Start = Assign*
    Assign = (ident "=" digit+) ! ";"
    ident = letter+
  }
`);
const assigned = assignments.match('a = 1; b = ?; c = 3;', undefined, {recover: true});
const pairs = assignments.createSemantics().addOperation('pairs', {
  Start(items) {
    return items.children.map(item => item.pairs());
  },
  Assign(name, equals, value, correction, semicolon) {
    return correction.isCorrection() ? correction.sourceString : `${name.sourceString}:${value.sourceString}`;
  }
});
pairs(assigned).pairs(); // ['a:1', 'b = ?', 'c:3']
```

<!-- @markscript
  assert.deepEqual(pairs(assigned).pairs(), ['a:1', 'b = ?', 'c:3']);
  assert.equal(assignments.rules.Assign.body.getArity(), 5);
-->

Recovery treats the guarded values as one unit, exactly as if they were wrapped in a rule. When the guarded expression fails, as in `b = ?`, none of its values is kept: every guarded argument is an empty optional node and the correction covers the whole damaged assignment.

## Traverse recovered input without handling it

A generic traversal, such as a pretty printer or a counter built from `_nonterminal`, `_iter` and `_terminal`, reaches correction nodes too. Without a `_correction` action, a correction node yields `undefined`, so a traversal that has nothing useful to do with skipped input needs no extra code.

```js
const retained = statements.createSemantics().addOperation('retained', {
  _nonterminal(...children) {
    return children.reduce((n, child) => n + (child.retained() ?? 0), 0);
  },
  _iter(...children) {
    return children.reduce((n, child) => n + (child.retained() ?? 0), 0);
  },
  _terminal() {
    return 1;
  }
});
retained(result).retained(); // 8: `abc`, `;`, `def` and `;`, but not the skipped `12`
```

<!-- @markscript
  assert.equal(retained(result).retained(), 8);
  const strict = statements.createSemantics().addOperation('strict', {
    _nonterminal(...children) { return children.map(child => child.strict()); },
    _iter(...children) { return children.map(child => child.strict()); },
    _terminal() { return 1; }
  }, {corrections: 'throw'});
  assert.throws(() => strict(result).strict(), /_correction/);
-->

Pass `{corrections: 'throw'}` when reaching skipped input would be a mistake, for example in an operation that builds a tree and expects to handle every correction itself. Use `child.isCorrection()` to tell the node apart, or pass a function for what the operation should produce there. An explicit `_correction` action always takes precedence. See the [`corrections` option](./api-reference.md#corrections-option).

## Choose a block boundary

Putting `!` after a repetition retains its successfully matched prefix, then skips the damaged remainder up to the join. It does not restart that repetition after skipping. Use this for a block or file, while keeping statement-level recovery inside it.

These extensions of `Statements` illustrate leaving a delimiter for the enclosing rule and accepting a damaged file tail:

```js
const boundaries = ohm.grammars(String.raw`
  Ahead <: Statements {
    Start := "{" Items "}"
    Items = Stmt* ! &"}"
  }
  AtEnd <: Statements {
    Start := Stmt* ! end
    Stmt := letter+ !~ ";"
  }
`, {Statements: statements});
boundaries.Ahead.match('{ abc; 12 }', undefined, {recover: true}).succeeded(); // true
boundaries.AtEnd.match('abc; unfinished', undefined, {recover: true})
  .getRecoveredFailures().map(f => f.interval.contents); // ['unfinished']
```

<!-- @markscript
  assert(boundaries.Ahead.match('{ abc; 12 }', undefined, {recover: true}).succeeded());
  assert.deepEqual(boundaries.Ahead.match('{ abc; 12 }', undefined, {recover: true}).getRecoveredFailures().map(f => f.interval.contents), ['12']);
  assert.deepEqual(boundaries.AtEnd.match('abc; unfinished', undefined, {recover: true}).getRecoveredFailures().map(f => f.interval.contents), ['unfinished']);
-->

`&"}"` matches without consuming the brace. `end` joins at EOF. `AtEnd` opts out of insertion at its statement terminators, so the unfinished final statement is discarded; the original statement grammar can instead insert its missing semicolon.

## Bound recovery in nested blocks

Enclosing Fallible joins also provide a bound for scans. A statement scan may not pass its block's closing brace while searching for a semicolon. A `recoveryStop` rule adds another boundary inside nested repetition blocks, such as the beginning of the next top-level unit. For this helper, a block level requires `*` or `+` directly before `!` and a join that is not direct lookahead. Optional (`?`) expressions do not establish a level.

```js
const units = ohm.grammar(String.raw`
  Units <: Statements {
    Start := Unit* ! end
    Unit = unit ident "{" Stmt* !~ "}"
    Stmt := ident ! ";"
    unit = "unit" ~alnum
    ident = ~unit letter+
    recoveryStop = unit
  }
`, {Statements: statements});
const unfinished = 'unit a { x; y;\nunit b { z; }';
const stopped = units.match(unfinished, undefined, {recover: true});
stopped.getRecoveredFailures().map(f => f.interval.contents); // [unfinished]: the entire input
```

This extends the same statement grammar with named units and opts out of insertion at the unit closer to demonstrate skip recovery. If a closing brace is missing before the next `unit`, the nested scan stops rather than using that unit's brace. `recoveryStop` is ignored by the outermost repetition block, and does not resume a stopped repetition. An enclosing recovery may discard the failed unit and the rest of the file. Choose boundaries according to what your application can afford to discard.

<!-- @markscript
  const nested = units.match('unit a { abc; 12 } unit b { def; }', undefined, {recover: true});
  assert(nested.succeeded());
  assert.deepEqual(nested.getRecoveredFailures().map(f => f.interval.contents), ['12']);
  assert(stopped.succeeded());
  assert.deepEqual(stopped.getRecoveredFailures().map(f => f.interval.contents), [unfinished]);
  assert.equal(stopped.getRecoveredFailures()[0].position, unfinished.indexOf('unit b'));
-->

## Skip whole tokens

Typically, fallible expressions switch to scanning damaged input one code unit at a time. This can be improved by providing a `recoveryToken` rule, which applies matching rules while looking for a `join`. By extending `Units` with `recoveryToken` so a scan steps over whole string literals and identifiers, a semicolon inside a string should not become a statement join.

```js
const tokenUnits = ohm.grammar(String.raw`
  TokenUnits <: Units {
    recoveryToken = string | letter+
    string = "\"" (~"\"" ~"\n" any)* "\""
  }
`, {Units: units});
tokenUnits.match('unit a { abc "a;b"; def; }', undefined, {recover: true})
  .getRecoveredFailures().map(f => f.interval.contents); // ['"a;b"']
```

<!-- @markscript
  const tokenResult = tokenUnits.match('unit a { abc "a;b"; def; }', undefined, {recover: true});
  assert(tokenResult.succeeded());
  assert.deepEqual(tokenResult.getRecoveredFailures().map(f => f.interval.contents), ['"a;b"']);
-->

This helper changes recovery scanning, not the statement syntax. Include token forms whose contents might resemble joins or stop markers. If the token rule fails or consumes nothing, scanning advances one code unit.

## Insert missing punctuation

A complete, nonempty guarded expression can recover without a real join when the join is literal punctuation, such as `";"` or `"{"`. Eligible literals consist only of Unicode punctuation or symbol characters, excluding connector punctuation such as `"_"`. A chain of rule applications that resolves to such a literal is eligible. Alternation and lexified joins use skip recovery.

Ohm infers the continuation from the remaining expressions in the rule and enclosing Fallible contexts, including the next item of a repeated block. For repeated items, a complete guarded prefix can provide evidence even if that item's join is also missing. The next item is parsed normally and can report its own omission.

For example, a missing semicolon must not swallow the next statement, even when that statement also lacks its semicolon:

```js
const insertionGrammar = ohm.grammar(String.raw`
  Insertion {
    Program = Stmt* ! end
    Stmt = Let | Do | Return
    Let = ("let" name "=" number) ! ";"
    Do = ("do" name "(" name ")") ! ";"
    Return = "return" ";"
    name = letter alnum*
    number = digit+
  }
`);
const twoOmissions = 'let x = 5\ndo printInt(x)\nreturn;';
const inserted = insertionGrammar.match(twoOmissions, undefined, {recover: true});
inserted.succeeded(); // true
inserted.getRecoveredFailures().map(f => f.missing); // [true, true]
```

<!-- @markscript
  assert(inserted.succeeded());
  assert.deepEqual(inserted.getRecoveredFailures().map(f => f.missing), [true, true]);
  assert.deepEqual(inserted.getRecoveredFailures().map(f => f.position),
    [twoOmissions.indexOf('\n'), twoOmissions.lastIndexOf('\n')]);
-->

An insertion has `missing: true`. Its `position` is immediately after the guarded expression's last token, before implicitly skipped whitespace. A direct insertion's correction and join nodes have zero-width source intervals there. The join's source string is empty; it is not a fabricated character in the original input. If the selected failure at the join includes that punctuation, the diagnostic retains the full expected set; otherwise it names the inserted punctuation. Inspect the diagnostics even when the recovered parse succeeds.

The following cases are checked against the same grammar. The block and loop examples supply enclosing continuation boundaries; ordinary failed guarded expressions continue to use skip recovery.

<!-- @markscript
  const siblingInput = 'let a = 1\nlet b = 2;';
  const siblingResult = insertionGrammar.match(siblingInput, undefined, {recover: true});
  assert(siblingResult.succeeded());
  assert.deepEqual(siblingResult.getRecoveredFailures().map(f => [f.missing, f.position]),
    [[true, siblingInput.indexOf('\n')]]);
  const blockInsertion = ohm.grammar(String.raw`
    BlockInsertion <: Insertion { Program := "{" Stmt* ! "}" }
  `, {Insertion: insertionGrammar});
  const blockInput = '{ let a = 1 }';
  const blockInserted = blockInsertion.match(blockInput, undefined, {recover: true});
  assert(blockInserted.succeeded());
  assert.deepEqual(blockInserted.getRecoveredFailures().map(f => [f.missing, f.position]),
    [[true, blockInput.indexOf('1') + 1]]);
  const loopInsertion = ohm.grammar(String.raw`
    LoopInsertion <: Insertion {
      Program := While Return
      While = ("while" "(" name ")") ! "{" Stmt* ! "}"
    }
  `, {Insertion: insertionGrammar});
  const loopInput = 'while (x)\n  let y = 1;\n}\nreturn;';
  const loopInserted = loopInsertion.match(loopInput, undefined, {recover: true});
  assert(loopInserted.succeeded());
  assert.deepEqual(loopInserted.getRecoveredFailures().map(f => [f.missing, f.position]),
    [[true, loopInput.indexOf(')') + 1]]);
  const skippedInput = 'let a = 1 xyz let b = 2;';
  const skippedResult = insertionGrammar.match(skippedInput, undefined, {recover: true});
  assert(skippedResult.succeeded());
  assert(skippedResult.getRecoveredFailures().some(f => f.missing));
  assert(skippedResult.getRecoveredFailures().some(f => f.interval.contents.includes('xyz')));
  const failedGuard = insertionGrammar.match('let a = = 1;', undefined, {recover: true});
  assert(failedGuard.succeeded());
  assert(failedGuard.getRecoveredFailures().every(f => !f.missing));
-->

Items in a delimited list and clauses in a `for` header use their own inferred continuations:

```js
const partInsertion = ohm.grammar(String.raw`
  Parts {
    Parts = Part* ! end
    Part = (name "(" Wires ")") ! ";"
    Wires = ListOf<Wire, ",">
    Wire = name "=" name
    name = letter alnum*
  }
`);
const partInput = 'Not(in=a, out=b)\nAnd(a=b, b=c, out=out);';
const partsInserted = partInsertion.match(partInput, undefined, {recover: true});
const headerInsertion = ohm.grammar(String.raw`
  Header {
    Header = "for" "(" (Init ! ";") (Cond ! ";") Update ")"
    Init = name "=" digit+
    Cond = name "<" name
    Update = name "++"
    name = letter alnum*
  }
`);
const headerInserted = headerInsertion.match('for (i = 0 i < n; i++)', undefined, {recover: true});
```

<!-- @markscript
  assert(partsInserted.succeeded());
  assert.deepEqual(partsInserted.getRecoveredFailures().map(f => [f.missing, f.position]),
    [[true, partInput.indexOf('\n')]]);
  assert(headerInserted.succeeded());
  assert.deepEqual(headerInserted.getRecoveredFailures().map(f => [f.missing, f.position]),
    [[true, 10]]);
-->

When damaged text separates a guarded expression from its continuation, recovery may skip that text and insert the join. Its diagnostic remains anchored at the missing punctuation; the skipped interval records the discarded text. They can be reported as one combined diagnostic or as two diagnostics.

Continuation checks run with recovery disabled in a private, bounded evaluator. A check that exhausts its work or input-window budget is inconclusive, and scanning continues to look for a real join or another verified continuation. Thus inference can miss a valid but expensive continuation; it does not promise exact continuation recognition for arbitrary PEG expressions. Stateful matching extensions and custom input streams retain ordinary skip recovery when their state cannot be isolated for a check. Ordinary matching does not run these checks. The design is described in [Inferred join insertion](design/inferred-join-insertion.md).

Use `guarded !~ join` at a site whose join is only a resynchronization marker. It disables inferred insertion at that site and keeps skip recovery. Both operators match the same language when recovery is disabled:

```js
const skipOnly = ohm.grammar('SkipOnly { Start = "x" !~ ";" }');
skipOnly.match('x').failed(); // true
skipOnly.match('x', undefined, {recover: true}).failed(); // true
```

<!-- @markscript
  assert(skipOnly.match('x').failed());
  assert(skipOnly.match('x', undefined, {recover: true}).failed());
  assert(skipOnly.match('x;', undefined, {recover: true}).succeeded());
-->
