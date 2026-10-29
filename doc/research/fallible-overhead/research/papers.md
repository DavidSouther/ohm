# Papers: Citation verification for a paper on the complexity of PEG error recovery

Date: 2026-10-27

## Method and access notes

- Bibliographic records: Crossref REST API (`api.crossref.org/works?query.bibliographic=...` and `/works/{doi}`), all items resolved. DOI landing resolution checked with `HEAD https://doi.org/{doi}` (HTTP 302 to publisher for every DOI listed).
- Abstracts: OpenAlex API (`api.openalex.org/works/doi:...`, abstract_inverted_index), arXiv API (`export.arxiv.org/api/query`), DataCite API (item 12).
- Unreachable or restricted: Semantic Scholar API returned HTTP 429 (rate limited) on every call; DBLP returned an anti-bot interstitial page (no data); ACM Digital Library and Elsevier/ScienceDirect returned HTTP 403 or a bare redirect page to WebFetch. Publisher pages were therefore not read. Abstracts for items 4, 5, 7 were taken from the authors' arXiv versions, which are not necessarily identical to the published abstracts.
- Quoted text below is from the OpenAlex or arXiv abstract strings returned by the APIs. No paper body text was read, so claims are limited to what the abstracts state.

## Findings

### Summary table

| # | Item | Status | DOI / URL |
|---|------|--------|-----------|
| 1 | Ford, Packrat Parsing, ICFP 2002 | VERIFIED | 10.1145/581478.581483 |
| 2 | Ford, Parsing Expression Grammars, POPL 2004 | VERIFIED | 10.1145/964001.964011 |
| 3 | Mizushima et al., PASTE 2010 | VERIFIED (abstract PARTIAL, truncated in OpenAlex) | 10.1145/1806672.1806679 |
| 4 | Medeiros et al., Left recursion in PEGs, SCP 2014 / SBLP 2012 | VERIFIED | 10.1016/j.scico.2014.01.013 ; 10.1007/978-3-642-33182-4_4 ; arXiv:1207.0443 |
| 5 | Maidl et al., Error reporting in PEGs, SCP 2016 | VERIFIED | 10.1016/j.scico.2016.08.004 ; arXiv:1405.6646 |
| 6 | Medeiros and Mascarenhas, Syntax error recovery in PEGs, SAC 2018 | VERIFIED | 10.1145/3167132.3167261 ; arXiv:1806.11150 |
| 7 | Medeiros et al., Automatic syntax error reporting and recovery in PEGs, SCP 2020 | VERIFIED | 10.1016/j.scico.2019.102373 ; arXiv:1905.02145 |
| 8 | Warth et al., Packrat parsers can support left recursion, PEPM 2008 | VERIFIED | 10.1145/1328408.1328424 |
| 9 | Dubroy and Warth, Incremental packrat parsing, SLE 2017 | VERIFIED | 10.1145/3136014.3136022 |
| 10 | Warth, Dubroy, Garnock-Jones, Modular semantic actions, DLS 2016 (Ohm) | VERIFIED | 10.1145/2989225.2989231 |
| 11 | Medeiros et al., From regexes to PEGs, SCP 2014 | VERIFIED (metadata only; no abstract) | 10.1016/j.scico.2012.11.006 |
| 12 | Diekmann and Tratt, Don't Panic!, ECOOP 2020 | VERIFIED | 10.4230/LIPIcs.ECOOP.2020.6 ; arXiv:1804.07133 |
| 13 | Grimm, Better extensibility through modular syntax, PLDI 2006 | VERIFIED | 10.1145/1133981.1133987 |
| 14 | Kuramitsu, Packrat Parsing with Elastic Sliding Window, JIP 2015 | VERIFIED | 10.2197/ipsjjip.23.505 |
| 15 | Medeiros and Ierusalimschy, A parsing machine for PEGs, DLS 2008 | VERIFIED | 10.1145/1408681.1408683 |

Corrections to the request: item 12 authors are Lukas Diekmann and Laurence Tratt (Tratt is second author); item 7 first-listed author is "Sérgio Queiroz de Medeiros" per Crossref and arXiv. Crossref titles the Ford 2002 paper "Packrat parsing: simple, powerful, lazy, linear time, functional pearl" (the ACM subtitle includes "functional pearl").

