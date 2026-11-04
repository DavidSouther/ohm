# Language service plan

Status: proposal, revised after prototyping on four languages (section 5). Branch base: `feat/fallible`.

## Goal

A language author supplies an Ohm grammar and semantic actions. A language service comes from those, without editing the actions:

1. **From the grammar alone:** syntax diagnostics with recovery, keyword and punctuation completion, tokens, folding, selection ranges, and generated TextMate, Monarch and `language-configuration.json` files.
2. **From a role table kept beside the actions** (`def`, `ref`, `scope`, ...; the actions themselves are not edited): outline, go to definition, references, rename, symbol completion, hover, and generic undefined and duplicate-name diagnostics.
3. **Everything else** (types, formatting, language-specific rules) stays optional author code.

The service is an editor-neutral library: offsets in, plain data out. A Monaco adapter runs it in the page; an LSP adapter serves it to other editors.

This plan covers the work needed to get there, in four parts: three small prerequisites in `ohm-js`, the language-service track in this repository, the downstream web-ide track, and future work.

## 1. Prerequisites in `ohm-js`

Three independent branches off `feat/fallible`. Each is useful on its own and none depends on another.

### P1. Recovering matchers accept edits

**Status:** implemented as PR 29, with review feedback applied.

**Today.** `Matcher._prepareForRecovery` (`packages/ohm-js/src/Matcher.js`) throws when the input changed after an earlier match, or when the memo table came from a plain match. It then resets the memo table anyway, because a fresh `RecoveryContext` has no attempts for previously memoized entries. The guards are covered by `test/test-fallible.js` ("a matcher with a stale or plain memo table refuses to recover"), `doc/api-reference.md` and the `recover` option comment in `index.d.ts`.

**Finding.** The guards were meant as a performance safeguard. Measurements say they are not needed:

- They do not protect correctness. With the stale flag bypassed, an edited matcher produced exactly the result of a fresh `grammar.match(text, undefined, {recover: true})` on 1,613 random edit sequences over two HDL chips (success, recovered failures with position, interval and message, failure position): 0 mismatches, 0 throws.
- Removing them costs nothing, since a recovering match already starts from an empty memo.
- The reuse they might be guarding is not worth building in its simple form. Typing a new line one character at a time into a 27 KB chip, only 4 of 25 intermediate states were valid; trying plain incremental first and recovering from scratch otherwise averaged 577 ms against 601 ms for always matching fresh.

**Change (P1a).** Remove both guards. A recovering match is allowed on any matcher after any edit and always starts from an empty memo. Update the test, `doc/api-reference.md` and `index.d.ts`. Add the random-edit property test (edited matcher equals fresh match) to the suite, including a grammar with `supportsIncrementalParsing: false`.

**Effect.** A language service can hold one `Matcher` per document, call `replaceInputRange` on every change, and match with recovery. There is no speed-up yet; this fixes the API contract that real reuse (section 4) would later sit behind.

**Size.** Hours.

### P2. A correction policy for operations

**Status:** implemented as PR 30. The review set the default to `'skip'`; the text below reflects that.

**Today.** `Operation.execute` (`packages/ohm-js/src/Semantics.js`) checks for a correction node after the node-name lookup and before `_nonterminal` and `_default`, so an operation with no `_correction` action throws `missingCorrectionAction`. `test/test-fallible-acceptance.js` ("an operation without a `_correction` action throws on a recovered node") pins that. `Wrapper` exposes `recoveredFailure` but not `isCorrection()`.

**Change.** A policy on the operation:

```js
semantics.addOperation(signature, actions, {corrections: 'skip' | 'throw' | fn});
// also addAttribute, extendOperation, extendAttribute
```

- `'skip'` is the default: a correction node yields `undefined` and the operation continues. The author must tolerate `undefined` in child results, and can filter with `isCorrection()`. Recovery is opt-in, so without it the policy never applies.
- `'throw'` restores today's strict behavior.
- A function is a zero-arity action, equivalent to defining `_correction`.
- An explicit `_correction` action always wins. The policy is a field on the operation: extensions inherit it, an option replaces it in either direction, and `toRecipe` writes it only when it differs from the inherited one.
- `Wrapper#isCorrection()` becomes public so generic `_nonterminal(...children)` traversals can filter.

