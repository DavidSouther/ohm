# API Reference

This page documents the API of Ohm/JS, a JavaScript library for working with grammars written in the Ohm language. For documentation on the Ohm language, see the [syntax reference](./syntax-reference.md).

## Instantiating Grammars

**NOTE:** For grammars defined in a JavaScript string literal (i.e., not in a separate .ohm file), it's recommended to use a [template literal with the String.raw tag](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/raw).

<b><pre class="api">ohm.grammar(source: string, optNamespace?: object) &rarr; Grammar</pre></b>

Instantiate the Grammar defined by `source`. If specified, `optNamespace` is an object in which references to other grammars should be resolved. For example, if the grammar source begins with an inheritance declaration like `MyGrammar <: OtherGrammar { ... }`, then `optNamespace` should have a property named `OtherGrammar`.

<b><pre class="api">ohm.grammars(source: string, optNamespace?: object) &rarr; object</pre></b>

Create a new object containing Grammar instances for all of the grammars defined in `source`. As with `ohm.grammar`, if `optNamespace` is specified, it is an object in which references to other grammars should be resolved. Additionally, it will be the prototype of the returned object.

Here is an example of instantiating a Grammar:

<!-- @markscript
  // Imports ohm so that we can process the code below.
  const ohm = require('ohm-js');
-->

```
const parentDef = String.raw`
  Parent {
    start = "parent"
  }
`;
const parentGrammar = ohm.grammar(parentDef);
```

<!-- @markscript
  // Verify parent grammar.
  assert.ok(parentGrammar.name == "Parent");
-->

In the next example We instantiate a new grammar, *Child*, that inherits from our *Parent* grammar. We use the `ohm.grammars` method, which returns an object of our grammars:
```
const childDef = String.raw`
  Child <: Parent {
    start := "child"
  }
`;
const childGrammar = ohm.grammars(childDef, {Parent: parentGrammar});
console.log(Object.keys(childGrammar));
// > [ 'Child' ]
```

<!-- @markscript
  // Verify that we're actually making the right grammars.
  assert.ok(childGrammar.Child);
  assert.deepEqual([ 'Child' ], Object.keys(childGrammar))
-->

You could also concatenate the grammar definitions, and then instantiate them. This results in an object with both Grammars:
```
const combinedDef = parentDef.concat(childDef);
const grammars = ohm.grammars(combinedDef);
console.log(Object.keys(grammars));
// > [ 'Parent', 'Child' ]
```

<!-- @markscript
  // Verify that the combined grammar contains both sub grammars.
  assert.deepEqual([ 'Parent', 'Child' ], Object.keys(grammars))
-->

## Grammar objects

A Grammar instance `g` has the following methods:

<a name="Grammar.match"><b><pre class="api">g.match(str: string, optStartRule?: string, options?: object) &rarr; MatchResult</pre></b></a>

