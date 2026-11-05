# Rubric amendments

Append-only. Each entry: date (UTC), what changed, justification, and the review finding that prompted it. rubric.md is never edited; its SHA-256 is in rubric.sha256.

(none yet)

## Amendment 1 (2026-11-04, UTC, after first sight of the reviewed work)
Added to section 1 (baseline expectations) as item 13: **State is keyed by document identity.** Any cache of "last good" analysis, symbol index, or recovered tree is held per document (URI or equivalent), never per language object, and the API that produces it takes a document identity. Positions returned from a stale analysis are either mapped to the current text or withheld.
Justification: the review of the language-service design found that `analyze(text)` carries no document identity and the reference engine's last-good cache is shared across documents (reproduced: a truncated document received another document's outline and definitions), and that stale answers use the old text's offsets without mapping. The existing baseline items 6 and 7 (edits over time; stale requests) cover the stale-offset half; the cross-document half was not explicit. The findings that rely on this amendment also stand under items 6 and 7 and dimensions K4 and K6, so no score was changed because of it.

## Amendment 2 (2026-11-04, UTC)
Added to section 3 (evidence quality), under "Prototypes that cannot fail", item (f): **evidence that cannot be re-run by a reader of the reviewed repository.** A result whose generating code lives outside the reviewed repository, depends on absolute paths of the author's machine, or is described only in prose counts as tier T1 for the reader until re-run; record both the author's tier and the reader's tier.
Justification: the design's worked-example output and its 90-assertion claim come from an engine that is not in the branch under review (the plan's Decision 6 leaves its location open) and whose HDL grammar is read from an absolute scratch path. The reviewer could re-run it only because the coordinator supplied a directory. The rubric already asks the reviewer to run and re-derive; this makes the repository-reproducibility gap an explicit finding class. Scores in this review use the author's tier where I re-ran the material and the reader's tier otherwise.
