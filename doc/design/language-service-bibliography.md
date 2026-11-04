# Bibliography for the language-service survey

Compiled 2026-11-04. Every entry was fetched by me during this task. "Depth" says how much I actually read: **full** (read end to end), **most** (read all but examples or appendices), **sections** (read the passages relevant to the survey), **skim** (abstract, introduction, conclusions, and a keyword search), **toc** (only the contents or navigation was usable). Weak depth is stated, not hidden. Dates are publication dates as shown on the source, or "as fetched 2026-11" for living documentation.

Counting: see the tally at the end. In short, 19 entries were read in full, 33 in full or most, 51 including section-level reads; the rest were skimmed.

## A. The anchor article and the posts it builds on

- **[G1] Why building a Rust LSP is hard.** popzxc (Rust Glancer author). 2026-09-16. https://rust-glancer.github.io/blog/why-lsp-is-hard/ . Depth: full. LSP work is producing useful answers from partial information. Covers initialize timing, VFS and source generations, cancellation, workspace discovery, UTF-16 and line indexes, layered indexing (parse, item tree, defmap, bodies), incorrect code as the norm, and the cursor problem. Single-author blog about an experimental tool; the author disclaims expertise. Credible on engineering experience, not as a survey.
- **[G2] Rust Glancer (matklad's comment-turned-post).** matklad. 2026-08-21. https://matklad.github.io/2026/08/21/rust-glancer.html . Depth: full. Calls rowan a poor fit for the 99% case of shallowly analysed dependencies; suggests lazy (not incremental) bodies; for proc macros suggests the "Sorbet trick" of shimming the effects of metaprogramming instead of running it.
- **[G3] Rust Glancer 0.2.0 release post.** popzxc. 2026-09. https://rust-glancer.github.io/blog/0-2-0/ . Depth: toc (fetched, not read; not cited for claims).

## B. matklad (essays, 2018 to 2026) and the rust-analyzer blog and docs

- **[M1] Why LSP?** matklad. 2022-04-25. https://matklad.github.io/2022/04/25/why-lsp.html . Depth: full. Argues the M x N story is wrong: glue is tiny, N was near zero because servers are hard, and the real fix was a two-sided-market equilibrium. Treat LSP as a serialization format, not an internal model.
- **[M2] LSP could have been better.** matklad. 2023-10-12. https://matklad.github.io/2023/10/12/lsp-could-have-been-better.html . Depth: full. Presentation focus is the genius; framing, UTF-16 columns, lost causality of notifications, RPC instead of state synchronisation, no interactive refactors, and dynamic registration are the flaws. Contrasts the Dart analysis protocol.
- **[M3] Against Query Based Compilers.** matklad. 2026-02-25. https://matklad.github.io/2026/02/25/against-query-based-compilers.html . Depth: full. Query-based incrementality is limited by the language's dependency structure ("avalanche"); design the language so coarse independent chunks exist; in-place diffs of global maps can beat queries.
- **[M4] Resilient LL Parsing Tutorial.** matklad. 2023-05-21. https://matklad.github.io/2023/05/21/resilient-ll-parsing-tutorial.html . Depth: most. Goal is to recognise as much structure as possible and localise errors; recursive descent plus a homogeneous CST; contrasts GLR (tree-sitter); explicitly "descriptive, not prescriptive"; says "just use Tree-sitter" for a quick result.
- **[M5] Parsing Advances.** matklad. 2025-12-28. https://matklad.github.io/2025/12/28/parsing-advances.html . Depth: full. Resilience pitfall: loops that consume no token; fuel and "assert the parser advanced" as a guard.
- **[M6] Zig Language Server And Cancellation.** matklad. 2023-05-06. https://matklad.github.io/2023/05/06/zig-language-server-and-cancellation.html . Depth: most. Strong versus relaxed consistency; sequential, immutable, cancel-in-flight options; start with a rock-solid data model.
- **[M7] How a Zig IDE Could Work.** matklad. 2023-02-10. https://matklad.github.io/2023/02/10/how-a-zig-ide-could-work.html . Depth: skim. The IDE adds incomplete code, change over time, and immediate results to the compiler problem.
- **[M8] A Missing IDE Feature.** matklad. 2024-10-14. https://matklad.github.io/2024/10/14/missing-ide-feature.html . Depth: most. Fold bodies by default is syntactically derivable but LSP's FoldingRangeKind has no "body"; protocol changes are hard unless you are VS Code.
- **[M9] Underusing Snapshot Testing.** matklad. 2025-04-15. https://matklad.github.io/2025/04/15/underusing-snapshot-testing.html . Depth: skim. "If I can't fuzz, I write a snapshot test."
- **[M10] 256 Lines or Less: Test Case Minimization.** matklad. 2026-04-20. https://matklad.github.io/2026/04/20/test-case-minimization.html . Depth: skim. A tiny property-testing library with a finite random source for shrinking.
- **[M11] Cancelation Terminology; Diagnostics Factory; Engine for an Editor; ARCHITECTURE.md; Modern Parser Generator; Why an IDE?** matklad. 2018 to 2026. Depth: toc/skim (fetched, only headings and openings read; used only for "see also"). Not counted.
- **[R1] Three Architectures for a Responsive IDE.** matklad (rust-analyzer blog). 2020-07-20. https://rust-analyzer.github.io/blog/2020/07/20/three-architectures-for-responsive-ide.html . Depth: full. Map-reduce with stubs (IntelliJ, Sorbet), header snapshots (clangd, Merlin), query-based (salsa). "It's not the incrementality, it's the laziness."
- **[R2] Durable Incrementality.** matklad. 2023-07-24. https://rust-analyzer.github.io/blog/2023/07/24/durable-incrementality.html . Depth: full. Salsa's dependency recording, early cutoff, laziness, durability version vectors; early-cutoff shields (do not store positions in the AST).
- **[R3] The Heart of a Language Server.** matklad. 2023-12-26. https://rust-analyzer.github.io/blog/2023/12/26/the-heart-of-a-language-server.html . Depth: full. Cursor to syntax to semantics via parent-then-siblings recursion; span-based lookup is too slow and loses syntax identity; requires syntactic nesting equals semantic nesting; macro-from-grammar example shows laziness conflicts with tracking generated code.
- **[R4] Find Usages.** matklad/rust-analyzer. 2019-11-13. https://rust-analyzer.github.io/blog/2019/11/13/find-usages.html . Depth: skim (intro). Reference search needs a search plan to avoid scanning everything.
- **[R5] Introducing Ungrammar.** matklad. 2020-10-24. https://rust-analyzer.github.io/blog/2020/10/24/introducing-ungrammar.html . Depth: sections. A grammar-like notation that describes CST types, not a language; generates the typed AST API (130+ types in rust-analyzer).
- **[R6] rust-analyzer architecture.md.** rust-analyzer contributors. As fetched 2026-11 (master). https://github.com/rust-lang/rust-analyzer/blob/master/docs/book/src/contributing/architecture.md . Depth: most. "Architecture invariants": parsing never fails, syntax trees are incomplete value types, typing in a body never invalidates global data, the `ide` API is POD in editor terminology, only one crate knows LSP, server stateless.
- **[R7] rust-analyzer testing.md.** As fetched 2026-11. https://github.com/rust-lang/rust-analyzer/blob/master/docs/book/src/contributing/testing.md . Depth: sections. expect-test snapshots, `$0` cursor and range markers, `// ^^^ label` annotations; notes that mismatches are found by the tool's own analysis, not the compiler.
- **[R8] rust-analyzer LSP extensions.** As fetched 2026-11. https://github.com/rust-lang/rust-analyzer/blob/master/docs/book/src/contributing/lsp-extensions.md . Depth: skim. A long list of non-standard requests, evidence of features LSP cannot express.

## C. The protocol and platform documentation

- **[L1] LSP 3.17 specification.** Microsoft. 2022-10 (changelog 05/10/2022). https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/ . Depth: sections. Base protocol, sync, diagnostics push and pull, semantic tokens, position encodings, inlay hints, notebooks, stale-request guidance.
- **[L2] LSP 3.18 specification and change log.** Microsoft. 3.18.0 dated 06/04/2026 in a MM/DD/YYYY changelog (so 4 June 2026; the page does not state the format, so I flag the ambiguity). https://microsoft.github.io/language-server-protocol/specifications/lsp/3.18/specification/ . Depth: sections. Adds inline completions, dynamic text document content, folding-range refresh, multi-range formatting, snippets in edits, code action kind documentation, completion applyKind. metaModel.json 3.18.0 fetched, structure checked only.
- **[V1] VS Code language extensions overview.** Microsoft. As fetched 2026-11. https://code.visualstudio.com/api/language-extensions/overview . Depth: sections. Still motivates LSP with the M x N story.
- **[V2] VS Code Language Server Extension Guide.** Microsoft. As fetched 2026-11. https://code.visualstudio.com/api/language-extensions/language-server-extension-guide . Depth: sections. Why a separate process; client/server split; multi-root sample.
- **[V3] VS Code Semantic Highlight Guide.** Microsoft. As fetched 2026-11. https://code.visualstudio.com/api/language-extensions/semantic-highlight-guide . Depth: sections. Semantic tokens augment TextMate; token types, modifiers, scope mapping.
- **[V4] VS Code Programmatic Language Features.** Microsoft. As fetched 2026-11. https://code.visualstudio.com/api/language-extensions/programmatic-language-features . Depth: sections. Direct provider registration versus a language server.
- **[V5] Using WebAssembly for Extension Development, part 2.** Microsoft. 2024-06-07. https://code.visualstudio.com/blogs/2024/06/07/wasm-part2 . Depth: skim. Run WASM in a worker; WASM-compiled language servers.
- **[J1] IntelliJ Platform SDK: Language Server Protocol.** JetBrains. As fetched 2026-11. https://plugins.jetbrains.com/docs/intellij/language-server-protocol.html . Depth: most. LSP "should not be considered a replacement" for the Language API; feature-by-version list (rename only in 2026.1.1); commercial IDEs only.
- **[J2] The LSP API Is Now Available to All IntelliJ IDEA Users.** Chrzanowski, JetBrains. 2025-09. https://blog.jetbrains.com/platform/2025/09/the-lsp-api-is-now-available-to-all-intellij-idea-users-and-plugin-developers/ . Depth: most. Closed-source, free-of-charge for third-party plugins; niche language communities.
- **[J3] Open-Sourcing the LSP Client API in IntelliJ IDEA 2026.2.** Chrzanowski, JetBrains. 2026-06. https://blog.jetbrains.com/platform/2026/06/open-sourcing-the-lsp-client-api-in-intellij-idea-2026-2/ . Depth: full. Android Studio failure with no error; renaming LspServer to LspClient; do not migrate from LSP4IJ just for its own sake.
- **[J4] IntelliJ Platform SDK: Stub Indexes; Indexing and PSI Stubs; Language Injection; Custom Language Support.** JetBrains. As fetched 2026-11. https://plugins.jetbrains.com/docs/intellij/stub-indexes.html and neighbours. Depth: sections. Stubs are a serialized subset of PSI for externally visible declarations; dumb mode; injected fragments are separate small files.
- **[J5] Grammar-Kit README.** JetBrains. As fetched 2026-11. https://github.com/JetBrains/Grammar-Kit . Depth: most. BNF to parser and PSI; resolve and non-trivial behaviour attach as hand-written mixins; Gradle plugin cannot process mixins.

## D. Architecture families: compiler-as-a-service and compiler-derived servers

- **[C1] Red-Green Trees.** Lippert. 2012-06-08. https://ericlippert.com/2012/06/08/red-green-trees/ . Depth: full. Immutable green tree without positions or parents; lazily built red facade per edit.
- **[C2] The clangd design and the clangd index.** LLVM project. As fetched 2026-11. https://clangd.llvm.org/design/ and /design/indexing . Depth: full. One parser loop per open file; layered dynamic, background, and prebuilt indexes; compile commands as configuration.
- **[C3] Gopls: Implementation.** Go project. Last major update 2024-01-16. https://tip.golang.org/gopls/design/implementation . Depth: full. Protocol types generated from the metamodel; snapshots; file cache; parsego "tree repair" of the Go parser's error recovery.
- **[C4] A 10x Faster TypeScript.** Hejlsberg. 2025-03-11. https://devblogs.microsoft.com/typescript/typescript-native-port/ . Depth: full. Native port, 8x editor project load (vendor-measured), move to LSP. Later TS 7 release facts come only from search snippets (VS Magazine returned 403), so I do not rely on them.
- **[C5] Pyright: Differences between Pyright and mypy.** Microsoft. As fetched 2026-11. https://github.com/microsoft/pyright/blob/main/docs/mypy-comparison.md . Depth: sections. A lazy, just-in-time type evaluator; "3x to 5x faster" is a vendor claim.
- **[C6] Making Sorbet more incremental.** Zimmerman. About 2023. https://blog.jez.io/making-sorbet-more-incremental/ . Depth: most (date not shown in the extracted text; the post refers to June 2022 data). Falls back to a full typecheck on 19% then 10% of edits; fallback reasons are measured; incremental mode gets 8% of tests.
- **[C7] Salsa book.** salsa-rs. As fetched 2026-11. https://salsa-rs.github.io/salsa/overview.html . Depth: toc. Only the table of contents was usable; salsa mechanics are taken from [R2] and [R1].
- **[C8] Build Systems a la Carte: Theory and Practice.** Mokhov, Mitchell, Peyton Jones. JFP 2020. Author copy at https://simon.peytonjones.org/assets/pdfs/build-systems-jfp.pdf . Depth: skim (intro, definitions of minimality, early cutoff). The theory under queries and early cutoff.
- **[C9] Glean: Indexing code at scale.** Marlow, Iborra (Meta). 2024-12-19. https://engineering.fb.com/2024/12/19/developer-tools/glean-open-source-code-indexing/ . Depth: sections. Centralised ahead-of-time indexing, per-language schemas, Angle.
- **[C10] SCIP announcement.** Geirsson (Sourcegraph). 2022. https://sourcegraph.com/blog/announcing-scip . Depth: full. Why LSIF's graph encoding failed (no schema, opaque IDs, hard incrementality); SCIP uses protobuf and readable symbol strings; speedups are vendor-reported.

## E. Grammar-first and specification-driven systems

- **[E1] Langium documentation: workflow, document lifecycle, cross-references, configuration via services, caches.** TypeFox/Eclipse. As fetched 2026-11. https://langium.org/docs/ . Depth: most. What is derived (AST types, parser, default scoping, completion, symbols) and what the author writes (scope provider/computation overrides, validators, type computation, caches).
- **[E2] Langium: the new language engineering tool.** TypeFox. 2021-06-24. https://www.typefox.io/blog/langium-the-new-language-engineering-tool/ . Depth: full. Goal, first feature set, roadmap.
- **[E3] Xtext to Langium (Xtext2Langium).** TypeFox. About 2022. https://typefox.io/blog/xtext-to-langium . Depth: sections. Grammar-only migration; semantic code is not migrated.
- **[E4] Xtext and Langium: what next?** Sujew, Spoenemann (TypeFox). 2025-12. https://www.typefox.io/blog/xtext-langium-what-next/ . Depth: full. CST consumes 75 to 80% of memory, about 60% of parse time (their benchmarks, not published in the post); JS cannot parallelise; announces a Go-based toolkit. Vendor self-report.
- **[E5] Xtext documentation: runtime concepts (linking, scoping, index).** Eclipse Xtext. As fetched 2026-11. https://eclipse.dev/Xtext/documentation/303_runtime_concepts.html . Depth: sections. Cross-reference declared in grammar; scoping via IScopeProvider; global scope via resource descriptions.
- **[E6] Rascal: util::LanguageServer and Register your language.** usethesource. rascal-lsp 2.23.0 (as fetched). https://www.rascal-mpl.org/docs/Packages/RascalLsp/API/util/LanguageServer/ . Depth: sections. Each service is author-supplied; "almost zero cost" is marketing.
- **[E7] Spoofax 3 current status.** Spoofax project. As fetched 2026-11. https://spoofax.dev/spoofax-pie/background/status/ . Depth: skim. Under development; no confirmed LSP generation.
- **[E8] JetBrains MPS user guide.** JetBrains. As fetched 2026-11. https://www.jetbrains.com/help/mps/mps-user-s-guide.html . Depth: toc. Projectional editing is a different premise; not analysed beyond that.
- **[E9] A Theory of Name Resolution.** Neron, Tolmach, Visser, Wachsmuth. ESOP 2015. https://rd.springer.com/content/pdf/10.1007/978-3-662-46669-8_9.pdf . Depth: skim (abstract, introduction, framework outline). Scope graphs, resolution calculus, language-independent rename.
- **[E10] Scopes as Types.** van Antwerpen, Bach Poulsen, Rouvoet, Visser. OOPSLA 2018. https://dcreager.net/pdf/VanAntwerpen2018.pdf . Depth: skim (abstract, introduction). Statix; scopes model structural and generic types.
- **[E11] Stack graphs: Name resolution at scale.** Creager, van Antwerpen. EVCS 2023 (arXiv 2211.01224v3, 2023-05-09). https://arxiv.org/pdf/2211.01224 . Depth: most. File-incremental, purely syntactic name binding declared with tree-sitter-graph; in production on Python since 2021-11.
- **[E12] github/stack-graphs README.** GitHub. As fetched 2026-11. https://github.com/github/stack-graphs . Depth: full. States the repository "is no longer supported or updated by GitHub".
- **[E13] Tree-sitter documentation (queries, syntax highlighting and locals, code navigation tags, writing the grammar, advanced parsing).** tree-sitter project. As fetched 2026-11. https://tree-sitter.github.io/ (raw docs from the repository). Depth: sections. highlights, locals, and tags queries; precedence and conflict resolution; edit-and-reparse API.
- **[E14] Lezer guide and CodeMirror "Writing a Language Package".** Haverbeke. As fetched 2026-11. https://lezer.codemirror.net/docs/guide/ and https://codemirror.net/examples/lang-package/ . Depth: most. Incremental GLR parser with search-based error recovery; folding, indentation, and highlighting are author-declared node props.
- **[E15] antlr4-c3 README.** Lischke. As fetched 2026-11. https://github.com/mike-lischke/antlr4-c3 . Depth: sections. Grammar-derived syntactic completion candidates; the author supplies the symbol table.
- **[E16] Chevrotain fault-tolerance tutorial.** As fetched 2026-11. https://chevrotain.io/docs/tutorial/step4_fault_tolerance.html . Depth: skim. Recovery follows ANTLR3; content-assist claims come from search snippets of type declarations only.
- **[E17] Execution vs Parse-based Language Servers.** Marr, Burchell, Niephaus. DLS 2022. Authors' preprint page https://stefan-marr.de/papers/dls-marr-et-al-execution-vs-parse-based-language-servers/ . Depth: most. Closest direct analogue: a language-agnostic parse-based server interface under 1,000 lines per language; survey of 20 servers (median 12,055 lines).
- **[E18] Code Less to Code More (Typelang for Neverlang).** Bruzzone, Cazzola, Favalli. JSS 2025 (arXiv 2509.15150, 2025-09-18). https://arxiv.org/pdf/2509.15150 . Depth: skim. Generated servers and plugins; a 93.48% character-reduction claim against the authors' own baseline.
- **[E19] Decoupling Language and Editor: The Impact of the Language Server Protocol on Textual DSLs.** Buender. 2019. https://www.scitepress.org/Papers/2019/75563/75563.pdf . Depth: skim. Case study with an Xtext-generated server in two IDEs, plus a SWOT.

## F. Error-tolerant parsing

- **[P1] Syntax Error Recovery in Parsing Expression Grammars.** Medeiros, Mascarenhas. SAC 2018 (arXiv 1806.11150). https://arxiv.org/pdf/1806.11150 . Depth: most. Labeled failures with recovery expressions; 180 hand-written invalid Lua programs, at least "good" for 91% and "excellent" for 56%.
- **[P2] Automatic Syntax Error Reporting and Recovery in PEGs.** Medeiros, Alves Junior, Mascarenhas. Sci. Comput. Program. (arXiv 1905.02145v2, 2019-10-01). https://arxiv.org/pdf/1905.02145 . Depth: skim. Automatic label insertion: Standard needs manual cleanup (at least 70% acceptable); Unique 41 to 76% unaided.
- **[P3] Incremental Packrat Parsing.** Dubroy, Warth. SLE 2017. Depth: NOT READ. The only available PDF copy found by search sat on the library vendor's own site, which I did not open (see the independence rules). Known only from a search-result abstract; used with that label.

## G. Testing, validation, and critical voices

- **[T1] LspFuzz: Hunting Bugs in Language Servers.** Zhu et al. ASE 2025 (arXiv 2510.00532, 2025-10-01). https://arxiv.org/pdf/2510.00532 . Depth: sections. The first fuzzer targeting LSP servers; 51 bugs reported, 42 confirmed, 2 CVEs; crash oracle only.
- **[T2] Proposal: LSP Interactive Code Actions.** Go project. 2025 to 2026 (undated in the extract). https://go.googlesource.com/proposal/+/refs/heads/master/design/76331-lsp-interactive-refactoring.md . Depth: sections. Refactorings that need user input cannot be expressed in LSP.
- **[D1] Discussion: How LSP could have been better (HN).** 2023-10-12. https://news.ycombinator.com/item?id=37852944 (read through the Algolia API). Depth: skim of top comments. Discussion, not authority.
- **[D2] Discussion: Why LSP? (HN).** 2022-04-25. item 31151048. Same treatment. The "strawman" rebuttal of the M x N critique.
- **[D3] Discussion: Why building a Rust LSP is hard (HN).** 2026-09-16. item 49734131. Same treatment. Wildcard imports hurt name resolution on broken code; best-effort editing versus exhaustive analysis.
- **[A1] Agents and LSP: "Stop Using Claude Code Like a Blind Typewriter".** Schmidt. 2026-03-04. https://www.amazingcto.com/lsp-in-claude/ . Depth: full. Blog-level evidence that coding agents use LSP for definitions, references, and post-edit diagnostics; RAM caveat. Also read: scottspence.com post and the Serena README. All are blog or README quality, not vendor documentation.
- **[B1] monaco-languageclient README and v10 post.** TypeFox. 2025-09-25 (post). https://www.typefox.io/blog/monaco-languageclient-v10/ . Depth: most. Monaco is not VS Code, so a VS Code API layer is re-implemented; worker or websocket transports.
- **[B2] codemirror-languageserver README; Pyright browser README.** As fetched. Depth: skim. Existence proofs: a CodeMirror 6 LSP client over WebSocket; Pyright packaged as a worker.

## Could not fetch, or not read (stated so nothing is cited from memory)

- Visual Studio Magazine, "TypeScript 7 arrives" (2026-07-08): HTTP 403. TS 7 GA and tsgo --lsp are known only from search snippets.
- Build Systems a la Carte at microsoft.com: HTTP 403 (used the author copy [C8]).
- petevilter.me Datalog type-checking post: fetch returned no text; not cited.
- Wagner and Graham incremental parsing PDF (CMU URL): 404. Not cited as read.
- Dubroy and Warth, Incremental Packrat Parsing: see [P3].
- Marr et al. PDF link: 404; the HTML preprint page worked.
- GitHub REST API for the LSP repository: refused by the session proxy policy ("access not enabled"); I did not route around it. The spec was read from microsoft.github.io instead.
- Salsa book internals, Sorbet's own architecture docs and talk, Roslyn's incremental reparse internals, JetBrains Fleet and Kotlin K2 Analysis API docs (404 on the guessed URL), the lobste.rs threads, the ACM Digital Library: not read. Fleet's discontinuation (2025-12-22) is from search snippets only.
- Langium "features" page: 404.

## Tally (honest count)

Entries are keyed documents; a few entries bundle several pages of the same documentation set (E1, E13, J4, V-series), so the number of distinct documents is higher than the number of entries.

- **Read in full:** 19 entries: G1, G2, M1, M2, M3, M5, R1, R2, R3, J3, C1, C2, C3, C4, C10, E2, E4, E12, A1.
- **Read most of:** 14 entries: M4, M6, M8, R6, J1, J2, E1, E11, E14, E17, P1, B1, C6, J5.
- **Read the relevant sections of:** 18 entries: R5, R7, L1, L2, V1, V2, V3, V4, J4, C5, C9, E3, E5, E6, E13, E15, T1, T2.
- **Total read in full, most, or sections:** 51 entries.
- **Skimmed or contents only (not counted):** M7, M9, M10, M11, R4, R8, V5, C7, C8, E7, E8, E9, E10, E16, E18, E19, P2, D1, D2, D3, B2, G3.
- **Shortfall, stated plainly:** the brief asked for at least 50 sources read in full. By the strictest reading (full only) I met 19; by "full or most" 33; the 51 figure includes sections-only reads of long specifications and documentation sets, which is the only sensible way to read a 50,000-word specification. Primary papers on scope graphs and Statix were read at abstract-and-introduction depth only.
