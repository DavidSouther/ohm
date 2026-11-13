# Langium, Tree-sitter, and Ohm: language-tooling comparison

## 1. Architectural premise

| | Langium | Tree-sitter | Ohm |
|---|---|---|---|
| Centre of gravity | The AST. Grammar assignments (`name=ID`) declare node types; a typed TypeScript AST is generated. | The concrete syntax tree. `grammar.js` generates a C parser; `node-types.json` describes node kinds and fields. | The grammar. It recognises text, declares recovery points, and carries optional lint and formatting features; meaning is attached by separate semantics. |
| Where behaviour lives | Dependency-injected TypeScript services keyed on AST types. | Query files and external tools (Topiary, ast-grep, Semgrep) keyed on node and capture names. | Semantics and authored roles keyed on rule names, with shared resolution and editor services; lint rules over grammar and tree structure; formatting hints on constructors and terminals. |
| Where tree construction lives | Semantic AST shape is declared in the grammar. | The grammar shapes the CST; consumers can build separate semantic ASTs. | The parser builds a grammar-shaped CST; semantics or `toAST` construct a semantic AST outside the grammar. |
| Where error recovery lives | In the parser runtime (Chevrotain), implicit. | In the parser runtime (GLR), implicit. | In the grammar, explicit (`!` recovery points, `recoveryToken`, `recoveryStop`), and visible to semantics as correction nodes. |
| Semantic layer | Built-in linking, scoping, and indexing over the grammar-derived AST. | None; `stack-graphs` archived. | Shared scope collection, resolution, and indexing from language-authored semantic roles and configuration; Workspace caches and invalidates results per revision. |

