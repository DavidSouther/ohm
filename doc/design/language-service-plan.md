# Language service: plan and evidence

Status: proposal, revised after prototyping on four languages and a reference engine (section 5). Branch base: `feat/fallible`.

The design (the role model, behavior on incomplete input, the API, and worked examples on the Ohm docs' arithmetic language and on HDL) is in [language-service.md](./language-service.md). This document is the plan to build it: the prerequisite in `ohm-js`, the deliverables of the two tracks, future work, the evidence behind the design, and the open decisions.

## Goal

A language author supplies an Ohm grammar, roles (which positions define and refer to names, and where scopes begin), and optionally semantic actions. An editor-neutral language service comes from those, with offsets in and plain data out: syntax diagnostics with recovery, completion, outline, go to definition, references, rename, and generic undefined and duplicate-name diagnostics. A Monaco adapter runs it in the page; an LSP adapter serves it to other editors. A language that already has actions gets a service without editing them; a new grammar gets the clean-sheet declaration.

This plan has four parts: one small prerequisite in `ohm-js`, the language-service track in this repository, the downstream web-ide track, and future work.

## 1. Prerequisite in `ohm-js`

One branch off `feat/fallible`.

### A minimal cursor: `Wrapper#pathAt`

**Today.** `Wrapper` has `children`, `source`, `ctorName`, but no parent, no ancestor path and no way to ask which node is at an offset. Hover, definition, rename, selection ranges and completion all start from that question.

**Change.** One method, no new class:

```ts
wrapper.pathAt(offset: number, bias?: 'left' | 'right'): Wrapper[]
// root -> deepest node that covers `offset`; the last element is the node itself
```

Everything else an editor needs is derivable from the path with existing members (`isLexical()`, `ctorName`, `source`) and `isCorrection()`:

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

## 2. Track A: the language service (this repository, branched from `feat/fallible` plus the cursor)

New packages follow `packages/semantics` (ESM TypeScript, `tsc`, `ava`) in this pnpm workspace: `packages/language`, `packages/lsp`, `packages/monaco`.

| # | Deliverable | Needs | Done when |
|---|---|---|---|
| A0 | Scaffolding for the three packages, CI wiring, a docs page | none | The packages build and test empty |
| A1 | `introspect(grammar)`: keywords, punctuation, token rules by naming convention (overridable), bracket pairs, foldable rules. Built in the package by walking `grammar.rules`; a stable `grammar.describe()` in `ohm-js` only if the walk proves brittle | none | The model for a real grammar (web-ide HDL) matches a hand-written expectation |
| A2 | Document analysis: one `Matcher` per document, always recovering, token list, `pathAt` queries, syntax diagnostics, and the last good analysis kept (marked `stale`) when a parse yields no tree (truncated or unclosed input gives no symbols in every prototype) | the cursor | An edit sequence equals a fresh analysis (property test); a truncated file keeps the previous outline |
| A3 | Completion part A: expected string terminals at the cursor from a prefix parse, partial-token filtering, replace range | A2 | Reproduces the verified cases below |
| A4 | The role model and its engine: the role model of the [design](./language-service.md#3-the-role-model) with its [vocabulary tail](./language-service.md#appendix-the-vocabulary-tail), an engine that walks the concrete syntax tree (it runs none of the author's operations), a symbol table with scope chains and a workspace layer, `uncertain` marking from damage analysis, and a validator that checks roles against an oracle (the language's own checker or compiler where one exists) | A2 | Roles for HDL, Jack, the Ohm grammar language and ES5 pass the checks in section 5 on one shared engine (today the reference engine runs the toy language and HDL, and separate prototypes run the rest) |
| A4b | Role proposer: probe the language's existing checker (rename a token, watch which diagnostics move) to draft roles for review | A4 | Drafts about two thirds of Jack's rows; says plainly where there is no checker to probe (ES5: one of 20 entries) |
| A4c | The clean-sheet API: `defineLanguage(grammar, spec)` (the reference engine's `roles:` spec) and roles written in the action block, normalising to the same table, a codemod from a table to inline roles, definition-time checks against the grammar, containment of failing function-form actions, and documentation that leads with it | A4 | Jack round-trips table to inline and back to an identical table (shown in the prototype); HDL, the Ohm grammar language and ES5 do the same; the function form handles one ES5 case the declarative vocabulary does not |
| A4d | A post-resolution `check` hook: author code that receives resolved definitions and references, for checks roles cannot express (call arity and static-versus-instance calls in Jack) | A4 | Jack's call-arity and call-kind checks run through it and agree with the existing compiler's |
| A5 | Features on the symbol table: definition, references, document highlight, rename, outline, hover, quick fixes from diagnostic suggestions, folding, selection ranges, semantic tokens | A3, A4 | Golden-file tests with a cursor marker |
| A6 | Completion part B (symbols): record the rule stack at the cursor failure (`Failure.context`, enabled by a `completionAt` match option); memo bypass in that mode | A4 | A spike shows the stack survives memoization |
| A7 | Emitters: TextMate, Monarch, `language-configuration.json` | A1 | Generated Monarch matches the web-ide's hand-written highlighting for its six languages |
| A8 | Adapters: `monaco` (providers in the page) and `lsp` (stdio, `vscode-languageserver`; offset to UTF-16 position conversion that handles `\r`, which Ohm's column does not count) | A5 | One `Language` served over both with identical results |

**Verified for A3.** Against the web-ide's HDL grammar, a prefix parse's rightmost failures at the cursor are the legal next tokens: after `PARTS:` they are `}`, `CLOCKED` and an identifier start; after `Nand(a=` they are `false`, `true` and an identifier start; after `IN a, ` they are `;` and an identifier start. The same holds with `{recover: true}` when an earlier error exists (the final recovered failure lists them). A partial word reports its failure at the start of the token (`CHI` at its first character), so completion filters by what was typed.

**Critical path.** The cursor -> A2 -> A3 -> A4 -> A5 -> A8. A1, A6 and A7 branch off it.

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
| B8 | Editing performance: one `Matcher` per document, debounce and cancellation, stale-while-revalidate for large files | none |

Constraints that carry over from that repository: formatting, linting, type checks and tests only through its `npm run` and `npm test` scripts; user-facing text through Lingui macros; `simulator` returns `Result<T, E>`. B6 and B7 should wait until B2 and B3 show the vocabulary holds for HDL and ASM.

## 4. Future

Not scheduled; revisit after A5.

| Item | Why later |
|---|---|
| True incremental recovery: keep recovery work (cache records, attempts, selected corrections) across edits and re-run only the affected region | Only large files need it. Fresh recovering parses cost about 1.1-1.5x a plain parse (70 ms for 5 KB, 415 ms for 27 KB, 1.4 s for 112 KB), while plain incremental edits are 30-50x cheaper, so the prize is real. The work needs re-keying position-dependent cache state and is uncertain. Start with a spike; stop if one week does not reach 5x on the 27 KB case with no mismatches against a fresh match |
| A v18 (wasm) adapter | The role vocabulary is runtime-independent; only the adapter differs. A faster base engine also changes the previous item's calculus, since base parse cost dominates |
| Formatting as an optional operation | Needs a pretty-printer per language |
| Types, signature help, inlay hints on top of the symbol table | Author-written analysis; no shared mechanism yet |
| Generic recovery placeholders | Languages hand-write "null objects" for recovered slots today; the role layer could replace most of it |
| One action block for both roles and AST building | Two operations over one grammar is simpler for a first version |
| Grammar-level role annotations | Needs a meta-grammar change; tagged actions give most of the value without it |
| Cross-language navigation (for example Jack to generated VM) | Needs a source map between compilation stages |
| Incremental text sync, semantic-token deltas, a partial tree on failed recovery | Optimizations once the basics work |

## 5. What prototyping showed

The design was prototyped on four languages, outside this repository: the web-ide's HDL and Jack (their real grammars and actions), the Ohm grammar language itself, and ES5 from `examples/ecmascript`. For HDL three approaches were compared: **A**, a role table beside the actions that is applied to the concrete syntax tree; **B**, observing the running actions; **C**, deriving symbols from the AST the actions already build. The Jack, Ohm and ES5 runs used A. All ran against this fork's source. The web-ide's own test suites were not run, because the stack needs a newer `jiffies` than was installed.

### Migration cost

Existing action code edited: **0 lines in all four languages.** That is not the same as zero migration:

| Language | Table | Engine | Validation |
|---|---|---|---|
| HDL | 7 entries (8 in the reference engine) | 218 lines | Outline, definition, references, rename and unresolved-name diagnostics on valid files and files with errors |
| Jack | 18 entries, 3 namespaces, a declared identifier rule, one export-from-filename flag | 345 lines | Renamed each of 150 definitions and recompiled with the existing compiler: 150 of 150 identical output; 0 false diagnostics on 11 valid files |
| Ohm grammar language | 11 entries (plus 1 in the recovery copy), 16 lines | n/a | 0 false positives on 19 real grammar groups; 40 of 40 and 17 of 17 renaming mutations caught; renames verified by recompiling with Ohm |
| ES5 | 20 entries (8 scope, 12 def/ref; ES6 adds 8) | 221 lines | `underscore` (24 KB, 105 scopes): 270 of 270 occurrence groups identical to ESLint's scope analysis |

What the author still has to supply:

1. **The table.** It cannot be inferred. Grammar-only inference gave 15 false "undefined" diagnostics on a valid HDL chip, and on ES5 guessed 3 of 13 roles right, found 0 of 8 scopes, and produced 802 false "undefined" out of 1,126 references. Name heuristics mislabel `compoundIdentifier` (Jack) and `caseName` (Ohm).
2. **Recovery points in the grammar.** They are a grammar change, constrained by the arities that existing positional actions fix (ES5 needed a wrapper rule for `Program`; adding them to the real Ohm meta-grammar breaks `buildGrammar`), and a join must guard the next construct's head or recovery swallows it.
3. **Operations that must tolerate `undefined`** if they run on recovered trees. A correction node yields `undefined` unless an operation opts into `corrections: 'throw'`, and in the ES5 example `hoistDeclarations` throws on a recovered tree while `toES5` prints "undefined". The role table survives because it runs none of the author's operations.

### Two ways in: an on-ramp and a destination

The same role model can be written in two places (the [design](./language-service.md#4-two-notations-one-model) describes both), and the plan proposes to **encourage authors to move from the first to the second**.

- **On-ramp: a table beside the actions.** For a language that already has actions, or whose grammar the author does not own (the ES5 example, the Ohm meta-grammar), a table gives a service with 0 edits to the actions. Three notations (an object of builders, a line-oriented file, `//@` comments in the grammar) normalised to the identical table in the prototype, which asserted it.
- **Destination: the clean-sheet API.** `defineLanguage` (the prototype's name; the name is open) with roles in the action block, where they sit beside the author's operations: `ChipHead: def('chip', {child: 1})`, `Chip_closed: scope()`, and a function form carrying a static `role` tag for the cases that need logic. For HDL the whole symbol-level block was about fifteen lines, and the roles could be read without parsing a file, so capabilities and symbol-completion context are known statically.

Why the second is worth encouraging, and how far Jack bore each argument out:

1. **Roles are checked against the grammar when they are defined.** A role that names a misspelled rule, a child index out of range, a child that can never hold an identifier, an unknown option or a mistyped kind is an error with a suggestion at definition time (`no rule "ClassVarDecbody" ... Did you mean "ClassVarDecBody"?`), not a silent no-op. What it does not catch is a valid but wrong slot. This is a gain over an unchecked table, not over a checked one, and it does not remove duplication with the author's existing attributes: 7 of the 13 role-bearing Jack rules also appear in an attribute action, so the roles and the AST code state the same slot knowledge twice and can drift from each other.
2. **An escape hatch for the vocabulary's tail.** Jack did not need it: every Jack role is a tagged declarative action (HDL's handle passing became `in: "@slot"`). The case for it rests on ES5, which needed a dozen specialised options (dynamic scope for `with`, `arguments`, weak definitions, ...) and has not been run through the inline form. What Jack did need author code for is call arity and static-versus-instance call checks; those need resolved targets, so they call for a post-resolution `check` hook that receives resolved definitions, not a role action.
3. **Recovery designed in.** It holds for Jack because its grammar already guards `B ! C` and the roles key on the guarded part. A rule written with `!` has an extra correction child (arity 3 for `VarDec`, 4 for `SubroutineDec`), so roles sit on the inner guarded rules. A new grammar designs both together.
4. **Newcomers start there.** Documentation and generated scaffolds lead with the clean-sheet API; the table is described as the way to bring an existing language along.

What keeps the migration cheap: both forms are the same model, and the table-to-inline step is mechanical. A codemod turned Jack's table into 20 lines of source; evaluating them reproduced the identical table, and 25 random shuffles of entry order and option key order did too. The validator and the table proposer work on the model, not the notation. The inline roles block sits beside the author's existing attributes in one semantics with no name clash, so adopting it does not touch them. Moving a rule's roles *into* an existing attribute action is not mechanical, and the plan does not propose it.

What has and has not been shown. The inline form has been exercised on HDL (first prototype) and on Jack (in full): Jack's inline declaration gave identical results to its table on 33 inputs (66 of 66 analyses, for tagged and function form), a rename check of 150 of 150 definitions recompiled with the existing compiler, 0 false diagnostics on 11 valid files, and byte-identical output on the corruption scenarios. The roles operation also ran on the real Jack semantics with `corrections: 'throw'`, leaving the existing AST and compiler output unchanged on valid and recovered input. The Ohm grammar language and ES5 have only been run in table form.

Costs the Jack run found:

- **The inline form is not shorter.** Jack's table is 21 non-blank lines; the inline declaration is 33 formatted (20 as generated). Authors have to know the child index of each name and that identifiers are declared; the arity adjustment Ohm requires is invisible to them.
- **Function-form actions run, so recovery has to be handled by the framework.** Its own `_correction` handling takes precedence over the `corrections` policy, so `'skip'` and `'throw'` behave the same for the roles operation. A careless function-form action on a skipped header threw and lost the whole file, so the framework now contains such failures: it keeps the subtree's symbols and reports `roles.actionFailed`, at the cost of that rule's own scope.

### The approaches

- **A is the mechanism.** It kept the most symbols near errors and held up on all four languages.
- **B is a proposer, not a mechanism.** On HDL it found definition versus reference for pins with no declaration (173 of 173 rename sets correct) and reused the existing builder's diagnostics. On Jack, 902 probes in 64 s proposed about two thirds of the table; on ES5, which has no checker, 1 of 20 entries. It is silently wrong when an action is refactored (interning a name dropped rename correctness to 0 of 46) and it patches private Ohm internals.
- **C is dropped.** The AST rarely carries spans (HDL declarations and all of Jack's have none), it loses more near errors, and it cannot apply to the Ohm grammar language, since `ohm.grammar()` throws on a broken file and so yields no object.

### The vocabulary and behavior on recovered input

The vocabulary the four languages required (each shown necessary by ablation) is the [appendix of the design](./language-service.md#appendix-the-vocabulary-tail); the behavior rules on recovered input are [section 5 of the design](./language-service.md#5-behavior-on-incomplete-input). Evidence for them:

- A statement that fails to match contributes no symbols. When only its join is missing, `B ! C` keeps the guarded part, so references survive (Jack: 30-35 of 35 references resolved, and every missed rename site lay inside a flagged lost span).
- Marking unresolved names beside skipped input `uncertain` instead of reporting an error: Jack's damage analysis, derived from the grammar and the roles, gave 0 certain false positives.
- A truncated file or unclosed construct has no tree, so every language needs a cache of the last good analysis. On ES5, typing one statement a key at a time (30 prefixes) gave a null root on 16 without recovery points and on 0 with five; the outline was correct 30 of 30 against 14 of 30.

### Reference engine

To check that the design can be stated and run end to end, a reference engine implements it (288 lines, no dependencies, 90 assertions passing, against this fork at `feat/fallible`). It adds no operation to the author's semantics. The design's worked examples are its output: the Ohm docs' arithmetic grammar and `eval` byte for byte (recovery added by inheritance in four lines, variables and two role lines on top), and the web-ide's real HDL grammar with 8 role entries. Oracles: toy rename against evaluation (335 pairs, 229 accepted all value-preserving, 106 refused), HDL metamorphic rename (319 renames, 183 accepted all identical).

It departs from the API sketch in three ways, which the design now states (section 9, "What the example shows"): a `start` option (a subgrammar inherits its parent's default start rule), `in: "@N"` also searches the nearest enclosing rule that has a ref at N (HDL wires sit under `Wires`, not `PartBody`), and extra read-only fields (`doc.links`, `doc.skipped`, `doc.tree`, `doc.symbolsText`). It does not include sequential visibility, symbol completion, reserved words, or the post-resolution `check` hook (A4d).

### Existing checkers

Reuse their diagnostics as they are, and let the table add only what they lack, to avoid double reporting. For Jack the existing checker's argument-count, call-kind, OS-interface, return-path and class-name checks are reusable; the reference layer would duplicate five codes (undeclared variable, unknown type, undefined class, missing subroutine, duplicate subroutine, which agreed by line on 6 mutants); and the table adds duplicate variables, parameters and fields (the compiler silently overwrites them), precise missing-member errors, and cross-file rename. `ohm.grammars()` throws one error with no code field, so it can supply only four checker-only kinds for `.ohm` files.

### Performance

A recovering match took 3.0 s of a 3.2 s analysis on 24 KB of ES5. Large files need debouncing or incremental recovering matchers (section 4).

### Corrections to earlier drafts of this plan

- For an existing language, roles cannot be edited into its actions without migrating it, so a table beside them (0 edits) is the way in. The engine walks the syntax tree for the tree and does not run the author's operations. Roles written in the action block (the clean-sheet API) normalise to the same model, and are the proposed destination.
- A flat scope with one definition per symbol is not enough, and neither is inference from rule names.
- Typed member lookup is expressible in the table, not an author hook.

## 6. Decisions

1. **Position on migration.** Tables are the on-ramp and the clean-sheet API is the destination: documentation and scaffolds lead with the clean-sheet form, and tables stay supported for languages whose actions or grammar the author cannot edit. The name of the API (`defineLanguage` in the prototype) is open.
2. Notation for the table. The prototype normalised three notations to the same table: an object of builders (about 9 lines for HDL), a line-oriented file (7 lines), and `//@` comments inside the `.ohm` file (6 lines, but it edits the grammar). Recommendation: the object of builders as the canonical form, since it is typed and composable; the others can compile to it.
3. How much of the vocabulary ships in the first version. The core is scope chain, owner hoisting, kind from keyword, declared type with typed member lookup, namespaces, implicit definitions, external registries, explicit identifier rules, `uncertain` marking and the last-good cache. The ES5-only items can follow.
4. Consumption of track A by downstream projects: GitHub install (as today) or published packages.
5. Whether `grammar.describe()` is added to `ohm-js` up front (A1) or only if walking `grammar.rules` proves brittle.
6. The worked examples in the design are generated by the reference engine and re-run with it; if the engine is not kept in the repository, they become hand-maintained prose. Decide whether the reference engine lives in `packages/language` as its first implementation (A4) or is discarded after the design is accepted.
7. Review follow-ups (an independent review of this PR, findings in order): fix the last-good cache (per document, offsets mapped or positional queries refused while stale; B1); measure recovery on typing-state corpora (M1); add cancellation and document versions to the adapter design (M2); put the reference engine and the HDL grammar fixture in the repository so the examples can be re-run (M4); decide on sequential visibility (M5); add a comparison with existing systems (M3, below).
