# Review Rubric: Deriving Language-Server-Style Features from a Grammar and Semantic Actions

Version 1.0, written 2026-11-04, before any work was seen. Derived from `survey.md` (section numbers below refer to it) and `bibliography.md` (keys in square brackets). This file is fingerprinted in `rubric.sha256`. After that it changes only by dated, justified amendments appended in `rubric-amendments.md`.

## 0. How to use this rubric

**Scope.** A design proposal plus prototype evidence for deriving editor features (diagnostics, completion, outline, go to definition, references, rename, hover, semantic tokens, folding) from a parsing library's grammar and semantic-actions API, so the language author writes little beyond those. The rubric is general: it should fit any such design.

**Stance.** Compare the design with how the best existing systems actually work, not with how the author describes them. Separate what was *measured*, what was *tested against an independent oracle*, what was *demonstrated on a toy*, and what was only *argued*. A claim of the form "the author writes little" is a claim about a ratio; ask for numerator and denominator.

**Scoring.** Each dimension (K1 to K10) is scored 1 to 5 with the anchors given. Score what the *evidence supports*, not what the text promises. Where evidence is absent, score the dimension on what can be verified and write "unassessable" for the rest; do not average over silence. Sections E (evidence), S (scope honesty), and M (migration) use the same 1 to 5 scale. Do not compute a grand total; the report states a profile.

**Source weight.** Where this rubric cites a vendor benchmark or a single-author blog, it is cited for *what the source claims*. The rubric's red flags are mine, drawn from the pattern across sources.

## 1. Baseline expectations (an omission is itself a finding)

Every serious design in the literature handles the following. If a proposal is silent, raise it as a finding (severity per section 9), not a question.

1. **Parsing never fails.** The syntactic layer returns a tree plus errors for any input; accessors tolerate missing children [R6, M4].
2. **Cursor to syntax to semantics.** A defined way to go from a position to the node and element under it, including positions between tokens and in whitespace [R3, E6, G1].
3. **Completion on incomplete input.** Completion is cursor-context based and works inside unfinished constructs [G1, E15].
4. **A symbol identity.** A stable way to say two syntax occurrences are the same definition, across files [E1, E5, C2].
5. **Position conversion.** Byte or code-point offsets internally, a negotiated protocol encoding at the edge (UTF-16 by default), line-ending awareness when producing edits [L1, G1, M2].
6. **Edits over time.** A stated model for text changes: what is re-parsed, what is invalidated, what happens to in-flight requests [M6, C6].
7. **Stale and cancelled requests.** What a request returns when the document changed under it (`ContentModified`, cancellation, or a consistent snapshot) [L2, M6].
8. **Diagnostics ownership.** Which diagnostics are syntactic, which semantic, who clears them, push or pull [L2].
9. **Capability negotiation.** The adapter advertises only what the language actually supports, and degrades by client [L2, J1].
10. **A protocol-independent core.** LSP types do not leak into the derivation machinery [R6, M1].
11. **Honest statement of non-derivable features.** At least a list of what still needs author code [E1, E6, E15].
12. **Tests with cursor markers or equivalent.** Feature tests expressed as annotated source with expected output, regenerable in update mode [R7, M9].

## 2. Dimensions

### K1. Author-facing API: where the line between derived and declared falls

**Strong looks like.** A table, per feature, of what is derived from the grammar alone, what is derived once the author adds a *named, declared* hook, and what is arbitrary author code. The hooks are few, composable, and expressed in the library's existing idiom (here, semantic actions), not a second language, unless the second language earns its keep (scope-graph rules, queries). Defaults are explicit about being heuristics. [E1, E5, E13, E15, E17]

