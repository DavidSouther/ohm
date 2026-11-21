# Resuming parse after a missing join

Given this fallible grammar

```ohm
Statements {
  Start = Stmt* ! end
  Stmt = ("let" name "=" digit+) ! ";"
  name = letter+
}
```

and the input `let a=1\nlet b=2;`, Ohm looks for the first semicolon at the start of `let b`. Without recovery, `B ! C` recognizes the same inputs as `B C`. The failure position is 8 (line 2, column 1), and the diagnostic position is 7 (line 1, column 8), just after the first value.

A scan for the first real semicolon would skip the second statement. The repetition lets the parser try matching a new statement at `let b`. A bounded check confirms that the second statement starts there. The parser supplies the missing join at position 7, skips the newline as implicit space, and matches the second statement from position 8.

## When a join can be inserted

In `B ! C`, `B` is the guarded expression and `C` is the join. The parser matches the guard first and tries the join if the guard succeeds. After a failed pass, it looks for Fallible attempts at the failure position, the furthest input index at which it recorded an unmet expectation. If an eligible attempt exists, the parser selects one and retries. That attempt can recover by scanning for a real join or inferring a missing one.

Insertion requires a successful guard with a nonempty terminal match retained past the start of the Fallible expression. The end of the last retained terminal is the diagnostic position for the omission. Implicit space, predicates, and terminals in discarded alternatives contribute no retained terminal. An empty or failed guard can still use ordinary scan recovery.

The join must resolve to one nonempty literal made up of Unicode punctuation or symbols. Connector punctuation such as `_` is excluded because it can be part of a name. A rule application or a parameter can resolve to an eligible literal. A sequence with multiple factors, a choice of literals, or a lexified expression is ineligible. A word join such as `"done"` can justify reporting a failure after the guard because it consumes on success. Insertion requires the narrower literal class as well as evidence of a continuation. For a join that serves only as a resynchronization marker, `B !~ C` keeps ordinary scan recovery and disables insertion.

## What can follow the join?

The parser derives candidate continuations from the expressions after the Fallible site in its rule. If that suffix starts with a repetition or an optional expression, the probe tries the operand first. One item can establish where the parser can resume before it spends the allowance on the whole suffix.

A next item may also lack its join. After trying the whole item, the probe can try a shorter candidate ending at its guard if its join qualifies for insertion. The shorter match establishes where parsing can resume. The item itself still has to parse and recover its join. On `let a=1\nlet b=2\nlet c=3;`, this lets the parser retain all three statements and report two missing semicolons.

A **frame** is the context of an enclosing Fallible expression. It records the resolved join and, for a repeated guard, the expression for the next item.

If the local suffix can match without consuming input, the probe can also check that suffix followed by the nearest frame's next item or join. With no enclosing frame it can check the suffix followed by end of input. Even a predicate that consumes nothing must succeed before this later evidence can count. With `Start = "{" Stmt* ! "}"`, the closing brace in `{let a=1 }` lets the parser insert the semicolon and leave the brace for the block. The checks use the actual rule arguments and the grammar's treatment of implicit space.

Continuation evidence is local to the rule and its enclosing frames. On `xq`, `("x" ! ";") "q"` can use the suffix `"q"` to continue. If a separate rule contains only `"x" ! ";"` and its caller matches that rule followed by `"q"`, the caller's ordinary suffix is outside the search. The inner rule can skip the `q` and insert at end of input. The caller then fails because it still expects `"q"`.

## How the scan chooses a recovery

The scan considers input positions in order after the guard. When the grammar lets it advance by whole tokens, it can pass over punctuation inside a token without mistaking it for a boundary. Otherwise it advances by one UTF-16 code unit. At each position, the scan accounts for implicit space and tries the following actions in order.

1. If the position after implicit space has reached the ordinary scan's minimum, try the real join. A match ends the scan. If it leaves the parser at the scan's starting position, the scan ends without a repair.
2. If the join qualifies for insertion, try the continuation. A successful check lets the parser supply the join and resume here.
3. If the position after implicit space has reached the same minimum, try the joins in the enclosing frames. Inside nested repetition blocks, a grammar-defined stop marker can also apply. A matching stop ends this scan without a repair, leaving the boundary available to the enclosing parse.
4. Advance and try the next position.

The ordinary scan's minimum search position reflects progress during the failed attempt, including progress from abandoned alternatives. Insertion can consider an earlier position because it starts from the guard's retained material. A real join takes priority at the same position when the scan can try it there. An earlier insertion can win before the scan reaches a later real join. In the opening example, the parser accepts the second statement as a continuation before it reaches that statement's semicolon.

## When a continuation check is inconclusive

A first-character check can eliminate a candidate before matching. The remaining candidates at one scan position share a bounded slice of input and the same allowances for parsing and input inspection. The probe tries them in order with recovery disabled. A candidate provides evidence when it matches and advances, or when it succeeds at the physical end of input.

The end of a slice can resemble the end of input. For example, `"a"* ~"b"` can appear to succeed on a slice that ends during a long run of `a` characters, with a `b` farther ahead. If a candidate examines past a truncated slice or exhausts either allowance, the check for that position is inconclusive and the scan can move on. Candidate preparation and first-character screening have separate allowances. The scan can still cover a longer span and repeat checks at many positions. When the matching state cannot be isolated for the probe, recovery can continue by scanning for a real join.

The probe may examine input beyond what the recovered expression retains. That examined span remains part of the match's evidence when a later pass of the same recovering match reuses the result.

## What the insertion records

An inserted join occupies its normal place in the parse tree and has zero width in the source. For a direct insertion, the empty join and the empty skipped interval sit at the diagnostic position, just after the last retained terminal. The parser resumes where the guard ended. That input position can be later if the guard already skipped implicit space.

When the scan passes over damaged input before finding a continuation, the skipped interval records that text and the diagnostic position still identifies the omission. On `let a=1 xyz let b=2;`, the diagnostic position is 7 and the skipped interval is `[8, 11)`, covering `xyz`. The zero-width join sits at position 11, where parsing resumes. The original source stays intact.

The insertion can retain the failed pass's expectations when the failure is at the start of the scan and the strong expectations include the missing literal. The opening example reports `";" or a digit` because the digit repetition and the join both produced expectations at that position. Otherwise the insertion reports the missing literal alone, so a failure farther along an abandoned path cannot supply expectations for this omission. If recovery ultimately fails, the result keeps the first failed pass's message and includes the repairs recorded in the final pass along with its final failure.
