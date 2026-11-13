# Ohm language-tooling feature requests

Provide rich editor support backed by Ohm grammars: a Workspace aggregate, grammar-provided linting and formatting, and shared language services with editor integration and an LSP server. Together, these enable Ohm to serve as a language-editor backend across browser, CLI, and protocol hosts.

All API snippets in this document are illustrative sketches, not design anchors or compatibility commitments. Names, types, signatures, collection and result shapes, and synchronous or asynchronous forms are open to redesign. Derive the API from the domain model, its invariants, and the host workflows below. Preserve the requested behavior and acceptance criteria; no sketch needs to be preserved or wrapped solely to retain its illustrated shape.

## 1. Workspace aggregate with revision deconflicting

Provide an Ohm Workspace that associates source revisions with their grammars, parse trees, semantics, and diagnostics. A host should be able to supply changed sources and query a coherent language model without maintaining a separate registry of parse and analysis results.

The host is the application including Ohm and its libraries. The platform is whatever abstraction that application uses for filesystem and UI operations. The Ohm Workspace owns language state. The host supplies source contents and publishes replacement text through its platform.

### Aggregate boundary and invariants

Apply the Aggregate, domain-objects, and visibility patterns to identify and justify the smallest cohesive consistency boundary. Workspace is the proposed Aggregate Root: multi-source acceptance and cross-source invalidation require source membership, current text and revisions, grammar associations, and derived-result validity to change coherently. Include state because it participates in those invariants. The boundary does not require every language-tooling computation to live in one object.

Sources have stable identity across revisions. Source snapshots, revision descriptors, spans, diagnostics, and replacement proposals are candidates for immutable value objects. Retained matchers, analysis caches, and provenance belong under Workspace's control. Grammars and their feature definitions may remain shared inputs; Workspace controls their associations and captures the configuration relevant to result validity.

All changes to accepted language state pass through the root's domain operations, including source batches, membership and configuration changes, removal and reentry, and installation of completed analysis. Validate each operation before exposing its effects. Readers must see a coherent state: pending work may wait or expose explicit readiness, unavailable, or stale status, but older results must never appear current for newer inputs. Rejected batches expose no partial changes. Protect owned state and captured configuration from mutation through caller-held inputs or returned views; choose immutable snapshots, safe views, or controlled capabilities without fixing their public representation.

Keep traversal, linting, formatting, and semantic analysis reusable as independent computations. Workspace coordinates their inputs and validates their outputs before installing results as current. Editors, source discovery, protocol version mapping, and filesystem publication remain host or adapter responsibilities outside the aggregate's consistency boundary.

### Requested behavior

- Construct a Workspace from grammars and optional initial source revisions, and provide a read-only view of its grammars (sketch: `buildWorkspace(grammars, revisions?)` and `readonly grammars`).
- Identify each source version by its source ID and numeric revision (sketch: `{sourceId: string, revision: number}`). A source ID identifies one source throughout the Workspace lifetime. Revisions are strictly increasing per source, with gaps allowed. An unknown source has implicit empty text at revision `0`.
- Accept batches of source revisions and new text (sketch: `setRevisions(Iterable<[Revision, string]>)`). Validate the entire batch before accepting it; each submitted revision must be newer than the stored revision. Update the associated matches and diagnostics before signaling completion. Invalid source syntax is accepted as current text and produces diagnostics.
- Retain the grammar and matcher association for each source. Use source changes to update retained matchers where possible, and invalidate affected analysis when its source or dependencies change. Results must remain associated with the exact text and revision that produced them.
- Keep current diagnostics separate from retained last-good semantic results. Mark retained results stale when their inputs no longer match; they may remain inspectable but cannot authorize navigation or edits against current text. Capture relevant source membership and language configuration along with revisions, and prevent older asynchronous work from overwriting newer state after edits, removal, or close/reopen.
- Support match queries by exact current revision and diagnostic queries for all findings or just syntax, semantic, or lint findings (sketch: `getMatch(revision): Promise<Match>` and `getDiagnostics(level, revision?): Diagnostic[]`). Omitting the diagnostic revision queries current sources. A supplied revision must exactly match the current stored revision. Each diagnostic records the exact source revision, its location, and the finding's details (sketch: `{revision, span, issue}`). Support language-provided semantics and AST construction from the corresponding match; grammar syntax alone does not supply arbitrary semantic meaning.
- Prepare replacement proposals from batches of edits (sketch: `applyEdits(Iterable<Edit>): Promise<Iterable<[Revision, string]>>`). An edit identifies its base revision, a half-open UTF-16 range, and replacement text (sketch: `{revision, range, text}`). Ranges have start and end offsets and cover positions from the start up to, excluding, the end. Check every revision, range, and conflict before computing any result. Apply ranges in reverse source order and return replacement texts keyed by their **base revisions**. Reject an invalid batch as a whole.
- Prepare formatting proposals using the grammar's optional formatting hints (sketch: `format(revisions?: Iterable<Revision>): Promise<Iterable<[Revision, string]>>`). Omitted revisions select current sources; explicit revisions require exact matches. Return only changed sources, keyed by their base revisions. Grammars without formatting hints produce no replacements.

