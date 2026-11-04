# A language service from a grammar and role declarations

Status: proposal with prototype evidence. This document is the design: the model, the behavior, the API and two worked examples. The schedule, the prerequisite in `ohm-js`, the evidence log and the open decisions are in [language-service-plan.md](./language-service-plan.md).

All output in the worked examples (sections 9 and 10) was produced by a reference engine of 288 lines that implements this design on top of this fork, with 90 passing assertions. It is a reference for the design, not the package the plan proposes to build.

## 1. What this is

A language author has an Ohm grammar and, usually, semantic actions that build an AST, compile or evaluate. An editor wants more: errors as you type, an outline, go to definition, find references, rename, completion. Today each language re-implements these by hand, once per editor.

The design derives them from two things the author already has or can state cheaply:

1. **The grammar**, which already says what the tokens, brackets and recovery points are.
2. **A small declaration of roles**: which positions in which rules *define* a name, which *refer* to one, and where scopes begin.

From those the engine computes a symbol table and answers editor questions over plain data: offsets in, spans and text out. The editor protocol is an adapter on top: LSP for out-of-process editors, direct calls for an in-page editor such as Monaco.

### Goals

- A language with existing actions gets a service **without editing those actions**.
- A new grammar gets a **single, clean declaration** that is checked against the grammar when it is defined.
- Half-typed input degrades gracefully: results near an error are marked uncertain instead of being wrong or missing.
- The author writes down only what cannot be read from the grammar.

### Non-goals

- Type systems. Type-dependent features (type-directed completion, signature help) need author analysis; the role model gives that analysis a symbol table to build on.
- Formatting, and refactorings beyond rename.
- Replacing a language's own compiler or checker. The service reuses their diagnostics and adds only what they lack.

## 2. Shape

```
grammar (Ohm)  +  roles  ───►  engine  ───►  analysis (plain data)  ───►  adapters
                                  │                                       ├─ in-page (Monaco)
          match with recovery ────┘                                       └─ LSP server
```

The engine walks the concrete syntax tree of a recovering match. **It does not run the author's operations or attributes.** That is what makes zero edits to existing actions possible, and it makes the service independent of whether those actions tolerate recovered input.

## 3. The role model

**Name.** The text of a rule the language declares to be an identifier (`identifiers: ['ident']`). A role may only pick children that can hold one; this is checked when the language is defined.

**Roles.** Three builders, each attached to a grammar rule and told which child holds the name:

- `scope()`: the node opens a lexical scope.
- `def(kind, options)`: the named child declares a symbol of `kind`.
- `ref(kind, options)`: the named child refers to a symbol.

A rule can carry several roles (an array). `kind` is a string such as `'fn'` or `'pin'`; `namespaces` groups kinds that share one lookup space (`value: ['let', 'param', 'fn']`), and a `ref` may name a kind or a namespace.

**Resolution.** A reference resolves by walking the scope chain outward from the reference, innermost first, so inner definitions shadow outer ones. A definition is visible in its whole scope unless an option narrows it.

### Core options

