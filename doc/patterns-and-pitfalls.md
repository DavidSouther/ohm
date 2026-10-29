# Patterns and Pitfalls

## Grammars

### Dealing with greedy matching

In Ohm, like other PEG-based tools, the [repetition operators](./syntax-reference.md#repetition-operators---) `*` and `+` are _greedy_, meaning they always consume as much input as possible. This is different than the way that `*` works in regular expressions. For example, the regular expression `/^a*a/` will successfully match `'aaa'`, whereas in Ohm, the equivalent parsing expression `"a"* "a"` can never match any input.

You can use [negative lookahead](./syntax-reference.md#negative-lookahead-) (`~`) to prevent a repetition from matching too many characters. E.g., the following rule will match all but the last 'a' in a string:

```
allButLastA = (~("a" end) "a")*
```

The expression `"a" end` means "match an 'a' at the end of the input", and `~("a" end) "a"` means "match an 'a' only if it is not the last 'a' at the end of the input".

For a more realistic example, see the next section on delimited strings.

### Delimited strings

A common use for negative lookahead is implementing delimited strings and comments. For example, to support JavaScript-style multiline strings delimited by `` ` ``:

```
stringDelimiter = "`"
string = stringDelimiter (~stringDelimiter any)* stringDelimiter
```

The expression `~stringDelimiter any` means "match any character not matched by _stringDelimiter_".

### Supporting comments

In most languages, comments are treated as a form of whitespace. Ohm has implicit space skipping ([see Syntactic vs. Lexical rules](./syntax-reference.md#syntactic-vs-lexical-rules)), which is controlled by the _space_ rule. To add comments to your language, you first need to define a _comment_ rule. Here's an example of C-style (`/*`/`*/`-delimited) comments:

```
comment = "/*" (~"*/" any)* "*/"
```

Then, you need to extend the _space_ rule in your grammar so that Ohm will treat the comments as whitespace:

```
space += comment
```

### Reserved words / keywords

Many programming languages have the concept of [reserved words](https://en.wikipedia.org/wiki/Reserved_word) — identifiers that have a special meaning, and can't be used as the name of a variable, function, etc. In Ohm grammars, it's common to define a separate lexical rule for each reserved word. For example, here's the definition of [the `keyword` rule in our ES5 grammar](https://github.com/ohmjs/ohm/blob/c7dcbb6b97366daf54349ba8e5be9133978f5c83/examples/ecmascript/src/es5.ohm#L87):

```
  keyword = break    | do        | instanceof | typeof
          | case     | else      | new        | var
          | catch    | finally   | return     | void
          | continue | for       | switch     | while
          | debugger | function  | this       | with
          | default  | if        | throw
          | delete   | in        | try
```

🐍 There are a couple of things to watch out for:

- One reserved word might be a prefix of another, e.g., `in` and `instanceof` in JavaScript.
- Identifiers that begin with a reserved word shouldn't be disallowed, e.g. `className`.

To prevent both of these potential problems, you can use [negative lookahead](./syntax-reference.md#negative-lookahead-) in the rules for your reserved words. For example:

```
  in = "in" ~identifierPart
```

This ensures that (a) the `in` rule won't accidentally match the wrong keyword (like "instanceof"), and (b) it won't match a valid identifier like "inProgress".

### Matching exactly _n_ times

Unlike regular expressions, Ohm does not support [quantifier](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Regular_Expressions/Quantifiers) syntax to indicate the number of times an expression should be matched. However, this can be implemented using a normal sequence:

```
zipCode = digit digit digit digit
```

### Operator precedence

The common way to handle operator precedence in Ohm is to use left-recursive rules which encode the precedence in the grammar structure. For example:

```
  exp = addExp

  addExp = addExp "+" mulExp  -- plus
         | addExp "-" mulExp  -- minus
         | mulExp

  mulExp = mulExp "*" priExp  -- times
         | mulExp "/" priExp  -- divide
         | priExp
```

Note that the rule for the lower precedence operators (`+` and `-`) invokes the rule for the higher-precedence operators (`*`/`/`). This ensures that the higher-precedence operators "bind more tightly". See Ray Toal's [Operator Precedence and Associativity Examples](https://github.com/ohmjs/ohm/tree/main/examples/operators) for more.

#### 🐍 Ambiguous recursion

Notice that in the arithmetic grammar above, `mulExp` appears on the right hand side of all of `addExp`'s cases. Be careful that you don't write rules that are "ambiguously recursive", e.g. `addExp = addExp "+" addExp`. If you write your grammar like this, a reader can't tell whether `+` is left-associative or right-associative. (In Ohm, you will actually get a right-associative parse — see [#56](https://github.com/ohmjs/ohm/issues/56) for details.)

### Recovery points and prediction

Place recovery points around complete items with stable synchronization boundaries,
for example `Statement = Expr ! ";"`. The expression grammar inside `Expr` may use
ordinary left recursion; keeping it recovery-free allows it to retain ordinary
memoization. Recovery inside an active left-recursive cycle needs separate performance
analysis.

Keep prediction and synchronization helpers transitively recovery-free. Inside `&`
or `~`, a fallible `B ! C` acts as `B C` and cannot commit recovery. A rule that reaches
such a marker through other rule calls still has this restriction. Recursive
lookahead over a recovery-bearing rule can reevaluate suffixes at different call
depths even on valid input. Prefer a recovery-free prediction helper when a rule is
shared between prediction and consuming parsing. Join expressions and
`recoveryToken`/`recoveryStop` helpers also run with recovery suspended.

A pure lookahead **join** is a different case: `Stmt* ! &"}"` places the marker outside
the predicate and is an ordinary synchronization pattern. It is the fallible reached
*inside* a predicate that warrants attention.

A future grammar advisory should follow calls and parameters to warn about these
prediction/helper paths, especially recursive ones. That advisory is proposed; no
such lint is currently provided. Its absence would not certify a grammar's cost.
For stable independent items, matching work can be linear while indexing adds
logarithmic per-error work. See the [practical recovery analysis](research/fallible-overhead/paper.md#75-a-practical-local-recovery-contract)
for the conditions and measurements of the earlier runtime. A join must actually match;
`!` does not insert a missing closer. A grammar that accepts an absent closer must
express that acceptance itself.

`B ! C` contributes three semantic arguments: B, a correction slot, and C.
B retains its matched result, including a repetition prefix; a failed B contributes
an empty optional-like node. The middle slot is empty on a clean match and contains
a `CorrectionNode` after recovery. Define `_correction` to handle that node. C contains
the actual join result, including a lookahead result when the join is a predicate.

## Semantics

### Iteration nodes

_Iteration nodes_ are associated with expressions inside a repetition operator (`*`, `+`, and `?`). E.g., for the grammar `G { letters = letter+ }`, the single argument to the _letters_ action will be an iteration node. There are two main ways to handle iteration nodes inside semantic actions:

1. Use array operations (`map`, `filter`, etc.) on the node's `children` attribute. For example, `iterNode.children.map(c => c.prettyPrint())` would invoke the `prettyPrint` operation on each child of the iteration node.
2. Define an _\_iter_ action for your operation, which allows you to write something like `iterNode.prettyPrint()`. If you have not defined an _\_iter_ action for the operation, this will result in a "missing semantic action" error.

#### Optional nodes

An optional node (associated with the `?` operator) is just an iteration node with at most one child. In modern JavaScript (EMCAScript 2020+) and TypeScript, the [optional chaining operator](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/Optional_chaining) provides a convenient way to deal with optional nodes:

```
optNode.child(0)?.myOperation();
```

This evaluates to either (a) `undefined`, if the node has no child, or (b) the result of calling `myOperation()` on the child. In older versions of JavaScript, you can achieve the same thing via `optNode.child(0) && optNode.child(0).myOperation()`. Another way to do the same thing is: `optNode.children.map(c => c.myOperation())[0]`.

### Handling the built-in list rules

When using the built-in list rules (`listOf`, etc.) in your grammar, you usually don't need to write semantic actions for them. Instead, you can use the [built-in `asIteration` operation](./api-reference.md#asIteration).