### Content statements by item

**1. Ford 2002.** Abstract (OpenAlex): "A packrat parser provides the power and flexibility of top-down parsing with backtracking and unlimited lookahead, but nevertheless guarantees linear parse time." Also: "converting a backtracking recursive descent parser into a linear-time packrat parser often involves only a fairly straightforward structural change." The abstract does not mention memoization space explicitly; the memoization mechanism is described in the body, which was not read.

**2. Ford 2004.** Abstract (OpenAlex): "A linear-time parser can be built for any PEG, avoiding both the complexity and fickleness of LR parsers and the inefficiency of generalized CFG parsing." Also: "Where CFGs express nondeterministic choice between alternatives, PEGs instead use prioritized choice." And: PEGs "are reducible to two minimal recognition schemas developed around 1970, TS/TDPL and gTS/GTDPL, which are here proven equivalent in effective recognition power."

**3. Mizushima, Maeda, Yamaguchi 2010.** Abstract (OpenAlex, truncated after the third sentence): "packrat parsers require O(n) space for memoization, where n is the length of the input." And: "we had proposed a packrat parser generator that accepts grammars extended with cut operators, which enable the generated parsers to reduce the amount of storage required." The remainder of the abstract (the "mostly constant space" result) could not be retrieved because ACM returned HTTP 403 and Semantic Scholar was rate limited. The title itself states the constant-space claim.

**4. Medeiros, Mascarenhas, Ierusalimschy, left recursion.** arXiv:1207.0443v3 abstract: "PEGs ... describe all deterministic context-free languages through a set of rules that specify a top-down parser"; "We present a simple conservative extension to the semantics of PEGs that gives useful meaning to direct and indirect left-recursive rules"; and "We prove the conservativeness of these extensions." The arXiv comment states it is the extended version of the SBLP 2012 paper (Crossref: LNCS, 2012, pp. 27-41, DOI 10.1007/978-3-642-33182-4_4).

**5. Maidl, Mascarenhas, Medeiros, Ierusalimschy, error reporting.** arXiv:1405.6646v3 abstract: "we show how to simulate an error-reporting heuristic through these semantic actions. We also propose a complementary error reporting strategy ... labeled failures. This approach is inspired by exception handling of programming languages, and lets a PEG define different kinds of failure, with each ordered choice operator specifying which kinds it catches." Related earlier paper (Crossref): Maidl, Mascarenhas, Ierusalimschy, "Exception Handling for Error Reporting in Parsing Expression Grammars," SBLP 2013, LNCS, pp. 1-15, DOI 10.1007/978-3-642-40922-6_1.

**6. Medeiros and Mascarenhas, SAC 2018.** arXiv:1806.11150 abstract: "As PEGs do not provide a good error recovery mechanism, PEG-based parsers usually do not recover from syntax errors in the input, or recover from syntax errors using ad-hoc, implementation-specific features." And: "We propose a conservative extension, based on PEGs with labeled failures ... This extension associates recovery expressions to labels, where a label now not only reports a syntax error but also uses this recovery expression to reach a synchronization point in the input and resume parsing." The abstract gives an operational semantics and a Lua parser evaluation; it makes no complexity claim.

**7. Medeiros, de Azevedo Alvez Junior, Mascarenhas, SCP 2020.** arXiv:1905.02145v2 abstract: "Labeled failures are a conservative extension of PEGs that adds an error reporting mechanism for PEG parsers, and these labels can also be associated with recovery expressions to provide an error recovery mechanism. These expressions can use the full expressivity of PEGs to recover from syntactic errors." Two automatic annotation approaches, Standard and Unique, are evaluated on Titan, C, Pascal and Java; Unique's acceptable recovery rate "ranged from 41% to 76%." No time-complexity statement appears in the abstract.

**8. Warth, Douglass, Millstein, PEPM 2008.** Abstract (OpenAlex): "Packrat parsing offers several advantages ... such as the guarantee of linear parse times while supporting backtracking and unlimited look-ahead." And: "This paper presents a modification to the memoization mechanism used by packrat parser implementations that makes it possible for them to support (even indirectly or mutually) left-recursive rules. While it is possible for a packrat parser with our modification to yield super-linear parse times for some left-recursive grammars, our experiments show that this is not the case for typical uses of left recursion."

