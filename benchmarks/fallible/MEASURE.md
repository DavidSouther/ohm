# Comparing time and memory across checkouts

`measure.mjs` compares the speed and the retained heap of ohm-js at several
checkouts, one fresh process per sample, rotating the order of the checkouts
between samples. It loads each checkout's `packages/ohm-js/index.mjs` as it is,
so no build step is needed. Node's standard library is the only dependency.

```sh
# One worktree per revision to compare, oldest first.
git worktree add --detach /tmp/ohm-a <revision-a>
git worktree add --detach /tmp/ohm-b <revision-b>

# Median match time per case, 9 processes per checkout and case.
node benchmarks/fallible/measure.mjs time --procs=9 /tmp/ohm-a /tmp/ohm-b

# Heap retained per match result after a forced GC, and peak RSS of the process.
node benchmarks/fallible/measure.mjs memory --procs=3 /tmp/ohm-a /tmp/ohm-b
```

Each table row is a case; each column is a checkout. The last two columns divide
the last checkout's number by the first one's and by the previous one's. A case
that a checkout cannot run, such as a grammar with `B ! C` recovery points on a
checkout that predates them, is `n/a`.

The workloads in `lib/workloads.mjs` are the `Prog` family (functions with blocks
of statements) and the `Lex` family (one token per line), each in a `plain`
variant and in a `bang` variant that adds recovery points, and as valid input, one
error, or an error in every statement.

Timings depend on the machine and on what else it is running; compare columns of
one run, and repeat a run before trusting a small difference.