**Why.** Every system in the grammar-first family derives structure and makes the author declare names: scope providers (Langium, Xtext), NaBL2/Statix, `locals.scm`, stack-graph rules, a symbol table for completion [E1, E5, E9, E10, E13, E11, E15]. Systems that blur the line (Rascal's "almost zero cost" [E6]) turn out to require a function per service.

**Evidence expected.** A feature-by-feature derivation table; the author-written lines needed for at least two real languages of different shape; an account of hooks that were *removed* because defaults sufficed.

**Red flags.** "The author writes only the grammar and actions" with no table. Hooks that are really a language server in disguise (author must produce ranges, kinds, protocol-shaped values). Defaults that silently produce plausible wrong answers. Derivation that depends on actions being pure but nothing checks it. Naming conventions as magic (a property called `name` doing resolution) without a switch-off [E1].

**Failure stories.** Grammar-Kit generates the parser but resolve and behaviour live in hand-written mixins, creating a generate-compile cycle that Gradle cannot run [J5]. Langium's generated AST has "gaps" the author must fill [E1]. Rascal's registration is cheap; the services are not [E6].

**Questions.** For each feature: what if the author declares nothing; what if the author's actions have side effects or depend on evaluation order; how does an author override one feature without losing the rest; what does a type error in a hook look like?

**Anchors.** 1: derivation claimed, no table, features unspecified. 2: table exists but conflates "derivable in principle" with "implemented". 3: table accurate; hooks identified; defaults not characterised. 4: table accurate, hooks minimal and idiomatic, defaults named as heuristics with known failure modes, two languages used. 5: as 4, plus evidence that defaults were tuned or removed against real cases and that overriding is local.

### K2. Feature derivation: correctness of each claimed feature

Score each of the nine features separately, then give the dimension the *lowest* of the features the proposal calls central.

| Feature | What "derived" can honestly mean | Known pitfall |
|---|---|---|
| Diagnostics | Syntax errors from the parser; semantic ones only from author actions | Cascading errors; stale clearing [L2, R6] |
| Completion | Syntactically legal next tokens/rules from the grammar [E15]; names from a symbol table the author supplies | Offering undefined names [E17]; cursor in unfinished construct [G1] |
| Outline | Named nodes; hierarchical `DocumentSymbol` [L2] | Which nodes count is language knowledge; breadcrumbs share the request [M2] |
| Go to definition | Resolution through scopes | Name-equality candidates have low precision [E17] |
| References | Inverse of resolution over the workspace | Needs a search plan; scanning everything is the pathological case [R4, G1] |
| Rename | Resolution plus text edits; in scope-graph theory it follows from resolution [E9] | Missed uses in files not yet loaded; interactive variants unsupported [M2, T2] |
| Hover | Definition text and author-provided docs | Needs types for bodies [G1] |
| Semantic tokens | Needs resolved kinds; legend and encoding are protocol matters [L2, V3] | Whole-file result vs changing state [M2] |
| Folding | Node kinds; "body" kind missing from LSP [M8] | Nested vs sibling fold hierarchy |

**Strong looks like.** Each feature has a stated contract (what is returned, what is *not* guaranteed), an automated test against an expected output, and a stated behaviour when resolution is partial. Precision and recall are discussed for references and rename.

**Red flags.** A feature "works" because the demo language has no shadowing, no overloading, no imports, no forward references. Rename claimed without a statement about unparsed files. Completion that lists every identifier seen. Semantic tokens computed only from lexical categories (that is highlighting, not semantic tokens).

**Questions.** What does rename do when one occurrence is in a file with a syntax error? What does find-references return for an identifier with three scopes of the same name? What does completion return after a dot when the receiver's definition is unresolved?

**Anchors.** 1: features demonstrated only in screenshots. 2: each feature works on the happy path of one toy. 3: contracts stated; tests exist; known gaps listed for most features. 4: contracts, tests, and precision/recall discussion for references and rename; partial-resolution behaviour defined. 5: as 4 plus a comparison against an independent implementation on a real language.

### K3. Name resolution and the symbol model

**Strong looks like.** An explicit scope model (what introduces a scope, what a definition and a reference are, how imports and qualified names work), declared once and used by definition, references, rename, completion, and hover. The author can say which resolution is exact and which is a candidate set. The design states how it would handle the next harder construct (imports, overloading, shadowing across files, members). It should be compared with scope graphs [E9, E10], stack graphs [E11], Langium-style hierarchical scopes with a global index [E1], and tree-sitter locals/tags [E13].

**Evidence expected.** A walkthrough of resolution on cases that break naive designs: shadowing, forward references, mutually recursive definitions, imports, duplicate definitions, a reference to a missing definition, and an unparsed region.

**Red flags.** A symbol table keyed by name string. Resolution that runs during parsing (actions with side effects) and so cannot be re-run on a partial tree. Rename implemented as text search. Cross-reference resolution that is only evaluated for open files. No story for definitions that are created by other definitions (generated or macro-like) [R3, M3].

**Failure stories.** Wildcard imports make resolution fragile whenever any part of the project fails to parse [D3]. Tree-sitter tags are "search-based" and imprecise [E13]. Stack graphs: even a successful declarative design was later left unmaintained [E12].

**Questions.** Is a definition's identity its name, its node, or a path? What survives an edit that does not change the definition? How are references to not-yet-defined names recorded so that defining them later fixes them? What are the exported and local scopes?

**Anchors.** 1: names are strings. 2: single flat scope. 3: nested scopes and a global index; shadowing correct; imports absent or special-cased. 4: scope model declared and shared across features; duplicates and missing names handled; tested on cases above. 5: as 4 plus a statement of formal relationship to a published model (scope graphs or equivalent) and tests showing the same behaviour on a second language.

### K4. Behaviour on incomplete and erroneous input

**Strong looks like.** The parser recovers; the tree is shaped to carry partial constructs; semantic actions tolerate missing children; every feature has defined behaviour on a broken tree. For a PEG: an explicit mechanism for recovery (labels with recovery expressions [P1], automatic labelling [P2], or a repair pass [C3]) and a statement of which errors it handles. The design acknowledges that a PEG failure may be backtracking and not an error, which complicates error position and recovery [P1].

**Evidence expected.** A corpus of *realistically broken* inputs (unclosed bracket mid-file, half-typed identifier at the cursor, deleted line in a block, stray token, unterminated string), with expected trees and feature outputs. Recovery quality graded against intended trees [P1], not merely "did not crash". The behaviour of each feature on each input.

**Red flags.** Demos only on valid input. A parser that aborts at the first error with the last good tree used as a fallback, but with no statement of how long the stale tree is trusted [E17]. A recovery strategy that can skip large regions [P1]. Loops in author actions that can spin without consuming input [M5]. Performance measured only on valid files.

**Failure stories.** Go's parser needed tree repair in gopls [C3]. Automatic PEG recovery reached 41% to 76% acceptable without manual work [P2]. Tree-sitter may find valid fragments yet fail to assemble an incomplete larger node [M4]. Chevrotain recovery can stall inside alternatives (unverified snippets) [E16].

**Questions.** What does the tree look like for `fn f(a,` and for `fn f(a, b) {`? Where does the error node attach? What does completion return at the cursor in each? How are recovery expressions authored, and by whom, for a new language?

**Anchors.** 1: abort on first error. 2: error reported, no tree. 3: tree for some errors; recovery manual; unknown coverage. 4: recovery defined and tested on a realistic broken corpus with graded quality; every feature has defined behaviour on broken trees. 5: as 4 plus recovery quality measured on a second language and compared with a baseline parser (tree-sitter, hand-written, or ANTLR).

### K5. Incrementality, invalidation, and latency

**Strong looks like.** A declared unit of invalidation (file, declaration, query) and a declared early-cutoff point (what stops propagation). Latency is *measured* (keystroke to updated diagnostics; cold open; completion) on inputs of several sizes with hardware stated; a slow-path fraction is measured and its reasons enumerated, as in Sorbet [C6]. The design is honest that incremental reparsing and incremental semantics are separate problems [R1, M3, R2].

**Evidence expected.** From-scratch versus incremental comparison on the same edit sequence with identical outputs (a differential test); latency percentiles, not means; memory; the largest file tested; the cost on a file of 10 times the typical size [E4, E17].

**Red flags.** "Fast enough" without numbers. Whole-document reparse justified by one small file; the parse blocks the thread that receives edits [E4]. Caches with no invalidation story. Position-bearing values stored in data that should be stable (breaks early cutoff) [R2]. Benchmarks on the library's best-case grammar.

**Failure stories.** CST memory 75% to 80% and 60% of parse time in Langium/Xtext (vendor-reported) [E4]. Sorbet's simple design held until base speed degraded [C6]. Query engines cost complexity and base speed [R1, M3]. Stateful incrementality bugs compound with every edit [C6].

**Questions.** What is recomputed after typing one character inside a declaration body? After renaming a declaration? After a change in another file? How do you know incremental results equal from-scratch results?

**Anchors.** 1: no discussion. 2: whole-document reparse and recompute; a single timing. 3: unit of invalidation stated; timings on several sizes; no equivalence test. 4: early-cutoff points identified; differential test of incremental versus scratch; slow-path reasons counted. 5: as 4 plus percentiles on a real corpus and a memory profile, with the weakest case reported.

### K6. Cancellation, concurrency, and consistency

**Strong looks like.** A stated consistency model (strong: answers reflect all acknowledged edits [M6]; or relaxed, with the staleness bound stated). A way to abandon obsolete work (cancel and restart, immutable snapshots, or check-and-abort at yield points) and a statement of how long the main loop can be blocked. In a single-threaded host (a browser, Node), long computations are chunked or moved to a worker, or the cost is admitted [E4].

**Evidence expected.** A test that sends an edit during a long request and checks the response; behaviour when two edits arrive before a response; behaviour of in-flight rename.

**Red flags.** Global mutable state in author actions and caches. A parse that cannot be interrupted. Request handlers that read the live document instead of a snapshot. A claim that the browser worker "solves" concurrency.

**Failure stories.** Racing `didOpen`/`didChange` in async servers [G1]; Langium parsing blocks message handling and cannot be aborted [E4]; Sorbet's stateful updates [C6].

**Anchors.** 1: not discussed. 2: sequential, blocking, acknowledged. 3: stated model, no test. 4: model stated and tested with an overlapping-edit scenario. 5: as 4 plus a latency measurement during concurrent typing.

### K7. Protocol adapters and host independence

**Strong looks like.** A narrow, serialisable service interface in editor terms (offsets, labels), with thin adapters: LSP server, in-process call, and worker messages [R6, M1]. LSP types never reach the derivation code. Negotiated position encoding. Behaviour when the client lacks a capability. A statement of LSP gaps and what the adapter does about them (for example folding kinds, interactive refactoring) [M8, T2]. For browsers: how Monaco or CodeMirror is bridged, and what each loses [B1, B2, E14].

**Evidence expected.** The same service interface exercised through at least two adapters in tests; a conformance smoke test against a real client; a list of LSP requests implemented and *not* implemented; measured overhead of the protocol path versus a direct call.

**Red flags.** LSP names in the core. An in-process path that was never run. A server that implements `didChange` as full sync only without saying so. Dynamic registration where a static capability would do [M2]. No position-encoding negotiation.

**Failure stories.** Monaco is not VS Code, so a VS Code API layer had to be rebuilt [B1]; JetBrains' LSP client lags native features and was unavailable in Android Studio without an error [J1, J3]; rust-analyzer needs extensions beyond LSP [R8].

**Anchors.** 1: LSP only, types in the core. 2: LSP adapter works with one client. 3: adapter separation exists; two hosts demonstrated informally. 4: shared interface tested through two adapters; capabilities and encodings negotiated. 5: as 4 plus a measured protocol overhead and a documented list of protocol gaps with workarounds.

### K8. Multi-file workspaces

**Strong looks like.** A workspace model: how files are discovered, how a document's role is determined, how an exported symbol index is built and updated (diff the file's old and new contribution [M3]), how dependants are invalidated (reference index [E1]), how unsaved buffers override disk [L2, C3], and how multiple projects are handled [G1, V2].