Edit and formatting operations prepare replacements without advancing stored revisions or committing new text. Each proposal preserves its complete relevant validity basis: source revisions and lifetimes, dependencies including unedited sources, membership, and language configuration. Provide a way for the host to revalidate that basis or observe invalidation before publication or protocol handoff. The host publishes the proposed text, then registers fresh revision numbers and the actual resulting contents. A failed or partial publication is reconciled by the host against its platform. Workspace batch validation does not make external writes atomic.

### Acceptance criteria

1. Updating source A refreshes A's parse and diagnostics while preserving the correct revision associations for source B and any dependent results.
2. Revision gaps are accepted; duplicate, older, and stale exact-revision operations are rejected. A rejected batch leaves stored state unchanged.
3. A valid multi-source edit returns complete replacements without changing Workspace state. An overlapping, out-of-range, or stale edit rejects the entire proposal.
4. After publication and registration of fresh revisions, queries use the new text and revision. Diagnostics from an earlier revision cannot authorize edits against the new one.
5. A host can use the same API with in-memory buffers or filesystem-backed sources, with explicit precedence for unsaved buffers and separate evidence of application and saving.
6. Changed dependencies, membership, or language configuration invalidate affected results and proposals. A semantic multi-source change is unavailable when discovery cannot establish its required targets or a required target is unsupported or read-only; no required target is silently omitted.
7. Reversed completion of asynchronous reads and close/reopen with a reused client version cannot restore obsolete state. Current diagnostics remain available when retained semantic results are stale.
8. Mutating caller-held inputs or returned views cannot bypass Workspace's state transitions or validity checks. Queries during a pending operation cannot present results from an obsolete basis as current.
9. A changed unedited dependency invalidates an affected semantic proposal even when every edited source still has its captured revision. The host can detect that invalidation before handoff.

Before finalizing the public API, specify grammar selection for each source, initialization readiness, and contracts for grammars, match results, and diagnostic details. Define how ranges and locations represent replacements, insertions, and diagnostics at empty input or end of input. Preserve the revision and publication lifecycle described above.

## 2. Linting primitives and grammar-provided linters

Provide reusable linting tools for hosts and language developers, together with a built-in suite for Ohm grammars. A language developer should be able to attach optional linters to a grammar once. Hosts using that grammar through Workspace should then receive its lint diagnostics without implementing the language's checks themselves.

### Requested behavior

Provide tree-walking and structural pattern-matching tools outside the semantics phase. Rules must be able to inspect grammar AST patterns, traverse authored parsing expressions, and capture relevant nodes without adding a semantic operation or changing a language's evaluation actions. Support syntax-tree traversal for programs written in Ohm languages as well, with explicit adapters for the different tree structures.

Keep structural traversal separate from semantic relationships. A rule may inspect applications, arguments, predicates, alternatives, and repetition structurally; resolving a rule call, parameter binding, inheritance, or override must be an explicit analysis step. Preserve source provenance so indirect findings can explain the relevant call and binding chain.

Separate matching from reporting. The rule author chooses the primary span, related locations, explanation paths, and any suggested repairs. A match may produce zero, one, or several diagnostics. Reporting must not silently choose the matched node as primary or merge reports with equal locations and messages. For example, a fallibility check may highlight `!`, while a lookahead check using the same evidence may highlight the predicate that reaches it.

Use Workspace source revisions for diagnostic and repair locations. Related evidence may reference other sources. Repairs carry independent edit ranges and remain proposals; applying one requires current revisions and validation of the entire edit batch through the Workspace contract.

Allow grammars to carry an optional lint feature containing their rules and defaults. Workspace discovers and runs those rules for the matching sources and includes the results in lint-only and combined diagnostic queries (sketch: `getDiagnostics("lint", revision?)` and `getDiagnostics("all", revision?)`). Hosts can configure enabled rules and severity and invoke the primitives directly. Language evaluation must remain usable without linting.