Try to match `str` against `g`, returning a [MatchResult](#matchresult-objects). If `optStartRule` is given, it specifies the rule on which to start matching. By default, the start rule is inherited from the supergrammar, or if there is no supergrammar specified, it is the first rule in `g`'s definition.

<span id="match-options"></span>Set `options.recover` to `true` to attempt recovery at [Fallible expressions](./syntax-reference.md#fallible-) after a failed match. It defaults to `false`, in which case `guarded ! join` recognizes the same input as `guarded join`. For example, use `g.match(input, undefined, {recover: true})` with the default start rule. See [Error recovery with Fallible](./fallible.md) for recipes.

<b><pre class="api">g.matcher()</pre></b>

Create a new [Matcher](#matcher-objects) object which supports incrementally matching `g` against a changing input string.

<a name="Grammar.trace"><b><pre class="api" id="trace">g.trace(str: string, optStartRule?: string, options?: object) &rarr; Trace</pre></b></a>

Try to match `str` against `g`, returning a Trace object. `optStartRule` and `options` have the same meaning as in `g.match`. Trace objects have a `toString()` method, which returns a string which summarizes each parsing step (useful for debugging).

<b><pre class="api">g.createSemantics() &rarr; Semantics</pre></b>

Create a new [Semantics](#semantics) object for `g`.

<b><pre class="api" id="extendSemantics">g.extendSemantics(superSemantics: Semantics) &rarr; Semantics</pre></b>

Create a new [Semantics](#semantics) object for `g` that inherits all of the operations and attributes in `superSemantics`. `g` must be a descendent of the grammar associated with `superSemantics`.

## Matcher objects

Matcher objects can be used to incrementally match a changing input against the Matcher's grammar, e.g. in an editor or IDE. When a Matcher's input is modified via `replaceInputRange`, further calls to `match` will reuse the partial results of previous calls wherever possible. Generally, this means that small changes to the input will result in very short match times.

A Matcher instance `m` has the following methods:

<b><pre class="api">m.getInput() &rarr; string</pre></b>

Return the current input string.

<b><pre class="api">m.setInput(str: string)</pre></b>

Set the input string to `str`.

<b><pre class="api">m.replaceInputRange(startIdx: number, endIdx: number, str: string)</pre></b>

Edit the current input string, replacing the characters between `startIdx` and `endIdx` with `str`.

<b><pre class="api">m.match(optStartRule?: string, options?: object) &rarr; MatchResult</pre></b>

Like [Grammar's `match` method](#Grammar.match), but operates incrementally.

<b><pre class="api">m.trace(optStartRule?: string, options?: object) &rarr; Trace</pre></b>

Like [Grammar's `trace` method](#Grammar.trace), with the same recovery restrictions as `m.match`.

## MatchResult objects

Internally, a successful MatchResult contains a _parse tree_, which is made up of _parse nodes_. Parse trees are not directly exposed -- instead, they are inspected indirectly through _operations_ and _attributes_, which are described in the next section.

A MatchResult instance `r` has the following methods:

<b><pre class="api">r.succeeded() &rarr; boolean</pre></b>

Return `true` if the match succeeded, otherwise `false`.

<b><pre class="api">r.failed() &rarr; boolean</pre></b>

Return `true` if the match failed, otherwise `false`.

<b><pre class="api">r.getRecoveredFailures() &rarr; Array</pre></b>

Return recovery diagnostics in input order. A successful recovering match can still have diagnostics. Without recovery, or on a clean match, the array is empty. If a recovering match fails, it contains earlier recoveries followed by the final failure.

Each diagnostic has these properties and methods:

- `interval`: the skipped input as an Interval. The final failure of an unsuccessful recovering match has an empty interval at its failure position.
- `position`: the error's input index, which can differ from the skipped interval's start.
- `shortMessage`: the error message, formatted like a failed MatchResult's `shortMessage`.
- `getExpectedText()` and `getRightmostFailures()`: describe what was expected at the error.

### MatchFailure objects

When `r.failed()` is `true`, `r` has the following additional properties and methods:

<b><pre class="api">r.message: string</pre></b>

Contains a message indicating where and why the match failed. This message is suitable for end users of a language (i.e., people who do not have access to the grammar source).

<b><pre class="api">r.shortMessage: string</pre></b>

Contains an abbreviated version of `r.message` that does not include an excerpt from the invalid input.

<b><pre class="api">r.getRightmostFailurePosition() &rarr; number</pre></b>

Return the index in the input stream at which the match failed.

<b><pre class="api">r.getRightmostFailures() &rarr; Array</pre></b>

Return an array of Failure objects describing the failures that occurred at the rightmost failure position.

### Failure objects

Failures describe individual expectations returned by `getRightmostFailures()` on a failed match or a recovery diagnostic.

<b><pre class="api">f.isFluffy() &rarr; boolean</pre></b>

Return whether the expectation is incidental to a successful optional or repeated expression. Default error messages omit these expectations.

<b><pre class="api">f.isLexical() &rarr; boolean</pre></b>

Return whether the expectation failed inside a lexical token that had already consumed input. A failure at the start of a token returns `false`, as does an expectation in a syntactic rule. Classification follows the token context, including when results are reused during recovery. A diagnostic can contain both lexical and non-lexical expectations.

<!-- @markscript
  const lexicalFailures = ohm.grammar('Tokens { Start = hex | name hex = "0x" hexDigit+ name = letter+ }');
  const visibleFailures = result => result.getRightmostFailures().filter(f => !f.isFluffy());
  assert(visibleFailures(lexicalFailures.match('0xZ')).every(f => f.isLexical()));
  assert(visibleFailures(lexicalFailures.match(';')).every(f => !f.isLexical()));
-->

<h2 id="semantics">Semantics, Operations, and Attributes</h2>

An Operation represents a function that can be applied to a successful match result. Like a [Visitor](http://en.wikipedia.org/wiki/Visitor_pattern), an operation is evaluated by recursively walking the parse tree, and at each node, invoking the matching semantic action from its _action dictionary_.

An Attribute is an Operation whose result is memoized, i.e., it is evaluated at most once for any given node.

A Semantics is a family of operations and/or attributes for a given grammar. A grammar may have any number of Semantics instances associated with it — this means that the clients of a grammar (even in the same program) never have to worry about operation/attribute name clashes.

### Semantics objects

Operations and attributes are accessed by applying a semantics instance to a [MatchResult](#matchresult-objects).
This returns a parse node, whose properties correspond to the operations and attributes of the semantics. For example, to invoke an operation named 'prettyPrint': `mySemantics(matchResult).prettyPrint()`. Attributes are accessed using property syntax — e.g., for an attribute named 'value': `mySemantics(matchResult).value`.

A Semantics instance `s` has the following methods, which all return `this` so they can be chained:

<b><pre class="api">mySemantics.addOperation(nameOrSignature: string, actionDict: object, options?: object) &rarr; Semantics</pre></b>

Add a new Operation to this Semantics, using the [semantic actions](#semantic-actions) contained in `actionDict`. The first argument is either a name (e.g. `'prettyPrint'`) or a _signature_ which specifies the operation name and zero or more named parameters (e.g., `'prettyPrint()'`, `'prettyPrint(depth, strict)'`). It is an error if there is already an operation or attribute called `name` in this semantics.

If the operation has arguments, they are accessible via `this.args` within a semantic action. For example, `this.args.depth` would hold the value of the `depth` argument for the current action.

<span id="corrections-option"></span>`options.corrections` sets what the operation does at a `_correction` node, which holds input that [recovery](./fallible.md) skipped. A `_correction` action in `actionDict` always wins. Otherwise, `'skip'` (the default) makes a correction node yield `undefined`, and `'throw'` makes reaching one an error. A function is a zero-arity action, as if `actionDict` defined it. An invalid option throws a `TypeError`. Recovery is opt-in, so without it there are no correction nodes and this never applies.

<b><pre class="api">mySemantics.addAttribute(name: string, actionDict: object, options?: object) &rarr; Semantics</pre></b>

Exactly like `semantics.addOperation`, except it will add an Attribute to the semantics rather than an Operation.

<b><pre class="api">mySemantics.extendOperation(name: string, actionDict: object, options?: object) &rarr; Semantics</pre></b>

Extend the Operation named `name` with the semantic actions contained in `actionDict`. `name` must be the name of an operation in the super semantics — i.e., you must first extend the Semantics via [`extendSemantics`](#extendSemantics) before you can extend any of its operations.

<b><pre class="api">semantics.extendAttribute(name: string, actionDict: object, options?: object) &rarr; Semantics</pre></b>

Exactly like `semantics.extendOperation`, except it will extend an Attribute of the super semantics rather than an Operation.

An extension inherits the correction policy of the operation it extends, and `options.corrections` replaces it. A `_correction` action, whether the extension defines it or inherits it, still takes precedence over the policy.

### Semantic Actions

A semantic action is a function that computes the value of an operation or attribute for a specific type of node in the parse tree. There are four different types of parse nodes:

- _Rule application_, or _non-terminal_ nodes, which correspond to rule application expressions
- _Terminal_ nodes, for string and number literals, and keyword expressions
- _Iteration_ nodes, which are associated with expressions inside a [repetition operator](./syntax-reference.md#repetition-operators) (`*`, `+`, and `?`)
- _Correction_ nodes, which describe input skipped by Fallible recovery

Generally, you write a semantic action for each rule in your grammar, and store them together in an _action dictionary_. For example, given the following grammar:

<!-- @markscript
  // Take the grammar below and instantiate it as `g` in the markscript environment.
  markscript.transformNextBlock((code) =>
    `const g = require('ohm-js').grammar(${JSON.stringify(code)});`
  );
-->

```
Name {
  FullName = name name
  name = (letter | "-" | ".")+
}
```

A set of semantic actions for this grammar might look like this:

<!-- @markscript
  // Replace '...' in the action dict below with some actual function definitions,
  // so that we can be sure that the code actually works.
  markscript.transformNextBlock((code) =>
    code.replace('...', "return lastName.x().toUpperCase() + ', ' + firstName.x()")
        .replace('...', "return this.sourceString;")
  );
-->

```js
const actions = {
  FullName(firstName, lastName) { ... },
  name(parts) { ... }
};
```

<!-- @markscript
  // Verify that the action dict actually works.
  const semantics = g.createSemantics().addOperation('x', actions);
  assert.equal(semantics(g.match('Guy Incognito')).x(), 'INCOGNITO, Guy');
-->

The value of an operation or attribute for a node is the result of invoking the node's matching semantic action. In the grammar above, the body of the `FullName` rule produces two values — one for each application of the `name` rule. The values are represented as parse nodes, which are passed as arguments when the semantic action is invoked. An error is thrown if the function arity does not match the number of values produced by the expression.

The matching semantic action for a particular node is chosen as follows:

- On a _rule application_ (non-terminal) node, first look for a semantic action with the same name as the rule (e.g., 'FullName'). If the action dictionary does not have a property with that name, use the action named `_nonterminal`, if it exists. If there is no `_nonterminal` action, and the node has exactly one child, then return the result of invoking the operation/attribute on the child node.
- On a terminal node (e.g., a node produced by the parsing expression `"hello"`), use the semantic action named `_terminal`.
- On an iteration node (e.g., a node produced by the parsing expression `letter+`), use the semantic action named `_iter`.
- On a correction node, use `_correction`, which takes no arguments. If the operation has no `_correction` action, it follows its [`corrections` option](#corrections-option): by default the node yields `undefined`.

<span id="special-actions"></span>The `_iter`, `_nonterminal`, `_terminal`, and `_correction` actions are sometimes called _special actions_. `_iter` and `_nonterminal` take a variable number of arguments, which are typically captured into an array using [rest parameter syntax](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Functions/rest_parameters) , e.g. `_iter(...children) { ... }`. The `_terminal` and `_correction` actions take no arguments.

<span id="fallible-actions"></span>A `guarded ! join` expression always contributes three arguments, even without recovery: the guarded node, a correction slot, and the join node. If the guarded expression failed, its argument is an empty optional node. The correction slot is an empty optional node on clean input and a childless `_correction` node after recovery. Its `sourceString` is the skipped input. An operation that visits this node can define `_correction`; `_nonterminal` does not handle it. Without one, the node follows the operation's [`corrections` option](#corrections-option): by default it yields `undefined`.

<!-- @markscript
  markscript.transformNextBlock((code) =>
    code.replace('...', "return lastName.x().toUpperCase() + ', ' + firstName.x()")
        .replace('...', "return this.sourceString;")
  );
-->

_**NOTE:** Versions of Ohm prior to v16.0 had slightly different behaviour with regards to default semantic actions. See [here](./releases/ohm-js-16.0.md#default-semantic-actions) for more details._

Note that you can also write semantic actions for built-in rules like `letter` or `digit`. For `ListOf`, please see the documentation on [asIteration](#asIteration) below.

### Parse Nodes

Each parse node is associated with a particular _parsing expression_ (a fragment of an Ohm grammar), and the node captures any input that was successfully parsed by that expression. Unlike many parsing frameworks, Ohm does not have a syntax for binding/capturing -- every parsing expression captures all the input it consumes, and produces a fixed number of values.

A node `n` has the following methods and properties:

<b><pre class="api">n.child(idx: number) &rarr; Node</pre></b>

Get the child at index `idx`.

<b><pre class="api">n.isTerminal() &rarr; boolean</pre></b>

`true` if the node is a terminal node, otherwise `false`.

<b><pre class="api">n.isCorrection() &rarr; boolean</pre></b>

`true` if the node is a `_correction` node, which holds input that recovery skipped, otherwise `false`.

<b><pre class="api">n.isIteration() &rarr; boolean</pre></b>

`true` if the node is an iteration node (i.e., if it associated with a repetition operator in the grammar), otherwise `false`.

<b><pre class="api">n.children: Array</pre></b>

An array containing the node's children.

<b><pre class="api">n.ctorName: string</pre></b>

The name of grammar rule that created the node.

<b><pre class="api">n.source: Interval</pre></b>

Captures the portion of the input that was consumed by the node.

<b><pre class="api" id="Node-sourceString">n.sourceString: string</pre></b>

The substring of the input that was consumed by the node. Equivalent to `n.source.contents`.

<b><pre class="api">n.numChildren: number</pre></b>

The number of child nodes that the node has.

<b><pre class="api">n.recoveredFailure: object | undefined</pre></b>

The diagnostic on a correction node; `undefined` on other nodes. It has the same shape as entries from `getRecoveredFailures()`.

<b><pre class="api">n.recoveredFailures: Array</pre></b>

Read-only recovery diagnostics at or below this node, in input order. At the root, these are the same diagnostic objects listed by `getRecoveredFailures()`.

<b><pre class="api">n.isOptional() &rarr; boolean</pre></b>

`true` if the node is an iterator node having either one or no child (? operator), otherwise `false`.

#### Operations and Attributes

In addition to the properties listed above, within a given semantics, every node also has a method/property corresponding to each operation/attribute in the semantics. For example, in a semantics that has an operation named 'prettyPrint' and an attribute named 'freeVars', every node has a `prettyPrint()` method and a `freeVars` property.

## Built-in Operations

### asIteration

The built-in `asIteration` operation offers a convenient way of handling _ListOf_ expressions, by adapting them to have the same interface as built-in iteration nodes. As an example, take the following grammar:

<!-- @markscript
  // Take the grammar below and instantiate it as `g_asIteration` in the markscript environment.
  markscript.transformNextBlock((code) =>
    `const g_asIteration = require('ohm-js').grammar(${JSON.stringify(code)});`
  );
-->

```
G {
  Start = ListOf<letter, ",">
}
```

...and an operation defined as follows:

<!-- @markscript
  const s = g_asIteration.createSemantics();
-->

```
s.addOperation('upper()', {
  Start(list) {
    return list.asIteration().children.map(c => c.upper());
  },
  letter(l) {
    return this.sourceString.toUpperCase();
  }
});
```

<!-- @markscript
  assert.deepEqual(
    s(g_asIteration.match('a, b, c')).upper(),
    ['A', 'B', 'C']
  );
-->

Then `s(g.match('a, b, c')).upper()` will return `['A', 'B', 'C']`. Note that calling `upper()` on the result of `asIteration` implicitly maps the `upper` operation over each element of the list.

You can also extend the `asIteration` operation to handle other list-like rules in your own language.