**Caveat from prototyping (section 5).** The default only helps an operation that tolerates `undefined`. In the ES5 example, `hoistDeclarations` throws on a recovered tree and `toES5` prints "undefined"; the role table below survives because it runs none of the author's actions.

**Tests.** The default skips and `'throw'` throws (the two existing tests that pinned the throw now opt in); function form; explicit action wins; extension and inheritance in both directions; recipe round trip; attributes memoize `undefined`.

**Size.** A day.

### P3. A minimal cursor: `Wrapper#pathAt`

**Today.** `Wrapper` has `children`, `source`, `ctorName`, but no parent, no ancestor path and no way to ask which node is at an offset. Hover, definition, rename, selection ranges and completion all start from that question.

**Change.** One method, no new class:

```ts
wrapper.pathAt(offset: number, bias?: 'left' | 'right'): Wrapper[]
// root -> deepest node that covers `offset`; the last element is the node itself
```

Everything else an editor needs is derivable from the path with existing members (`isLexical()`, `ctorName`, `source`) and `isCorrection()` from P2:

- the token at the cursor: walk back from the end of the path while the node is lexical;
- whether the cursor is inside skipped input: any path element is a correction;
- the neighbors when the cursor sits in a gap: the last node's `children`, around `offset`.

Those helpers belong in the language-service package (track A), not in `ohm-js`.

**Semantics.**

| Case | Result |
|---|---|
| Offset on a boundary between siblings | `bias: 'right'` (default) picks the node that starts there; `'left'` picks the node that ends there |
| Offset in whitespace between children | The parent; no child covers it |
| Zero-width nodes (empty optional, empty correction slot) | Never covered |
| Offset inside skipped input | Ends at the `_correction` node |
| `_iter` nodes | Cover an offset only if one of their elements does (see below) |
| Offset outside the root's interval | `[root]` |
| Synthetic wrapper with no `source` | Throws |

**The one subtlety.** A repetition such as `(sep elem)*` produces one `_iter` node per column. They are sibling children of the enclosing nonterminal, each spanning the whole repetition, so their intervals overlap and "the last child starting at or before the offset" can pick the wrong column. The algorithm binary-searches the children by start offset, then tries each adjacent child that contains the offset, accepting an `_iter` only if it has an element covering it. The candidates are as few as the arity of the repetition.

**Efficiency.** Wrappers are created only for the nodes on the path (`Wrapper#child`), never for all of a node's children, and the lookup is O(depth x log children).

**Evidence.** A prototype against the HDL grammar in the web-ide, written as it would live in `Wrapper` (using `_node.childOffsets` and `_baseInterval`): identical to a brute-force oracle at every offset, both biases, on valid and recovered trees (436 checks, 0 mismatches; the oracle uses the same coverage rule, so this validates the search, not the rule). On a 4,000-part chip: 3.4 us per call, against 310 us for scanning with all child wrappers materialized; first call on a fresh tree 0.24 ms. Timings are from a sandbox; the ratio is what matters.

**Tests.** One per table row; `pathAt` at every offset of sample files equals the brute-force oracle; a recovered tree; an empty file; repetitions with separators.

**Size.** A few days, including types in `index.d.ts` and docs.

### Order

P1a, P2 and P3 can be three PRs in parallel. Track A depends on all three.

## 2. Track A: the language service (this repository, branched from `feat/fallible` plus P1-P3)

New packages follow `packages/semantics` (ESM TypeScript, `tsc`, `ava`) in this pnpm workspace: `packages/language`, `packages/lsp`, `packages/monaco`.