Build the Ohm grammar linters on these public primitives. Include checks for fallibility under predicates, fallibility in recovery helpers, left-recursive operator patterns, ambiguous recursion, fallibility in left recursion, nullable recovery tokens, and unused rules. Preserve the distinction between an advisory finding, an automatic repair, and a suggested repair.

### Acceptance criteria

1. A language developer attaches a custom rule to a grammar; a host supplying that grammar and source revisions receives its diagnostics without language-specific host wiring.
2. A structural grammar pattern can be matched and reported without invoking user semantics.
3. Two rules can choose different primary locations from the same captured evidence, including related locations in another source.
4. Diagnostics preserve source revisions, report counts, and explicit evidence. Missing evidence is represented honestly, without invented locations.
5. Stale or conflicting repair edits are rejected as a whole. A grammar without linters remains usable and produces no lint findings.

## 3. Grammar-provided formatting primitives

Provide formatting primitives that let a grammar suggest how sources in its language should be laid out. A language developer should be able to ship optional formatting rules with a grammar, and a host should be able to request formatting through Workspace without building a separate formatter for that language.

### Requested behavior

Allow a grammar to attach optional formatting hints to rule constructors and terminals. Support spacing before and after nodes, indentation and dedentation, bracket and section layout, and verbatim regions. Keep these hints separate from the grammar's recognition rules and evaluation semantics. Hosts may supply formatting preferences, such as the indentation string, through a documented configuration contract.

Preserve comments, source line breaks, and lexical content while normalizing permitted whitespace. Reparse proposed output and verify the relevant tree structure, whitespace constraints, and idempotence before offering it as a replacement. These checks establish the formatter's structural contract; language-specific semantic claims require language-specific evidence. If formatting cannot meet its contract, retain the source and expose the reason for refusal. If recovery is supported, preserve damaged regions verbatim and make that behavior explicit.

Provide formatting both as a reusable computation and through Workspace (sketch: `Workspace.format(revisions?)`). The Workspace operation checks exact current revisions, selects the associated grammar's formatting feature, and returns changed replacement texts keyed by their base revisions. Already formatted sources and grammars without hints produce no replacements. The host publishes accepted replacements and registers the actual resulting contents with fresh revisions.

Design the formatting result so hosts can distinguish a refusal, successful formatting with no changes, and changed replacements.

### Acceptance criteria

1. A host can format a source using only its grammar's attached hints and shared formatting preferences.
2. Formatting preserves comments and lexical content, passes structural verification, and produces no further changes on a second run.
3. Unsupported or unverifiable input remains unchanged, with a refusal distinguishable from successful formatting that needs no changes.
4. Workspace formatting rejects stale revisions and does not change stored source state or write files.
5. Supply built-in hints for Ohm grammar sources and examples covering HDL, ASM, VM, Jack, and TST. CMP remains comparison data.

## 4. Shared language services, editor integration, and an LSP server

Provide protocol-independent language-service defaults over Workspace, editor consumers of those services, and primitives that adapt them to the Language Server Protocol with a default server API. A language developer supplies semantic roles and configuration once; browser, CLI, and protocol hosts should share the resulting language knowledge without implementing each semantic feature separately.

### Requested behavior

#### Shared semantic defaults

Let language authors describe declarations, scopes, references, imports, member access, and export policy alongside their semantic actions. Use those roles and configuration to provide shared scope collection, name and member resolution, cross-source indexing, duplicate and unresolved-name diagnostics, document symbols, definition, references, completion, and rename. Keep evaluation actions usable independently. A grammar without semantic roles still supplies parsing and syntax diagnostics; it does not infer arbitrary language meaning.

Keep these computations outside the LSP adapter and apply the revision, stale-result, dependency, and edit-proposal rules from request 1. Language authors retain control of namespaces, external symbols, export visibility, valid names, and unsupported operations. A rename must preserve binding identity and refuse conflicts or incomplete coverage with an explicit reason.

#### Grammar authoring and service inspection

Provide built-in inspection of Ohm grammar declarations and bound rule applications, including inheritance, overrides, and rule arguments, with navigation to their authored source spans. Support binding-aware grammar-family rename across associated sources, including unopened sources. Renaming `Stmt` to `Statement` must update its declaration, overrides, and bound applications while preserving unrelated same-spelled rules, comments, strings, and terminals. Use the Workspace proposal/publication lifecycle, rebuild the grammar family, and rerun its accepted and rejected input examples to validate the change.