**Evidence expected.** Tests with two or more files: rename across files, references across files, a deleted file, a created file that satisfies a previously unresolved name, an unsaved edit in one file affecting another.

**Red flags.** Cross-file features implemented by re-parsing everything per request. Open-files-only analysis presented as workspace support. No story for files changed outside the editor [G1].

**Anchors.** 1: single file. 2: multi-file by concatenation. 3: index and dependant invalidation work on a toy workspace. 4: file create/delete/rename and unsaved overrides tested. 5: as 4 plus a larger real workspace and a timing.

### K9. Type-dependent features and extension limits

Only score if the proposal claims anything type-dependent (completion after a dot, member hover, inlay hints, type-based diagnostics). **Strong looks like** a clear statement that these need a type model authored by the language, a place to put it (for example an action computing a type per node, invalidated with the declaration), and honest precision. Parse-only designs may legitimately decline [E17, E1]; they must say so. **Red flags:** "types are just another action" with no cycle story, no laziness, and no cache invalidation [E1, C5]. **Anchors.** 1: claimed, absent. 2: demonstrated on a monomorphic toy. 3: typed completion on one language with caveats. 4: type hooks with laziness and cycle handling. 5: as 4 on two languages. If the proposal explicitly excludes type-dependent features and says so, score 3 for honesty and mark the rest "out of scope".