All three construct parser trees. Langium also declares semantic AST shape in the grammar; Tree-sitter exposes a [CST with an AST-like traversal view](https://tree-sitter.github.io/tree-sitter/using-parsers/2-basic-parsing.html#named-vs-anonymous-nodes), while Ohm supplies semantics and `toAST` for external semantic AST construction. Ohm makes recovery authored grammar structure that semantics, lints, and the formatter can all see.

## 2. Feature matrix

| Area | Langium 4.4.2 | Tree-sitter 0.27.2 | Ohm v17.5-next |
|---|---|---|---|
| Parsing algorithm | Chevrotain LL with ALL(*) lookahead | GLR; generated C parser | PEG with packrat memoisation; interpreted grammar; arena memo table |
| Lexing | Separate token definitions | Generated lexer plus C external scanners | Scannerless |
| Left recursion | Not supported by LL parsing (general Chevrotain property, not verified in Langium docs); `infix` rules | Supported via GLR with precedence declarations | Supported natively |
| Error recovery: mechanism | Chevrotain recovery, on by default; strategy details not verified | Automatic; always produces a tree | Grammar-declared Fallible points; skip-to-join; opt-in per match |
| Error recovery: missing input | Not verified | Zero-width `MISSING` nodes | Not supported; recovery deletes, never inserts |
| Error recovery: author control | Limited, not verified | None in the grammar | Recovery points, token-aware scanning, nested stop boundaries; lints check recovery helpers |
| Error recovery: visibility to consumers | Partial AST | `ERROR`/`MISSING` nodes, queryable | Correction nodes with diagnostics, as typed action arguments; per-operation `corrections` policy |
| Grammar modularity | Imports; no override/extend operators found | JavaScript grammar composition with generator validation; queries not inherited | Checked inheritance, override, extend, super-splice, parameterised rules; semantics extend alongside |
| Embedded languages | Multi-language projects | Injections over included ranges | Not addressed |
| Typed tree | Generated declared/inferred AST types | `node-types.json` metadata enables downstream grammar-specific type generation | Generic node-kind argument types; arity-checked actions; no grammar-specific shapes |
| Cross-references, scoping | Built in over the grammar-derived AST | `locals.scm` hints only | Language-authored declaration/scope/reference roles and export configuration drive shared resolution and indexing; Workspace manages freshness |
| Incremental model | Staged document builder; full reparse of the edited document, relinking of dependents | `ts_tree_edit` and tree reuse; host owns versioning | Retained Matchers with incremental reparse and recovery after edits; dependency-aware invalidation |
| Revision discipline | Client document versions; priority reads | None | `{sourceId, revision}` on every result and edit; stale work rejected |
| Edits | LSP `TextEdit`s from services | Not provided | Batch-validated `applyEdits` proposals; host publishes, then registers revisions |
| Linting | Imperative validation registry per AST type | External (ast-grep) | Grammar-attached structural rules outside semantics; rule-chosen primary and related spans; cross-source evidence; advisory, automatic, and suggested repairs |
| Grammar authoring support | `.langium` validation and LSP | Generator conflict reports | Built-in lints (fallibility under predicates and recovery helpers, left-recursive operator patterns, ambiguous recursion, nullable recovery tokens, unused rules), formatting; source-backed rule/binding inspection and binding-aware grammar-family rename through Workspace and editor views |
| Formatting | Imperative `AbstractFormatter` per language | External (Topiary, query-driven, idempotence-checked) | Grammar-attached declarative hints; reparse, structure, whitespace, and idempotence verification; refusal with reasons; damaged regions kept verbatim |
| LSP coverage | ~30 services with defaults, including semantic tokens, hover, inlay hints, hierarchies, folding, signature help | None in core; immature grammar-to-LSP projects | Sync, diagnostics (syntax, recovery, semantic, lint), formatting, code actions; symbols, definition, references, completion, rename from shared role-based services; semantic tokens and advanced services remain outside the request |
| Highlighting | Semantic tokens; TextMate generation | `highlights.scm` | Retained host-specific CodeMirror and Monarch syntax highlighting; no shared highlighting definition or LSP semantic-token service requested |
| Protocol coupling | LSP types throughout services | None; a library | Confined to the adapter |
| Distribution | npm; TypeScript | Generated C, native and WASM builds, ABI constraints | npm; runtime-loaded grammar; no generated artefacts |
| Ecosystem | Sprotty, Langium AI, generators, templates | Large grammar catalogue; Neovim, Helix, Zed, GitHub, Semgrep, Difftastic | Ohm editor/visualiser; one named production user |

## 3. Ohm's distinctive combination

1. **Stand-alone Grammar.** Recognition, recovery points, lint rules, and formatting hints travel together; meaning and semantic AST shape are adjacent. One grammar serves an interpreter, a grader, a linter, a formatter, and a language server.
2. **Error recovery as authored, inspectable grammar structure.** Langium and Tree-sitter recover implicitly in the parser runtime. Ohm recovery points are part of the grammar. They are inherited and overridden with it, checked by built-in lints (fallibility under predicates, nullable recovery tokens), and appear in semantics as correction nodes with diagnostics. The language author decides what may be discarded and where parsing resumes.
3. **Opt-in recovery semantics.** The per-operation `corrections` policy lets a pretty-printer pass through damaged input, an AST builder refuse the source entirely, and a fragment extractor keep partial statements, all using the same match. Independent consumers can also handle damage in [Tree-sitter's error-bearing trees](https://tree-sitter.github.io/tree-sitter/using-parsers/queries/1-syntax.html#the-error-node) or [intermediate trees built by embedded-action parsers](https://chevrotain.io/docs/tutorial/step4_fault_tolerance.html#cst-integration). Ohm integrates this dispatch with operations and inherited semantics.
4. **Checked action contracts.** Action names and arity are validated, including correction slots. Tree-sitter also [checks query node names, fields, and structure against a language](https://tree-sitter.github.io/tree-sitter/using-parsers/queries/4-api.html); Topiary uses those queries. These checks and [language-version metadata](https://raw.githubusercontent.com/tree-sitter/tree-sitter/v0.27.2/lib/include/tree_sitter/api.h) do not guarantee compatibility across arbitrary grammar versions or editor-specific capture meanings.
5. **Multiple semantics per parse.** After a match against the grammar, the resulting CST can be analyzed with different semantics actions sharing inherited behaviors. Tree-walking interpreters, intermediate representation compilers, and lint checkers can all use the same parse tree & semantic API.
6. **Explicit, checked grammar-level extension with inherited semantics.** Tree-sitter composes grammars in JavaScript and performs generator validation; that differs from Ohm's explicit inheritance and action-arity checks. Langium has imports without comparable override/extend operators found.
7. **Formatting and linting attached to the grammar, verified, and recovery-aware.** The formatter preserves damaged regions verbatim and refuses output it cannot verify. Topiary and ast-grep are the nearest precedents; neither is attached to the grammar, and neither knows the grammar's recovery points.
8. **Revision-exact consistency** for every match, diagnostic, semantic result, and edit.
9. **A language model independent of protocol and editor.** The same Workspace serves a CLI, a browser IDE, and the LSP adapter. Cross-host use is shared: [Langium supports CLI and browser applications](https://langium.org/), and Tree-sitter is an editor-independent library. This does not establish identical protocol-coupling architectures.
10. **No generated artefacts or native toolchain**, which matters for the browser-hosted web-ide.

## 4. Gap inventory

These gaps remain after the baseline in section 1. Each is listed with the tool that closes it and the evidence. No remedies are proposed here.

### 4.1 Typing

| Gap | Closed by | Notes |
|---|---|---|
| No grammar-specific tree or action-argument shape types | Langium (generated AST types); Tree-sitter (metadata for optional downstream type generation) | Ohm supplies generic node-kind types and arity checks. Tree-sitter's [`node-types.json`](https://tree-sitter.github.io/tree-sitter/using-parsers/6-static-node-types.html) enables type declarations; it is not itself a universal typed binding. |
| No typed `toAST` output | Langium | `toAST` exists but its result shape is not described by types. |

### 4.2 Semantics infrastructure

| Gap | Closed by | Notes |
|---|---|---|
| No grammar-derived AST/linking integration | Langium | Ohm's shared resolver and index consume language-authored declarations, scopes, references, member relations, and export configuration. These roles supply semantic defaults without Langium's grammar-declared AST/cross-reference model. |
| No query language for semantic consumers | Tree-sitter (queries) | Lint primitives offer structural matching; whether they form a general, user-facing query language is beyond the current design. |

### 4.3 Error recovery

| Gap | Closed by | Notes |
|---|---|---|
| No insertion of missing input | Tree-sitter (`MISSING`); Chevrotain (not verified) | A missing `;` is recovered only by skipping to a later join. |
| Recovery requires authored join points | Tree-sitter (automatic) | A grammar without `!` gets no recovery. The cost is authoring effort, offset by control. |
| A failed guarded unit keeps no partial values | Tree-sitter (partial subtrees inside `ERROR`) | When the guarded operand fails, all guarded arguments are empty and the correction covers the whole unit. Completion inside a broken statement has no partial tree to work from. |
| Opt-in per match | Tree-sitter, Langium (always on) | Hosts must request recovery; the Workspace is assumed to do so. |

### 4.4 Performance

| Gap | Closed by | Notes |
|---|---|---|
| Current comparative parsing speed and memory evidence | Not established | No comparative measurements for this baseline were reviewed. The [Chevrotain author's 2017 estimate](https://news.ycombinator.com/item?id=15491336) concerns older Ohm. The arena design is verified, but no current speed ranking or memory ratio is established. Reported v18 measurements concern an excluded baseline. |
| Recovery overhead relative to clean matching | Not established | Benchmark harness exists (`benchmarks/fallible`); results were not reviewed. Neither the direction nor magnitude of the cost difference is established here. |

### 4.5 Editor services

| Editor service / gap | Closed by | Notes |
|---|---|---|
| Host-specific syntax highlighting | Partly covered by the Ohm request | Retain CodeMirror and Monarch tokenizers during editor integration. A general highlighting definition or generator across editors is not requested. |
| Semantic tokens | Langium | Remains outside the request; retained syntax highlighting does not provide a semantic-token service. |
| Hover, folding, inlay hints, signature help, call/type hierarchies | Langium | Remain outside the request. Service inspection and diagnostic tooltips do not establish these services. |
| Embedded-language injection | Tree-sitter | Remains outside the request. |
| Default behaviour for semantic features | Partly covered by Ohm; broader defaults in Langium | Language-authored roles and export policy drive shared resolution, diagnostics, symbols, definition, references, completion, and rename outside LSP. The advanced services above still have no requested defaults. |

### 4.6 Ecosystem and adoption

| Gap | Closed by | Notes |
|---|---|---|
| Grammar catalogue and editor integration | Tree-sitter | Native support in Neovim, Helix, Zed, GitHub. |
| Diagrams, code generation, AI tooling | Langium | Sprotty, `expandToString`, Langium AI. |
| Production evidence | Both | One named Ohm production user (Shopify's Liquid language server). |
| Version direction | Both | v18 removes the APIs this baseline depends on. |

### 4.7 Debuggability

| Gap | Closed by | Notes |
|---|---|---|
| Rule-name dispatch is less transparent to debuggers than direct calls | Langium | Ohm's visualiser and tracing (v17) partly offset this. Tree-sitter is weaker here: users describe GLR conflicts as hard to debug and external scanners as error-prone. |

## 5. Grammar/semantic-action separation: reception

**Evidence in favour.**
- Ohm's authors argue that embedded actions clutter grammars and force duplication when a second consumer is added (Warth et al., DLS 2016). The Ohm philosophy page states "Grammars are pure."
- The retrieved secondary accounts favour ANTLR 4's listener/visitor approach; [one retrieved HN commenter](https://news.ycombinator.com/item?id=15016061) also praises separation. No primary Parr rationale was retrieved.
- One [PEG.js issue reporter](https://github.com/pegjs/pegjs/issues/545) reports embedded-action boilerplate; the source log also records secondary evidence of workarounds.
- Tree-sitter has no semantic actions, and Neovim, Helix, Zed, and GitHub use its grammar/query separation. No direct, quotable debate over the principle was retrieved; adoption alone does not establish approval of that design choice.
- The [Chevrotain author described Ohm's separation as a strength in 2017](https://news.ycombinator.com/item?id=15491336).

**Evidence against, or costs.**
- Arity drift: semantics fall out of step with the grammar when rules change. Ohm's paper concedes this; an [Ohm Editor issue reports inconsistent-arity friction](https://github.com/ohmjs/ohm-editor/issues/32). Fallible adds to the surface, since each `!` adds a correction slot and a join argument to its rule's actions.
- Positional action arguments have generic node-kind types rather than grammar-specific shapes.
- One action per rule, or reliance on defaults, is boilerplate of its own.
- Tree-sitter checks structural query references, but editor capture conventions and query distribution can still drift, as the [Zed query-ownership issue](https://github.com/zed-industries/zed/issues/40532) illustrates.
- Semgrep [converts each Tree-sitter CST into its own semantic AST](https://docs.semgrep.dev/contributing/adding-a-language), illustrating a separate construction step after parsing.
- For a single-consumer task, separation may add indirection without an immediate reuse benefit (design inference).

**Assessment.** The retrieved sample contains praise for separation and reports of practical costs; it does not establish developer-population preference. No survey-quality evidence was found. The tools put their boundaries at different levels:

- **Langium** declares semantic AST shape in the grammar and generates AST types; consumers can still construct other representations.
- **Tree-sitter** builds a grammar-shaped CST, with behaviour and optional semantic AST construction outside the grammar. Query compilation checks the tree-facing boundary; editor capture meanings and distribution remain separate concerns.
- **Ohm** builds a grammar-shaped CST in the parser and supplies external semantic AST construction through semantics or `toAST`. It checks action names and arity and supplies generic node-kind types, but lacks grammar-specific argument/AST shape types.

The design inference is that checks and grammar-specific types can reduce manual synchronisation. Ohm checks inherited semantic actions; Tree-sitter checks queries against a particular language; Langium supplies grammar-specific AST types. These are different contracts, and the retrieved comments do not establish a population preference among them.

Fallible makes a second-consumer benefit explicit in Ohm's operation API. Recovery points belong to the grammar; each operation chooses how to handle correction nodes when it reaches them, and that policy participates in semantic inheritance. Embedded-action systems can also construct error-bearing intermediate ASTs and let independent visitors decide how to handle damage. Ohm supplies built-in per-operation dispatch for this choice.

## 6. Positioning

Langium suits a language whose value lies in cross-references and rich editor services. Tree-sitter suits broad editor support for many existing languages, where incremental syntax trees, automatic recovery, and adoption matter and semantic depth is not required. Ohm suits families of related languages, grammar-centric teaching and experimentation, and hosts that benefit from its combination of checked grammar extension, inherited semantics, and author-controlled recovery across a CLI, a browser IDE, and an LSP server.

Ohm's distinctive offer is a pure, extensible grammar that declares its own recovery points and carries its own linting and formatting, with a checked boundary to its semantics. Its remaining feature gaps are grammar-specific typing and grammar-derived AST/linking integration (against Langium); insertion recovery, partial trees in failed units, and adoption (against Tree-sitter); and editor-service breadth. Comparative speed, memory use, and recovery overhead remain unmeasured for this baseline.

---

*Prepared 2026-11-13. Langium figures describe release 4.4.2; Tree-sitter figures describe release 0.27.2. "Projected Ohm" describes ohm-js 17.5.0 with the `feat/fallible` branch, plus the four requests in `.ailly/prompts/ohm-language-tooling.md` in their most robust form.*

*Citations for public claims are in `.ailly/developer/2026-11-13-A-langium-ohm-comparison/research/public-sources.md`; Fallible claims cite `doc/fallible.md`, `doc/syntax-reference.md`, and `doc/api-reference.md` on `feat/fallible`.*