Provide a shared service inspector that consumes the host's existing language service and Workspace state. Show current diagnostics, symbols, definitions, references, source/revision provenance, and readiness or stale status. Grammar inspection should identify grammar-rule bindings explicitly. Navigation and edit controls must become unavailable as soon as their captured document, revision, or semantic basis changes, including a document swap with identical text.

#### Editor and package integration

Integrate the shared tools with the actual editors and documents used by the host. Retain Ohm Editor's CodeMirror syntax highlighting and the course IDE's Monarch tokenizers when composing service, lint, format, and Workspace views. Controls, selections, and diagnostics must use the same editor instance and effective source buffers as the surrounding application.

Provide usable browser and Node package entry points and declarations. Prove the same scenarios through source entry points and clean archive-installed consumers, including compatible parser/semantics identities and one shared Ohm runtime within each consumer. Archive-installed consumers must run without sibling worktree paths or source aliases. Native DOM proofs and interactive browser acceptance must be reported separately.

#### LSP adapters and default server

Provide reusable conversions between source IDs and document URIs, UTF-16 source spans and LSP positions/ranges, revision-bound diagnostics and protocol diagnostics, and replacement proposals and LSP text edits. Map lint repairs to code actions and grammar formatting to document-formatting requests. Preserve primary and related locations; document any explanation data the protocol representation cannot carry.

Provide a default server entry point accepting a Workspace or the grammar configuration needed to construct one, transport streams, and host hooks for source discovery and backing-source changes. Handle protocol initialization, capability advertisement, document open/change/close events, diagnostics, formatting, code actions, shutdown, and disposal. Advertise optional capabilities according to the supplied grammar features.

Register received source contents as Workspace revisions and query the resulting state. Keep client document versions distinct from Workspace revisions, with an explicit mapping between them. Serialize changes and requests so each response uses a coherent source revision. Cancel or reject stale work, and prevent delayed diagnostics from replacing newer results.

Formatting and code-action responses propose edits for client acceptance. They must not advance Workspace state merely because a response was sent. Observe the actual subsequent source changes and register their revisions through the same input path. Closing a document must reconcile its buffer with the host's backing-source policy and clear or replace published diagnostics as appropriate.

Adapt the shared service's document symbols, definition, references, completion, and rename without reimplementing language analysis in protocol handlers. Negotiate supported result shapes and versioned edit capabilities. Refuse a rename handoff if the client contract cannot preserve every required target's captured base; sending edits establishes neither application nor saving. Source discovery and filesystem access remain host/platform hooks; the default server must also work with in-memory sources.

### Acceptance criteria

1. A minimal grammar configuration starts a server with source synchronization and syntax diagnostics; attached lint and formatting features become available without language-specific protocol handlers.
2. An end-to-end client session opens and edits a document, receives current diagnostics, requests formatting or a lint repair, accepts the edit, and produces the expected new Workspace revision after the change notification.
3. Unicode and multiline position conversions are correct. Out-of-order client versions, cancelled requests, and delayed results cannot produce edits or diagnostics presented as current.
4. Authored semantic roles drive shared resolution, diagnostics, symbols, definition, references, completion, and rename through both an in-process consumer and the protocol adapter. Exercise lexical scopes, member access, and configured cross-source exports, with unrelated same-spelled symbols as negative controls.
5. Inspect and rename an Ohm rule across declarations, overrides, bound applications and arguments, and an unopened source. Preserve unrelated names, comments, strings, and terminals; rebuild and rerun accepted/rejected examples, then verify the host's saved and reopened sources.
6. A real editor inspector and protocol client report matching definition/reference identities and ranges from the same service. Editing or swapping its document immediately disables stale controls while current diagnostics remain visible. Existing CodeMirror and Monarch syntax highlighting survives combined-tool attachment.
7. The same integration scenarios pass through source and clean archive-installed public entries. Both modes use one Ohm runtime; installed consumers use no sibling source aliases. Verify native builds and declarations; keep browser focus/layout and manual persistence acceptance distinct from native DOM results.
8. A host can use conversion primitives independently and extend supported features. Protocol dependencies remain in the LSP adapter; Workspace, shared semantic services, linting, and formatting remain usable independently.

Scope traceability: the [language-tooling session plan](../developer/2026-11-10-A-language-tooling/plan.md) and [session report](../developer/2026-11-10-A-language-tooling/report.md) supply the service, grammar-rename, editor, and consumer scenarios incorporated here.