**9. Dubroy and Warth, SLE 2017.** Abstract (OpenAlex): "Packrat parsing is a popular technique for implementing top-down, unlimited-lookahead parsers that operate in guaranteed linear time." And: "we describe a method for turning a standard packrat parser into an incremental parser through a simple modification to its memoization strategy ... the parser can perform syntax analysis without completely reparsing the input after each edit operation." Also: "an incremental packrat parser for JavaScript can outperform even a hand-optimized, non-incremental parser."

**10. Warth, Dubroy, Garnock-Jones, DLS 2016.** Abstract (OpenAlex): "We introduce Ohm, a parser generator in which both grammars and their interpretations can be extended in safe and modular ways. Unlike many similar tools, Ohm completely separates grammars and semantic actions." This is the citable Ohm paper. The Dubroy and Warth incremental-parsing paper (item 9) is by two of the same authors, but its abstract does not name Ohm.

**11. Medeiros, Mascarenhas, Ierusalimschy, From regexes to PEGs.** Metadata verified in Crossref (Sci. Comput. Program., vol. 93, pp. 3-18, Nov. 2014); no abstract retrieved. Only the bibliographic record is supported.

**12. Diekmann and Tratt, ECOOP 2020.** arXiv:1804.07133v4 abstract: "More advanced error recovery techniques suffer less from this problem but have seen little practical use because their typical performance was seen as poor, their worst case unbounded, and the repairs they reported arbitrary." And: "on a corpus of 200,000 real-world syntactically invalid Java programs, CPCT+ is able to repair 98.37% of files within a timeout of 0.5s." Answer to the question posed: the abstract discusses recovery cost directly (performance, unbounded worst case, a 0.5 s timeout), but it does not state a formal time bound; the body was not read, so the existence of a complexity analysis is unconfirmed. DataCite lists the paper as LIPIcs vol. 166, article 6, pp. 6:1-6:32. The artifact has its own DOI 10.4230/DARTS.6.2.17.

**13. Grimm, PLDI 2006 (Rats!).** Abstract (OpenAlex): "PEGs are implemented by so-called packrat parsers, which are recursive descent parsers that memoize all intermediate results (hence their name). Memoization ensures linear-time performance in the presence of unlimited lookahead, but also results in an essentially lazy, functional parsing technique." And: the paper shows "how make packrat parsing more widely applicable by implementing this lazy, functional technique in a strict, imperative language, while also generating better performing parsers through aggressive optimizations." The abstract does not specifically address memoization space; the body was not read.

**14. Kuramitsu, JIP 2015.** Abstract (OpenAlex): "An arising problem is extremely huge heap consumption in memoization, resulting in the fact that the cost of memoization is likely to outweigh its benefits. In many cases, developers need to make a difficult choice to abandon packrat parsing despite the possible exponential time parsing." And: "The heap consumption is upper-bounded since memorized results are stored on a sliding window buffer." This supports both the claim that PEG parsing without memoization can take exponential time in the worst case and the claim that full memoization has heavy space cost. Open-access PDF per OpenAlex: https://www.jstage.jst.go.jp/article/ipsjjip/23/4/23_505/_pdf (not fetched).

**15. Medeiros and Ierusalimschy, DLS 2008.** Abstract (OpenAlex): "Generally, the implementation of PEGs is based on a recursive-descent parser, or uses a memoization algorithm. We present a new approach for implementing PEGs, based on a virtual parsing machine, which is more suitable for pattern matching." The authors give an operational semantics and a correctness proof of the PEG-to-machine transformation.

## Sources

