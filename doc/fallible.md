# Error recovery with Fallible

Fallible expressions let a grammar recognize useful parts of an input containing syntax errors. In `guarded ! join`, the guarded expression is what may fail while parsing, and the join is a boundary where parsing should continue. Good joins are simple recognizable delimiters, such as a statement's semicolon or a block's closing brace.

Without recovery, this expression recognizes the same input as `guarded join`. With `{recover: true}` as a match option, Ohm first tries to match both expressions normally. If either `guarded` or `join` fails, it can recover at Fallible expressions by keeping matched guarded material and skipping damaged input until a `join` matches. Recovery does not insert missing delimiters, and can still fail if `join` is never encountered.

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
  assert(statements.match('abc', undefined, {recover: true}).failed());
-->

Here `letter+` matched `abc`, but the join failed at `12`. Recovery skips `12`, consumes the semicolon, and continues with `def;`. Always inspect diagnostics even when `succeeded()` is true. A diagnostic's `position` locates the error; its `interval` describes skipped input. These may not start at the same place when the guarded expression allows repetition.

## Use the retained input

Every Fallible contributes three action arguments: guarded material, a correction slot, and the join. The following operation returns retained fragments for an editor:

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

`&"}"` matches without consuming the brace. `end` joins at EOF, so the unfinished final statement is discarded. In the original grammar, `abc` without a semicolon fails even with recovery: there is no matching join.

## Bound recovery in nested blocks

Enclosing Fallible joins also provide a bound for scans. A statement scan may not pass its block's closing brace while searching for a semicolon. A `recoveryStop` rule adds another boundary inside nested repetition blocks, such as the beginning of the next top-level unit. For this helper, a block level requires `*` or `+` directly before `!` and a join that is not direct lookahead. Optional (`?`) expressions do not establish a level.

```js
const units = ohm.grammar(String.raw`
  Units <: Statements {
    Start := Unit* ! end
    Unit = unit ident "{" Stmt* ! "}"
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

This extends the same statement grammar with named units. If a closing brace is missing before the next `unit`, the nested scan stops rather than using that unit's brace. `recoveryStop` is ignored by the outermost repetition block, and does not resume a stopped repetition. An enclosing recovery may discard the failed unit and the rest of the file. Choose boundaries according to what your application can afford to discard.

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
