# The Cost of Fallible Expressions: Historical Recovery Costs and Optimized Reuse in Ohm

*Original analysis: 2026-10-27. Optimization review: 2026-10-29.*

> Sections 3–6 analyze historical Ohm `<original-fallible-commit>`, preserved in the in-repository
> [fixture](../../../benchmarks/fallible/fixtures/fallible-before-reuse/README.md),
> against baseline [`<baseline-commit>`](https://github.com/DavidSouther/ohm/tree/support/v17).
> Section 7 reviews the optimized runtime inspected at `<corrected-source-commit>`, distinguishes
> fresh operation counts from archived `<benchmark-snapshot-commit>` timings, and gives a practical
> local-recovery bound after diagnostic fix `<diagnostic-fix-commit>`. [Reproduction instructions](README.md) cover both engines.

> **Runtime boundary (2026-10-30).** This paper describes the earlier recovery
> semantics, including implicit missing-closer insertion and two CST slots. The
> current API uses `corrections`, `CorrectionNode` and `_correction`, contributes
> three semantic slots (guarded result, correction, matched join), and fails when
> the join cannot match. Historical algorithm names, counts and proofs below are
> retained as evidence about those earlier revisions; they are not measurements
> or complexity claims about the changed runtime.

## Abstract

A *fallible expression* `B ! C` extends a parsing expression grammar (PEG) with a permitted recovery that skips input up to the join expression `C`. Before each retry, the driver grants one new permission at the farthest failure of the preceding pass. Its diagnostic-equality goal is not proven here. For the general policy, the number of logical passes satisfies `r + 1 ≤ P ≤ |K| + 1`, where `r` counts distinct recovered keys in the accepted parse and `|K| ≤ f·(n+1)·a` bounds reachable keys by fallible occurrences, input length and argument instances. Logical passes need not repeat all earlier work.

For corrected runtime `<corrected-source-commit>`, stable independent items admit `Θ(n+k)` matching evaluations and an `O(n+1+k log(n+1))` matching-plus-diagnostics bound under the stated fixed-grammar cost model, where `k` counts permission grants. Resumable iteration prefixes and dependency-based reuse avoid repeating accepted items; the remaining logarithmic term comes from bookkeeping. Diagnostic fix `<diagnostic-fix-commit>` normalizes endpoint filters and prunes rejected shared histories, removing the former exponential traversal in ordinary nested missing-closer recovery. Broader intended-use bounds require stable synchronization boundaries, bounded contexts and bounded local work. The proposed general total bound `O(n²+k log(n+1))` is false for the corrected implementation: ordinary nested missing closers force `Ω(n³)` dependency-invalidation work, and the same growth occurs in closed files when malformed-item count and nesting grow together. The useful mechanism is recovery rounds times the retired frontier times upward dependency work, not three independent full-input parses.

The original `<original-fallible-commit>` engine has two proven exponential evaluation families and an exponential peak-log-space consequence. Those historical bounds do not automatically transfer to the corrected engine. Recovery-bearing recursive lookahead remains a hazardous combination for proposed authoring warnings: it can turn a linear baseline quadratic on valid input. Baseline suffix lookahead can also be quadratic independently of recovery. These restrictions delimit the practical contract without implying that ordinary local recovery scales poorly. Historical counts, current counts and a labeled replay of the former diagnostic-filter policy are reproducible. Archived `<benchmark-snapshot-commit>` timings remain evidence of dense-error gains and valid/sparse-input allocation costs, not measurements of the corrected checkout.

## 1. Introduction

Packrat parsing obtains linear time for a fixed grammar when memoization and bounded work per memoized state cover the repeated computation [1], [2]. Ohm is a PEG-based parser generator that memoizes rule applications and supports left recursion [3]. Its procedural repetitions do not automatically satisfy that bounded-work hypothesis (Section 7.3). Labeled failures extend PEG error reporting with failure labels and catch sets [5]; later work attaches recovery expressions to labels to resume parsing within a pass [6], [7]. Restart-based PEG recovery also predates this design: [6], Section 5, discusses repeated parsing in Parboiled and farthest-failure contextual recovery in Rüfenacht’s work. The operator studied here uses a particular repeated-pass policy. A grammar author marks a recovery point by writing `B ! C`, and recovery is driven from *outside* the parse by repeated passes. Each retry permits one more recovery point at the farthest failure of the preceding pass. The appeal of this design is semantic. Its stated goal is that the *i*-th diagnostic is the error a plain parse reports after the first *i*−1 errors are repaired, so that the first diagnostic of a recovering parse equals the plain parse's error message. The implementation's test suite checks this on specific inputs [4]. This paper treats it as a design goal, not a proven property, and Observation 28 records a case where several diagnostics collapse into one.

The cost of repair recovery is the subject of this paper. The phrase "overhead added to generation" is explored in three parts:

- **G1, grammar construction:** parsing grammar source with the extended meta-grammar, building expression trees, and running static checks. Not substantially larger than any existing grammar feature.
- **G2, match and CST generation:** the pass driver, memoization, left recursion, recovery scans, and `_fail` node construction. The bulk of the algorithmic work, and the bulk of the paper.
- **G3, diagnostic collection:** `getRecoveredFailures`. Minimal and only paid when reporting errors.

**Contributions.**

1. A formal semantics of `B ! C` parameterized by a permit set, together with the pass driver (Section 3).
2. Upper and lower bounds on the number of passes, a sufficient condition for cross-pass memo validity, and a quadratic lower bound within an explicit whole-application replay model (Section 4).
3. Equivalence results showing that the implementation's evaluation sequence is unchanged in the absence of recovery events (Section 5).
4. Two unconditional and one conditional exponential evaluation lower bounds for recovering mode, plus an exponential peak recovery-log-space consequence of the one-recovery construction (Section 5).
5. Reproducible historical operation counts (Section 6), an implementation-backed optimization review, practical local-recovery bounds, authoring guidance and a corrected diagnostic traversal (Section 7).

<!--
**Epistemic labels.**

- **Theorem**, **Proposition**, **Lemma** and **Corollary** carry proofs.
- **Claim (informal)** carries an argument that falls short of a proof.
- **Conjecture** is unproven.
- **Observation** reports a measured count, tied to an experiment identifier `E*` reproduced by `scripts/experiments.mjs`.
-->

Historical results about the implementation are proved against a model of the code at commit `<original-fallible-commit>` [4], obtained by inspection. Fidelity of that model is a threat to validity (Section 8). The optimized-source review and new counterexample are explicitly separated in Section 7.

## 2. Background

### 2.1 PEGs and packrat parsing

A PEG is a recognition-based formalism with prioritized choice: where a CFG chooses nondeterministically, a PEG commits to the first alternative that succeeds [2]. Every PEG admits a linear-time parser [2]. A packrat parser achieves this bound by memoizing intermediate results at a granularity that bounds the local work per state, giving "linear parse time" despite backtracking and unlimited lookahead [1], [9]. Memoizing only whole rule applications is insufficient when each application repeats a suffix-length loop; Section 7.3 exhibits that case in Ohm. Memoization costs space: packrat parsers "require O(n) space for memoization", and cut operators reduce that storage [8]. Heap consumption from memoization has led implementers to abandon packrat parsing despite the possibility of exponential-time parsing without it [10]. Operational semantics of PEGs and of PEG matching machines appear in [12], [13].

### 2.2 Left recursion

Packrat parsing can be extended to left-recursive rules by seeding a memo entry with failure and growing it [11]. That extension can yield "super-linear parse times for some left-recursive grammars" [11]. A conservative semantic extension of PEGs for left recursion is given and proven in [12]. Ohm implements seed growth (`growSeedResult`) with an "involved applications" set that suppresses memoization inside an active left recursion [4].

### 2.3 Error reporting and recovery in PEGs

Labeled failures, "inspired by exception handling", let a PEG define different kinds of failure, each of which an ordered choice may catch [5]. Recovery expressions attached to labels "reach a synchronization point in the input and resume parsing" [6]. Labels and recovery expressions can be inserted automatically [7]. This paper derives no comparative complexity bounds from [5]–[7]. For LR parsers, earlier advanced recovery techniques were considered to have poor typical performance and an unbounded worst case. CPCT+ repairs 98.37 % of a 200,000-file corpus within a 0.5 s timeout [15].

### 2.4 Ohm

Ohm separates grammars from semantic actions [3]. Its matcher (`MatchState`) evaluates parsing expressions by recursive descent. It memoizes *applications* (rule instances, keyed by rule name and actual parameters) in a per-position table (`PosInfo`). Each entry records the *examined length*: the farthest input offset the application read. Ohm's incremental parsing invalidates memo entries whose examined interval intersects an edit [14]. The historical fallible extension reuses that invalidation routine between passes [4]. The optimized implementation instead tracks permission dependencies when its additional recovery cache is enabled (Section 7.1).

## 3. Formal Model

### 3.1 Syntax and keys

Let `G` be a grammar with rule instances `R` and fallible occurrences `F`, with `f = |F|`. Let `w` be the input, with `n = |w|`. A fallible occurrence `φ ∈ F` written `B ! C` has a *guarded expression* `B` and a *join expression* `C`. Ohm requires both to have arity 1, and `B` may not be a predicate [4].

**Definition 1 (recovery key).** A *recovery key* is a triple `κ = (φ, i, α)`, where `φ ∈ F` is a fallible occurrence, `i ∈ [0, n]` is the position at which `φ` is evaluated, and `α` is the actual-argument tuple of the enclosing rule application, or `⊥` when that rule is not parameterized. `K` denotes the set of keys reachable in any pass. When `a` bounds the number of distinct argument tuples that reach a rule containing a fallible, with `a = 1` for unparameterized grammars, `|K| ≤ f·(n+1)·a`.

### 3.2 Judgement

Evaluation is a judgement `⟨e, i⟩ ⇒[Π, σ, ν; q] o`, with these components:

- `Π ⊆ K` is the *permit set* of the pass.
- `σ` is the *stop stack*: the join expressions of the fallibles whose attempt is in progress.
- `ν ∈ {0, 1}` records whether evaluation is inside a predicate (`&`, `~`) or a recovery scan.
- `q` is the start position of the current enclosing rule application; it records progress before the fallible begins.
- The outcome `o` is either `j` (success, ending at position `j`) or `✗` (failure).

Every PEG operator other than `!` follows the standard rules [2], [12] and threads `Π`, `σ`, `ν` and `q` unchanged, except that `&e` and `~e` evaluate `e` with `ν = 1`, and entering a rule application at position `j` sets `q = j` for that application’s body.

For a failed attempt, `ρ` denotes the farthest failure position reached inside the attempt. `scan(φ, i, σ, q)` is the partial function that searches forward for `C` (Section 3.4).

```
            ⟨B C, i⟩ ⇒[Π, σ, 1; q] o
(F0)  ───────────────────────────────────  ν = 1: inside a predicate or scan, `!` is a sequence
        ⟨B ! C, i⟩ ⇒[Π, σ, 1; q] o

        ⟨B, i⟩ ⇒[Π, σ·C, 0; q] j     ⟨C, j⟩ ⇒[Π, σ·C, 0; q] k
(F1)  ─────────────────────────────────────────────────
        ⟨B ! C, i⟩ ⇒[Π, σ, 0; q] k

        ⟨B C, i⟩ ⇒[Π, σ·C, 0; q] ✗      κ = (φ, i, α) ∉ Π
(F2)  ─────────────────────────────────────────────────    records attempt (κ, ρ)
        ⟨B ! C, i⟩ ⇒[Π, σ, 0; q] ✗

        ⟨B C, i⟩ ⇒[Π, σ·C, 0; q] ✗    κ ∈ Π    scan(φ, i, σ, q) = k
(F3)  ─────────────────────────────────────────────────────    yields a `_fail` node over the skipped input
        ⟨B ! C, i⟩ ⇒[Π, σ, 0; q] k

        ⟨B C, i⟩ ⇒[Π, σ·C, 0; q] ✗    κ ∈ Π    scan(φ, i, σ, q) undefined
(F4)  ─────────────────────────────────────────────────────────
        ⟨B ! C, i⟩ ⇒[Π, σ, 0; q] ✗
```

In rule F3, when `B` is an iteration `B'*` or `B'+`, the elements matched by the failed attempt are kept. Ohm re-evaluates them, with the stop stack extended by `C`, before the scan; keeping the prefix does not require recomputation in the general design.

**Definition 2 (desugaring).** `δ(G)` replaces each `B ! C` by an unflattened sequence node `(B C)`. Under `Π = ∅`, rules F1 and F2 coincide with the sequence rule, so `⟨e, i⟩ ⇒[∅, σ, ν; q] o` holds iff `⟨δ(e), i⟩ ⇒ o` holds in `δ(G)`.

### 3.3 Pass driver

The driver maintains a permit set `Π_t` and an attempt store `A_t`. The attempt store is kept across passes because, in the implementation, an application memoized in an earlier pass does not run again and therefore does not record its attempts again [4].

1. Start with `Π_1 = ∅` and `A_1 = ∅`.
2. Pass `t` parses `w` under `Π_t` and adds the attempts recorded by F2 to `A_t`. If the pass succeeds, the driver stops.
3. Otherwise, let `ρ_t` be the farthest failure position of the pass. The driver chooses `κ*_t ∈ A_t` with `ρ(κ*_t) = ρ_t` and `κ*_t ∉ Π_t`, preferring the greatest start position and then the greatest application depth. It sets `Π_{t+1} = Π_t ∪ {κ*_t}` and removes from `A_t` every attempt whose interval `[start, ρ]` contains `start(κ*_t)`.
4. If no candidate exists, the driver stops and reports failure, listing the recoveries made so far.

`P` denotes the number of passes.

### 3.4 Scan

`scan(φ, i, σ, q)` starts at the first token boundary after the farthest complete token of the failed attempt. At each candidate position `p` it does the following:

1. It tests `C` at `p`. If `C` matches, the skip region is `[start, p)`, and the result is defined only if the region together with `C` covers at least one code unit.
2. Otherwise, it tests every join expression on `σ`. When the fallible is nested within at least two blocks, it also tests the grammar's `recoveryStop` rule. If any of these matches, the scan stops.
3. Otherwise, it advances by one `recoveryToken` match if the grammar defines that rule, or by one code unit.

When the scan stops at position `p`, or reaches the end of the input (`p = n`), a *block* (a guarded `*`/`+` whose join expression is not a lookahead) may insert the missing join only if `p > i` or `i > q`. Thus input must have been consumed during the fallible or earlier in its enclosing application. If neither progress condition holds, or the fallible is not a block, the scan is undefined (rule F4). For example, `S = any* ! "}"` on empty input cannot insert a closer because `p = i = q = 0`. All scan evaluations run with `ν = 1` [4].

## 4. Complexity of the General Design

This section analyzes the policy of Section 3 independently of Ohm's memo policy. Proposition 7 and Claim 8 assume a linear-scan attempt store; that is an algorithm choice, not a lower bound inherent in the permit policy. Section 7 describes the indexed replacement.

**Theorem 1 (termination and pass bound).** The driver terminates after `P ≤ |K| + 1 ≤ f·(n+1)·a + 1` passes, provided each pass terminates.

*Proof.* Every pass `t < P` ends in step 3, which adds a key `κ*_t ∉ Π_t` to the permit set, so `|Π_{t+1}| = |Π_t| + 1`. Every permit set is a subset of `K`. Hence at most `|K|` passes end in step 3, and the pass that follows them ends in step 2 or step 4. ∎

**Proposition 2 (pass lower bound).** If the accepted parse of the final pass applies rule F3 at `r` distinct keys, then `P ≥ r + 1`.

*Proof.* Rule F3 applies only at keys in `Π_P`. The permit set grows by exactly one key per pass, so `|Π_P| = P − 1`. Hence `r ≤ P − 1`. ∎

**Corollary 3 (tightness in `n`).** Some grammar families have `P = Ω(n)` whenever the driver accepts. On those families the upper bound of Theorem 1 is attained up to the factor `f·a`.

*Proof.* Consider `S = Item* end; Item = "a" ! ";"` with input `"b;"^k · "a;"^k`, so `n = 4k`. The only terminals are `"a"`, `";"` and `end`, and the guarded expression is not an iteration, so no block insertion occurs. Each `b` in an accepted parse must therefore lie inside a skip region of rule F3. Every code unit is a scan candidate (the grammar defines no `recoveryToken`), and a scan stops at the first candidate where `";"` matches. A skip region therefore contains no `";"`, and so covers at most one `b`. If the driver accepts, the accepted parse thus applies F3 at `r ≥ k` keys, and Proposition 2 gives `P ≥ k + 1 = Ω(n)`. Acceptance itself is not proven here. Theorem 1 gives `P = O(f·a·n)`, and `f = a = 1` for this family. ∎

Observation 30 (experiment E7) reports `P = k + 1` exactly on this family, and Observation 9 reports the same on the HDL family of experiment E2.

**Lemma 4 (memo validity across passes).** Let `D(A, i)` be the set of start positions of all fallible evaluations with `ν = 0` in the derivation of application `A` at position `i` under `(Π, σ, q)`. Suppose `start(κ*) ∉ D(A, i)` and the derivation applies neither F3 nor F4. Then the outcome of `A` at `i` under `(Π ∪ {κ*}, σ, q)` equals its outcome under `(Π, σ, q)`.

*Proof.* The proof is by induction on the derivation. Rules F2, F3 and F4 are the only rules whose premises mention `Π`, and they mention only the membership of the evaluated key. Every fallible evaluation in the derivation has a key whose position lies in `D(A, i)` and therefore differs from `κ*`, so each membership test has the same answer under both permit sets. Every other rule is independent of `Π`. Since F3 and F4 are not applied, the derivation does not consult `scan`, so its validity does not depend on `σ` beyond the stop stack the rules themselves pass on. The same derivation is therefore valid under `Π ∪ {κ*}`, and PEG evaluation is deterministic, so the outcomes agree. ∎

Lemma 4 gives a sufficient condition for reuse, not a necessary one. Applications whose dependence set excludes the new permit and which applied neither F3 nor F4 may be reused in the same context. Failure of this hypothesis alone does not show that an outcome changes or that every implementation must recompute it. The ancestors whose derivations include the new permit form its *spine*. Results that applied F3 or F4 also consult the scan context, which keying by rule instance and position alone does not capture.

**Proposition 5 (cost under whole-application replay).** Consider a restricted reuse model: an application result is reused across passes only when Lemma 4’s hypothesis holds; otherwise its body is replayed from its start, without continuation or iteration-suffix reuse. Let `J` be a set of passes that replay an iterating application, and let `m_t` be the actual number of elements visited by that replay in pass `t`. Then those replays cost `Ω(Σ_{t∈J} m_t)` element evaluations. If `Σ_{t∈J} m_t = Ω(P·m)`, the cost is `Ω(P·m)`.

*Proof.* The replay restriction requires the body to visit its `m_t` elements in pass `t`. Each visited element costs at least one evaluation, including a memo hit. Summing gives the stated lower bound. The `Ω(P·m)` specialization requires the additional traversal-sum hypothesis; it does not follow merely from the existence of `m` items in the input. ∎

**Corollary 6 (quadratic cost under whole-application replay).** On Corollary 3’s input `"b;"^k · "a;"^k`, with `k = Θ(n)`, the reuse model of Proposition 5 costs `Ω(n²)`, provided the driver accepts. Implementations that resume a pass mid-iteration or memoize iteration suffixes fall outside this model.

*Proof.* An unpermitted bad item fails and stops `Item*`, after which `end` fails. Permitting it lets its recovery consume through the next semicolon, exposing the next bad item. Thus, before acceptance, the driver must successively permit all `k` bad items. When the next key is permitted, the preceding root derivation includes that key’s position in its dependence set, so the restricted model replays the root from its start. The replay with `j` permitted bad items visits at least those `j` items, for `1 ≤ j ≤ k`. Proposition 5 therefore gives `Ω(Σ_{j=1}^k j) = Ω(k²) = Ω(n²)`. Early failed passes need not reach the valid suffix. Acceptance remains conditional, as in Corollary 3. ∎

**Proposition 7 (driver bookkeeping).** Choosing and permitting a key costs `O(|A_t|) ≤ O(|K|)` per pass, so `O(P·|K|)` in total. The design stores `O(|K|)` attempts and `O(P)` permits, in addition to the memo table.

*Proof.* The choice in step 3 is a linear scan over `A_t`, and the pruning is a second linear scan. `A_t` maps keys to records, so `|A_t| ≤ |K|`, and `|Π_t| < P`. ∎

**Claim 8 (informal; general worst-case and typical-case time).** Let `W_t` be the cost of pass `t` and `M_t` the cost of any per-pass message computation. By Theorem 1 and Proposition 7, the total time is `Σ_{t ≤ P} (W_t + M_t) + O(P·|K|)` with `P ≤ |K| + 1`.

- **Worst case:** if both a primary pass and its message computation cost `O(W)`, with packrat cost `W = O(|G|·n)`, the total is `O((|K| + 1)·(W + |K|))`, retaining the driver-bookkeeping term. Whether the per-pass bound holds depends on how the implementation memoizes context-dependent results (Section 5.4).
- **Typical case:** suppose `e` errors each need one permit and ideal reuse revisits at most `h` spine nodes per permit, at cost `O(c)` per node. The baseline plus this spine/recovery contribution is `O(W + e·h·c)`. This is a total-time bound only if traversal outside those nodes, message computations and driver bookkeeping are also bounded by that expression. Short spines and absence of backtracking or predicates alone do not establish these additional bounds.

*Argument.* The worst-case figure sums the assumed primary/message bounds and Proposition 7’s bookkeeping bound over at most `|K| + 1` passes. The typical-case contribution follows from the additional per-permit work assumption. Lemma 4 permits some reuse but does not prove that these are the only computations needed. The argument is informal because the ideal context-sensitive reuse policy is not known to be realized (Conjecture 2), and the remaining traversal, message and bookkeeping costs need separate bounds. ∎

## 5. The Ohm Implementation

This section concerns `<original-fallible-commit>`; Section 7 reviews the optimized implementation.

The analysis below refers to commit `<original-fallible-commit>` [4]. The unit of cost is one call of `MatchState#eval`, the *evaluation count*. Outside its nested calls, each such call does `O(1)` work, with these exceptions:

- recovery-key string construction, which costs `O(|memo key|)` for parameterized rules;
- `activeJoin`, which substitutes parameters into `C` at `O(|C|)` cost for parameterized rules;
- filtering the recovery log, `O(m)` for `m` recoveries inside one attempt;
- the work in Section 5.3.

### 5.1 G1: grammar construction and analysis

The meta-grammar changes `Seq = Iter*` to `Seq = Fallible*`, with `Fallible = Iter "!" Iter | Iter "!" | Iter`, and adds `"!"` to the operator tokens.

**Proposition 10 (construction overhead).** Parsing grammar source with the extended meta-grammar adds `O(1)` evaluations per sequence factor, and remains linear in the length of the grammar source. Each static pass over expression trees (arity, nullability, application validity, parameter introduction and substitution, recipes, `toFailure`, `toString`, the Wasm `assertNoFallibles` check) visits each `Fallible` node once and recurses into `B` and `C`. These passes therefore keep their baseline complexity in `|G|`. An exception is `assertChoicesHaveUniformArity`, which calls `getArity` on both operands at each fallible. That check costs `O(|G|·h)`, where `h` is the nesting height of fallibles, the same form as the existing check for alternations.

*Proof.* For each sequence factor, `Fallible` is a memoized application. Its three alternatives each begin with `Iter` at the same position. The first evaluation of `Iter` is memoized, and the second and third alternatives reuse that entry. Each alternative then makes at most one terminal test (`"!"`) and, in the first alternative, one further `Iter`, which is the next factor and is memoized in its own right. This is `O(1)` evaluations per factor beyond the baseline, and packrat linearity [1], [2] is preserved because no new rule is left-recursive. For the static passes, the code adds one method per pass for `Fallible`, delegating to `this.fallible` and `this.join` [4]. `getArity` is a full recursion over its operand, so the arity check costs the sum of subtree sizes along fallible nesting chains, which is `O(|G|·h)`. ∎

Observation 11 quantifies Proposition 10 on one grammar: +461 evaluations (+7.9 %) to construct a grammar that contains no `!`.

### 5.2 G2 without recovery events

Ohm adds the following to every evaluation, whether or not a grammar uses `!`:

- `MatchState#eval` tests `this.recovery` on each successful evaluation;
- `enterApplication` and `exitApplication` each test `this.recovery` once;
- `Apply#eval` tests `memoRec.isRecoveryTainted`;
- `Apply#reallyEval` compares the taint counter twice and stores `tokenEndOffset`;
- predicates call `_suspendRecovery` and `_resumeRecovery`.

None of these calls `eval`.

**Theorem 12 (no-recovery equivalence).** Call a pass *taint-free* when it evaluates no fallible with `ν = 1` and applies neither F3 nor F4. Matching `G` in plain mode on a fresh matcher (an empty memo table), and the first pass of a recovering match whenever that pass is taint-free, perform the same sequence of `eval` calls as plain-mode matching of `δ(G)`. For a grammar with no fallibles, the commit performs the same sequence of `eval` calls as the baseline `<baseline-commit>`.

*Proof.* Plain mode: `Fallible#eval` with `state.recovery` undefined returns `state.eval(B) && state.eval(C)`, which is the call sequence of the sequence node `(B C)`. Recovering mode, taint-free first pass:

- Each fallible evaluated with `ν = 0` evaluates `B` then `C`, as in F1 and F2.
- Its other actions (pushing and popping failure info, recording the attempt, maintaining `_syncStack`, `_blockDepth` and `_tokenEnd`) make no `eval` call.
- Because no taint event occurs, the taint counter is constant throughout the pass. Every memoization condition in `reallyEval` therefore reduces to the baseline condition, and every left-recursion head is stored with `isRecoveryTainted = false`, so `Apply#eval` takes the baseline branches.
- `_prepareForRecovery` empties the memo table before pass 1, as a fresh plain match would.

Grammars without `!`: the diff from the baseline adds only the non-`eval` tests listed above. The taint counter is incremented only inside `Fallible#eval`, so it is constant, and every memo decision is the baseline decision. ∎

Theorem 12 asserts equality of call *sequences* by inspection; the experiments check only the counts. In both Theorem 12 and Observation 13, the count for `δ(G)` written in Ohm's surface syntax differs by the number of evaluations of fallibles that occur directly inside a sequence, because the builder flattens a nested sequence written in parentheses. This accounts for the constant +1 in E1.

**Corollary 14 (valid input).** On an input that `G` accepts, a recovering match runs one pass and costs exactly a plain match, provided no fallible is reachable under a predicate.

*Proof.* With no fallible reachable under a predicate, pass 1 evaluates no fallible with `ν = 1`. Its permit set is empty, so F3 and F4 never apply. The pass is therefore taint-free, and Theorem 12 applies. The pass succeeds because `δ(G)` accepts the input, so the driver stops after one pass. ∎

### 5.3 G2 per-pass costs of the driver

**Proposition 15 (match runs).** A recovering match runs `2P − 1` complete matches when it succeeds: `P` passes and `P − 1` message passes. When tracing, it runs one more.

*Proof.* `matchRecovering` calls `result.getRightmostFailures()` on every failing pass. Because the first match does not record failures, that call re-runs `matcher._match` with `positionToRecordFailures` set under the same `RecoveryContext`, which is one complete match. A succeeding pass computes no message, and tracing adds one final `runPass` with tracing enabled [4]. ∎

The message pass reuses the memo table, except for entries that lack failure information at the recorded position (`hasNecessaryInfo`). The plain matcher also computes failure messages lazily, but the driver forces this computation on every failing pass.

Between passes, `_invalidateMemoEntries(s, s+1)` with `s = start(κ*)` visits positions `0..s` and deletes each entry whose examined interval reaches past `s`. This realizes the condition of Lemma 4, using the examined interval as an over-approximation of `D(A, i)`. The over-approximation is sound because the permitted key belongs to a failed attempt, which read its start position (the input stream records a read even at the end of the input), so its start lies inside the examined interval of every enclosing application. The cost is `O(s)`, plus the number of keys enumerated at positions whose maximum examined length crosses `s`. Each deleted entry was created once, so deletions amortize against creation. `chooseAttempt` and `permit` are linear in the attempt store (Proposition 7).

**Proposition 16 (scan cost).** A scan that starts at position `p₀` visits at most `n − p₀ + 1` candidate positions. At each candidate it makes one `spaces` evaluation, at most one evaluation of `C`, at most `|σ| + 1` stop-marker evaluations, and at most one `recoveryToken` evaluation.

*Proof.* The loop variable `p` strictly increases: `nextCandidate` returns either the end of a `recoveryToken` match that made progress, or `tokenStart + 1` with `tokenStart ≥ p`. The loop stops after `p = n`. The per-candidate calls can be read from the code of `scan` [4]. ∎

All scan evaluations run with `ν = 1`. Applications they evaluate are memoized unless they themselves contain a fallible. A scan that runs to the end of the input visits `O(n − p₀ + 1)` candidates. A matching lower bound requires a bounded-advance assumption covering both token and whitespace jumps; an unbounded `recoveryToken` can cross the whole suffix in one match. Candidate count is distinct from the work inside token, space, stop and join evaluations.

### 5.4 G2 with recovery events: the taint rule

Ohm keeps a counter `_recoveryTaint` and increments it in two cases: when a permitted fallible enters recovery (rules F3 and F4), and when a fallible is evaluated with `ν = 1` (rule F0). `reallyEval` does not memoize an application whose evaluation changed the counter. A left-recursion head that changed it is stored for seed growth and then deleted on its next lookup. The rule is sound: it prevents reuse of results that depend on `σ`, and of results computed under `ν = 1`, which recorded no attempts. It is also coarse. The counter is monotone, and every application whose dynamic extent contains a taint event is excluded, including every ancestor on the application stack.

**Theorem 17 (exponential cost of one recovery under backtracking).** Consider the grammar `S = E end; E = "(" E ")" "a" | "(" E ")" "b" | X; X = "x" ! ";"` and the input `w_d = "("^d · "y;" · ")b"^d`, of length `3d + 2`. A recovering match of `w_d` evaluates `E` at least `2^d` times in its second pass. The input contains one error.

*Proof.* Pass 1 fails. `X` at position `d` fails at `d` (`"x"` against `y`). No expression consumes input past position `d`, so `ρ_1 = d`. The only attempt with `ρ = d` is `(X, d)`, because attempts of `X` at positions `j < d` fail at `j`. The driver therefore permits `(X, d)`.

In pass 2, `E` at `d` fails its first two alternatives at `y`. Its third alternative applies `X`, which fails its attempt and recovers: the scan finds `";"` at `d + 1`. This application of F3 increments the taint counter. Every application whose extent contains that recovery is therefore not memoized, including every application of `E` at a position `j ≤ d`, by induction on `d − j`. For `j < d`, an evaluation of `E` at `j` matches `"("` and evaluates `E` at `j + 1` in its first alternative. After that, `")"` matches and `"a"` fails against `b`. The second alternative then evaluates `E` at `j + 1` again, with no memo entry to reuse. Writing `N(j)` for the number of evaluations of `E` at `j`, this gives `N(0) ≥ 1` and `N(j + 1) ≥ 2·N(j)`, so `N(d) ≥ 2^d`. Each of those evaluations of `E` at `d` repeats the recovery scan. ∎

Theorem 17 shows that the evaluation count of a recovering match with a single error is `2^Ω(n)`. A plain match of the corrected input is linear (column "valid, plain" in E3).

**Theorem 18 (exponential cost on error-free input).** Consider the grammar `S = E end; E = &P "(" E ")" "a" | &P "(" E ")" "b" | "x"; P = "(" ! any` and the valid input `v_d = "("^d · "x" · ")b"^d`. A recovering match of `v_d` runs one pass and evaluates `E` at least `2^d` times. A plain match evaluates `E` `O(d)` times.

*Proof.* Every evaluation of `&P` evaluates the fallible in `P` with `ν = 1`, which increments the taint counter under rule F0, even though the fallible succeeds. Every evaluation of `E` at `j < d` begins its first alternative with `&P`, so no such evaluation is memoized. The first alternative matches `"("`, evaluates `E` at `j + 1`, matches `")"`, and fails at `"a"`. The second alternative re-evaluates `E` at `j + 1`. As in Theorem 17, `N(d) ≥ 2^d`. No failure is final, so the driver stops after one pass. In plain mode no taint exists, Theorem 12 applies, and packrat memoization bounds the evaluations of `E` by a constant per position. ∎

Theorem 18 means that using `recover: true` can change the time complexity on *correct* input. Reachability beneath `&` or `~` can invalidate the evaluation-equivalence guarantee, which explains Corollary 14’s conservative hypothesis. It does not by itself imply a changed asymptotic class: Theorem 18 also uses recursive two-way backtracking to obtain exponential duplication.

**Theorem 19 (exponential cost of nested missing closers).** Consider the grammar `S = Stmt*; Block = "{" Stmt* ! "}"; Stmt = Block | Simple; Simple = "x" ";"` and the input `"{"^d · "x;"`, which has `d` unclosed blocks. Suppose the final pass permits all `d` block keys. Then the final pass evaluates the block nested at depth `d − 1` at least `2^{d−1}` times. The hypothesis holds whenever `P = d + 1`.

*Proof.* The fallible occurrence is evaluated only at positions `1..d`, after each `"{"`, so the grammar has exactly `d` reachable keys. If `P = d + 1`, then `|Π_P| = d` and every key is permitted.

In the final pass, consider the block at depth `j < d − 1`. Its attempt evaluates `Stmt*`, which applies the block at depth `j + 1`. That inner block succeeds by recovery, so its evaluation increments the taint counter and is not memoized. The attempt then fails, because `"}"` is absent at the end of the input. The key is permitted, so F3 applies. The guarded expression is an iteration, so `recover` re-evaluates `Stmt*` to keep the matched prefix, and this applies the block at depth `j + 1` a second time. The scan then reaches the end of the input, and the block recovers by inserting the missing join. Hence `N(j + 1) ≥ 2·N(j)` and `N(0) ≥ 1`. ∎

Theorem 19 combines the taint rule with re-evaluation of the kept prefix, a choice specific to the implementation. The general design (rule F3) requires the prefix to be *kept*, but it does not require the prefix to be *recomputed*.

**Claim 20 (informal; flat-list traversal and repeated recovery).** Suppose a top-level iteration of `m` items contains `k ≥ 1` errors, each recovered in a different item, with no recovery beneath a backtracking choice or predicate. Assume acceptance after `P = k + 1` primary passes, bounded item-visit cost outside recovery, and comparable recovery cost `Θ(c)` per execution. Let `m_t` count the actual item visits in each primary or message run after the first primary pass, and let `V = Σ_t m_t`. If message runs add at most a constant factor to the primary traversal and recovery work, and every later primary pass revisits the earlier recovered items, the evaluation count has the informal accounting `W + Θ(V) + Θ(k²·c)`, where `W` is the first primary pass’s evaluation count.

*Argument.* Taint prevents memoization of applications containing a recovery, but a failing pass may stop at the next unpermitted error. Its traversal charge is therefore its actual `m_t`, not automatically `m`. Untainted items may be memo hits; recovered items repeat their recovery in later primary passes. With one newly permitted item per pass and earlier recoveries revisited, these passes execute `1 + 2 + ··· + k = Θ(k²)` recoveries, including first executions. The message-run assumption adds at most a constant factor. Under these uniform-cost and run-count assumptions, `V = O(k·m)`, giving an upper bound `O(W + k·m + k²·c)`. A tight traversal term `Θ(k·m)` requires the additional placement condition `V = Θ(k·m)`, for example that a constant fraction of the failing passes reaches a constant fraction of the list. The claim remains informal because these cost and message-run assumptions are not derived for arbitrary grammars. ∎

For clustered errors in `"b;"^k · "a;"^(m−k)` with `Item = "a" ! ";"` and constant-cost recovery, failed passes visit increasing bad prefixes and only the successful pass reaches the full valid suffix. The resulting evaluation count is `Θ(m + k²)`, rather than a universal `Θ(k·m)` traversal cost. Observation 21’s fit (maximum relative error 2.2 %) is evidence about E2’s fixed family, not a lower bound for every error placement.

### 5.5 Left recursion

**Proposition 22 (tainted left-recursion heads).** If the growth of a left-recursive head at position `i` contains a taint event, the grown result is used only by the evaluation that grew it. Every later request for the head at `i` regrows the seed from failure.

*Proof.* `reallyEval` stores the head's record with `isRecoveryTainted = true`, because the seed must stay visible during growth. On the next lookup, `Apply#eval` deletes a tainted record and calls `reallyEval`, which detects a new left recursion, memoizes a failure, and grows again [4]. ∎

Seed growth already costs one body evaluation per growth step, and the implementation of [11] admits super-linear behaviour. Proposition 22 multiplies that cost by the number of times the head is requested at the same position. Observation 23 reports the cost for a left-recursive sum.

### 5.6 Incrementality, G3, and space

**Proposition 24 (no incremental reuse).** A recovering match never reuses memo entries from an earlier match. It throws an error if the matcher's input changed since the last match, or if the memo table was filled by a plain match.

*Proof.* `_prepareForRecovery` throws in both cases and otherwise calls `_resetMemoTable` [4]. ∎

An editor that requests a recovering parse after each edit therefore pays a full parse plus recovery on every keystroke. The incremental reuse of [14] is available only in plain mode.

**Proposition 25 (G3 cost).** `getRecoveredFailures` costs `O(|T| + m log m)` on a successful result, where `|T|` is the number of CST nodes outside `_fail` subtrees and `m` is the number of recorded failures. Each call additionally copies the `m` cached entries. On a failed result the list is precomputed, at `O(m log m)` cost, from the recovery log of the final pass.

*Proof.* `collectRecoveredFailures` walks the CST and does not descend into failure nodes. `distinctByPosition` makes one pass with a hash set, then sorts. The result is cached, and each call returns `slice()` [4]. ∎

**Proposition 26 (space).** Let `L` be the maximum number of simultaneously retained recovery-log entries during any one pass. It counts dynamic entries, including duplicates left by backtracking, whereas `r` in Proposition 2 counts distinct keys in the accepted parse. In addition to the baseline memo table, a recovering match stores:

- `O(|K|)` attempt records and `O(P)` permits;
- one `MatchResult` per failing pass, retained by `RecoveredFailure` objects through their permitting pass;
- `O(h_s)` stop-stack entries, where `h_s` is the depth of active fallible attempts;
- `O(h_a)` token-end entries, where `h_a` is the depth of the application stack;
- `O(L)` recovery-log slots at peak within a pass; `L` is not bounded by `r`.

Each memo record gains one field (`tokenEndOffset`) in every mode. Tainted applications are not memoized, so recovery can *shrink* the memo table.

*Proof.* The structures in `RecoveryContext`, `RecoveredFailure`, `MatchState` and `reallyEval` give the listed storage [4]. Each successful dynamic recovery appends a fresh `RecoveredFailure`. Ordinary backtracking restores input and bindings without truncating the recovery log; recovery-specific cleanup does not eliminate all duplicates accumulated through failed alternatives. Thus distinct accepted keys do not bound its peak entry count. ∎

The expected-failure sets held by retained `MatchResult` objects contribute `O(P·φ)`, where `φ` bounds the size of one such set; this does not bound their entire reachable object graphs. More decisively, Theorem 17’s final primary pass performs at least `2^d` recoveries at the same key and retains their log entries simultaneously. Hence `L ≥ 2^d`, although `r = 1` and `P = 2`. This is an exponential peak-space lower bound during parsing, not a claim about storage reachable after the match returns. Small `P` alone therefore does not establish memo-table dominance over recovery storage; the baseline memo-space results of [8] do not bound `L`.

## 6. Empirical Sanity Checks

`scripts/experiments.mjs` counts `MatchState#eval` calls (`evals`), primary passes (`passes`) and message passes (`msg`) by patching prototypes at run time. It loads the `<original-fallible-commit>` runtime from the in-repository [fixture](../../../benchmarks/fallible/fixtures/fallible-before-reuse/README.md), a frozen copy of that commit’s `packages/ohm-js` sources, and baseline `<baseline-commit>`, an ancestor of the working checkout, through `git archive` into an ignored cache; neither depends on the checkout’s HEAD. The counts are deterministic. `scripts/check_paper.mjs` re-runs the script and compares every table below cell by cell. Wall-clock time is not measured. These nine tables retain the original historical counts. Subsequent engineering results and current-source probes are discussed in Section 7.

**Observation 11 (E0).** Constructing the `!`-free HDL grammar costs 461 more evaluations on the branch than on the baseline (+7.9 %), as predicted by Proposition 10. Matching with that grammar costs exactly the baseline count, as predicted by Theorem 12.

<!-- exp:E0 -->
| phase | grammar | baseline | branch |
|---|---|---|---|
| construct | HDL (no !) | 5838 | 6299 |
| construct | HDL (with !) | - | 6295 |
| match n=1631 | HDL (no !) | 18346 | 18346 |
| match n=6631 | HDL (no !) | 75106 | 75106 |

**Observation 13 (E1).** On valid input, plain mode and recover mode have identical evaluation counts, as predicted by Corollary 14, and each is one more than the textual desugaring because of sequence flattening (Section 5.2).

<!-- exp:E1 -->
| n | desugared | plain mode | recover mode | passes |
|---|---|---|---|---|
| 1631 | 18346 | 18347 | 18347 | 1 |
| 3271 | 36946 | 36947 | 36947 | 1 |
| 6631 | 75106 | 75107 | 75107 | 1 |

**Observation 9 (E2).** For an HDL chip of 240 parts with `k` broken parts, the driver runs `P = k + 1` passes and `k` message passes, which attains Proposition 2 and agrees with Proposition 15. It reports all `k` errors. The evaluation count grows superlinearly in `k`.

<!-- exp:E2 -->
| k | passes | msg | evals | evals/base | reported |
|---|---|---|---|---|---|
| 0 | 1 | 0 | 75107 | 1.00 | 0 |
| 1 | 2 | 1 | 75174 | 1.00 | 1 |
| 2 | 3 | 2 | 75877 | 1.01 | 2 |
| 4 | 5 | 4 | 77820 | 1.04 | 4 |
| 8 | 9 | 8 | 83830 | 1.12 | 8 |
| 16 | 17 | 16 | 104439 | 1.39 | 16 |
| 32 | 33 | 32 | 179363 | 2.39 | 32 |
| 64 | 65 | 64 | 465789 | 6.20 | 64 |

**Observation 21 (E2fit).** A least-squares fit of the excess evaluations in E2, `evals(k) − evals(0) = a·k + b·k²`, is consistent with Claim 20’s conditional repeated-recovery accounting on this fixed family. It does not establish a tight traversal bound for other error placements.

<!-- exp:E2fit -->
| a | b | max rel. error (k>=8) |
|---|---|---|
| 401 | 89.1 | 2.2% |

At `k = 64`, the quadratic term accounts for about 365,000 of the 390,682 excess evaluations.

In E3–E5, the retained table heading “ratio vs d-2” denotes the ratio to the previous measured row: at `d = 2` the denominator is depth 1; from `d = 4` onward it is depth `d − 2`.

**Observation 27 (E3).** One recovery beneath a two-way backtracking nest multiplies the evaluation count by a factor approaching 4 per two levels of depth, that is, about 2 per level, as predicted by Theorem 17. A plain match of the corrected input stays linear.

<!-- exp:E3 -->
| d | valid, plain | one error, recover | passes | ratio vs d-2 |
|---|---|---|---|---|
| 1 | 70 | 179 | 2 | - |
| 2 | 102 | 305 | 2 | 1.70 |
| 4 | 166 | 877 | 2 | 2.88 |
| 6 | 230 | 2889 | 2 | 3.29 |
| 8 | 294 | 10661 | 2 | 3.69 |
| 10 | 358 | 41473 | 2 | 3.89 |

**Observation 28 (E4).** With `d` nested blocks each missing a closer, the driver runs `P = d + 1` passes, which establishes the hypothesis of Theorem 19 for `d ≤ 10`. The evaluation count grows by about 2.1 per level. Only one diagnostic is reported for `d` missing closers. All `d` recoveries are zero-width at the end of the input and carry the same message, and `distinctByPosition` merges them. This loss of diagnostics is incidental to this paper and is recorded for the engineering follow-up.

<!-- exp:E4 -->
| d | valid, recover | d missing, recover | passes | msg | reported | ratio vs d-2 |
|---|---|---|---|---|---|---|
| 1 | 74 | 150 | 2 | 1 | 1 | - |
| 2 | 105 | 335 | 3 | 2 | 1 | 2.23 |
| 4 | 167 | 1497 | 5 | 4 | 1 | 4.47 |
| 6 | 229 | 6391 | 7 | 6 | 1 | 4.27 |
| 8 | 291 | 27653 | 9 | 8 | 1 | 4.33 |
| 10 | 353 | 121011 | 11 | 10 | 1 | 4.38 |

**Observation 29 (E5).** On *valid* input with a fallible beneath `&`, recover mode runs a single pass but grows by a factor of 4 per two levels, as predicted by Theorem 18. Plain mode stays linear.

<!-- exp:E5 -->
| d | plain mode | recover mode | passes | ratio vs d-2 |
|---|---|---|---|---|
| 1 | 79 | 108 | 1 | - |
| 2 | 123 | 238 | 1 | 2.20 |
| 4 | 211 | 978 | 1 | 4.11 |
| 6 | 299 | 3878 | 1 | 3.97 |
| 8 | 387 | 15418 | 1 | 3.98 |
| 10 | 475 | 61518 | 1 | 3.99 |

**Observation 30 (E7).** On the family of Corollary 3, the driver runs exactly `k + 1` passes and reports `k` diagnostics, with `n = 4k`.

<!-- exp:E7 -->
| n | k | passes | reported |
|---|---|---|---|
| 4 | 1 | 2 | 1 |
| 16 | 4 | 5 | 4 |
| 64 | 16 | 17 | 16 |
| 256 | 64 | 65 | 64 |

**Observation 23 (E6).** On a left-recursive sum of 64 items with `k` broken items, `P = k + 1` again. The evaluation count rises from 1747 to 15200 at `k = 16`, a factor of 8.7, for 17 passes. This corroborates Proposition 22’s repeated seed-growth mechanism. Claim 20’s bounded item and message costs are not established for this seed-growth family.

<!-- exp:E6 -->
| k | passes | msg | evals | reported |
|---|---|---|---|---|
| 0 | 1 | 0 | 1747 | 0 |
| 1 | 2 | 1 | 1820 | 1 |
| 2 | 3 | 2 | 2572 | 2 |
| 4 | 5 | 4 | 4136 | 4 |
| 8 | 9 | 8 | 7504 | 8 |
| 16 | 17 | 16 | 15200 | 16 |

## 7. Optimized Recovery and the Proposed Product Bound

### 7.1 Implemented mechanisms and changed premises

This review inspects the runtime at `<corrected-source-commit>`. The relevant sources are [Recovery.js](../../../packages/ohm-js/src/Recovery.js), [RecoveryCache.js](../../../packages/ohm-js/src/RecoveryCache.js), [RecoveryEffects.js](../../../packages/ohm-js/src/RecoveryEffects.js), [RecoveryAttempts.js](../../../packages/ohm-js/src/RecoveryAttempts.js), [RecoveryAttemptReplay.js](../../../packages/ohm-js/src/RecoveryAttemptReplay.js), [RecoveryAnalysis.js](../../../packages/ohm-js/src/RecoveryAnalysis.js) and [SourcePositions.js](../../../packages/ohm-js/src/SourcePositions.js).

The driver still grants one new permission before each retry, so Theorem 1's logical-pass argument remains applicable. It now obtains failure messages from summaries accumulated during evaluation. Without tracing, it creates `P` MatchStates rather than Proposition 15's historical `2P − 1`; tracing adds a final pass. One logical pass is a new start-rule request, not necessarily a full re-evaluation of the input.

The additional recovery cache stores applications and iterations with their parsing context, including application depth, predicate/lexical flags, block depth and synchronization context. Permission reads create dependency edges. Granting a permission invalidates affected users; unchanged records can replay their results and effects. Iterations retain stable rows and restart at the earliest affected row, with lazy CST-array materialization. Pure subgrammars continue to use ordinary application memoization. Stateful initialization and custom input streams can disable the added cache, and active left-recursion growth is handled conservatively.

The native taint rule still rejects some ordinary memo entries, but that rejection no longer implies total recomputation: the additional cache can reuse the same completed work. Hence the proofs of Theorems 17–19 and Proposition 22 cannot be transferred merely by observing native taint. Similarly, Corollary 6 explicitly excludes the iteration-prefix reuse now implemented.

Immutable effect segments share recovery and attempt histories rather than copying expanded occurrences. Unique diagnostic traversal visits shared segment/context combinations; explicit `toArray()` still expands occurrences. Historical `L` counts expanded log slots, so Proposition 26's `Ω(L)` physical-space consequence does not transfer to this shared representation. Sharing alone supplies no uniform linear physical-space bound. AVL indexes replace full attempt-store scans, range mutation versions skip unchanged attempt replay, source positions are indexed once, and detached diagnostic snapshots replace retained per-permit MatchResults. Index operations, dependency walks, context-key construction, failure-summary merging and final materialization still cost work; none is assumed constant without a bound.

### 7.2 Measured improvements and their limits

The [performance report](../../../benchmarks/fallible/performance.md) archives a controlled comparison of `<original-fallible-commit>` with `<benchmark-snapshot-commit>`. On its Lex scale-100 dense input, both trees take 1,001 logical passes, while evaluations fall from 25,433,142 to 1,611,930, scans from 1,000,000 to 1,000, and MatchStates from 2,001 to 1,001. On the paper's 240-part HDL family, 240 errors improve from 438.60 ms to 18.36 ms including diagnostics; valid recovering input instead rises from 11.66 ms to 28.86 ms. The sampled Prog/blocks memory worker reports valid-input allocation of 10.79→51.96 MB and retained storage of 3.89→7.55 MB. These timings and memory samples retain their archived revision, environment and sampling limitations; they are not measurements of an arbitrary later checkout or asymptotic proofs.

Fresh operation-count experiment `adversarial` runs the three depth-10 historical families against the checked-out optimized source. At `<corrected-source-commit>`, the evaluation counts are 569, 454 and 1,213, compared with historical 41,473, 61,518 and 121,011. Logical pass counts remain 2, 1 and 11. These finite checks show that the old duplication costs have changed on these inputs; they do not prove linear depth scaling for every grammar.

<!-- current-exp:adversarial -->
| family | evals | passes | recoveries |
| --- | ---: | ---: | ---: |
| one-error-backtracking | 569 | 2 | 1 |
| valid-predicate | 454 | 1 | 0 |
| nested-missing-closers | 1213 | 11 | 1 |

Here `recoveries` is the number of reported diagnostics, not dynamic recovery events or distinct permitted keys. The nested-closer row retains the historical diagnostic collapse: ten permissions produce one diagnostic.

### 7.3 A constant-depth quadratic counterexample

Consider the proposed universal bound `O(g·n·d·r)`, where `g` is grammar complexity, `n` input length, `d` structural depth and `r` recovery count. Zero recoveries already require a baseline term such as `r+1`, and flat input requires a positive depth convention such as `max(1,d)`. Even with those repairs the bound is false for Ohm.

**Theorem 31 (quadratic suffix lookahead at constant depth).** At inspected runtime `<corrected-source-commit>`, the fixed grammar below performs `Θ(n²)` expression evaluations on input `"a"^n`, in both plain and recovering modes, with no recoveries and bounded application depth.

```ohm
G {
  s = (&tail any)* end
  tail = any*
}
```

*Proof.* At each position `i = 0,…,n`, the iteration evaluates `&tail`. Its `tail` call is at a new input position, so there is no earlier application memo entry for that call. The procedural `any*` in `tail` successfully evaluates `any` exactly `n−i` times before its terminating failure. Lookahead restores position `i`; the outer `any` consumes one character until the end. The suffix evaluations sum to `n+(n−1)+…+1 = Θ(n²)`. Other work adds only a constant number of expression evaluations per iteration or per suffix character, so the evaluation count is also `O(n²)`. There is no fallible expression or left recursion. The grammar's rule-call structure is fixed, so application depth is bounded independently of `n`; the maximum is 3 in this runtime. Recovery analysis sends these pure rules through ordinary application memoization, so recovering mode does not add suffix reuse. ∎

The live `suffixLookahead` experiment measures both modes. `plainEvals` and `recoverEvals` count `MatchState.eval` calls; `plainDepth` and `recoverDepth` are maximum application-stack lengths. Every row uses one pass and reports zero diagnostics.

<!-- current-exp:suffixLookahead -->
| n | plainEvals | recoverEvals | plainDepth | recoverDepth | passes | recoveries |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 32 | 766 | 766 | 3 | 3 | 1 | 0 |
| 64 | 2542 | 2542 | 3 | 3 | 1 | 0 |
| 128 | 9166 | 9166 | 3 | 3 | 1 | 0 |
| 256 | 34702 | 34702 | 3 | 3 | 1 | 0 |

For this family, grammar size, input nesting depth and application depth are constant, and `r = 0`. The charitable product `O(g·n·max(1,d)·(r+1))` would therefore imply `O(n)` time, contradicted by the quadratic evaluation lower bound. This counterexample concerns current Ohm, independently of the historical recovery-specific exponential families. It also explains why the textbook existence of a linear-time PEG parser does not establish linearity of every implementation strategy for that PEG.

### 7.4 What can be stated conditionally

A useful accounting is `T = T_setup + Σ_t W_t + T_driver + T_materialize`, where `W_t` charges actual fresh/repeated evaluation, scans, summary merging and reuse replay in logical pass `t`; the driver term charges index operations and dependency invalidation, and materialization includes CST arrays and diagnostics. This is an accounting identity, not a bound expressed only in grammar/input parameters. Establishing such a bound additionally requires limits on local work, instantiated rule/context counts, left-recursion growth, dependency traversal and effect handling.

If every logical pass including recovery work costs `O(g·n·d)`, and setup, interpass and final costs together fit `O(g·n·d·(p+1))`, then `p` permission grants plus the initial pass give `P = p+1` and the conditional upper bound `O(g·n·d·(p+1))`. Those premises are not established for arbitrary Ohm grammars; Theorem 31 falsifies the per-pass premise even without recovery. `p` counts permissions actually granted. Accepted recovered keys satisfy only `r ≤ p`, and reported diagnostics may be fewer still, so replacing `p` by a diagnostic count is unjustified.

For normalized packrat states with bounded local work, a baseline `O(g·n)` needs no separate depth multiplier: recursive nesting is already charged by the visited states. Context-sensitive recovery can add states and costs, but input nesting depth alone does not bound them. Reuse can also avoid revisiting earlier work across passes, so multiplying full-input work by every recovery need not be tight. Finally, a product linear in each independent variable separately is not jointly linear when those variables grow together. The implemented optimizations support improved measured scaling, not four independently proven linear bounds.


### 7.5 A practical local-recovery contract

For intended use, recovery cost should be compared with the same grammar's ordinary work. Theorem 31 is baseline parser work; it says nothing by itself about the overhead of recovery. A useful positive result is available for stable independent items.

**Proposition 32 (flat independent recovery).** At `<corrected-source-commit>`, consider a grammar with rules `s = item* end` and `item = "a" ! ";"`, and input consisting of `m` items, each either `"a;"` or `"b;"`. Let `k` be the number of bad `"b;"` items and `n = 2m`. A recovering match succeeds after `k+1` passes, makes exactly `k` recovery scans, and performs `Θ(m+k+1)` expression evaluations. Under the ordinary word-RAM model with bounded local key/summary costs and an `O(k log(k+1))` comparison sort, matching and first diagnostic collection cost `O(n+1+k log(n+1))`.

*Proof.* The first unpermitted bad item stops the iteration. Permitting that item consumes through its own semicolon and exposes the next bad item, so permits advance through the bad items in order. Each accepted row has no dependency on a later item: its guard and join are pure, fixed-width terminals, and its recovery has no nested attempts. The iteration resumes its stable prefix at the failed row. Valid rows are evaluated once; bad rows have one failed attempt and one successful recovery; each pass adds only a constant number of frontier/root evaluations. This gives the evaluation upper bound and exactly one scan per bad item. Reading the items and executing those scans give the matching lower bound. The attempt store holds only the current failed item, each grant affects a constant-size dependency chain, and each insertion/retirement updates a position-version path of height `Θ(log(n+1))`. Setup and final CST materialization cost `O(n+1)`; collecting and sorting the `k` diagnostics adds `O(k log(k+1))` under the stated bounded-key cost model, which fits the upper bound because `k ≤ m`. Literal string/bit costs beyond that model must be charged separately. ∎

The `flatIndependent` experiment uses dense errors. Counts for all 255 placements of good/bad items with `m ≤ 7` were also checked in the investigation; the measured evaluation formula is `4m+10+10k`. The table's `versionWrites` counts actual writes to the position-version map, separately from expression evaluations. It makes the logarithmic bookkeeping visible instead of treating each retry as a complete reparse.

<!-- current-exp:flatIndependent -->
| items | errors | evals | scans | versionWrites |
| ---: | ---: | ---: | ---: | ---: |
| 16 | 16 | 234 | 16 | 224 |
| 32 | 32 | 458 | 32 | 512 |
| 64 | 64 | 906 | 64 | 1152 |
| 128 | 128 | 1802 | 128 | 2560 |
| 256 | 256 | 3594 | 256 | 5632 |

The broader engineering contract is explicit: pure item bodies and boundary helpers have bounded work per consumed character; synchronization stays within stable item/block boundaries; earlier completed rows keep their permissions and stop contexts; summaries, actual-argument/key costs, binding arity and competing contexts are bounded for the fixed grammar; and affected records have bounded-width dependency paths. An ordinary pure left-recursive expression may sit inside a guarded statement, but recovery-sensitive active left recursion is outside this contract. These conditions explain why local recovery can scale well. Their satisfaction must be established for a grammar and workload; absence of a warning does not prove them.

On a fresh successful first pass, excluding fallibles reached under predicates or scans, active recovery-sensitive LR, custom mutable state and unbounded local bookkeeping keeps ordinary memoization untainted. The added cache delegates to native memo entries, performs the same body, or reuses completed work; no permission invalidation or attempt-index replay runs. Under those restrictions, extra work is `O(E+n+|G|)`, where `E` is actual baseline evaluation work, including repeated iteration work. Thus adding markers preserves a baseline-linear grammar's asymptotic class on valid input within this contract. This is a relative guarantee, not a claim that all baseline Ohm grammars are linear.

For structured recovery, let `C_G` collect constants of a fixed compiled grammar, `d ≥ 1` bound affected ancestor depth and `k` count grants. Let `Q` be weighted scan work: each candidate is charged for actual whitespace, token and join work, plus the maximum work of one stop-marker test; at most `O(C_G d)` stop markers are tested per candidate. This charges variable-width or complex helpers instead of assuming every candidate costs one unit. Additionally assume core expression evaluation outside scans and effect construction/replay, including `since` walks, together cost `O(C_G(n+kd))`; there are at most `O(C_G d)` attempt mutations per grant; each mutation invalidates at most `O(C_G d)` ancestors; and corrected diagnostic traversal inspects `O(C_G(n+kd))` segment/normalized-context states across the whole collection. Under these explicit hypotheses, the engineering accounting gives the conservative conditional operation bound

`O(C_G [n + kd + dQ + kd² + kd log(n+1) + k log(k+1)] + 1)`.

The `kd²` term is material: each retired attempt currently starts a separate dependency walk. For the nested-closer family, Theorem 33 proves a cubic invalidation lower bound even though expression counts grow quadratically. If additionally `d = O(n+1)`, `k = O(n+1)` and `Q = O(n(k+1))`, this bound fits the looser envelope `O(C_G (n+1)d(k+1))`. This recovers the practical multiplicative intuition under stated restrictions, while the tighter flat result is more informative. It does not establish a linear coefficient in arbitrary grammar source size, or make every internal mechanism independently linear.

### 7.6 Prediction helpers and proposed warnings

The following recovery-specific example motivates an authoring warning:

```ohm
G {
  s = (&tail "a;")* end
  tail = ("a" ! ";") tail -- rec
       | end              -- done
}
```

The `predicateMarker` experiment uses valid `"a;"^m`, with no grants, scans or reported diagnostics. However the fallible reached through lookahead taints ordinary memoization. The extra cache distinguishes application depths, so the same suffix reached at different depths is evaluated again. Replacing `!` with ordinary sequencing gives the `controlEvals` column, which is the same in plain and recovering modes. This isolates recovery-specific overhead from Theorem 31's baseline suffix loop.

<!-- current-exp:predicateMarker -->
| items | plainEvals | recoverEvals | controlEvals | passes | recoveries |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 16 | 194 | 1130 | 177 | 1 | 0 |
| 32 | 370 | 4034 | 337 | 1 | 0 |
| 64 | 722 | 15218 | 657 | 1 | 0 |
| 128 | 1426 | 59090 | 1297 | 1 | 0 |

A proposed advisory should follow rule calls and actual parameters to identify fallibles reachable from `&`, `~`, joins and `recoveryToken`/`recoveryStop` helpers, because these run with recovery suspended. Recursive prediction deserves particular attention. A marker whose join is pure lookahead, such as `Stmt* ! &"}"`, is not itself a fallible inside a predicate. Prefer recovery-free prediction/synchronization helpers and markers around complete items. These warnings are proposed tooling, not an implemented lint or a certificate of the whole overhead contract. [Authoring guidance](../../patterns-and-pitfalls.md#recovery-points-and-prediction) records the distinction.

### 7.7 Corrected nested diagnostic traversal

The investigation also found a genuine implementation defect in ordinary missing-closer recovery, using the existing `Block = "{" Stmt* ! "}"` family on `"{"^d · "x;"`. Earlier histories were retained both directly and beneath fresh closure filters. Deduplication by segment plus the full sequence of filter identities preserved both paths; predicates were checked only at leaves. This allowed a logical recurrence with two visits to each earlier history under distinct contexts, despite compact physical storage. Missing nested closers are an intended recovery case, so this issue required an implementation correction.

Fix `<diagnostic-fix-commit>`, present in inspected runtime `<corrected-source-commit>`, replaces that production closure filter with `filterAfter(position)`. Valid intervals satisfy `startIdx ≤ endIdx`, so the old predicate is exactly `endIdx > position`. Nested thresholds compose by maximum. Each effect segment stores a maximum interval end, allowing a whole rejected history to be pruned before descent. The missing-closer histories all end at EOF and are rejected at the EOF threshold; their filtered histories become empty immediately. Ordering, distinct retained regions and diagnostic deduplication remain part of the correction's semantic contract.

The `nestedDiagnostics` experiment compares the corrected runtime with a **legacy-policy control**: only `RecoveryEffects.filterAfter` is temporarily replaced by the former closure-filter expression, on the same corrected runtime. It is not a rerun of a historical checkout. All prototype patches are restored in `finally`. `diagnosticMapReads` counts `Map.get` calls only during the first `getRecoveredFailures()`, after CST arrays are materialized; it does not count all diagnostic work. `effectNodes` counts unique effect nodes reachable from the final CST, including the shared empty node. Matching evaluations and reported diagnostics agree between policies.

<!-- current-exp:nestedDiagnostics -->
| depth | evals | legacyMapReads | diagnosticMapReads | legacyEffectNodes | effectNodes | recoveries |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 4 | 319 | 33 | 0 | 13 | 1 | 1 |
| 8 | 851 | 741 | 0 | 57 | 1 | 1 |
| 12 | 1639 | 12249 | 0 | 133 | 1 | 1 |
| 16 | 2683 | 196557 | 0 | 241 | 1 | 1 |

The former-policy counts fit `3(2^d-d-1)` Map reads while the retained graph has `d²-d+1` nodes on these inputs; the independently inspected shared-history/filter-context recurrence explains the explosive visits. The corrected zero count means these nested effect histories are pruned, not that diagnostics cost nothing: the CST is still walked and diagnostics are still deduplicated/sorted.

Production recovery histories now use normalized thresholds instead of closure-identity sequences. For one traversal with no generic filters or depth shifts, an effective threshold is either absent or an input offset, so there are at most `n+2` threshold values per physical segment. This removes the former exponential filter-path multiplicity. It does not prove global `O(V)` collection work for `V` physical segments: different failure nodes start separate traversals, and surviving thresholds can differ. The structured bound in Section 7.5 therefore states its whole-collection context bound explicitly. The completed fix and remaining advisory work are recorded in the developer task list.


### 7.8 Refuting a quadratic total-work envelope

The local bound does not extend to the proposed general `O(n²+k log(n+1))` total bound. The corrected implementation still invalidates overlapping dependency paths separately for each retired attempt. Ordinary nested missing closers expose that repeated driver work without predicates or left recursion.

**Theorem 33 (cubic dependency-invalidation lower bound).** At corrected runtime `<corrected-source-commit>`, the fixed grammar

```ohm
G {
  S = Stmt*
  Block = "{" Stmt* ! "}"
  Stmt = Block | Simple
  Simple = "x" ";"
}
```

on input `"{"^d · "x;"`, for `d ≥ 1`, succeeds with `k=d` recovery permission grants and incurs `Ω(d³)=Ω(n³)` dependency-record visits inside `RecoveryCache.invalidate`, where `n=d+2`. Consequently total matching-plus-diagnostics work is not `O(n²+k log(n+1))` under the unit-cost record-operation model.

*Proof.* Number blocks by depth `j=1,…,d`, outermost first. Their fallible starts are positions `j`, while their enclosing block applications start at `j−1`. Before repairing depth `m`, the inner blocks `m+1,…,d` are permitted and insert their missing closers at EOF; the outer blocks `1,…,m` have unpermitted failed attempts with intervals `[j,n]`. Their stored farthest-failure positions are all `n`, so greatest-start selection chooses `m`. An outer block's own join need not be tested at EOF: its failed child may stop its iteration earlier, but the child's farthest failure still propagates into the enclosing attempt.

This invariant holds initially because `Simple` consumes `"x;"`, the deepest closer fails at EOF, and that failure propagates while the outer attempts unwind. Permitting `m` repairs that block: its opener supplies the required progress (`m > m−1`). The next pass therefore exposes depth `m−1`. The outer bodies were invalidated and rebuild their failed attempts; repaired inner blocks cannot introduce another unpermitted inner key. Induction gives the stated invariant, exactly `d` grants, and acceptance on the following pass.

For every failed key `j`, permission reads register its current block record, and dependencies retain an ancestor path through `Stmt`, an iteration-row watcher and the enclosing iteration at every level to the root `S`. This is a path of length `Ω(j)`. The paths are established during that pass's evaluation. At stage `m`, every interval `[j,n]`, `j ≤ m`, contains the chosen start `m`; `invalidateAt(m)` consequently retires all `m` attempts. `RecoveryContext.permit` calls `cache.invalidate` separately for each retired key and again for the chosen key. Each call creates a fresh `seen` set and follows `node.users` even when a previous call already made the node dirty. It neither detaches dependency edges nor removes permission-user records. Detachment happens on later re-evaluation, after this retirement loop.

Thus each stage revisits at least `Ω(Σ_(j=1)^m j)=Ω(m²)` records. Summing over `m=d,d−1,…,1` gives `Ω(d³)` visits without counting any diagnostic work. Index operations, scans and corrected diagnostics can only add work. Since `n=d+2` and `k=d`, the proposed expression is `Θ(d²)`, contradicting this lower bound. The single deduplicated output diagnostic does not affect the grant count or the argument. ∎

The `nestedInvalidation` experiment counts **actual** `node.users` Set iterations during invalidation, excluding the initial permission-user root Set. Each visited record executes that loop once. The counter does not simulate a second graph walk; all prototype instrumentation is restored in `finally`. First diagnostic collection is included in the operation but cannot contribute to this driver-only counter.

<!-- current-exp:nestedInvalidation -->
| depth | n | k | evals | dependencyNodes |
| ---: | ---: | ---: | ---: | ---: |
| 8 | 10 | 8 | 851 | 668 |
| 16 | 18 | 16 | 2683 | 3960 |
| 32 | 34 | 32 | 9419 | 26608 |
| 64 | 66 | 64 | 35179 | 193504 |

At these depths the record counts equal `d(4d²+27d+29)/6`: each retired depth-`j` chain has `4j+1` records, and the chosen chain is invalidated once more. The lower-bound proof needs only the retained `Ω(j)` paths, not an exact-count fit. This is a refutation of the quadratic candidate, not a tight general upper bound for every Ohm grammar. Batching the union of invalidation roots with one visited set per grant is recorded as planned work; it has not been implemented or assumed by this analysis.


### 7.9 Depth, recovery count and local scan distance

The qualitative anchor is **recovery rounds × retired pending attempts × upward dependency work per attempt**. More precisely, let `n` be input code-unit length and `k` the number of permission grants. For grant `t`, let `A_t` count retired attempts and `H_(t,a)` count reachable dependency records in invalidation call `a`. The current driver performs the exact record-visit count

`D = Σ_(t=1)^k Σ_(a=1)^(A_t+1) H_(t,a)`.

The extra call is the chosen key's final invalidation. Graph-walk time also charges traversed user edges and construction of the root lists. Input block depth `d` can describe these paths in a simple grammar, but arbitrary grammars need not have frontier width or user-graph reachability proportional to input depth. This accounting neither requires a full-input traversal per grant nor establishes a cubic ceiling for every Ohm grammar.

**Proposition 34 (closed blocks with independently variable depth and errors).** At `<corrected-source-commit>`, use the fixed grammar

```ohm
G {
  S = Stmt*
  Block = "{" Stmt* ! "}"
  Stmt = Block | Item
  Item = "a" ! ";"
}
```

and input `"{"^d · u · "}"^d`, where `u` contains `m` two-code-unit items, each `"a;"` or `"b;"`, with exactly `k` bad items. Here `d≥0`, `0≤k≤m` and `n=2d+2m`; all delimiters are present. Matching grants exactly `k` permissions and visits exactly `k(2d²+11d+10)` dependency records during invalidation. For positive `k`, this component is `Θ(k(d+1)²)`.

*Proof.* Before a grant, the accepted item prefix ends at the next bad Item's start `p`. That Item and its `d` enclosing Blocks have pending intervals containing `p`: the Item fails at `p`, and its farthest failure propagates through the enclosing attempts. The Item starts after the outer Block fallibles. If it ties the innermost Block's fallible start, its greater application depth wins the tie. Speculative fallback Item attempts at opening braces have earlier farthest failures and are not retired. Thus the chosen key is the bad Item, and the retired frontier consists of exactly that Item and the `d` enclosing Blocks.

The permitted scan consumes that Item through its own immediately following semicolon. Previously completed rows are retained. The next pass exposes the next bad Item and rebuilds the failed enclosing Block attempts; after the last grant the remaining items and closing braces match. This proves `k` grants and the same frontier shape at each one.

As in Theorem 33, a Block at depth `j` has a `4j+1`-record user chain, while the chosen leaf Item has `4d+5` records. The links remain throughout the grant. Each Block chain is walked once; the Item chain is walked once during retirement and once again as the chosen key. Each grant therefore visits `Σ_(j=1)^d(4j+1)+2(4d+5)=2d²+11d+10` records. Multiplying by `k` proves the count. ∎

The `closedDepthErrors` table fixes `m=32` and varies depth and errors separately. The probe additionally checks all 24 cells at depths `0,1,4,8,16,32` and error counts `0,1,4,16` against the proposition.

<!-- current-exp:closedDepthErrors -->
| depth | n | k | evals | dependencyNodes |
| ---: | ---: | ---: | ---: | ---: |
| 4 | 72 | 1 | 915 | 86 |
| 4 | 72 | 16 | 2190 | 1376 |
| 8 | 80 | 1 | 1115 | 226 |
| 8 | 80 | 16 | 3350 | 3616 |
| 16 | 96 | 1 | 1515 | 698 |
| 16 | 96 | 16 | 5670 | 11168 |
| 32 | 128 | 1 | 2315 | 2410 |
| 32 | 128 | 16 | 10310 | 38560 |

These regimes have different meanings. At fixed depth, invalidation is linear in bad-item count. At fixed positive bad-item count, it is quadratic in depth. Choosing `m=k=d` gives `n=4d` and `Θ(n³)` record visits in an ordinary file with every closer present. Adding correct sibling items at fixed depth and error count does not increase this invalidation component; it still adds recognition work.

The path argument also applies to a balanced forest of this same grammar. If bad Item `i` has `h_i` enclosing Blocks when its grant is selected, then

`D_forest = Σ_(i=1)^k (2h_i²+11h_i+10)`.

Earlier siblings have only earlier failure positions; the current bad Item and precisely its enclosing Blocks provide the retired frontier. This refines global maximum depth into error-local depth. The `errorDepthLocality` control compares equal-length inputs with the same maximum depth and eight bad Items. In `deepNodes`, one good Item and all eight bad Items are inside the nested Blocks. In `topLevelNodes`, only the good Item is nested and the eight bad Items follow at top level. Both have `n=2d+18`; unrelated deep valid structure does not lengthen those top-level recovery paths.

<!-- current-exp:errorDepthLocality -->
| depth | n | k | deepNodes | topLevelNodes |
| ---: | ---: | ---: | ---: | ---: |
| 8 | 34 | 8 | 1808 | 80 |
| 16 | 50 | 8 | 5584 | 80 |
| 32 | 82 | 8 | 19280 | 80 |
| 64 | 146 | 8 | 71248 | 80 |

Supplementary controls are emitted in `_meta.dimensionalControls`. Mixed error depths `0,1,4,8,16` give 1,043 record visits, matching the sum above. At depth 8 with eight errors, padding from 16 to 1,024 items keeps invalidation at 1,808 visits while expression work increases. At depth 8 with 64 items and 16 errors, placing the errors at the start, spread out or at the end gives the same invalidation count. For the missing-closer grammar of Theorem 33, supplying `d−k` inner closers leaves only `k` outer blocks pending: its invalidation count becomes `k(4k²+27k+29)/6`, independent of additional valid inner depth. These statements concern this driver component, not total parsing cost.

Scan distance is a separate dimension. For the closed-block grammar, input `"{"^d · "b"^L · ";" · "}"^d`, with `L ≥ 1`, has one bad Item and one grant. Invalidation remains `2d²+11d+10` as `L` varies. Without a custom token rule, each skipped code unit tests the Item's join and the enclosing block boundaries; scanning therefore has `Θ((d+1)L)` expression evaluations. The `scanDistance` table counts `MatchState.eval` calls only while inside `Fallible.scan`, with all instrumentation restored in `finally`.

<!-- current-exp:scanDistance -->
| depth | span | n | k | scanEvals | dependencyNodes |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 4 | 8 | 17 | 1 | 115 | 86 |
| 4 | 128 | 137 | 1 | 1795 | 86 |
| 16 | 8 | 41 | 1 | 307 | 698 |
| 16 | 128 | 161 | 1 | 4867 | 698 |

The displayed scan counts agree with `(2d+6)L+3`; the loop's repeated stop tests explain the product-shaped growth. Complex or variable-width helpers still need the weighted scan charges of Section 7.5. For these atomic closed-block families, the two recovery components have shapes `Σ_i(h_i+1)L_i` for scanning and `Σ_i(h_i+1)²` for repeated invalidation, in addition to baseline recognition. Indexes, summaries, effect replay and final diagnostics remain separate work. This makes the depth/error/length interaction concrete without multiplying the entire input into every recovery automatically. For this closed-chain grammar, all retired Block paths are contained in the chosen Item's `4h_i+5`-record ancestor chain. A shared visited set across the roots of one grant would therefore target `Σ_i(4h_i+5)` record visits for this component instead of the repeated-path sum. For the partial-closer family, the corresponding union-path sum is `2k²+3k`. These are analyses of the proposed batching target, not implemented performance results or whole-parser bounds; scans and the other charges remain.

## 8. Threats to Validity

- **Model fidelity.** Theorems 12 and 17–19 and Propositions 10, 15, 16 and 22–26 are proved against a model of the code obtained by inspection, not against a mechanized semantics. A misreading of the code would invalidate a proof without being detected. Observations 9–30 give independent evidence that the model matches the code on the measured families. That evidence is not a proof for other grammars. Propositions 32 and 34, Theorem 33 and the structured-use accounting likewise depend on inspection of `<corrected-source-commit>` and their explicit cost-model hypotheses; the new probes are not mechanized proofs.
- **Cost unit.** The evaluation count ignores per-call constant factors, including the branch tests added in Section 5.2. It also ignores the non-`eval` work listed at the start of Section 5: key strings, `substituteParams`, memo invalidation, the attempt store, and garbage collection. Theorem 12 shows that the *number* of evaluations is unchanged without recovery; it does not show that wall-clock time is unchanged. Section 7.2 reports archived wall-clock evidence separately from operation counts.
- **Typical case.** Claims 8 and 20 require ideal-reuse or uniform-cost assumptions beyond the absence of a backtracking choice or predicate above recovery. Error placement determines actual traversed prefixes; short spines do not bound message or driver costs. These conditional arguments are not evidence that practical grammars avoid exponential cost. Many expression grammars contain alternatives with a shared prefix, such as a call and a parenthesized expression. Such prefixes can support repeated evaluation after recovery; Theorem 17 supplies a specific recursively nested family with exponential duplication. No survey of real grammars was made.
- **Experiment scale.** The historical and current operation-count families are small, `n ≤ 6631` with constructed input nesting at most 64; the suffix counterexample has maximum application-stack depth 3. Ratios such as 3.89 and 4.38 are finite-size estimates of asymptotic growth constants.
- **Citations.** Bibliographic records and abstracts were checked, with targeted author/preprint body checks for labeled reporting ([5], Section 4), recovery expressions and earlier restart/context recovery ([6], Sections 2.2 and 5), seed growth ([11], Section 3 and Figures 3–9), and examined intervals/invalidation ([14], Sections 3.1.3 and 3.3). These selected body checks are not an exhaustive literature review or independent verification of every bibliographic field. Other source claims retain their abstract/metadata evidence limits; no novelty or diagnostic-guarantee comparison follows from unread bodies.
- **Unproven design goal.** The diagnostic-equality property that motivates the multi-pass design is not proven here. Observation 28 shows that the number of reported diagnostics can be smaller than the number of recoveries.
- **Moving target.** The implementation is unreleased. Sections 3–6 analyze the in-repository fixture of `<original-fallible-commit>`. Section 7 inspects `<corrected-source-commit>`; its current-source probes intentionally execute the checkout, so later runtime changes may change their counts. The checker verifies that the experiment metadata matches the fixture’s recorded source commit `<original-fallible-commit>` and content fingerprint, independently of the checkout’s HEAD.

## 9. Related Work

Packrat parsing [1] and PEGs [2] establish the linear-time baseline that Sections 4 and 5 measure against. Rats! obtains linear time through memoization in an imperative setting [9]. Cut operators [8] and sliding-window memoization [10] reduce memo space. The historical taint rule moves in the same direction as these, toward a smaller memo table, but for soundness rather than for space, and the time cost of Theorems 17–19 is the price in that implementation. Left-recursive packrat parsing [11], [12] already gives up strict linearity for some grammars; Proposition 22 shows how recovery interacts with seed growth. Labeled failures [5] extend error reporting with labels and catch sets; [6]–[7] add recovery expressions that resume parsing within a pass. Such a strategy avoids this driver’s repeated-primary-pass factor, but the cited results checked here do not establish this paper’s particular diagnostic-equality goal. No incompatibility with that goal follows from one-pass operation. Repeated parsing is also an existing PEG recovery technique: [6], Section 5, discusses Parboiled’s location/repair/resynchronization parses and Rüfenacht’s farthest-failure contextual recovery. Those designs supply relevant restart/context precedents; the one-new-permit-at-farthest-failure policy studied here is more specific. The targeted review establishes neither equivalent diagnostic guarantees nor priority for this policy. Incremental packrat parsing [14] is the mechanism that the historical driver reuses for cross-pass invalidation, and Proposition 24 shows that it cannot be used across edits in recovering mode. Repair-based recovery for LR parsers [15] addresses similar cost concerns with a time budget instead of a structural bound. The operational semantics of [13] suggests a target for mechanizing the model of Section 3.

## 10. Conclusion and Status of the Historical Remedies

For stable independent items in the corrected engine, Proposition 32 establishes linear matching evaluations and `O(n+1+k log(n+1))` matching-plus-diagnostics work under explicit fixed-grammar assumptions. The broader structured-use contract can support a conservative `O(C_G(n+1)d(k+1))` envelope when the stated scan, dependency and whole-collection context bounds hold. Recovery markers preserve a baseline-linear grammar's class on valid input under the taint-free, bounded-local-cost restrictions. These are useful intended-use statements, rather than a universal claim about arbitrary grammar source size. Theorem 33 refutes the stronger general `O(n²+k log(n+1))` total bound after the diagnostic correction. Proposition 34 strengthens the practical interpretation: ordinary closed files have `Θ(k(d+1)²)` invalidation visits, becoming cubic when both depth and malformed-item count grow with input length. The mechanism is recovery rounds times the affected pending frontier times repeated upward walks; error-local depths and scan spans are more informative than maximum depth alone. These component results do not establish a universal cubic upper bound.

The implementation reuses completed recovery work and iteration prefixes, shares effects, indexes attempts and computes failure messages without diagnostic re-matches. Fix `<diagnostic-fix-commit>` additionally removes the demonstrated exponential filter-context replay in ordinary nested missing-closer diagnostics. The legacy-policy control distinguishes that correction from a historical engine rerun. Current work counts support the source analysis; archived timings retain their measured revision and tradeoffs.

The permit policy still bounds logical passes by `r+1 ≤ P ≤ |K|+1`, where accepted keys, granted permissions and deduplicated diagnostics remain different quantities. The historical engine demonstrates that few passes can still be expensive, while the corrected engine shows that many logical retries need not reparse accepted prefixes. Recovery-bearing recursive prediction belongs in proposed grammar guidance; the independent suffix-loop example describes baseline work. Neither supplies a reason to reject the practical local-recovery contract.

The following conjectures retain their original statements for traceability. Their mechanisms now have implemented counterparts: context-sensitive caching, dependency-based reuse and iteration-prefix preservation. The observed improvements support those choices but do not prove every quantified bound below for arbitrary grammars, left-recursion growth or context/dependency structures.

**Conjecture 1.** Memoizing a tainted result within a pass, keyed additionally by the identity of the stop stack, the predicate flag `ν`, and a permit-set version, restores a per-pass bound of `O(|G|·n·s)`, where `s` is the number of distinct stop-stack contexts reached at a position. That bound would remove the exponential lower bounds of Theorems 17 and 18.

*Current status.* Context-sensitive caching is implemented, but this bound needs a bounded-local-work premise for ordinary states as well. Caching tainted results alone does not remove Theorem 31's pure-rule suffix loops; the bound as originally stated cannot be inferred for all Ohm grammars.

**Conjecture 2.** A context-valid reuse policy for recovered results whose dependence sets exclude the new permit could remove Claim 20’s repeated-recovery term. Lemma 4 does not itself prove this policy sound for recovered results, which it excludes. If it leaves item visits and their costs bounded as in Claim 20, the resulting evaluation-count upper bound would be `O(W + V) ⊆ O(W + k·m)`. A tight `Θ(k·m)` traversal term would still require the stated placement condition; message and driver costs need separate bounds before this is a total-time claim.

*Current status.* Permission-dependency invalidation and cross-pass reuse implement this mechanism. The indexed-attempt, dependency-graph and summary costs still require separate analysis, even when expression counts improve.

**Conjecture 3.** Keeping the prefix of a guarded iteration from the failed attempt, without re-evaluating it, removes the doubling in Theorem 19.

*Current status.* Iteration-prefix preservation is implemented. The depth-10 probe reduces 121,011 evaluations to 1,213; that finite result alone does not prove a bound for all depths or grammars.

## References

[1] B. Ford, "Packrat parsing: simple, powerful, lazy, linear time, functional pearl," in *Proc. 7th ACM SIGPLAN Int. Conf. Functional Programming (ICFP '02)*, 2002, pp. 36–47, doi: 10.1145/581478.581483.

[2] B. Ford, "Parsing expression grammars: a recognition-based syntactic foundation," in *Proc. 31st ACM SIGPLAN-SIGACT Symp. Principles of Programming Languages (POPL '04)*, 2004, pp. 111–122, doi: 10.1145/964001.964011.

[3] A. Warth, P. Dubroy, and T. Garnock-Jones, "Modular semantic actions," in *Proc. 12th Symp. Dynamic Languages (DLS 2016)*, 2016, pp. 108–119, doi: 10.1145/2989225.2989231.

[4] Ohm contributors, "ohm-js, branch feat/fallible-v17," source code, [source directory](../../../benchmarks/fallible/fixtures/fallible-before-reuse/packages/ohm-js/src) (in-repository fixture), files `packages/ohm-js/src/{pexprs-evalFallible,Recovery,RecoveredFailure,MatchState,Matcher,MatchResult,pexprs-eval,PosInfo,Builder,buildGrammar}.js` and `ohm-grammar.ohm` [source: inspected at commit <original-fallible-commit>]; baseline `support/v17` at commit <baseline-commit>.

[5] A. M. Maidl, F. Mascarenhas, S. Medeiros, and R. Ierusalimschy, "Error reporting in parsing expression grammars," *Sci. Comput. Program.*, vol. 132, pp. 129–140, 2016, doi: 10.1016/j.scico.2016.08.004.

[6] S. Medeiros and F. Mascarenhas, "Syntax error recovery in parsing expression grammars," in *Proc. 33rd Annu. ACM Symp. Applied Computing (SAC '18)*, 2018, pp. 1195–1202, doi: 10.1145/3167132.3167261.

[7] S. Q. de Medeiros, G. de Azevedo Alvez Junior, and F. Mascarenhas, "Automatic syntax error reporting and recovery in parsing expression grammars," *Sci. Comput. Program.*, vol. 187, Art. no. 102373, 2020, doi: 10.1016/j.scico.2019.102373.

[8] K. Mizushima, A. Maeda, and Y. Yamaguchi, "Packrat parsers can handle practical grammars in mostly constant space," in *Proc. 9th ACM SIGPLAN-SIGSOFT Workshop Program Analysis for Software Tools and Engineering (PASTE '10)*, 2010, pp. 29–36, doi: 10.1145/1806672.1806679.

[9] R. Grimm, "Better extensibility through modular syntax," in *Proc. 27th ACM SIGPLAN Conf. Programming Language Design and Implementation (PLDI '06)*, 2006, pp. 38–51, doi: 10.1145/1133981.1133987.

[10] K. Kuramitsu, "Packrat parsing with elastic sliding window," *J. Inf. Process.*, vol. 23, no. 4, pp. 505–512, 2015, doi: 10.2197/ipsjjip.23.505.

[11] A. Warth, J. R. Douglass, and T. Millstein, "Packrat parsers can support left recursion," in *Proc. 2008 ACM SIGPLAN Symp. Partial Evaluation and Semantics-Based Program Manipulation (PEPM '08)*, 2008, pp. 103–110, doi: 10.1145/1328408.1328424.

[12] S. Medeiros, F. Mascarenhas, and R. Ierusalimschy, "Left recursion in parsing expression grammars," *Sci. Comput. Program.*, vol. 96, pp. 177–190, 2014, doi: 10.1016/j.scico.2014.01.013.

[13] S. Medeiros and R. Ierusalimschy, "A parsing machine for PEGs," in *Proc. 2008 Symp. Dynamic Languages (DLS '08)*, 2008, pp. 1–12, doi: 10.1145/1408681.1408683.

[14] P. Dubroy and A. Warth, "Incremental packrat parsing," in *Proc. 10th ACM SIGPLAN Int. Conf. Software Language Engineering (SLE 2017)*, 2017, pp. 14–25, doi: 10.1145/3136014.3136022.

[15] L. Diekmann and L. Tratt, "Don't panic! Better, fewer, syntax errors for LR parsers," in *34th Eur. Conf. Object-Oriented Programming (ECOOP 2020)*, LIPIcs vol. 166, 2020, pp. 6:1–6:32, doi: 10.4230/LIPIcs.ECOOP.2020.6.