| Option | Meaning | Needed by |
|---|---|---|
| `child` | Index (or array of indexes) of the child holding the name | all |
| `hoist` | The definition binds in the scope *enclosing* the node that owns it (a function's name is visible outside the function) | functions, classes, chips, grammar rules |
| `visibleIn` | The definition is visible only inside the span of child N, not the whole scope (`let x = e1 in e2`) | let-expressions |
| `kindFrom` | Index of a keyword child that gives the definition its kind (`static`/`field`, `function`/`method`) | Jack, ES5 |
| `typeFrom` | Index of a child reference that gives the definition its declared type | typed member lookup |
| `in` and `members` | Member lookup: `a.b` resolves `b` among the members of the type of `a` (`"@N"`), or of the enclosing class (`"self"`) | Jack, HDL |
| `implicit` | An unresolved reference declares the symbol at its first use | HDL internal pins, ES5 globals |
| `external` | Resolve through a host-supplied resolver (other files, built-in libraries, a chip registry) | HDL chips, OS classes |
| `builtin` | Names that are always defined | constants such as HDL's `true` and `false` |

Prototypes on four languages (HDL, Jack, the Ohm grammar language, ES5) needed this core plus a tail of specialised options (conditional entries, weak definitions, dynamic scope, labels, workspace-level families). The tail is listed in the [appendix](#appendix-the-vocabulary-tail) with its evidence.

### What is inferred

The engine finds the **candidate** name positions from the grammar. It cannot tell a definition from a reference, and a heuristic that guessed gave 15 false "undefined" diagnostics on a valid HDL chip and 802 false ones in 1,126 references on ES5. So roles are written by the author, and the engine's job is to check them against the grammar (section 8), not to guess them.

## 4. Two notations, one model

**A spec beside existing actions (the on-ramp).** Roles are passed to `defineLanguage` with the grammar; nothing in the author's semantics changes. This is the path for a language whose actions or grammar the author cannot or does not want to touch. Every example below uses it.

**Roles in the action block (the destination).** A new language states its roles in the same declaration as its other operations: `ChipHead: def('chip', {child: 1})` as an action, with a function form for the few cases that need logic. This was exercised in full on Jack and in the first HDL prototype, not in the reference engine of this document.

Both forms normalise to one table (`doc.table`), so tools that check, propose or migrate declarations work on the model, not the notation, and a codemod can turn a table into inline roles mechanically (Jack round-tripped to an identical table). The design encourages the second form for new work because it is checked when defined, sits with the rest of the language's declarations, and leaves room for an escape hatch. It is not shorter than a table, and moving a rule's roles *into* an existing attribute action is not mechanical, so the design does not ask for that.

## 5. Behavior on incomplete input

Editors spend most of their time looking at input that does not parse. The design treats that as the main case, and sections 9 and 10 show each point below on real output.

- **Recovery points are in the grammar.** `B ! C` ("B, recovering at C") keeps what matched of `B` and skips input up to `C` when parsing fails. Where `B` matched and only `C` is missing, the references inside `B` survive.
- **A statement that fails to match contributes no symbols.** Its definitions are missing and its references are not seen. The service must not turn that into confident errors.
- **Uncertain, not wrong.** An unresolved name that sits in or beside skipped input is reported as `ref.uncertain`, never as an undefined-name error. Rename warns (`incomplete`) when skipped spans lie inside the symbol's reach.
- **Last good analysis.** A truncated or unclosed file makes the match fail with no tree. The service keeps the previous outline and symbols, marks the analysis `stale`, reports the syntax diagnostic, and refuses rename.
- **Recovery is a grammar change.** Adding `!` to a rule adds a correction child, which changes the rule's arity and so breaks positional actions, so recovery points go on rules the actions do not depend on, or in a wrapper rule. This is the one place where existing code can constrain a language.

## 6. Diagnostics

Three streams, kept apart:

1. **Syntax**, from the recovered failures of the match, with the expected-text list.
2. **Symbol**, from the roles: undefined reference, duplicate definition, undefined member, and the uncertain variant.
3. **Author**, from the language's own checker or compiler, shown as they are.

Where a language already reports undefined and duplicate names, the symbol stream would repeat it. The service shows the existing diagnostics and adds only what the author's checker lacks; for Jack that was duplicate variables (which the compiler silently overwrites), precise missing-member errors, and cross-file rename. Diagnostics are data (a code and typed arguments), rendered to text by the host, so they can be localised and mapped to LSP `code` and `data`. The reference engine produces the first two streams.

## 7. The service

```js
const lang = defineLanguage(grammar, { identifiers, namespaces, roles, external, start });
const doc = lang.analyze(text);       // never throws

doc.diagnostics        // syntax and symbol diagnostics, each with a span
doc.outline()          // nested definitions
doc.definitionAt(o)    doc.referencesAt(o)    doc.renameAt(o, name)
doc.completionsAt(o)   // keywords and punctuation legal at the cursor
doc.table              // the normalised declaration
doc.stale              // true when no tree was produced and symbols are from the last good text
```

Offsets are UTF-16 code unit indexes into the text. `start` names the start rule, because an Ohm subgrammar inherits its parent's. `renameAt` returns `{edits}`, optionally `incomplete: true`, or `{refused: reason}`. The reference engine also exposes read-only `doc.links`, `doc.skipped`, `doc.tree` and `doc.symbolsText`.

| Feature | Derived from | Status |
|---|---|---|
| Syntax diagnostics | recovered failures | in the reference engine |
| Undefined, duplicate and uncertain names | resolution over roles | in the reference engine |
| Outline, definition, references, rename | symbol table | in the reference engine; rename checked by oracles |
| Keyword completion | expected terminals at the cursor from a prefix parse | in the reference engine |
| Symbol completion | the rule stack at the cursor failure plus the symbol table | not built; the mechanism is unproven |
| Selection ranges, hover on a node | a path from the root to the cursor (`pathAt`) | cursor prototyped; features not built |
| Call-arity and similar author checks | a post-resolution `check` hook | designed; not in the reference engine |
| Folding, semantic tokens | grammar introspection | not built |
| Formatting, code actions | author code | out of scope |

**Adapters.** An in-page adapter registers Monaco providers that call these methods directly. An LSP adapter converts offsets to line and UTF-16 character positions (Ohm's column does not count `\r`; LSP's does), advertises only the capabilities the language's roles support, and serves open documents. Neither adapter is built.

## 8. Checked when defined

`defineLanguage` throws a clear error naming the rule and the option, with a suggestion, for: a rule that does not exist, a child index outside the rule's arity, a child that can never hold an identifier, an unknown option, a kind that no definition declares, an `external` ref with no host resolver. It does not catch a valid but wrong slot: `child: 2` where `3` was meant, when both can hold identifiers. Oracle checks (section 12) are how that is found.

## 9. Worked example: the Ohm docs' arithmetic language

The example grows the grammar the Ohm documentation uses to teach semantic actions. The documentation's grammar and its `eval` actions are used verbatim. Nothing in them is edited: every addition is a new rule, an Ohm override, or an action added by `extendSemantics`.

```ohm
Arithmetic {
  Exp
    = AddExp

  AddExp
    = AddExp "+" PriExp  -- plus
    | AddExp "-" PriExp  -- minus
    | PriExp

  PriExp
    = "(" Exp ")"  -- paren
    | number

  number
    = digit+
}
```

The documentation's example, `1 + (2 - 3) + 4`, evaluates to 4.

### Part A. Recovery on the unchanged grammar

**Before.** The grammar is given to `defineLanguage` with no roles: `defineLanguage(Arithmetic, {identifiers: [], roles: {}})`. With no names, outline, definition, references and rename have nothing to say, so what remains is what the grammar alone gives: syntax diagnostics and completion. On five broken inputs the grammar produces exactly one diagnostic (the first failure) and no tree. The grammar has no `;` at all, so even `1 + 2; 3 - 1` is a syntax error.

| Input | Result |
|---|---|
| `1 + ; 2 - 3;` | `@4` expected a digit or `"("`; no tree |
| `(2 - 3; 4;` | `@6` expected `")"`; no tree |
| `1 + + 2; 3;` | `@4` expected a digit or `"("`; no tree |
| `1 + 2; 3 - 1` | `@5` expected end of input; no tree |
| `1 + (2 - ` | `@9` expected a digit or `"("`; no tree |

Completion still works from the grammar alone: after `1 + ` it offers `(` and a digit, after `1 ` it offers `-` and `+`. After an earlier unrecovered error, `completionsAt` reports the end of input as unknown (`unreliable`) rather than guessing.

**After.** Recovery is a grammar change, made by inheritance in four lines:

```ohm
ArithmeticRecovering <: Arithmetic {
  Program = (Exp ! ";")*
  PriExp += string
  string = "\"" (~"\"" ~"\n" any)* "\""
  recoveryToken = string
}
```

`Program` makes each statement a recovery point: `Exp` is the guarded part and `;` the join. The `string` rules are the smallest extra construct for which `recoveryToken` has an observable effect: without it, the scan takes the `;` inside `"a;b"` as the join and reports a second, bogus error; with it the scan steps over the whole string. (On pure arithmetic neither `recoveryToken` nor `recoveryStop` changes anything, and neither do line comments.) The cost to the author is one new `eval` action for `Program`, which has arity 3 (guarded `Exp`, a correction slot, the `;` join):

```js
Program(stmts, corrections, semis) { return stmts.children.map(s => s.eval()); }
```

The same five inputs, with `start: 'Program'`:

| Input | Skipped (`«»`) | Diagnostic | Docs `eval` plus the new action |
|---|---|---|---|
| `1 + ; 2 - 3;` | `1 «+» ; 2 - 3;` | `@2-3` expected a digit, `"("` or `"\""` | `[1, -1]` |
| `(2 - 3; 4;` | `«(2 - 3»; 4;` | `@0-6` expected `")"` | **throws** `Missing semantic action for '_iter'` |
| `1 + + 2; 3;` | `1 «+ + 2»; 3;` | `@2-7` expected a digit, `"("` or `"\""` | `[1, 3]` |
| `1 + 2; 3 - 1` | none | `@12` expected `";"`; no tree | no tree |
| `1 + (2 - ` | none | `@9` expected a digit, `"("` or `"\""`; no tree | no tree |

Three of five now recover. Two things need care:

- **Evaluating a recovered tree is the author's problem.** `1 + ;` silently evaluates to 1 (the `+` is skipped), and the docs `eval` throws on `(2 - 3;` because the statement failed completely and its slot is an empty `_iter` node. A visited correction node yields `undefined`; `corrections: 'throw'` would throw instead; an operation that never visits the correction column never sees it. The engine in this design never runs `eval`, so it is not affected.
- **Recovery cannot repair a missing final `;`**: the join never appears, so there is no tree. Such files are handled by the last good analysis (below, B.4(d)). A variant `Program = Stmts ! end` keeps a tree and discards the damaged tail as one skipped span, at the price of a wrapper rule because the guarded part of `!` must have arity 1.

### Part B. Variables, and the roles that give them an editor

Variables are five new grammar lines:

```ohm
ArithmeticVars <: ArithmeticRecovering {
  Exp := LetExp | AddExp
  LetExp = "let" ident "=" Exp "in" Exp
  PriExp += ident -- var
  ident = ~keyword letter alnum*
  keyword = ("let" | "in") ~alnum
}
```

and an evaluator, added as a second operation with `extendSemantics` (`let x = e1 in e2` evaluates `e2` in an environment extended with `x`). The docs `eval` and the Part A `Program` action are untouched, and the docs example still evaluates to 4.

The roles are two lines. `x` in `let x = e1 in e2` is a definition visible only in `e2` (child 5); the let opens a scope; a variable use is a reference:

```js
const lang = defineLanguage(ArithmeticVars, {
  identifiers: ['ident'],
  namespaces: { value: ['let'] },
  start: 'Program',
  roles: {
    LetExp: [def('let', { child: 1, visibleIn: 5 }), scope()],
    PriExp_var: ref('value', { child: 0 }),
  },
});
```

```
doc.table = {"externalKinds":[],"identifiers":["ident"],"namespaces":{"value":["let"]},"roles":{"LetExp":[{"child":[1],"kind":"let","role":"def","visibleIn":5},{"role":"scope"}],"PriExp_var":[{"child":[0],"kind":"value","role":"ref"}]},"start":"Program"}
```

#### B.1 Shadowing

`let x = 1 in let x = x + 1 in x;` is valid and evaluates to 2. The initializer `x` (offset 21) resolves to the *outer* definition (4) and the body `x` (offset 30) to the *inner* one (17):

```
outline:
  let x @4-5
    let x @17-18
resolution:
  x@21 -> def@4
  x@30 -> def@17
```

A variant whose value tells the two apart, `let x = 5 in let x = x - 1 in x - 10;`, evaluates to -6; had the body used the outer `x` it would be -5.

#### B.2 Queries and rename

```
let base = 10 in base + 1;
let a = 1 in let b = a + 1 in (a + b) - (let a = 20 in a - b);
```

```
at 4  (def base):        definitionAt=4-8    referencesAt=4-8, 17-21
at 58 (use of a):        definitionAt=31-32  referencesAt=31-32, 48-49, 58-59
at 72 (inner a = 20):    definitionAt=72-73  referencesAt=72-73, 82-83
renameAt(72, "big") -> 2 edits [72-73 82-83]
  => ... (let big = 20 in big - b);
renameAt(31, "one") -> 3 edits [31-32 48-49 58-59]
  => let one = 1 in let b = one + 1 in (one + b) - (let a = 20 in a - b);
```

The inner `a` and the outer `a` are different symbols: renaming one leaves the other.

#### B.3 Undefined names and refusals

```
let a = 1 in a + b;
c + a;
```

```
semantic/ref.undefined @17-18 "b"
semantic/ref.undefined @20-21 "c"
semantic/ref.undefined @24-25 "a"      (a's let ended with the first statement)
```

Nothing was skipped, so these are certain errors. Rename asks the engine to re-resolve with the new name and refuses if any reference would resolve differently:

```
let outer = 1 in let inner = 2 in outer + inner;

renameAt(21, "outer")  -> REFUSED: collision: "outer" would change what outer at 34 refers to
renameAt(21, "inner2") -> 2 edits [21-26 42-47]
renameAt(21, "let")    -> REFUSED: "let" is not a valid identifier
renameAt(21, "1x")     -> REFUSED: "1x" is not a valid identifier
```

The collision is real: applying `inner -> outer` naively makes the body's `outer` resolve to the inner definition, and the program evaluates to 4 instead of 3.

#### B.4 Corrections, with names

**(a) A missing `;`.** The next statement is swallowed up to the following `;`:

```
let a = 1 in a
let b = 2 in b + a;
let c = 3 in c + z;
```

```
skipped:      let a = 1 in a\n«let b = 2 in b + a»;\nlet c = 3 in c + z;
diagnostics:  parse/syntax.expected @15-33 "let b = 2 in b + a" expected ";" or "-" or "+"
              semantic/ref.uncertain @52-53 "z"
outline:      let a @4-5
              let c @39-40
```

`b` is gone from the outline, and `z` is *uncertain*, not undefined: a skipped statement might have defined it in an enclosing scope. `a` and `c` still rename correctly, with all their uses.

**(b) A half-typed statement in the middle:**

```
let x = 1 in x;
let y = 2 +;
y + x;
```

```
skipped:      let x = 1 in x;\n«let y = 2 +»;\ny + x;
diagnostics:  parse/syntax.expected @16-27 "let y = 2 +" expected a digit or "(" or "\"" or a letter
              semantic/ref.uncertain @29-30 "y"
              semantic/ref.uncertain @33-34 "x"
outline:      let x @4-5
```

The use of `x` in the last line is uncertain as well. That is deliberately conservative: any skipped span in the scope chain makes an unresolved name uncertain, even in another statement.

**(c) An unclosed paren** loses the whole statement `let x = 1 in (x + 2` and keeps `let z`, whose definition and use still resolve.

**(d) A truncated file, after a good analysis.** The match fails with no tree. The service keeps the previous symbols, marks the result `stale`, and answers in the *last good text's* offsets:

```
let a = 1 in a + 1;
let b = a +

tree: false   stale: true   (symbols are from the last good text)
diagnostics:  parse/syntax.expected @31-31 expected a digit or "(" or "\"" or a letter (no tree)
outline:      let a @4-5
definitionAt(4) = 4-5   referencesAt(4) = 4-5, 13-14
renameAt(4, "xx") -> REFUSED: stale: the text has no tree, offsets refer to the last good text
```

#### B.5 What the roles add

The same recovered input, with `roles: {}` and then with the two roles:

```
let a = 1 in a + 2;
let b = a +;
b + a;
let c = 3 in c + d;
```

| | `roles: {}` | with roles |
|---|---|---|
| syntax diagnostic | `@20-31` expected a digit, `"("`, `"\""` or a letter | the same |
| other diagnostics | none | `ref.uncertain` for `b`, `a` and `d` (all near the skipped statement) |
| outline | empty | `let a`, `let c` |
| `definitionAt(4)` | none | 4-5 |
| `referencesAt(4)` | none | 4-5, 13-14 |
| `renameAt(4, "alpha")` | `{refused: "no symbol at this offset"}` | edits at 4-5 and 13-14 |

#### B.6 Checked against an independent oracle

The language has an evaluator, which is an independent check on rename: a rename that is accepted must not change the value of the program. On 10 programs with 23 definitions, 335 pairs of (definition, new name) were tried. 229 were accepted and all 229 kept the value; 106 were refused (37 for collision, 69 for an invalid identifier), and none of the refusals was unnecessary. Applying every rename naively would have broken exactly those 106.

#### What the example shows

- Part A needs no names at all: recovery is a four-line grammar change plus one new action, and it turns "one error, no tree" into "keep the good statements" on three of five inputs.
- Part B's declaration is two role lines for five grammar lines, and it turns the same grammar into outline, definition, references and a rename that refuses unsafe edits.
- Two departures from the sketch were needed: `start`, and `visibleIn` can only name a child of the same rule, so sequential top-level `let` was not modelled.

## 10. Worked example: HDL

The grammar is the web-ide's real HDL grammar (`base.ohm` followed by `hdl.ohm`, 114 lines, unmodified). The host supplies a chip registry, since a part's chip name resolves outside the file. The roles are 8 entries on 6 rules:

```js
const roles = {
  Chip_closed: scope(), Chip_unclosed: scope(),             // CHIP ... { ... } opens a scope
  ChipHead: def('chip', { child: 1, hoist: true }),         // CHIP And      -> bound outside the chip
  PinDecl: def('pin', { child: 0 }),                        // IN a, b[16];  -> declared pins
  ClockedBody: ref('pin', { child: 1 }),                    // CLOCKED a, b; -> uses of declared pins
  PartBody: ref('chip', { child: 0, external: true }),      // Nand(...)     -> resolved by the host
  Wire: [
    ref('pin', { child: 0, in: '@0', members: 'pin' }),     // left of `=`: a pin of the part's chip
    ref('pin', { child: 2, implicit: true,                  // right of `=`: a pin of this chip,
                 builtin: ['true', 'false'] }),             //   declared by first use; constants
  ],
};
const lang = defineLanguage(Hdl, {
  identifiers: ['identifier'], roles,
  external: { chip: name => registry[name] },               // { members: ['a', 'b', 'out'] }
});
```

### 10.1 A valid chip

```
CHIP And {
  IN a, b;
  OUT out;
  PARTS:
  Nand(a=a, b=b, out=x);
  Not(in=x, out=out);
}
```

```
diagnostics: none
outline:
  chip And @5-8
    pin a @16-17
    pin b @19-20
    pin out @28-31
    pin x @63-64 (implicit)
```

`x` is an internal wire, declared by first use. The part names and the left-hand pin names resolve through the host registry (`Nand@44 -> ext:chip:Nand`, `a@49 -> ext:chip:Nand.a`); the right-hand names resolve in the chip (`a@51 -> def@16`, `x@76 -> def@63`).

```
referencesAt(63)  = 63-64, 76-77             (the internal pin x)
renameAt(63, "nandOut") -> 2 edits           Nand(..., out=nandOut); Not(in=nandOut, ...)
renameAt(16, "in1")     -> 2 edits           IN in1, b; ... Nand(a=in1, ...)
renameAt(16, "b")       -> REFUSED: collision: "b" would change what b at 56 refers to
renameAt(44, "Foo")     -> REFUSED: external symbol Nand
renameAt(49, "q")       -> REFUSED: external symbol a
renameAt(5, "AndGate")  -> 1 edit
```

Renaming a pin that belongs to a library chip (`a` in `Nand(a=...)`) is refused: the file does not own it.

### 10.2 The three mistakes HDL users make

| Input | Diagnostic |
|---|---|
| `Nandd(a=a, b=b, out=out);` | `ref.undefined @45-50 {name: "Nandd", kind: "chip"}` |
| `Not(inn=a, out=out);` | `ref.undefinedMember @49-52 {name: "inn", owner: "Not"}` |
| `IN a, a;` | `def.duplicate @20-21 {name: "a", kind: "pin", first: 17-18}` |

All three are certain, since nothing is skipped. The third does not stop wires from resolving: they bind to the first `a`.

### 10.3 Corrections from typing

**(a) A part missing its `;`.** The next part is swallowed up to the following `;`:

```
  Nand(a=a, b=b, out=x)
  Not(in=x, out=out);
  Not(in=x, out=y);
```

```
skipped:      Nand(a=a, b=b, out=x)\n  «Not(in=x, out=out)»;
diagnostics:  parse/syntax.expected @68-86 expected ";"
outline:      chip And; pin a, b, out; pin x (implicit); pin y (implicit)
renameAt(16, "in1") -> 2 edits, incomplete: true
```

The swallowed part is not in the links. Renaming pin `a` is flagged `incomplete`, because skipped input lies inside the chip and could hold more uses.

**(b) A half-typed part in the middle** (`Nand(a=a, b=` then the next line) swallows the next part into one skipped span, with one diagnostic `expected ")"`; the chip and its three declared pins stay in the outline.

**(c) A header with no `{`** recovers at `PARTS`, skipping the header *and* the `IN`/`OUT` lines. The pins `a`, `b` and `out` then appear in the outline as implicit pins, declared by first use, and **no error is reported for the lost declarations**. That is a real hazard of `implicit`: it can hide the loss of a declaration next to a skipped span.

**(d) A truncated file** after a good analysis is `stale`, as in B.4(d): the outline of the last good text, the diagnostic `expected "false" or "true" or a letter`, and no rename.

### 10.4 Keyword completion

Completion is computed from the expected terminals of a prefix parse:

```
after "PARTS:"            keywords: }, CLOCKED         other: a letter
after "Nand(a="           keywords: false, true        other: a letter
after "IN a, "            keywords: ;                  other: a letter
partial "CHI"             keywords: CHIP               replace 0-3
after an earlier error    no suggestions               unreliable
```

### 10.5 Checked by a metamorphic test

For HDL there is no evaluator, so the check is metamorphic: rename a definition, then re-analyse and require the resolution to be identical up to the renamed text. Over 9 inputs and 41 definitions, 319 renames were tried; 183 were accepted and all 183 were identical, and 136 were refused.

## 11. Existing languages

For a language that already has actions, adoption is: write a roles block (7 to 20 entries across the four languages tried), check it against an oracle where one exists, and, if the language should recover from errors, add recovery points to the grammar. Nothing in the existing actions is edited.

A language's own checker can *propose* a draft: renaming a token and watching which of its diagnostics move found definition versus reference for pins in HDL and about two thirds of Jack's entries; it found 1 of 20 for ES5, which has no checker. It is a proposer, not a mechanism, because it is silently wrong when an action is refactored.

## 12. What this does not do, and what is unproven

- A **declaration is required**. It cannot be inferred, and the vocabulary beyond HDL is large (the appendix).
- **Type-dependent resolution** beyond declared types needs author code, as do call arity and static-versus-instance checks. They need resolved targets, so the design adds a post-resolution hook for author checks; it is not in the reference engine.
- **Large files**: a recovering match took 3.0 s of a 3.2 s analysis on 24 KB of ES5. Debouncing, or incremental recovering matches, is needed there.
- **Approximations in the reference engine.** `ref.uncertain` is conservative (any skipped span in the scope chain). Implicit definitions can mask lost declarations (10.3c). A new name is checked only against the identifier rule, so HDL accepts `IN` as a pin name. Sequential top-level visibility, reserved words and symbol completion are not modelled.
- **Not built**: symbol completion, both adapters, one engine across all four prototype languages (the reference engine runs two; the others were prototyped separately).
- **Validation.** Independent oracles where they existed: Jack, recompile after rename, 150 of 150 identical; ES5, ESLint's scope analysis, 270 of 270 groups; Ohm, recompile renamed grammars; the toy language, evaluation after rename; HDL, a metamorphic rename. They ran against the fork's source, not the web-ide's own test suites.

## Appendix: the vocabulary tail

HDL alone suggests `def`, `ref`, `scope`, member lookup and implicit definitions. The other three languages required the following, each shown necessary by removing it (the core options of section 3 cover the first six):

- scope chain with shadowing (rename correctness fell to 72 of 150 on Jack without it);
- owner hoisting, and hoisting of `var` to the function;
- definition kind from a keyword, and a declared type carried on a definition;
- typed member lookup (name-only lookup got 11 of 33 Jack method renames wrong);
- ordered kind groups and namespaces (variable before class; duplicates per namespace);
- implicit definitions, and external or built-in registries;
- explicit identifier rules, a search mode for identifiers under a slot, and stopping at rules that carry their own entries so nested expressions are not counted twice;
- override and extend resolution, names derived from other names (Ohm case names), arity on definitions and arguments on references;
- ES5 specifics, shown necessary by ablation: conditional entries (`=` versus `+=`), properties grouped by name, weak definitions, opaque namespaces (labels), dynamic scope (`with`), `arguments`; the temporal dead zone was tested only on a scratch grammar;
- file level: export from the file name, and a placeholder symbol for a file that failed or lost its header;
- workspace level: cross-file namespaces and a family rename with a collision check.