[1] B. Ford, "Packrat parsing: simple, powerful, lazy, linear time, functional pearl," in *Proc. 7th ACM SIGPLAN Int. Conf. Functional Programming (ICFP '02)*, Pittsburgh, PA, USA, Oct. 2002, pp. 36-47. doi: 10.1145/581478.581483. [Online]. Available: https://doi.org/10.1145/581478.581483. Verified: Crossref `/works?query.bibliographic` and `/works/{doi}`; abstract from OpenAlex W1971135355. Also published as *ACM SIGPLAN Notices*, vol. 37, no. 9, 2002, doi: 10.1145/583852.581483. VERIFIED. (Crossref date 2002-09-17; ICFP 2002 was held in October 2002; the month in the IEEE entry is not Crossref-verified, so use "2002" only if exact month is uncertain.)

[2] B. Ford, "Parsing expression grammars: a recognition-based syntactic foundation," in *Proc. 31st ACM SIGPLAN-SIGACT Symp. Principles of Programming Languages (POPL '04)*, Venice, Italy, Jan. 2004, pp. 111-122. doi: 10.1145/964001.964011. [Online]. Available: https://doi.org/10.1145/964001.964011. Verified: Crossref; abstract from OpenAlex W2018045485. Also *ACM SIGPLAN Notices*, doi: 10.1145/982962.964011. VERIFIED. (Crossref issued date 2004-01; the Venice location is not returned by Crossref and is not API-verified.)

[3] K. Mizushima, A. Maeda, and Y. Yamaguchi, "Packrat parsers can handle practical grammars in mostly constant space," in *Proc. 9th ACM SIGPLAN-SIGSOFT Workshop Program Analysis for Software Tools and Engineering (PASTE '10)*, 2010, pp. 29-36. doi: 10.1145/1806672.1806679. [Online]. Available: https://doi.org/10.1145/1806672.1806679. Verified: Crossref (issued 2010-05-06); partial abstract from OpenAlex W2159233442. VERIFIED (abstract truncated).

[4] S. Medeiros, F. Mascarenhas, and R. Ierusalimschy, "Left recursion in parsing expression grammars," *Sci. Comput. Program.*, vol. 96, pp. 177-190, Dec. 2014. doi: 10.1016/j.scico.2014.01.013. [Online]. Available: https://doi.org/10.1016/j.scico.2014.01.013. Verified: Crossref (volume 96, pages 177-190, issued 2014-12); abstract from arXiv:1207.0443v3 (https://arxiv.org/abs/1207.0443). Conference version: same authors, "Left recursion in parsing expression grammars," in *Programming Languages (SBLP 2012)*, LNCS, 2012, pp. 27-41, doi: 10.1007/978-3-642-33182-4_4. VERIFIED.

[5] A. M. Maidl, F. Mascarenhas, S. Medeiros, and R. Ierusalimschy, "Error reporting in parsing expression grammars," *Sci. Comput. Program.*, vol. 132, pp. 129-140, Dec. 2016. doi: 10.1016/j.scico.2016.08.004. [Online]. Available: https://doi.org/10.1016/j.scico.2016.08.004. Verified: Crossref (volume 132, pages 129-140, issued 2016-12); abstract from arXiv:1405.6646v3 (https://arxiv.org/abs/1405.6646). VERIFIED.

[6] S. Medeiros and F. Mascarenhas, "Syntax error recovery in parsing expression grammars," in *Proc. 33rd Annu. ACM Symp. Applied Computing (SAC '18)*, 2018, pp. 1195-1202. doi: 10.1145/3167132.3167261. [Online]. Available: https://doi.org/10.1145/3167132.3167261. Verified: Crossref (issued 2018-04-09); abstract from arXiv:1806.11150 (https://arxiv.org/abs/1806.11150, whose metadata also lists this DOI). A related SBLP 2018 paper exists: S. de Medeiros and F. Mascarenhas, "Towards automatic error recovery in parsing expression grammars," doi: 10.1145/3264637.3264638 (Crossref). VERIFIED.

[7] S. Q. de Medeiros, G. de Azevedo Alvez Junior, and F. Mascarenhas, "Automatic syntax error reporting and recovery in parsing expression grammars," *Sci. Comput. Program.*, vol. 187, Art. no. 102373, Feb. 2020. doi: 10.1016/j.scico.2019.102373. [Online]. Available: https://doi.org/10.1016/j.scico.2019.102373. Verified: Crossref (volume 187, article 102373, issued 2020-02; author name form "Sérgio Queiroz de Medeiros"); abstract from arXiv:1905.02145v2 (https://arxiv.org/abs/1905.02145). VERIFIED.

[8] A. Warth, J. R. Douglass, and T. Millstein, "Packrat parsers can support left recursion," in *Proc. 2008 ACM SIGPLAN Symp. Partial Evaluation and Semantics-Based Program Manipulation (PEPM '08)*, 2008, pp. 103-110. doi: 10.1145/1328408.1328424. [Online]. Available: https://doi.org/10.1145/1328408.1328424. Verified: Crossref (issued 2008-01-07); abstract from OpenAlex W2006898115. VERIFIED.

[9] P. Dubroy and A. Warth, "Incremental packrat parsing," in *Proc. 10th ACM SIGPLAN Int. Conf. Software Language Engineering (SLE 2017)*, Oct. 2017, pp. 14-25. doi: 10.1145/3136014.3136022. [Online]. Available: https://doi.org/10.1145/3136014.3136022. Verified: Crossref (issued 2017-10-23); abstract from OpenAlex W2766768151. VERIFIED.

[10] A. Warth, P. Dubroy, and T. Garnock-Jones, "Modular semantic actions," in *Proc. 12th Symp. Dynamic Languages (DLS 2016)*, Nov. 2016, pp. 108-119. doi: 10.1145/2989225.2989231. [Online]. Available: https://doi.org/10.1145/2989225.2989231. Verified: Crossref (issued 2016-11); abstract from OpenAlex W2539365466. Also *ACM SIGPLAN Notices*, doi: 10.1145/3093334.2989231. VERIFIED.

[11] S. Medeiros, F. Mascarenhas, and R. Ierusalimschy, "From regexes to parsing expression grammars," *Sci. Comput. Program.*, vol. 93, pp. 3-18, Nov. 2014. doi: 10.1016/j.scico.2012.11.006. [Online]. Available: https://doi.org/10.1016/j.scico.2012.11.006. Verified: Crossref `/works/{doi}` (volume 93, pages 3-18, issued 2014-11). VERIFIED (no abstract retrieved).

[12] L. Diekmann and L. Tratt, "Don't panic! Better, fewer, syntax errors for LR parsers," in *34th Eur. Conf. Object-Oriented Programming (ECOOP 2020)*, ser. LIPIcs, vol. 166, 2020, pp. 6:1-6:32. doi: 10.4230/LIPIcs.ECOOP.2020.6. [Online]. Available: https://doi.org/10.4230/LIPIcs.ECOOP.2020.6. Verified: DataCite API (container LIPIcs vol. 166, article 6, 6:1-6:32; arXiv:1804.07133 related identifier), OpenAlex search, doi.org redirect to drops.dagstuhl.de; abstract from arXiv:1804.07133v4 (https://arxiv.org/abs/1804.07133). Crossref returned "Resource not found" for this DOI (DataCite-registered). VERIFIED.

[13] R. Grimm, "Better extensibility through modular syntax," in *Proc. 27th ACM SIGPLAN Conf. Programming Language Design and Implementation (PLDI '06)*, Jun. 2006, pp. 38-51. doi: 10.1145/1133981.1133987. [Online]. Available: https://doi.org/10.1145/1133981.1133987. Verified: Crossref (issued 2006-06-11); abstract from OpenAlex W4237774781. VERIFIED.

[14] K. Kuramitsu, "Packrat parsing with elastic sliding window," *J. Inf. Process.*, vol. 23, no. 4, pp. 505-512, 2015. doi: 10.2197/ipsjjip.23.505. [Online]. Available: https://doi.org/10.2197/ipsjjip.23.505. Verified: Crossref (pages 505-512, 2015); volume/issue 23/4 from the J-STAGE URL returned by the doi.org redirect (`.../ipsjjip/23/4/23_505/_article`); abstract from OpenAlex W998070183. VERIFIED.

[15] S. Medeiros and R. Ierusalimschy, "A parsing machine for PEGs," in *Proc. 2008 Symp. Dynamic Languages (DLS '08)*, Jul. 2008, pp. 1-12. doi: 10.1145/1408681.1408683. [Online]. Available: https://doi.org/10.1145/1408681.1408683. Verified: Crossref (issued 2008-07-08); abstract from OpenAlex W2044735303. VERIFIED.

## Unresolved

- Item 3: full abstract (tail after the cut-operator sentence) not retrieved.
- Item 11: abstract not retrieved.
- Items 1, 2: month and city for IEEE-style conference entries not returned by the APIs.
- Items 4, 5, 7: abstracts are from arXiv versions; Elsevier pages could not be read.
- Semantic Scholar and DBLP were not usable, so no citation-graph data was collected.