### K10. Testing and validation methodology

**Strong looks like.** Feature tests as annotated sources with expected output and an update mode [R7, M9]; property or fuzz tests that check invariants (never crashes, positions in range, incremental equals scratch, rename then re-resolve is stable); crash fuzzing of the adapter [T1]; a regression corpus of broken inputs; tests that *can* fail (see section E). Differential testing against a reference implementation where one exists.

**Evidence expected.** A test inventory by feature; invariants checked; seeds and shrinking; the number of real defects the tests found.

**Red flags.** Tests that restate the implementation. Expected outputs generated by the tool under test and never reviewed [R7]. A single language. No negative tests. Counting lines of code saved as validation [E18].

**Anchors.** 1: manual demo. 2: unit tests on happy paths. 3: annotated feature tests on broken and valid inputs. 4: plus property/differential tests and a fuzz pass. 5: plus independent-oracle checks on a real language and recorded defect yield.

## 3. E. Evidence quality

Treat every empirical claim as belonging to one of five tiers, and say which in the report.

| Tier | Meaning | Weight |
|---|---|---|
| T4 | Tested against an independent oracle (a reference compiler, a second implementation, a human-curated gold set not written by the authors), on inputs the authors did not choose | High |
| T3 | Measured on a realistic corpus with stated method and hardware, results include failures | Medium to high |
| T2 | Demonstrated on a toy or the library's own examples | Low |
| T1 | Argued from design; no run | Very low |
| T0 | Asserted, or screenshot only | None |