| # | Deliverable | Needs | Done when |
|---|---|---|---|
| A0 | Scaffolding for the three packages, CI wiring, a docs page | none | The packages build and test empty |
| A1 | `introspect(grammar)`: keywords, punctuation, token rules by naming convention (overridable), bracket pairs, foldable rules. Built in the package by walking `grammar.rules`; a stable `grammar.describe()` in `ohm-js` only if the walk proves brittle | none | The model for a real grammar (web-ide HDL) matches a hand-written expectation |
| A2 | Document analysis: one `Matcher` per document, always recovering, token list, `pathAt` queries, syntax diagnostics, and the last good analysis kept when a parse yields no tree (truncated or unclosed input gives zero facts in every prototype) | P1a, P2, P3 | An edit sequence equals a fresh analysis (property test); a truncated file keeps the previous outline |
| A3 | Completion part A: expected string terminals at the cursor from a prefix parse, partial-token filtering, replace range | A2 | Reproduces the verified cases below |
| A4 | The role table and its engine: the vocabulary in section 5, an engine that walks the concrete syntax tree (it runs none of the author's actions), a `SymbolTable` with scope chains and a workspace layer, `uncertain` marking from damage analysis, and a table validator that checks a table against an oracle (the language's own checker or compiler where one exists) | P2, A2 | Tables for HDL, Jack, the Ohm grammar language and ES5 pass the checks in section 5 on one shared engine (today there are four prototype copies) |
| A4b | Table proposer: probe the language's existing checker (rename a token, watch which diagnostics move) to draft a table for review | A4 | Drafts about two thirds of Jack's rows; says plainly where there is no checker to probe (ES5: one of 20 entries) |
| A5 | Features on facts: definition, references, document highlight, rename, outline, hover, quick fixes from diagnostic suggestions, folding, selection ranges, semantic tokens | A3, A4, P3 | Golden-file tests with a cursor marker |
| A6 | Completion part B (symbols): record the rule stack at the cursor failure (`Failure.context`, enabled by a `completionAt` match option); memo bypass in that mode | A4 | A spike shows the stack survives memoization |
| A7 | Emitters: TextMate, Monarch, `language-configuration.json` | A1 | Generated Monarch matches the web-ide's hand-written highlighting for its six languages |
| A8 | Adapters: `monaco` (providers in the page) and `lsp` (stdio, `vscode-languageserver`; offset to UTF-16 position conversion that handles `\r`, which Ohm's column does not count) | A5 | One `Language` served over both with identical results |

**Verified for A3.** Against the web-ide's HDL grammar, a prefix parse's rightmost failures at the cursor are the legal next tokens: after `PARTS:` they are `}`, `CLOCKED` and an identifier start; after `Nand(a=` they are `false`, `true` and an identifier start; after `IN a, ` they are `;` and an identifier start. The same holds with `{recover: true}` when an earlier error exists (the final recovered failure lists them). A partial word reports its failure at the start of the token (`CHI` at its first character), so completion filters by what was typed.

**Critical path.** P1a, P2, P3 -> A2 -> A3 -> A4 -> A5 -> A8. A1, A6 and A7 branch off it.

**Risks.**

- A6: recording a rule stack conflicts with the matcher reusing memoized failures; the mitigation is to bypass failure memoization at the target offset in that mode, and needs a spike.
- A3: a prefix parse loses lookahead, so suggestions mid-line may be too broad.
- A2: an unsuccessful recovering parse has no root tree. Decide between keeping the last good analysis (stale) and exposing a partial tree.

## 3. Track B: web-ide (separate repository; consumes track A)

Written here so the dependency is visible; these are tracked in the web-ide repository, not by this one.

| # | Deliverable | Needs |
|---|---|---|
| B0 | Land the `diagnostics/*` pull request stack in `nand2tetris/web-ide` (the chain from "Use Ohm fallible branch with recovery" through the CLI option, plus the custom chip completions PR). Everything below branches from its tip | review |
| B1 | Consume the new packages the way the stack consumes this fork today (a GitHub install of this repository) | A0 |
| B2 | HDL first: define the language with `defineLanguage`; replace the hand-written Monarch file by the generated one; keyword completion, folding, selection ranges. Diagnostic codes and arguments stay byte-identical (they are the API for message catalogs and the CLI) | A3, A7, B1 |
| B3 | Role tables for HDL, then ASM: outline, definition, references, rename; generic undefined and duplicate diagnostics replace the hand-written ones, with identical spans | A4, A5, B2 |
| B4 | Workspace resolution for cross-file references (chips using chips, Jack classes using classes) through the web-ide file system and the builtin chip registry | A5, B3 |
| B5 | Symbol completion for HDL (part and pin names) | A6, B3 |
| B6 | VS Code extension: generated TextMate and language configuration replace the hand-written files; diagnostics through the shared service | A7, A8 |
| B7 | Jack and VM: nested scopes, per-function labels, cross-file classes | A4, B4 |
| B8 | Editing performance: one `Matcher` per document, debounce and cancellation, stale-while-revalidate for large files | P1a |

Constraints that carry over from that repository: formatting, linting, type checks and tests only through its `npm run` and `npm test` scripts; user-facing text through Lingui macros; `simulator` returns `Result<T, E>`. B6 and B7 should wait until B2 and B3 show the vocabulary holds for HDL and ASM.

## 4. Future

Not scheduled; revisit after A5.

| Item | Why later |
|---|---|
| True incremental recovery: keep recovery work (cache records, attempts, selected corrections) across edits and re-run only the affected region | Only large files need it. Fresh recovering parses cost about 1.1-1.5x a plain parse (70 ms for 5 KB, 415 ms for 27 KB, 1.4 s for 112 KB), while plain incremental edits are 30-50x cheaper, so the prize is real. The work needs re-keying position-dependent cache state and is uncertain. Start with a spike; stop if one week does not reach 5x on the 27 KB case with no mismatches against a fresh match |
| A v18 (wasm) adapter | The facts vocabulary is runtime-independent; only the adapter differs. A faster base engine also changes the previous item's calculus, since base parse cost dominates |
| Formatting as an optional operation | Needs a pretty-printer per language |
| Types, signature help, inlay hints on top of the symbol table | Author-written analysis; no shared mechanism yet |
| Generic recovery placeholders | Languages hand-write "null objects" for recovered slots today; the facts layer could replace most of it |
| One action block for both facts and AST building | Two operations over one grammar is simpler for a first version |
| Grammar-level role annotations | Needs a meta-grammar change; tagged actions give most of the value without it |
| Cross-language navigation (for example Jack to generated VM) | Needs a source map between compilation stages |
| Incremental text sync, semantic-token deltas, a partial tree on failed recovery | Optimizations once the basics work |

## 5. What prototyping showed

The design was prototyped on four languages, outside this repository: the web-ide's HDL and Jack (their real grammars and actions), the Ohm grammar language itself, and ES5 from `examples/ecmascript`. For HDL three approaches were compared: **A**, a role table beside the actions that is applied to the concrete syntax tree; **B**, observing the running actions; **C**, deriving symbols from the AST the actions already build. The Jack, Ohm and ES5 runs used A. All ran against this fork's source. The web-ide's own test suites were not run, because the stack needs a newer `jiffies` than was installed.

### Migration cost

Existing action code edited: **0 lines in all four languages.** That is not the same as zero migration:

| Language | Table | Engine | Validation |
|---|---|---|---|
| HDL | 7 entries | 218 lines | Outline, definition, references, rename and unresolved-name diagnostics on valid files and files with errors |
| Jack | 19 rows (17 def/ref, 2 scope), 3 namespaces, a declared identifier rule, one export-from-filename flag | 345 lines | Renamed each of 150 definitions and recompiled with the existing compiler: 150 of 150 identical output; 0 false diagnostics on 11 valid files |
| Ohm grammar language | 11 entries (plus 1 in the recovery copy), 16 lines | n/a | 0 false positives on 19 real grammar groups; 40 of 40 and 17 of 17 renaming mutations caught; renames verified by recompiling with Ohm |
| ES5 | 20 entries (8 scope, 12 def/ref; ES6 adds 8) | 221 lines | `underscore` (24 KB, 105 scopes): 270 of 270 occurrence groups identical to ESLint's scope analysis |

What the author still has to supply:

1. **The table.** It cannot be inferred. Grammar-only inference gave 15 false "undefined" diagnostics on a valid HDL chip, and on ES5 guessed 3 of 13 roles right, found 0 of 8 scopes, and produced 802 false "undefined" out of 1,126 references. Name heuristics mislabel `compoundIdentifier` (Jack) and `caseName` (Ohm).
2. **Recovery points in the grammar.** They are a grammar change, constrained by the arities that existing positional actions fix (ES5 needed a wrapper rule for `Program`; adding them to the real Ohm meta-grammar breaks `buildGrammar`), and a join must guard the next construct's head or recovery swallows it.
3. **Operations that must tolerate `undefined`** if they run on recovered trees (P2's caveat).

### The approaches

- **A is the mechanism.** It kept the most facts near errors and held up on all four languages.
- **B is a proposer, not a mechanism.** On HDL it found definition versus reference for pins with no declaration (173 of 173 rename sets correct) and reused the existing builder's diagnostics. On Jack, 902 probes in 64 s proposed about two thirds of the table; on ES5, which has no checker, 1 of 20 entries. It is silently wrong when an action is refactored (interning a name dropped rename correctness to 0 of 46) and it patches private Ohm internals.
- **C is dropped.** The AST rarely carries spans (HDL declarations and all of Jack's have none), it loses more near errors, and it cannot apply to the Ohm grammar language, since `ohm.grammar()` throws on a broken file and so yields no object.

### The vocabulary the table needs

HDL alone would have suggested `def`, `ref`, `scope`, member lookup and implicit definitions. The other three languages required, each shown necessary by removing it:

- scope chain with shadowing (rename correctness fell to 72 of 150 on Jack without it);
- owner hoisting: a scope's own name (subroutine, class, function, rule) binds in the enclosing scope; and hoisting of `var` to the function;
- definition kind taken from a keyword (`static` or `field`; `constructor`, `function` or `method`), and a declared type carried on a definition;
- typed member lookup: `a.b` resolves through the declared type of `a`, or through the class when `a` names one (name-only lookup got 11 of 33 Jack method renames wrong);
- ordered kind groups and namespaces (variable before class; duplicates per namespace);
- implicit definitions (HDL pins; ES5 globals), and external or built-in registries (chips, OS classes, ES5 globals, Ohm's built-in rules);
- explicit identifier rules, a search mode for identifiers under a slot, and stopping at rules that carry their own entries so nested expressions are not counted twice;
- override and extend resolution, names derived from other names (Ohm case names), arity on definitions and arguments on references;
- ES5 specifics shown necessary by ablation: conditional entries (`=` versus `+=`), properties grouped by name, weak definitions, opaque namespaces (labels), dynamic scope (`with`), `arguments`; temporal dead zone was tested only on a scratch grammar;
- file level: export from the file name, and a placeholder symbol for a file that failed or lost its header;
- workspace level: cross-file namespaces and a family rename with a collision check.

### Behavior on recovered input

- A statement that fails to match contributes no facts. When only its join is missing, `B ! C` keeps the guarded part, so references survive (Jack: 30-35 of 35 references resolved, and every missed rename site lay inside a flagged lost span).
- A lost declaration disappears from the outline. The rule that worked: **never report an unresolved name beside skipped input as an error; mark it `uncertain`.** Jack's damage analysis, derived from the grammar and the table, gave 0 certain false positives.
- A truncated file or unclosed construct makes the match fail, so there are no facts. Every language needs a cache of the last good analysis. On ES5, typing one statement a key at a time (30 prefixes) gave a null root on 16 without recovery points and on 0 with five; the outline was correct 30 of 30 against 14 of 30.
- Rename near skipped input should warn or refuse.

### Existing checkers

Reuse their diagnostics as they are, and let the table add only what they lack, to avoid double reporting. For Jack the existing checker's argument-count, call-kind, OS-interface, return-path and class-name checks are reusable; the reference layer would duplicate five codes (undeclared variable, unknown type, undefined class, missing subroutine, duplicate subroutine, which agreed by line on 6 mutants); and the table adds duplicate variables, parameters and fields (the compiler silently overwrites them), precise missing-member errors, and cross-file rename. `ohm.grammars()` throws one error with no code field, so it can supply only four checker-only kinds for `.ohm` files.

### Performance

A recovering match took 3.0 s of a 3.2 s analysis on 24 KB of ES5. Large files need debouncing or incremental recovering matchers (section 4).

### Corrections to earlier drafts of this plan

- Symbol facts are not written as actions in the author's block. A table owns them, and the engine owns the traversal.
- A flat scope with one definition per symbol is not enough, and neither is inference from rule names.
- "No `_correction` action needed" holds only for operations that tolerate `undefined`.
- Typed member lookup is expressible in the table, not an author hook.

## 6. Decisions

1. Notation for the table. The prototype normalised three notations to the same table: an object of builders (about 9 lines for HDL), a line-oriented file (7 lines), and `//@` comments inside the `.ohm` file (6 lines, but it edits the grammar). Recommendation: the object of builders as the canonical form, since it is typed and composable; the others can compile to it.
2. How much of the vocabulary ships in the first version. The core is scope chain, owner hoisting, kind from keyword, declared type with typed member lookup, namespaces, implicit definitions, external registries, explicit identifier rules, `uncertain` marking and the last-good cache. The ES5-only items can follow.
3. Consumption of track A by downstream projects: GitHub install (as today) or published packages.
4. Whether `grammar.describe()` is added to `ohm-js` up front (A1) or only if walking `grammar.rules` proves brittle.
