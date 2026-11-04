# Language service plan

Status: proposal. Branch base: `feat/fallible`.

## Goal

A language author supplies an Ohm grammar and one semantic actions block. A language service comes from those two things:

1. **From the grammar alone:** syntax diagnostics with recovery, keyword and punctuation completion, tokens, folding, selection ranges, and generated TextMate, Monarch and `language-configuration.json` files.
2. **From role actions in the same block** (`def`, `ref`, `scope`, ...): outline, go to definition, references, rename, symbol completion, hover, and generic undefined and duplicate-name diagnostics.
3. **Everything else** (types, formatting, language-specific rules) stays optional author code.

The service is an editor-neutral library: offsets in, plain data out. A Monaco adapter runs it in the page; an LSP adapter serves it to other editors.

This plan covers the work needed to get there, in four parts: three small prerequisites in `ohm-js`, the language-service track in this repository, the downstream web-ide track, and future work.

## 1. Prerequisites in `ohm-js`

Three independent branches off `feat/fallible`. Each is useful on its own and none depends on another.

### P1. Recovering matchers accept edits

**Today.** `Matcher._prepareForRecovery` (`packages/ohm-js/src/Matcher.js`) throws when the input changed after an earlier match, or when the memo table came from a plain match. It then resets the memo table anyway, because a fresh `RecoveryContext` has no attempts for previously memoized entries. The guards are covered by `test/test-fallible.js` ("a matcher with a stale or plain memo table refuses to recover"), `doc/api-reference.md` and the `recover` option comment in `index.d.ts`.

**Finding.** The guards were meant as a performance safeguard. Measurements say they are not needed:

- They do not protect correctness. With the stale flag bypassed, an edited matcher produced exactly the result of a fresh `grammar.match(text, undefined, {recover: true})` on 1,613 random edit sequences over two HDL chips (success, recovered failures with position, interval and message, failure position): 0 mismatches, 0 throws.
- Removing them costs nothing, since a recovering match already starts from an empty memo.
- The reuse they might be guarding is not worth building in its simple form. Typing a new line one character at a time into a 27 KB chip, only 4 of 25 intermediate states were valid; trying plain incremental first and recovering from scratch otherwise averaged 577 ms against 601 ms for always matching fresh.

**Change (P1a).** Remove both guards. A recovering match is allowed on any matcher after any edit and always starts from an empty memo. Update the test, `doc/api-reference.md` and `index.d.ts`. Add the random-edit property test (edited matcher equals fresh match) to the suite, including a grammar with `supportsIncrementalParsing: false`.

**Effect.** A language service can hold one `Matcher` per document, call `replaceInputRange` on every change, and match with recovery. There is no speed-up yet; this fixes the API contract that real reuse (section 4) would later sit behind.

**Size.** Hours.

### P2. A correction policy for operations

**Today.** `Operation.execute` (`packages/ohm-js/src/Semantics.js`) checks for a correction node after the node-name lookup and before `_nonterminal` and `_default`, so an operation with no `_correction` action throws `missingCorrectionAction`. `test/test-fallible-acceptance.js` ("an operation without a `_correction` action throws on a recovered node") pins that. `Wrapper` exposes `recoveredFailure` but not `isCorrection()`.

**Change.** An opt-in policy on the operation:

```js
semantics.addOperation(signature, actions, {corrections: 'throw' | 'skip' | fn});
// also addAttribute, extendOperation, extendAttribute
```

- `'throw'` is the default and is today's behavior.
- `'skip'`: a correction node yields `undefined` and the operation continues. The author must tolerate `undefined` in child results, and can filter with `isCorrection()`.
- A function is a zero-arity action, equivalent to defining `_correction`.
- An explicit `_correction` action always wins. `extend*` inherits the policy unless given another. `toRecipe` serializes it.
- `Wrapper#isCorrection()` becomes public so generic `_nonterminal(...children)` traversals can filter.

**Tests.** Default still throws (the existing test, unchanged); `'skip'` through a recovered tree; function form; explicit action wins; `extendOperation` inheritance; recipe round trip; attributes memoize `undefined`.

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
| A2 | Document analysis: one `Matcher` per document, always recovering, token list, `pathAt` queries, syntax diagnostics | P1a, P2, P3 | An edit sequence equals a fresh analysis (property test) |
| A3 | Completion part A: expected string terminals at the cursor from a prefix parse, partial-token filtering, replace range | A2 | Reproduces the verified cases below |
| A4 | Facts vocabulary (`def`, `ref`, `scope`, `doc`, `diag`, `token`, `fold`), static-tagged role actions, a `facts` operation with merge defaults, `SymbolTable`, generic undefined and duplicate diagnostics | P2, A2 | HDL and ASM facts give the same spans as the web-ide's hand-written diagnostics |
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
| B3 | Facts for HDL, then ASM: outline, definition, references, rename; generic undefined and duplicate diagnostics replace the hand-written ones, with identical spans | A4, A5, B2 |
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

## 5. Decisions

1. Option name for P2: `corrections` as above, or `onCorrection`.
2. Consumption of track A by downstream projects: GitHub install (as today) or published packages.
3. Whether `grammar.describe()` is added to `ohm-js` up front (A1) or only if walking `grammar.rules` proves brittle.