**What makes an oracle independent.** It does not share code, data, or authorship of the expected values with the system under test. Rust-analyzer's type-mismatch tests are checked by the tool's own analysis, which its own guide flags [R7]. The PEG recovery papers grade against intended trees but wrote the test set themselves and kept one public language [P1]. A reference *compiler* for a language with an existing implementation is independent; the library's own AST dump is not.

**Detecting cherry-picked inputs.** Ask for the selection rule. Are the languages the library's own examples? Is there at least one language the author did not write? Do inputs include the awkward constructs of section K3 and the broken inputs of K4? Is the size distribution realistic [E17: three small research languages]? Does any reported number come from the best case?

**Small-N.** One or two grammars, tens of test files, one machine. Percentages from small N (for example "93.48% reduction" over a baseline of the authors' choosing [E18]) report the ratio of two choices, not an effect. Insist on counts, not just rates.

**Prototypes that cannot fail.** A prototype cannot fail if (a) expected outputs are produced by the prototype, (b) the test language has no construct the feature mishandles, (c) failure is swallowed (a feature returns empty and the test only checks "no exception"), (d) the metric rewards less code and ignores wrong answers, or (e) the benchmark input is valid code only. For each claim, ask: what observation would have shown this was false, and was it looked for?

**Lines-of-code and "writes little" claims.** A line-count comparison is meaningful only when both sides provide the same features at the same precision. Marr et al. compare under 1,000 lines against a median of 12,055 for ad hoc servers, but at reduced precision and for dynamic languages only, and they say so [E17]. Check for the same disclosures. Check what is counted (generated code, protocol glue, tests).

**Vendor and self-report.** Speedups, memory percentages, and "bugs found" counts in the literature are cited, not proven [C4, C5, C10, E4]. The same standard applies to the work under review.

**Anchors (E).** 1: mostly T0/T1. 2: T2 evidence only, presented as validation. 3: T2/T3 with caveats stated. 4: some T3, at least one T4 check on one feature, selection rule stated. 5: T4 on several features, an author-independent language, failures reported.

## 4. S. Scope honesty

Comparable systems concede a great deal. Langium says types have no default [E1]. antlr4-c3 says the symbol table is yours [E15]. Marr et al. list low precision, undefined-variable completions, no recovery, dynamic languages only [E17]. TypeFox says CST cost cannot be bolted away [E4]. Tree-sitter says tags are search-based [E13]. A proposal that concedes less than these has either not looked or is overselling.

**Checks.** (1) Is there an explicit "not derived" list per feature? (2) Does it match what a reader finds in the prototype? (3) Are the limitations in the main text or hidden in a footnote? (4) Does the abstract's headline match the least-qualified evidence? (5) Does the proposal name competing approaches and what they do better (scope-graph rules, queries, hand-written servers)? (6) Are future-work items marked as not done? (7) Are there features listed in the summary table that exist only in the design?

**Anchors.** 1: no limits stated. 2: generic caveats ("more work needed"). 3: limits listed, partly incomplete. 4: complete list that matches the prototype; competing approaches named fairly. 5: as 4 plus the limits are used to motivate the design (hooks exist exactly where derivation stops).

## 5. M. Migration and adoption

**What the literature says.** The only direct precedent I found for grammar migration moves the grammar and not the semantic code [E3]. Langium kept Xtext's concepts and moved platform, and the maintainers still say it will not fit all workloads [E2, E4]. JetBrains says LSP integration does not replace native APIs and told plugin authors not to migrate clients for its own sake [J1, J3]. SCIP replaced LSIF within a few years but offered a converter and kept accepting the old format [C10]. TypeScript's native port keeps a maintained JS line in parallel so users are not forced to move [C4]. Stack graphs promised self-service per-language rules [E11] but the work is unmaintained [E12]. Lesson: authors pay when (a) the authored hooks live in a new language or tool, (b) semantics must be rewritten, (c) the embedding API (not the server) changes.

**Checks.** (1) Can an existing grammar and set of actions be used unchanged, with features turned on incrementally? (2) What is the diff for a real existing user, in lines and in concepts? (3) Do existing actions that have side effects, mutable state, or depend on evaluation order break derivation, and does the library detect this? (4) Are there compatibility shims, deprecation periods, a codemod? (5) What is the upgrade path when the derivation changes behaviour between versions (snapshot tests for users)? (6) Who maintains the generated or derived pieces? (7) What does an author give up (control over error messages, tree shape)?

**Red flags.** Required restructuring of the grammar for editor features. Silent behaviour change in existing parse results. A new required semantics style. "Migration is trivial" without a worked case from a real, third-party language.

**Anchors.** 1: not discussed. 2: asserted trivial. 3: a worked toy migration. 4: a worked migration of a real third-party grammar with diff and defects found. 5: as 4 plus a compatibility story across library versions and a rollback path.

## 6. Failure patterns to look for (cross-cutting)

1. **Derivation by naming convention** that fails when the author's names differ [E1].
2. **Position-bearing derived data**, which defeats early cutoff [R2].
3. **Resolution in actions at parse time**, which cannot run on partial trees [R3, G1].
4. **Whole-file everything**, which works on small files and fails near 1 MB [E4].
5. **Feature parity illusion**: server advertises capabilities the language cannot honour [J1, L2].
6. **Missing kinds in the protocol**, producing a derived feature no client can show [M8].
7. **Test-language bias**: the demo language is expression-oriented, ASCII-only, and has no imports.
8. **Maintenance cliff**: the generated service depends on a framework the author cannot patch [E12, E7].

## 7. Procedure

1. **Read the claims first, without the evidence.** Write the list of testable claims and the rubric dimensions each touches. Do this before looking at any code or numbers.
2. **Read the proposal's own scope/limits section next** and compare with section S before seeing the prototype. Note what the text promises.
3. **Run, do not read, whatever can be run:** the prototype on at least three inputs you choose yourself, including a broken one, a large one, and one with shadowing; the test suite; a mutation (break the implementation and see if a test fails); an incremental-versus-scratch comparison if offered. **Re-derive** any headline number from raw data. **Read** design rationale, API shape, and prose arguments.
4. **Build your own corpus** before opening theirs: a dozen broken inputs and a dozen name-resolution cases from K3 and K4.
5. **Compare against a baseline you know:** tree-sitter highlight/locals/tags for the same grammar; a hand-written server sketch; the Langium or Marr et al. line counts [E17].
6. **Avoid anchoring:** score dimensions *before* reading the author's own assessment of them; keep the claim list and the evidence list separate; do not adopt the author's vocabulary for "derived" until you have checked it against the table in K2; ask whether each praised property would have been visible if the answer were wrong.
7. **Stop when** every dimension has either a supported score or "unassessable" with reason; every blocker is reproduced; and a second pass over the claim list finds nothing unexamined. Do not stop earlier because the story is coherent.
8. **Write the report in the template in Appendix A**, keeping findings, praise, open questions, and unassessable items in separate sections.
9. **Amendments.** If a review reveals the rubric is wrong or missing something, append a dated, justified amendment to `rubric-amendments.md`; never edit this file.

## 8. Quick scoring sheet

| Code | Dimension | Score 1 to 5 or "unassessable" |
|---|---|---|
| K1 | Author-facing API, derived vs declared | |
| K2 | Per-feature correctness | |
| K3 | Name resolution and symbols | |
| K4 | Incomplete and erroneous input | |
| K5 | Incrementality and latency | |
| K6 | Cancellation and consistency | |
| K7 | Adapters and host independence | |
| K8 | Multi-file workspaces | |
| K9 | Type-dependent features | |
| K10 | Testing and validation | |
| E | Evidence quality | |
| S | Scope honesty | |
| M | Migration and adoption | |

## 9. Severity scheme

- **Blocker.** A claim that the evidence contradicts or cannot support and that the proposal's conclusion depends on; a baseline expectation (section 1) missing for a feature the proposal calls central; a prototype that cannot fail for its headline result; data-loss or wrong-edit behaviour (rename editing wrong places) without a stated safeguard.
- **Major.** A dimension scored 2 or lower that is central to the claim; a baseline expectation missing but not central; evidence at tier T2 or below used to support a general claim; migration cost materially understated; a scope list that omits a limitation found by the reviewer.
- **Minor.** A real gap with a limited effect on the conclusion; a stated limitation that is under-explained; inconsistent terminology; missing measurement for a secondary feature.
- **Nit.** Wording, formatting, naming, or an easily fixed omission.

Rules: severity attaches to the *effect on the conclusion*, not to effort to fix. A finding must cite the evidence for it (file, line, command, or output) and say whether it was reproduced. Findings that rest on reading only are marked as such.

## 10. Appendix A. Report template

```
# Review of <title>
Rubric: v1.0 (sha256 <hash>); amendments applied: <list or none>
Reviewer stance and date.

## 1. What was assessed (and what was not)
Material read; material run; commands used.

## 2. Claims inventory
C1.. each: claim, tier of evidence (T0..T4), where supported.

## 3. Findings (ordered by severity)
For each: ID, severity, dimension, statement, evidence (reproduced / read only), why it matters, suggested resolution.

## 4. Dimension profile
Table from section 8 with a one-line justification each.

## 5. What is good (praise, with evidence)
Kept separate from findings; each item cites what was checked.

## 6. Open questions for the author
Numbered, answerable, each linked to a finding or a dimension.

## 7. Could not assess
Items, with reason (missing material, could not run, outside my expertise).

## 8. Recommendation
One paragraph; conditions for acceptance; which blockers must be cleared.
```

## 11. Appendix B. Question bank for the author (use selectively)

1. Show the table of features by derived, hooked, and coded. Which row is least certain?
2. Which existing grammar written by someone else did you run this on? What broke?
3. What does the tree look like for three specific broken inputs? What does each feature return?
4. What is the unit of invalidation? Show a from-scratch versus incremental equivalence test.
5. How does rename behave if one file has a syntax error?
6. What changes for an author whose actions mutate state or rely on order?
7. Where does LSP fail to express what you derived? What did you do?
8. Which numbers in the document were measured by someone other than you?
9. Which claim in your summary is the least supported by the prototype?
10. If the library vanished tomorrow, what do authors keep?

## 12. Appendix C. Source map for the rubric

K1: E1, E5, E6, E13, E15, E17, J5. K2: L2, E9, E15, E17, M8, R7. K3: E1, E5, E9, E10, E11, E12, E13, D3. K4: P1, P2, M4, M5, C3, E16, R6. K5: R1, R2, M3, C6, E4. K6: M6, L2, G1, E4. K7: R6, M1, B1, B2, E14, T2, M8. K8: E1, G1, C2, C3, M3. K9: E1, E10, E11, E17, C5. K10: R7, M9, T1, M10, E18. E: R7, P1, E17, E18, C4, C5, C10, E4. S: E1, E15, E17, E4, E13. M: E3, E2, J1, J3, C10, C4, E11, E12.
