# Fallible overhead: report tables (full profile)

## Environment

| item | value |
| --- | --- |
| Node / V8 | v26.12.1 / 14.6.202.34-node.40 |
| platform | darwin 27.0.0 arm64, Apple M5 Max, 18 logical CPUs, 48 GB |
| baseline | 4a40f38f (HEAD) |
| fallible | d55d10ad (feat/fallible-v17) |
| load average (1/5/15 min) at start | 10.43 / 9.96 / 9.81 |
| load average at end | 7.76 / 8.92 / 10.11 |
| busiest processes at start (%CPU command) | 282.2 /Applications/Visual Studio Code.app/Contents/Frameworks/Code Helper (Plugin).app/Contents/MacOS/Code Helper (Plugin); 50.9 /Library/SystemExtensions/8649B63F-5C9F-4A4F-AB21-FB60F0B0702E/com.jamf.protect.security-extension.systemextension/Contents/MacOS/com.jamf.protect.security-extension; 26.8 /opt/homebrew/bin/node; 9.0 /usr/libexec/logd |
| busiest processes at end | 228.1 /Applications/Visual Studio Code.app/Contents/Frameworks/Code Helper (Plugin).app/Contents/MacOS/Code Helper (Plugin); 67.3 auditd; 31.9 /opt/homebrew/bin/node; 30.4 /Library/SystemExtensions/8649B63F-5C9F-4A4F-AB21-FB60F0B0702E/com.jamf.protect.security-extension.systemextension/Contents/MacOS/com.jamf.protect.security-extension |
| started / finished | 2026-10-27T17:43:26.891Z / 2026-10-27T18:51:57.577Z |
| method | 4 alternating-order processes per tree; per cell: first call (cold), warmup >= 200 ms, then >= 15 timed calls within 400 ms (cap 400); pooled over processes; scales 1, 3, 10, 30, 100, 300 |

## Sanity

| check | result | detail |
| --- | --- | --- |
| baseline-detached-at-pinned-commit | PASS | 4a40f38f414023d57934d108efccd4c5eea5b546 HEAD |
| grammars-identical-up-to-bang | PASS |  |
| same-cst-valid | PASS | 9 groups |
| recover-valid-single-pass-no-failures | PASS | 24 rows |
| plain-fails-invalid | PASS | 36 rows |
| bang-match-equals-plain-message | PASS |  |
| recovered-failure-count | PASS | 30 rows |
| passes-equal-failures-plus-one | PASS |  |
| plain-recover-fails-one-pass | PASS | 18 rows |
| baseline-tree-untouched | PASS | baseline: status unchanged |
| tracked-source-untouched | PASS | fallible: status unchanged |
| memory-not-gc-dominated | PASS | 14/252 samples discarded |
| incremental-agrees | PASS | 12 rows |
| cells-complete | PASS | {"expected":{"baseline":108,"fallible":306},"have":{"baseline":108,"fallible":306}} |

## Construction

Median ms per call (IQR as a share of the median). `ratio` is fallible / baseline on the same source; `bang vs plain` is the `!` source over its `!`-free twin on the fallible tree.

| source | operation | chars | baseline ms | fallible ms | ratio | class | bang vs plain |
| --- | --- | --- | --- | --- | --- | --- | --- |
| prog-plain | ohm.grammar | 756 | 2.02 (15.5%) | 2.47 (26.1%) | 1.22x | within noise | n/a |
| prog-plain | metagrammar-parse | 756 | 1.65 (20.2%) | 1.81 (17.7%) | 1.10x | within noise | n/a |
| prog-plain | toRecipe | 756 | 0.027 (7.0%) | 0.027 (2.5%) | 1.00x | within noise | n/a |
| prog-plain | makeRecipe | 756 | 0.042 (8.5%) | 0.042 (4.9%) | 1.00x | within noise | n/a |
| ohm-grammar.ohm | ohm.grammar | 2712 | 6.10 (20.1%) | 7.14 (22.3%) | 1.17x | within noise | n/a |
| ohm-grammar.ohm | metagrammar-parse | 2712 | 4.50 (21.9%) | 5.28 (22.4%) | 1.17x | within noise | n/a |
| ohm-grammar.ohm | toRecipe | 2712 | 0.099 (21.6%) | 0.083 (23.7%) | 0.84x | within noise | n/a |
| ohm-grammar.ohm | makeRecipe | 2712 | 0.154 (22.6%) | 0.137 (11.0%) | 0.89x | within noise | n/a |
| syn10-plain | ohm.grammar | 350 | 1.30 (16.7%) | 1.42 (25.5%) | 1.09x | within noise | n/a |
| syn10-plain | metagrammar-parse | 350 | 0.922 (16.5%) | 1.08 (36.1%) | 1.17x | within noise | n/a |
| syn10-plain | toRecipe | 350 | 0.021 (3.3%) | 0.021 (5.5%) | 0.99x | within noise | n/a |
| syn10-plain | makeRecipe | 350 | 0.033 (4.1%) | 0.033 (2.6%) | 1.01x | within noise | n/a |
| syn100-plain | ohm.grammar | 3230 | 12.8 (11.5%) | 13.2 (6.0%) | 1.03x | within noise | n/a |
| syn100-plain | metagrammar-parse | 3230 | 9.11 (12.5%) | 10.0 (11.6%) | 1.10x | within noise | n/a |
| syn100-plain | toRecipe | 3230 | 0.208 (13.2%) | 0.215 (20.7%) | 1.03x | within noise | n/a |
| syn100-plain | makeRecipe | 3230 | 0.322 (6.5%) | 0.334 (30.9%) | 1.04x | within noise | n/a |
| syn1000-plain | ohm.grammar | 33830 | 145 (7.0%) | 162 (12.2%) | 1.11x | slower | n/a |
| syn1000-plain | metagrammar-parse | 33830 | 113 (14.3%) | 127 (17.7%) | 1.13x | within noise | n/a |
| syn1000-plain | toRecipe | 33830 | 2.15 (13.1%) | 2.13 (8.0%) | 0.99x | within noise | n/a |
| syn1000-plain | makeRecipe | 33830 | 3.96 (25.1%) | 3.61 (10.9%) | 0.91x | within noise | n/a |
| prog-bang | ohm.grammar | 759 | n/a | 2.24 (15.6%) | n/a | n/a | 0.91x |
| prog-bang | metagrammar-parse | 759 | n/a | 1.71 (15.3%) | n/a | n/a | 0.94x |
| prog-bang | toRecipe | 759 | n/a | 0.027 (5.2%) | n/a | n/a | 1.01x |
| prog-bang | makeRecipe | 759 | n/a | 0.042 (4.6%) | n/a | n/a | 0.99x |
| syn10-bang | ohm.grammar | 380 | n/a | 1.36 (7.8%) | n/a | n/a | 0.96x |
| syn10-bang | metagrammar-parse | 380 | n/a | 1.09 (19.0%) | n/a | n/a | 1.01x |
| syn10-bang | toRecipe | 380 | n/a | 0.024 (4.9%) | n/a | n/a | 1.12x |
| syn10-bang | makeRecipe | 380 | n/a | 0.038 (3.3%) | n/a | n/a | 1.14x |
| syn100-bang | ohm.grammar | 3530 | n/a | 14.3 (16.4%) | n/a | n/a | 1.08x |
| syn100-bang | metagrammar-parse | 3530 | n/a | 10.4 (13.6%) | n/a | n/a | 1.04x |
| syn100-bang | toRecipe | 3530 | n/a | 0.235 (8.8%) | n/a | n/a | 1.10x |
| syn100-bang | makeRecipe | 3530 | n/a | 0.380 (32.0%) | n/a | n/a | 1.14x |
| syn1000-bang | ohm.grammar | 36830 | n/a | 160 (16.7%) | n/a | n/a | 0.99x |
| syn1000-bang | metagrammar-parse | 36830 | n/a | 126 (11.6%) | n/a | n/a | 0.99x |
| syn1000-bang | toRecipe | 36830 | n/a | 2.40 (10.1%) | n/a | n/a | 1.13x |
| syn1000-bang | makeRecipe | 36830 | n/a | 4.33 (17.2%) | n/a | n/a | 1.20x |

### Construction phase breakdown (instrumented, 40 samples)

Columns: total `ohm.grammar`; metagrammar parse of the source; `GrammarDecl.build` (analysis passes and `Grammar` construction); remainder (semantic actions and `Builder`). Timer wrappers add overhead; ratios, not absolutes, are informative.

| tree | source | total ms | parse ms | decl.build ms | actions+builder ms |
| --- | --- | --- | --- | --- | --- |
| baseline | prog-plain | 2.07 | 1.73 | 0.024 | 0.314 |
| baseline | syn100-plain | 11.8 | 8.54 | 0.095 | 3.19 |
| fallible | prog-plain | 2.30 | 1.78 | 0.026 | 0.499 |
| fallible | syn100-plain | 14.0 | 10.5 | 0.103 | 3.47 |
| fallible | prog-bang | 2.13 | 1.66 | 0.019 | 0.458 |
| fallible | syn100-bang | 13.9 | 10.7 | 0.086 | 3.15 |

### Load and cold start

| tree | import `index.mjs` median ms | IQR | launches |
| --- | --- | --- | --- |
| baseline | 12.6 | 14.0% | 12 |
| fallible | 13.3 | 13.7% | 12 |

Cold: first calls in a fresh process at scale 10 (median over launches).

| tree | case | grammar build ms | 1st match ms | 2nd ms | 6th ms | launches |
| --- | --- | --- | --- | --- | --- | --- |
| baseline | prog|blocks|valid|plain/match | 8.05 | 9.64 | 9.87 | 4.93 | 6 |
| fallible | prog|blocks|valid|plain/match | 8.36 | 9.95 | 8.93 | 5.87 | 6 |
| fallible | prog|blocks|valid|bang/match | 7.95 | 9.90 | 8.50 | 5.67 | 6 |
| fallible | prog|blocks|valid|bang/recover | 8.06 | 10.8 | 8.62 | 5.96 | 6 |
| fallible | prog|blocks|invalid-dense|bang/recover | 8.40 | 16.5 | 9.72 | 7.95 | 6 |

## Matching

Cells show median ms, then the ratio to the baseline tree matching the valid input of the same size with the plain grammar. Invalid-input rows therefore state the cost of an input of the same size, not of the same text. Fail rows (`plain/match`, `bang/match` on invalid input) stop at the first error. `n/a` marks configurations that do not exist on the baseline.

### prog / blocks / valid

| scale | chars | base plain/match | fb plain/match | fb plain/recover | fb bang/match | fb bang/recover | fb bangTok/recover |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 248 | 0.352 (1.00x) | 0.368 (1.05x) | 0.537 (1.53x) | 0.361 (1.03x) | 0.397 (1.13x) | 0.395 (1.12x) |
| 3 | 778 | 1.06 (1.00x) | 1.10 (1.03x) | 1.22 (1.15x) | 1.12 (1.05x) | 1.23 (1.15x) | 1.21 (1.14x) |
| 10 | 2633 | 3.63 (1.00x) | 3.75 (1.03x) | 4.21 (1.16x) | 3.93 (1.08x) | 4.57 (1.26x) | 4.35 (1.20x) |
| 30 | 8293 | 12.5 (1.00x) | 12.4 (0.99x) | 13.6 (1.09x) | 12.5 (1.00x) | 14.1 (1.13x) | 14.0 (1.12x) |
| 100 | 28103 | 49.1 (1.00x) | 49.7 (1.01x) | 64.2 (1.31x) | 51.6 (1.05x) | 54.8 (1.12x) | 54.8 (1.12x) |
| 300 | 88303 | 152 (1.00x) | 156 (1.03x) | 169 (1.11x) | 163 (1.07x) | 178 (1.18x) | 172 (1.14x) |
| growth exp. (all / last two) |  | 1.07 / 1.03 | 1.07 / 1.04 | 1.04 / 0.88 | 1.08 / 1.05 | 1.07 / 1.07 | 1.07 / 1.04 |

### prog / flat / valid

| scale | chars | base plain/match | fb plain/match | fb plain/recover | fb bang/match | fb bang/recover | fb bangTok/recover |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 250 | 0.351 (1.00x) | 0.360 (1.02x) | 0.387 (1.10x) | 0.401 (1.14x) | 0.416 (1.18x) | 0.504 (1.43x) |
| 3 | 748 | 1.05 (1.00x) | 1.15 (1.09x) | 1.18 (1.12x) | 1.11 (1.05x) | 1.22 (1.17x) | 1.31 (1.24x) |
| 10 | 2491 | 3.68 (1.00x) | 3.74 (1.02x) | 3.99 (1.08x) | 3.69 (1.00x) | 4.46 (1.21x) | 4.41 (1.20x) |
| 30 | 7811 | 12.2 (1.00x) | 12.7 (1.05x) | 13.2 (1.09x) | 12.0 (0.98x) | 16.5 (1.35x) | 14.4 (1.18x) |
| 100 | 26431 | 46.6 (1.00x) | 49.3 (1.06x) | 51.4 (1.10x) | 50.1 (1.08x) | 58.4 (1.25x) | 55.4 (1.19x) |
| 300 | 83031 | 146 (1.00x) | 157 (1.07x) | 156 (1.07x) | 161 (1.10x) | 178 (1.21x) | 173 (1.19x) |
| growth exp. (all / last two) |  | 1.06 / 1.04 | 1.07 / 1.05 | 1.06 / 1.01 | 1.06 / 1.06 | 1.08 / 1.01 | 1.04 / 1.04 |

### prog / blocks / invalid-single

| scale | chars | base plain/match | fb plain/match | fb plain/recover | fb bang/match | fb bang/recover | fb bangTok/recover |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 233 | 0.210 (0.60x) | 0.212 (0.60x) | 0.275 (0.78x) | 0.273 (0.78x) | 0.470 (1.34x) | 0.421 (1.20x) |
| 3 | 762 | 0.560 (0.53x) | 0.594 (0.56x) | 0.723 (0.68x) | 0.726 (0.68x) | 1.51 (1.41x) | 1.31 (1.23x) |
| 10 | 2623 | 1.90 (0.52x) | 1.91 (0.53x) | 2.27 (0.62x) | 2.17 (0.60x) | 4.90 (1.35x) | 4.83 (1.33x) |
| 30 | 8282 | 5.90 (0.47x) | 6.86 (0.55x) | 6.95 (0.56x) | 6.81 (0.54x) | 14.4 (1.15x) | 14.1 (1.13x) |
| 100 | 28092 | 23.8 (0.49x) | 25.1 (0.51x) | 28.9 (0.59x) | 27.3 (0.56x) | 58.8 (1.20x) | 57.2 (1.17x) |
| 300 | 88291 | 74.7 (0.49x) | 79.5 (0.52x) | 97.7 (0.64x) | 89.2 (0.59x) | 187 (1.23x) | 184 (1.21x) |
| growth exp. (all / last two) |  | 1.04 / 1.04 | 1.05 / 1.05 | 1.03 / 1.11 | 1.02 / 1.08 | 1.05 / 1.05 | 1.07 / 1.06 |

### prog / flat / invalid-single

| scale | chars | base plain/match | fb plain/match | fb plain/recover | fb bang/match | fb bang/recover | fb bangTok/recover |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 235 | 0.199 (0.57x) | 0.226 (0.64x) | 0.267 (0.76x) | 0.231 (0.66x) | 0.501 (1.43x) | 0.459 (1.31x) |
| 3 | 732 | 0.540 (0.51x) | 0.713 (0.68x) | 0.672 (0.64x) | 0.626 (0.60x) | 1.28 (1.22x) | 1.29 (1.22x) |
| 10 | 2481 | 1.71 (0.46x) | 1.96 (0.53x) | 2.19 (0.59x) | 2.10 (0.57x) | 4.78 (1.30x) | 4.62 (1.26x) |
| 30 | 7800 | 5.59 (0.46x) | 6.08 (0.50x) | 7.11 (0.58x) | 6.34 (0.52x) | 13.8 (1.13x) | 13.8 (1.14x) |
| 100 | 26420 | 22.8 (0.49x) | 24.1 (0.52x) | 28.5 (0.61x) | 25.3 (0.54x) | 55.6 (1.19x) | 56.0 (1.20x) |
| 300 | 83019 | 71.1 (0.49x) | 71.6 (0.49x) | 87.2 (0.60x) | 82.5 (0.56x) | 185 (1.26x) | 172 (1.17x) |
| growth exp. (all / last two) |  | 1.04 / 1.04 | 1.01 / 0.99 | 1.03 / 1.02 | 1.04 / 1.08 | 1.04 / 1.09 | 1.05 / 1.02 |

### prog / blocks / invalid-dense

| scale | chars | base plain/match | fb plain/match | fb plain/recover | fb bang/match | fb bang/recover | fb bangTok/recover |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 233 | 0.203 (0.58x) | 0.222 (0.63x) | 0.270 (0.77x) | 0.262 (0.75x) | 0.492 (1.40x) | 0.420 (1.19x) |
| 3 | 729 | 0.200 (0.19x) | 0.214 (0.20x) | 0.273 (0.26x) | 0.224 (0.21x) | 1.38 (1.29x) | 1.41 (1.32x) |
| 10 | 2468 | 0.210 (0.06x) | 0.218 (0.06x) | 0.280 (0.08x) | 0.229 (0.06x) | 5.41 (1.49x) | 5.44 (1.50x) |
| 30 | 7774 | 0.213 (0.02x) | 0.235 (0.02x) | 0.280 (0.02x) | 0.238 (0.02x) | 23.9 (1.91x) | 26.7 (2.14x) |
| 100 | 26348 | 0.267 (0.01x) | 0.272 (0.01x) | 0.325 (0.01x) | 0.316 (0.01x) | 132 (2.68x) | 153 (3.11x) |
| 300 | 82814 | 0.435 (0.00x) | 0.447 (0.00x) | 0.527 (0.00x) | 0.522 (0.00x) | 1065 (7.02x) | 1309 (8.63x) |
| growth exp. (all / last two) |  | 0.12 / 0.45 | 0.11 / 0.45 | 0.10 / 0.44 | 0.11 / 0.46 | 1.33 / 1.90 | 1.39 / 1.96 |

### prog / flat / invalid-dense

| scale | chars | base plain/match | fb plain/match | fb plain/recover | fb bang/match | fb bang/recover | fb bangTok/recover |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 235 | 0.206 (0.59x) | 0.219 (0.62x) | 0.336 (0.96x) | 0.240 (0.68x) | 0.470 (1.34x) | 0.498 (1.42x) |
| 3 | 699 | 0.203 (0.19x) | 0.214 (0.20x) | 0.304 (0.29x) | 0.235 (0.22x) | 1.31 (1.24x) | 1.56 (1.48x) |
| 10 | 2326 | 0.209 (0.06x) | 0.229 (0.06x) | 0.355 (0.10x) | 0.250 (0.07x) | 5.80 (1.58x) | 5.48 (1.49x) |
| 30 | 7292 | 0.222 (0.02x) | 0.238 (0.02x) | 0.373 (0.03x) | 0.264 (0.02x) | 23.3 (1.92x) | 20.8 (1.71x) |
| 100 | 24676 | 0.277 (0.01x) | 0.277 (0.01x) | 0.359 (0.01x) | 0.306 (0.01x) | 113 (2.42x) | 115 (2.48x) |
| 300 | 77542 | 0.468 (0.00x) | 0.516 (0.00x) | 0.572 (0.00x) | 0.490 (0.00x) | 849 (5.81x) | 879 (6.01x) |
| growth exp. (all / last two) |  | 0.13 / 0.48 | 0.13 / 0.57 | 0.08 / 0.42 | 0.11 / 0.43 | 1.30 / 1.84 | 1.29 / 1.85 |

### lex / lines / valid

| scale | chars | base plain/match | fb plain/match | fb plain/recover | fb bang/match | fb bang/recover | fb bangTok/recover |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 1580 | 1.27 (1.00x) | 1.25 (0.98x) | 1.52 (1.19x) | 1.28 (1.00x) | 1.56 (1.23x) | n/a |
| 3 | 5180 | 4.34 (1.00x) | 4.32 (1.00x) | 5.61 (1.29x) | 4.27 (0.99x) | 5.48 (1.26x) | n/a |
| 10 | 17780 | 20.4 (1.00x) | 18.7 (0.92x) | 21.8 (1.07x) | 19.6 (0.96x) | 23.0 (1.13x) | n/a |
| 30 | 57780 | 61.6 (1.00x) | 63.4 (1.03x) | 73.7 (1.20x) | 62.8 (1.02x) | 75.5 (1.23x) | n/a |
| 100 | 197780 | 211 (1.00x) | 237 (1.12x) | 265 (1.25x) | 227 (1.07x) | 254 (1.20x) | n/a |
| 300 | 637780 | 723 (1.00x) | 797 (1.10x) | 819 (1.13x) | 775 (1.07x) | 849 (1.17x) | n/a |
| growth exp. (all / last two) |  | 1.11 / 1.12 | 1.13 / 1.10 | 1.10 / 1.03 | 1.12 / 1.12 | 1.10 / 1.10 | n/a |

### lex / lines / invalid-single

| scale | chars | base plain/match | fb plain/match | fb plain/recover | fb bang/match | fb bang/recover | fb bangTok/recover |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 1573 | 0.603 (0.48x) | 0.624 (0.49x) | 0.761 (0.60x) | 0.684 (0.54x) | 1.51 (1.19x) | n/a |
| 3 | 5172 | 1.99 (0.46x) | 1.91 (0.44x) | 2.68 (0.62x) | 2.16 (0.50x) | 5.71 (1.32x) | n/a |
| 10 | 17772 | 9.66 (0.47x) | 9.10 (0.45x) | 10.1 (0.50x) | 9.61 (0.47x) | 23.2 (1.13x) | n/a |
| 30 | 57771 | 30.7 (0.50x) | 28.7 (0.47x) | 36.2 (0.59x) | 34.1 (0.55x) | 76.7 (1.25x) | n/a |
| 100 | 197771 | 110 (0.52x) | 110 (0.52x) | 129 (0.61x) | 117 (0.55x) | 259 (1.23x) | n/a |
| 300 | 637770 | 353 (0.49x) | 347 (0.48x) | 420 (0.58x) | 368 (0.51x) | 899 (1.24x) | n/a |
| growth exp. (all / last two) |  | 1.12 / 1.06 | 1.12 / 1.04 | 1.11 / 1.08 | 1.11 / 1.04 | 1.11 / 1.13 | n/a |

### lex / lines / invalid-dense

| scale | chars | base plain/match | fb plain/match | fb plain/recover | fb bang/match | fb bang/recover | fb bangTok/recover |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 1511 | 0.062 (0.05x) | 0.064 (0.05x) | 0.102 (0.08x) | 0.065 (0.05x) | 1.92 (1.51x) | n/a |
| 3 | 4951 | 0.071 (0.02x) | 0.070 (0.02x) | 0.117 (0.03x) | 0.072 (0.02x) | 7.73 (1.78x) | n/a |
| 10 | 16991 | 0.096 (0.00x) | 0.097 (0.00x) | 0.152 (0.01x) | 0.117 (0.01x) | 55.3 (2.71x) | n/a |
| 30 | 55191 | 0.221 (0.00x) | 0.264 (0.00x) | 0.360 (0.01x) | 0.309 (0.01x) | 429 (6.96x) | n/a |
| 100 | 188891 | 0.622 (0.00x) | 0.628 (0.00x) | 0.859 (0.00x) | 0.806 (0.00x) | 6087 (28.86x) | n/a |
| 300 | 608891 | 2.30 (0.00x) | 2.33 (0.00x) | 2.63 (0.00x) | 2.58 (0.00x) | 80332 (111.10x) | n/a |
| growth exp. (all / last two) |  | 0.63 / 1.19 | 0.64 / 1.19 | 0.57 / 1.02 | 0.66 / 1.06 | 1.88 / 2.35 | n/a |

### Regression check: identical grammar without `!` (fallible / baseline)

Primary columns use the clean processes (only `plain/match` cells executed). The last column repeats the ratio from the all-configurations processes, where the fallible process has also run recovering cells before: the difference between the two ratios is the cost of JIT history in a mixed process, not of the engine change.

| workload | scale | baseline ms | fallible ms | ratio | cross-process spread (max) | class | ratio in mixed process |
| --- | --- | --- | --- | --- | --- | --- | --- |
| prog/blocks/valid | 1 | 0.352 | 0.368 | 1.05x | 35.7% | within noise | 1.04x |
| prog/blocks/valid | 3 | 1.06 | 1.10 | 1.03x | 18.4% | within noise | 1.09x |
| prog/blocks/valid | 10 | 3.63 | 3.75 | 1.03x | 23.4% | within noise | 1.15x |
| prog/blocks/valid | 30 | 12.5 | 12.4 | 0.99x | 15.4% | within noise | 1.06x |
| prog/blocks/valid | 100 | 49.1 | 49.7 | 1.01x | 17.9% | within noise | 1.07x |
| prog/blocks/valid | 300 | 152 | 156 | 1.03x | 7.6% | within noise | 1.13x |
| prog/flat/valid | 1 | 0.351 | 0.360 | 1.02x | 12.5% | within noise | 1.05x |
| prog/flat/valid | 3 | 1.05 | 1.15 | 1.09x | 26.9% | within noise | 1.02x |
| prog/flat/valid | 10 | 3.68 | 3.74 | 1.02x | 31.9% | within noise | 1.07x |
| prog/flat/valid | 30 | 12.2 | 12.7 | 1.05x | 18.0% | within noise | 0.99x |
| prog/flat/valid | 100 | 46.6 | 49.3 | 1.06x | 9.9% | within noise | 1.08x |
| prog/flat/valid | 300 | 146 | 157 | 1.07x | 20.8% | within noise | 1.07x |
| prog/blocks/invalid-single | 1 | 0.210 | 0.212 | 1.01x | 20.9% | within noise | 1.13x |
| prog/blocks/invalid-single | 3 | 0.560 | 0.594 | 1.06x | 38.3% | within noise | 1.24x |
| prog/blocks/invalid-single | 10 | 1.90 | 1.91 | 1.01x | 35.4% | within noise | 1.21x |
| prog/blocks/invalid-single | 30 | 5.90 | 6.86 | 1.16x | 37.6% | within noise | 1.16x |
| prog/blocks/invalid-single | 100 | 23.8 | 25.1 | 1.05x | 8.3% | within noise | 1.22x |
| prog/blocks/invalid-single | 300 | 74.7 | 79.5 | 1.06x | 36.1% | within noise | 1.04x |
| prog/flat/invalid-single | 1 | 0.199 | 0.226 | 1.13x | 43.7% | within noise | 1.02x |
| prog/flat/invalid-single | 3 | 0.540 | 0.713 | 1.32x | 35.5% | within noise | 1.12x |
| prog/flat/invalid-single | 10 | 1.71 | 1.96 | 1.15x | 36.8% | within noise | 1.16x |
| prog/flat/invalid-single | 30 | 5.59 | 6.08 | 1.09x | 22.0% | within noise | 1.20x |
| prog/flat/invalid-single | 100 | 22.8 | 24.1 | 1.06x | 32.2% | within noise | 1.02x |
| prog/flat/invalid-single | 300 | 71.1 | 71.6 | 1.01x | 33.9% | within noise | 1.14x |
| prog/blocks/invalid-dense | 1 | 0.203 | 0.222 | 1.09x | 32.9% | within noise | 1.09x |
| prog/blocks/invalid-dense | 3 | 0.200 | 0.214 | 1.07x | 22.0% | within noise | 1.12x |
| prog/blocks/invalid-dense | 10 | 0.210 | 0.218 | 1.04x | 19.8% | within noise | 1.10x |
| prog/blocks/invalid-dense | 30 | 0.213 | 0.235 | 1.10x | 19.2% | within noise | 1.09x |
| prog/blocks/invalid-dense | 100 | 0.267 | 0.272 | 1.02x | 18.6% | within noise | 1.09x |
| prog/blocks/invalid-dense | 300 | 0.435 | 0.447 | 1.03x | 4.1% | within noise | 1.05x |
| prog/flat/invalid-dense | 1 | 0.206 | 0.219 | 1.06x | 49.4% | within noise | 1.42x |
| prog/flat/invalid-dense | 3 | 0.203 | 0.214 | 1.06x | 14.1% | within noise | 1.31x |
| prog/flat/invalid-dense | 10 | 0.209 | 0.229 | 1.10x | 38.3% | within noise | 1.53x |
| prog/flat/invalid-dense | 30 | 0.222 | 0.238 | 1.07x | 34.4% | within noise | 1.25x |
| prog/flat/invalid-dense | 100 | 0.277 | 0.277 | 1.00x | 37.9% | within noise | 1.15x |
| prog/flat/invalid-dense | 300 | 0.468 | 0.516 | 1.10x | 18.5% | within noise | 1.21x |
| lex/lines/valid | 1 | 1.27 | 1.25 | 0.98x | 31.7% | within noise | 1.05x |
| lex/lines/valid | 3 | 4.34 | 4.32 | 1.00x | 33.7% | within noise | 1.16x |
| lex/lines/valid | 10 | 20.4 | 18.7 | 0.92x | 28.9% | within noise | 1.18x |
| lex/lines/valid | 30 | 61.6 | 63.4 | 1.03x | 21.9% | within noise | 1.08x |
| lex/lines/valid | 100 | 211 | 237 | 1.12x | 21.5% | within noise | 1.00x |
| lex/lines/valid | 300 | 723 | 797 | 1.10x | 12.1% | within noise | 1.06x |
| lex/lines/invalid-single | 1 | 0.603 | 0.624 | 1.03x | 36.3% | within noise | 1.16x |
| lex/lines/invalid-single | 3 | 1.99 | 1.91 | 0.96x | 43.3% | within noise | 1.10x |
| lex/lines/invalid-single | 10 | 9.66 | 9.10 | 0.94x | 56.9% | within noise | 1.14x |
| lex/lines/invalid-single | 30 | 30.7 | 28.7 | 0.94x | 24.5% | within noise | 1.29x |
| lex/lines/invalid-single | 100 | 110 | 110 | 1.00x | 25.3% | within noise | 1.08x |
| lex/lines/invalid-single | 300 | 353 | 347 | 0.98x | 21.6% | within noise | 1.08x |
| lex/lines/invalid-dense | 1 | 0.062 | 0.064 | 1.04x | 16.1% | within noise | 1.28x |
| lex/lines/invalid-dense | 3 | 0.071 | 0.070 | 0.99x | 33.2% | within noise | 1.42x |
| lex/lines/invalid-dense | 10 | 0.096 | 0.097 | 1.00x | 24.3% | within noise | 1.34x |
| lex/lines/invalid-dense | 30 | 0.221 | 0.264 | 1.20x | 31.8% | within noise | 1.07x |
| lex/lines/invalid-dense | 100 | 0.622 | 0.628 | 1.01x | 12.2% | within noise | 1.06x |
| lex/lines/invalid-dense | 300 | 2.30 | 2.33 | 1.01x | 8.5% | within noise | 1.23x |

### Overhead of `!` without and with recovery on valid input (fallible tree)

Ratios are to `plain/match` measured in the same (all-configurations) fallible process, same input, but not interleaved; see report-paired.md for interleaved ratios.

| workload | scale | plain/match ms | plain/recover | bang/match | bang/recover | bangTok/recover |
| --- | --- | --- | --- | --- | --- | --- |
| prog/blocks | 1 | 0.360 | 1.49x (slower) | 1.00x (within noise) | 1.10x (within noise) | 1.10x (slower) |
| prog/blocks | 3 | 1.12 | 1.10x (within noise) | 1.00x (within noise) | 1.10x (within noise) | 1.09x (within noise) |
| prog/blocks | 10 | 4.06 | 1.04x (within noise) | 0.97x (within noise) | 1.13x (within noise) | 1.07x (within noise) |
| prog/blocks | 30 | 12.7 | 1.07x (within noise) | 0.98x (within noise) | 1.11x (within noise) | 1.10x (within noise) |
| prog/blocks | 100 | 51.8 | 1.24x (within noise) | 1.00x (within noise) | 1.06x (within noise) | 1.06x (within noise) |
| prog/blocks | 300 | 169 | 1.00x (within noise) | 0.96x (within noise) | 1.06x (within noise) | 1.02x (within noise) |
| prog/flat | 1 | 0.357 | 1.09x (slower) | 1.12x (within noise) | 1.17x (within noise) | 1.41x (slower) |
| prog/flat | 3 | 1.06 | 1.12x (within noise) | 1.05x (within noise) | 1.16x (within noise) | 1.23x (within noise) |
| prog/flat | 10 | 3.75 | 1.07x (within noise) | 0.98x (within noise) | 1.19x (within noise) | 1.18x (within noise) |
| prog/flat | 30 | 12.4 | 1.07x (within noise) | 0.96x (within noise) | 1.33x (slower) | 1.16x (within noise) |
| prog/flat | 100 | 49.4 | 1.04x (within noise) | 1.02x (within noise) | 1.18x (within noise) | 1.12x (within noise) |
| prog/flat | 300 | 149 | 1.05x (slower) | 1.08x (within noise) | 1.19x (within noise) | 1.16x (within noise) |
| lex/lines | 1 | 1.27 | 1.20x (within noise) | 1.01x (within noise) | 1.23x (within noise) | n/a |
| lex/lines | 3 | 4.59 | 1.22x (within noise) | 0.93x (within noise) | 1.19x (within noise) | n/a |
| lex/lines | 10 | 21.7 | 1.00x (within noise) | 0.90x (within noise) | 1.06x (within noise) | n/a |
| lex/lines | 30 | 64.9 | 1.14x (within noise) | 0.97x (within noise) | 1.16x (within noise) | n/a |
| lex/lines | 100 | 231 | 1.15x (within noise) | 0.98x (within noise) | 1.10x (within noise) | n/a |
| lex/lines | 300 | 727 | 1.13x (within noise) | 1.07x (within noise) | 1.17x (slower) | n/a |

### Failed match with message (forces the rightmost-failure re-match), prog/blocks/invalid-single

| scale | baseline ms | fb plain ms | ratio | class | fb bang ms | bang/plain |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 0.232 | 0.266 | 1.15x | within noise | 0.259 | 0.97x |
| 3 | 0.631 | 0.654 | 1.04x | within noise | 0.810 | 1.24x |
| 10 | 1.92 | 2.14 | 1.11x | within noise | 2.62 | 1.23x |
| 30 | 5.99 | 6.65 | 1.11x | within noise | 6.56 | 0.99x |
| 100 | 25.0 | 29.7 | 1.19x | within noise | 27.1 | 0.91x |
| 300 | 75.7 | 83.3 | 1.10x | within noise | 84.0 | 1.01x |

### Recovering match plus lazy diagnostics (`getRecoveredFailures()`), prog/blocks

| regime | scale | bang/recover ms | bang/recover + diagnostics ms | ratio |
| --- | --- | --- | --- | --- |
| invalid-single | 1 | 0.470 | 0.439 | 0.93x |
| invalid-single | 3 | 1.51 | 1.36 | 0.91x |
| invalid-single | 10 | 4.90 | 5.08 | 1.04x |
| invalid-single | 30 | 14.4 | 14.9 | 1.04x |
| invalid-single | 100 | 58.8 | 59.7 | 1.02x |
| invalid-single | 300 | 187 | 187 | 1.00x |
| invalid-dense | 1 | 0.492 | 0.439 | 0.89x |
| invalid-dense | 3 | 1.38 | 1.43 | 1.04x |
| invalid-dense | 10 | 5.41 | 6.18 | 1.14x |
| invalid-dense | 30 | 23.9 | 23.2 | 0.97x |
| invalid-dense | 100 | 132 | 142 | 1.08x |
| invalid-dense | 300 | 1065 | 1108 | 1.04x |

## Counters

Deterministic work counts for one match (instrumented run, not timed). `evals` = `MatchState.eval` calls; `apps` = `Apply.reallyEval` calls (memo misses); `hits`/`stores` = memo hits and stores; `states` = `MatchState` pass instances; `rematch` = `Matcher._match` calls (1 + one rightmost-failure re-match per failed pass); `recover` and `scan` = calls; `scanEv` = evals inside scans; `recEv` = evals in `recover` outside scans (prefix re-evaluation); `choose` = attempts visited by `chooseAttempt`; `inval` = positions walked by memo invalidation; `rec` = recovered failures reported; `passes` = permits + 1 (cross-checked against `states - (rematch - 1)`). `hits` and `stores` include left-recursion seed reads and stores (the expression rules are left-recursive) and do not count tainted or invalidated entries dropped.

| tree | workload | config | scale | inj | result | evals | apps | hits | stores | states | rematch | recover | scan | scanEv | recEv | choose | inval | rec | passes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| baseline | prog/blocks/valid | plain/match | 1 | 0 | ok | 5,037 | 1,482 | 1,386 | 1,296 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | - | - |
| baseline | prog/blocks/valid | plain/match | 10 | 0 | ok | 51,360 | 15,342 | 13,833 | 13,482 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | - | - |
| baseline | prog/blocks/valid | plain/match | 100 | 0 | ok | 526,830 | 160,062 | 138,303 | 141,462 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | - | - |
| baseline | prog/blocks/invalid-single | plain/match | 1 | 1 | FAIL | 2,990 | 890 | 793 | 787 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | - | - |
| baseline | prog/blocks/invalid-single | plain/match | 10 | 1 | FAIL | 25,978 | 7,770 | 6,957 | 6,838 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | - | - |
| baseline | prog/blocks/invalid-single | plain/match | 100 | 1 | FAIL | 263,057 | 79,802 | 69,192 | 70,500 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | - | - |
| baseline | prog/flat/invalid-single | plain/match | 1 | 1 | FAIL | 2,996 | 893 | 793 | 790 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | - | - |
| baseline | prog/flat/invalid-single | plain/match | 10 | 1 | FAIL | 24,864 | 7,378 | 6,862 | 6,446 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | - | - |
| baseline | prog/flat/invalid-single | plain/match | 100 | 1 | FAIL | 251,371 | 75,609 | 68,242 | 66,307 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | - | - |
| baseline | prog/blocks/invalid-dense | plain/match | 1 | 1 | FAIL | 2,990 | 890 | 793 | 787 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | - | - |
| baseline | prog/blocks/invalid-dense | plain/match | 10 | 10 | FAIL | 2,990 | 890 | 793 | 787 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | - | - |
| baseline | prog/blocks/invalid-dense | plain/match | 100 | 100 | FAIL | 2,990 | 890 | 793 | 787 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | - | - |
| baseline | prog/flat/invalid-dense | plain/match | 1 | 1 | FAIL | 2,996 | 893 | 793 | 790 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | - | - |
| baseline | prog/flat/invalid-dense | plain/match | 10 | 10 | FAIL | 2,996 | 893 | 793 | 790 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | - | - |
| baseline | prog/flat/invalid-dense | plain/match | 100 | 100 | FAIL | 2,996 | 893 | 793 | 790 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | - | - |
| baseline | lex/lines/valid | plain/match | 1 | 0 | ok | 14,287 | 6,542 | 0 | 6,542 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | - | - |
| baseline | lex/lines/valid | plain/match | 10 | 0 | ok | 156,487 | 72,242 | 0 | 72,242 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | - | - |
| baseline | lex/lines/valid | plain/match | 100 | 0 | ok | 1,704,487 | 792,242 | 0 | 792,242 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | - | - |
| baseline | lex/lines/invalid-single | plain/match | 1 | 1 | FAIL | 7,123 | 3,258 | 0 | 3,258 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | - | - |
| baseline | lex/lines/invalid-single | plain/match | 10 | 1 | FAIL | 77,523 | 35,758 | 0 | 35,758 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | - | - |
| baseline | lex/lines/invalid-single | plain/match | 100 | 1 | FAIL | 844,523 | 392,258 | 0 | 392,258 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | - | - |
| baseline | lex/lines/invalid-dense | plain/match | 1 | 10 | FAIL | 713 | 323 | 0 | 323 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | - | - |
| baseline | lex/lines/invalid-dense | plain/match | 10 | 100 | FAIL | 713 | 323 | 0 | 323 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | - | - |
| baseline | lex/lines/invalid-dense | plain/match | 100 | 1000 | FAIL | 713 | 323 | 0 | 323 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | - | - |
| fallible | prog/blocks/valid | plain/match | 1 | 0 | ok | 5,037 | 1,482 | 1,386 | 1,296 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | - |
| fallible | prog/blocks/valid | plain/match | 10 | 0 | ok | 51,360 | 15,342 | 13,833 | 13,482 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | - |
| fallible | prog/blocks/valid | plain/match | 100 | 0 | ok | 526,830 | 160,062 | 138,303 | 141,462 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | - |
| fallible | prog/blocks/valid | plain/recover | 1 | 0 | ok | 5,037 | 1,482 | 1,386 | 1,296 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |
| fallible | prog/blocks/valid | plain/recover | 10 | 0 | ok | 51,360 | 15,342 | 13,833 | 13,482 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |
| fallible | prog/blocks/valid | plain/recover | 100 | 0 | ok | 526,830 | 160,062 | 138,303 | 141,462 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |
| fallible | prog/blocks/valid | bang/match | 1 | 0 | ok | 5,039 | 1,482 | 1,386 | 1,296 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | - |
| fallible | prog/blocks/valid | bang/match | 10 | 0 | ok | 51,380 | 15,342 | 13,833 | 13,482 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | - |
| fallible | prog/blocks/valid | bang/match | 100 | 0 | ok | 527,030 | 160,062 | 138,303 | 141,462 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | - |
| fallible | prog/blocks/valid | bang/recover | 1 | 0 | ok | 5,039 | 1,482 | 1,386 | 1,296 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |
| fallible | prog/blocks/valid | bang/recover | 10 | 0 | ok | 51,380 | 15,342 | 13,833 | 13,482 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |
| fallible | prog/blocks/valid | bang/recover | 100 | 0 | ok | 527,030 | 160,062 | 138,303 | 141,462 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |
| fallible | prog/blocks/valid | bangTok/recover | 1 | 0 | ok | 5,039 | 1,482 | 1,386 | 1,296 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |
| fallible | prog/blocks/valid | bangTok/recover | 10 | 0 | ok | 51,380 | 15,342 | 13,833 | 13,482 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |
| fallible | prog/blocks/valid | bangTok/recover | 100 | 0 | ok | 527,030 | 160,062 | 138,303 | 141,462 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |
| fallible | prog/blocks/invalid-single | plain/match | 1 | 1 | FAIL | 2,990 | 890 | 793 | 787 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | - |
| fallible | prog/blocks/invalid-single | plain/match | 10 | 1 | FAIL | 25,978 | 7,770 | 6,957 | 6,838 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | - |
| fallible | prog/blocks/invalid-single | plain/match | 100 | 1 | FAIL | 263,057 | 79,802 | 69,192 | 70,500 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | - |
| fallible | prog/blocks/invalid-single | plain/recover | 1 | 1 | FAIL | 3,122 | 917 | 854 | 812 | 2 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 1 |
| fallible | prog/blocks/invalid-single | plain/recover | 10 | 1 | FAIL | 26,110 | 7,797 | 7,018 | 6,863 | 2 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 1 |
| fallible | prog/blocks/invalid-single | plain/recover | 100 | 1 | FAIL | 263,279 | 79,829 | 69,343 | 70,525 | 2 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 1 |
| fallible | prog/blocks/invalid-single | bang/match | 1 | 1 | FAIL | 2,992 | 890 | 793 | 787 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | - |
| fallible | prog/blocks/invalid-single | bang/match | 10 | 1 | FAIL | 25,989 | 7,770 | 6,957 | 6,838 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | - |
| fallible | prog/blocks/invalid-single | bang/match | 100 | 1 | FAIL | 263,158 | 79,802 | 69,192 | 70,500 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | - |
| fallible | prog/blocks/invalid-single | bang/recover | 1 | 1 | ok | 4,879 | 1,423 | 1,367 | 1,252 | 3 | 2 | 1 | 1 | 18 | 1 | 3 | 144 | 1 | 2 |
| fallible | prog/blocks/invalid-single | bang/recover | 10 | 1 | ok | 51,462 | 15,345 | 13,896 | 13,488 | 3 | 2 | 1 | 1 | 22 | 1 | 12 | 1,325 | 1 | 2 |
| fallible | prog/blocks/invalid-single | bang/recover | 100 | 1 | ok | 527,294 | 160,066 | 138,546 | 141,469 | 3 | 2 | 1 | 1 | 26 | 1 | 102 | 13,971 | 1 | 2 |
| fallible | prog/blocks/invalid-single | bangTok/recover | 1 | 1 | ok | 4,949 | 1,448 | 1,374 | 1,277 | 3 | 2 | 1 | 1 | 88 | 1 | 3 | 144 | 1 | 2 |
| fallible | prog/blocks/invalid-single | bangTok/recover | 10 | 1 | ok | 51,528 | 15,368 | 13,903 | 13,511 | 3 | 2 | 1 | 1 | 88 | 1 | 12 | 1,325 | 1 | 2 |
| fallible | prog/blocks/invalid-single | bangTok/recover | 100 | 1 | ok | 527,356 | 160,087 | 138,553 | 141,490 | 3 | 2 | 1 | 1 | 88 | 1 | 102 | 13,971 | 1 | 2 |
| fallible | prog/flat/invalid-single | plain/match | 1 | 1 | FAIL | 2,996 | 893 | 793 | 790 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | - |
| fallible | prog/flat/invalid-single | plain/match | 10 | 1 | FAIL | 24,864 | 7,378 | 6,862 | 6,446 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | - |
| fallible | prog/flat/invalid-single | plain/match | 100 | 1 | FAIL | 251,371 | 75,609 | 68,242 | 66,307 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | - |
| fallible | prog/flat/invalid-single | plain/recover | 1 | 1 | FAIL | 3,128 | 920 | 854 | 815 | 2 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 1 |
| fallible | prog/flat/invalid-single | plain/recover | 10 | 1 | FAIL | 25,086 | 7,405 | 7,013 | 6,471 | 2 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 1 |
| fallible | prog/flat/invalid-single | plain/recover | 100 | 1 | FAIL | 252,493 | 75,636 | 69,293 | 66,332 | 2 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 1 |
| fallible | prog/flat/invalid-single | bang/match | 1 | 1 | FAIL | 2,998 | 893 | 793 | 790 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | - |
| fallible | prog/flat/invalid-single | bang/match | 10 | 1 | FAIL | 24,870 | 7,378 | 6,862 | 6,446 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | - |
| fallible | prog/flat/invalid-single | bang/match | 100 | 1 | FAIL | 251,422 | 75,609 | 68,242 | 66,307 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | - |
| fallible | prog/flat/invalid-single | bang/recover | 1 | 1 | ok | 4,885 | 1,426 | 1,367 | 1,255 | 3 | 2 | 1 | 1 | 18 | 1 | 3 | 146 | 1 | 2 |
| fallible | prog/flat/invalid-single | bang/recover | 10 | 1 | ok | 49,623 | 14,637 | 13,905 | 12,780 | 3 | 2 | 1 | 1 | 22 | 1 | 7 | 1,247 | 1 | 2 |
| fallible | prog/flat/invalid-single | bang/recover | 100 | 1 | ok | 505,745 | 151,708 | 138,465 | 133,111 | 3 | 2 | 1 | 1 | 26 | 1 | 52 | 13,132 | 1 | 2 |
| fallible | prog/flat/invalid-single | bangTok/recover | 1 | 1 | ok | 4,955 | 1,451 | 1,374 | 1,280 | 3 | 2 | 1 | 1 | 88 | 1 | 3 | 146 | 1 | 2 |
| fallible | prog/flat/invalid-single | bangTok/recover | 10 | 1 | ok | 49,689 | 14,660 | 13,912 | 12,803 | 3 | 2 | 1 | 1 | 88 | 1 | 7 | 1,247 | 1 | 2 |
| fallible | prog/flat/invalid-single | bangTok/recover | 100 | 1 | ok | 505,807 | 151,729 | 138,472 | 133,132 | 3 | 2 | 1 | 1 | 88 | 1 | 52 | 13,132 | 1 | 2 |
| fallible | prog/blocks/invalid-dense | plain/match | 1 | 1 | FAIL | 2,990 | 890 | 793 | 787 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | - |
| fallible | prog/blocks/invalid-dense | plain/match | 10 | 10 | FAIL | 2,990 | 890 | 793 | 787 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | - |
| fallible | prog/blocks/invalid-dense | plain/match | 100 | 100 | FAIL | 2,990 | 890 | 793 | 787 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | - |
| fallible | prog/blocks/invalid-dense | plain/recover | 1 | 1 | FAIL | 3,122 | 917 | 854 | 812 | 2 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 1 |
| fallible | prog/blocks/invalid-dense | plain/recover | 10 | 10 | FAIL | 3,122 | 917 | 854 | 812 | 2 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 1 |
| fallible | prog/blocks/invalid-dense | plain/recover | 100 | 100 | FAIL | 3,122 | 917 | 854 | 812 | 2 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 1 |
| fallible | prog/blocks/invalid-dense | bang/match | 1 | 1 | FAIL | 2,992 | 890 | 793 | 787 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | - |
| fallible | prog/blocks/invalid-dense | bang/match | 10 | 10 | FAIL | 2,992 | 890 | 793 | 787 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | - |
| fallible | prog/blocks/invalid-dense | bang/match | 100 | 100 | FAIL | 2,992 | 890 | 793 | 787 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | - |
| fallible | prog/blocks/invalid-dense | bang/recover | 1 | 1 | ok | 4,879 | 1,423 | 1,367 | 1,252 | 3 | 2 | 1 | 1 | 18 | 1 | 3 | 144 | 1 | 2 |
| fallible | prog/blocks/invalid-dense | bang/recover | 10 | 10 | ok | 56,008 | 15,049 | 18,122 | 12,994 | 21 | 11 | 100 | 100 | 1,239 | 100 | 120 | 12,564 | 10 | 11 |
| fallible | prog/blocks/invalid-dense | bang/recover | 100 | 100 | ok | 1,151,788 | 184,099 | 603,602 | 136,474 | 201 | 101 | 10,000 | 10,000 | 125,769 | 10,000 | 10,200 | 1,312,164 | 100 | 101 |
| fallible | prog/blocks/invalid-dense | bangTok/recover | 1 | 1 | ok | 4,949 | 1,448 | 1,374 | 1,277 | 3 | 2 | 1 | 1 | 88 | 1 | 3 | 144 | 1 | 2 |
| fallible | prog/blocks/invalid-dense | bangTok/recover | 10 | 10 | ok | 57,083 | 15,218 | 18,753 | 13,163 | 21 | 11 | 100 | 100 | 2,314 | 100 | 120 | 12,564 | 10 | 11 |
| fallible | prog/blocks/invalid-dense | bangTok/recover | 100 | 100 | ok | 1,208,003 | 185,528 | 655,923 | 137,903 | 201 | 101 | 10,000 | 10,000 | 181,984 | 10,000 | 10,200 | 1,312,164 | 100 | 101 |
| fallible | prog/flat/invalid-dense | plain/match | 1 | 1 | FAIL | 2,996 | 893 | 793 | 790 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | - |
| fallible | prog/flat/invalid-dense | plain/match | 10 | 10 | FAIL | 2,996 | 893 | 793 | 790 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | - |
| fallible | prog/flat/invalid-dense | plain/match | 100 | 100 | FAIL | 2,996 | 893 | 793 | 790 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | - |
| fallible | prog/flat/invalid-dense | plain/recover | 1 | 1 | FAIL | 3,128 | 920 | 854 | 815 | 2 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 1 |
| fallible | prog/flat/invalid-dense | plain/recover | 10 | 10 | FAIL | 3,128 | 920 | 854 | 815 | 2 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 1 |
| fallible | prog/flat/invalid-dense | plain/recover | 100 | 100 | FAIL | 3,128 | 920 | 854 | 815 | 2 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 1 |
| fallible | prog/flat/invalid-dense | bang/match | 1 | 1 | FAIL | 2,998 | 893 | 793 | 790 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | - |
| fallible | prog/flat/invalid-dense | bang/match | 10 | 10 | FAIL | 2,998 | 893 | 793 | 790 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | - |
| fallible | prog/flat/invalid-dense | bang/match | 100 | 100 | FAIL | 2,998 | 893 | 793 | 790 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | - |
| fallible | prog/flat/invalid-dense | bang/recover | 1 | 1 | ok | 4,885 | 1,426 | 1,367 | 1,255 | 3 | 2 | 1 | 1 | 18 | 1 | 3 | 146 | 1 | 2 |
| fallible | prog/flat/invalid-dense | bang/recover | 10 | 10 | ok | 51,559 | 14,161 | 16,691 | 12,268 | 21 | 11 | 100 | 100 | 1,239 | 100 | 75 | 11,864 | 10 | 11 |
| fallible | prog/flat/invalid-dense | bang/recover | 100 | 100 | ok | 861,139 | 155,941 | 463,121 | 127,918 | 201 | 101 | 10,000 | 10,000 | 125,769 | 10,000 | 5,250 | 1,229,069 | 100 | 101 |
| fallible | prog/flat/invalid-dense | bangTok/recover | 1 | 1 | ok | 4,955 | 1,451 | 1,374 | 1,280 | 3 | 2 | 1 | 1 | 88 | 1 | 3 | 146 | 1 | 2 |
| fallible | prog/flat/invalid-dense | bangTok/recover | 10 | 10 | ok | 52,634 | 14,330 | 17,322 | 12,437 | 21 | 11 | 100 | 100 | 2,314 | 100 | 75 | 11,864 | 10 | 11 |
| fallible | prog/flat/invalid-dense | bangTok/recover | 100 | 100 | ok | 917,354 | 157,370 | 515,442 | 129,347 | 201 | 101 | 10,000 | 10,000 | 181,984 | 10,000 | 5,250 | 1,229,069 | 100 | 101 |
| fallible | lex/lines/valid | plain/match | 1 | 0 | ok | 14,287 | 6,542 | 0 | 6,542 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | - |
| fallible | lex/lines/valid | plain/match | 10 | 0 | ok | 156,487 | 72,242 | 0 | 72,242 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | - |
| fallible | lex/lines/valid | plain/match | 100 | 0 | ok | 1,704,487 | 792,242 | 0 | 792,242 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | - |
| fallible | lex/lines/valid | plain/recover | 1 | 0 | ok | 14,287 | 6,542 | 0 | 6,542 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |
| fallible | lex/lines/valid | plain/recover | 10 | 0 | ok | 156,487 | 72,242 | 0 | 72,242 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |
| fallible | lex/lines/valid | plain/recover | 100 | 0 | ok | 1,704,487 | 792,242 | 0 | 792,242 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |
| fallible | lex/lines/valid | bang/match | 1 | 0 | ok | 14,287 | 6,542 | 0 | 6,542 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | - |
| fallible | lex/lines/valid | bang/match | 10 | 0 | ok | 156,487 | 72,242 | 0 | 72,242 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | - |
| fallible | lex/lines/valid | bang/match | 100 | 0 | ok | 1,704,487 | 792,242 | 0 | 792,242 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | - |
| fallible | lex/lines/valid | bang/recover | 1 | 0 | ok | 14,287 | 6,542 | 0 | 6,542 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |
| fallible | lex/lines/valid | bang/recover | 10 | 0 | ok | 156,487 | 72,242 | 0 | 72,242 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |
| fallible | lex/lines/valid | bang/recover | 100 | 0 | ok | 1,704,487 | 792,242 | 0 | 792,242 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |
| fallible | lex/lines/invalid-single | plain/match | 1 | 1 | FAIL | 7,123 | 3,258 | 0 | 3,258 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | - |
| fallible | lex/lines/invalid-single | plain/match | 10 | 1 | FAIL | 77,523 | 35,758 | 0 | 35,758 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | - |
| fallible | lex/lines/invalid-single | plain/match | 100 | 1 | FAIL | 844,523 | 392,258 | 0 | 392,258 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | - |
| fallible | lex/lines/invalid-single | plain/recover | 1 | 1 | FAIL | 7,203 | 3,269 | 52 | 3,269 | 2 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 1 |
| fallible | lex/lines/invalid-single | plain/recover | 10 | 1 | FAIL | 78,053 | 35,769 | 502 | 35,769 | 2 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 1 |
| fallible | lex/lines/invalid-single | plain/recover | 100 | 1 | FAIL | 849,553 | 392,269 | 5,002 | 392,269 | 2 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 1 |
| fallible | lex/lines/invalid-single | bang/match | 1 | 1 | FAIL | 7,123 | 3,258 | 0 | 3,258 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | - |
| fallible | lex/lines/invalid-single | bang/match | 10 | 1 | FAIL | 77,523 | 35,758 | 0 | 35,758 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | - |
| fallible | lex/lines/invalid-single | bang/match | 100 | 1 | FAIL | 844,523 | 392,258 | 0 | 392,258 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | - |
| fallible | lex/lines/invalid-single | bang/recover | 1 | 1 | ok | 14,366 | 6,521 | 106 | 6,519 | 3 | 2 | 1 | 1 | 9 | 0 | 1 | 781 | 1 | 2 |
| fallible | lex/lines/invalid-single | bang/recover | 10 | 1 | ok | 157,453 | 72,214 | 1,006 | 72,212 | 3 | 2 | 1 | 1 | 10 | 0 | 1 | 8,781 | 1 | 2 |
| fallible | lex/lines/invalid-single | bang/recover | 100 | 1 | ok | 1,714,440 | 792,207 | 10,006 | 792,205 | 3 | 2 | 1 | 1 | 11 | 0 | 1 | 97,781 | 1 | 2 |
| fallible | lex/lines/invalid-dense | plain/match | 1 | 10 | FAIL | 713 | 323 | 0 | 323 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | - |
| fallible | lex/lines/invalid-dense | plain/match | 10 | 100 | FAIL | 713 | 323 | 0 | 323 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | - |
| fallible | lex/lines/invalid-dense | plain/match | 100 | 1000 | FAIL | 713 | 323 | 0 | 323 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | - |
| fallible | lex/lines/invalid-dense | plain/recover | 1 | 10 | FAIL | 748 | 334 | 7 | 334 | 2 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 1 |
| fallible | lex/lines/invalid-dense | plain/recover | 10 | 100 | FAIL | 748 | 334 | 7 | 334 | 2 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 1 |
| fallible | lex/lines/invalid-dense | plain/recover | 100 | 1000 | FAIL | 748 | 334 | 7 | 334 | 2 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 1 |
| fallible | lex/lines/invalid-dense | bang/match | 1 | 10 | FAIL | 713 | 323 | 0 | 323 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | - |
| fallible | lex/lines/invalid-dense | bang/match | 10 | 100 | FAIL | 713 | 323 | 0 | 323 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | - |
| fallible | lex/lines/invalid-dense | bang/match | 100 | 1000 | FAIL | 713 | 323 | 0 | 323 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | - |
| fallible | lex/lines/invalid-dense | bang/recover | 1 | 10 | ok | 16,152 | 6,429 | 1,060 | 6,310 | 21 | 11 | 100 | 100 | 881 | 0 | 10 | 7,514 | 10 | 11 |
| fallible | lex/lines/invalid-dense | bang/recover | 10 | 100 | ok | 379,842 | 79,419 | 100,600 | 69,220 | 201 | 101 | 10,000 | 10,000 | 97,901 | 0 | 100 | 840,554 | 100 | 101 |
| fallible | lex/lines/invalid-dense | bang/recover | 100 | 1000 | ok | 25,433,142 | 1,757,019 | 10,006,000 | 755,020 | 2,001 | 1,001 | 1,000,000 | 1,000,000 | 10,788,101 | 0 | 1,000 | 93,492,404 | 1000 | 1001 |

## Memory

prog/blocks only. `alloc` = heap growth during one match with a 256 MB semi-space (no scavenge; samples that saw a GC are discarded). `retained` = heap growth after a forced GC with the result alive (CST plus the memo table held by the matcher). KB, median over repetitions. Ratio is to the baseline tree plain/match valid at the same scale.

| tree | regime | config | scale | chars | alloc KB | retained KB | alloc / retained vs baseline | GC-discarded |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| baseline | valid | plain/match | 10 | 2633 | 10526 | 3676 | 1.00x / 1.00x | 0/7 |
| baseline | valid | plain/match | 100 | 28103 | 89326 | 37919 | 1.00x / 1.00x | 0/7 |
| baseline | invalid-single | plain/match | 10 | 2623 | 5551 | 1764 | - | 0/7 |
| baseline | invalid-single | plain/match | 100 | 28092 | 46866 | 19185 | - | 0/7 |
| baseline | invalid-dense | plain/match | 10 | 2468 | 841 | 225 | - | 0/7 |
| baseline | invalid-dense | plain/match | 100 | 26348 | 1581 | 466 | - | 0/7 |
| fallible | valid | plain/match | 10 | 2633 | 10444 | 3788 | 0.99x / 1.03x | 0/7 |
| fallible | valid | plain/match | 100 | 28103 | 95143 | 39078 | 1.07x / 1.03x | 0/7 |
| fallible | valid | plain/recover | 10 | 2633 | 10774 | 3881 | 1.02x / 1.06x | 0/7 |
| fallible | valid | plain/recover | 100 | 28103 | 97750 | 39455 | 1.09x / 1.04x | 0/7 |
| fallible | valid | bang/match | 10 | 2633 | 10397 | 3848 | 0.99x / 1.05x | 0/7 |
| fallible | valid | bang/match | 100 | 28103 | 94966 | 39417 | 1.06x / 1.04x | 0/7 |
| fallible | valid | bang/recover | 10 | 2633 | 10432 | 3883 | 0.99x / 1.06x | 0/7 |
| fallible | valid | bang/recover | 100 | 28103 | 97841 | 39472 | 1.10x / 1.04x | 0/7 |
| fallible | valid | bangTok/recover | 10 | 2633 | 10454 | 3880 | 0.99x / 1.06x | 0/7 |
| fallible | valid | bangTok/recover | 100 | 28103 | 97788 | 39478 | 1.09x / 1.04x | 0/7 |
| fallible | invalid-single | plain/match | 10 | 2623 | 6068 | 1978 | - | 0/7 |
| fallible | invalid-single | plain/match | 100 | 28092 | 49517 | 19857 | - | 0/7 |
| fallible | invalid-single | plain/recover | 10 | 2623 | 5533 | 1944 | - | 0/7 |
| fallible | invalid-single | plain/recover | 100 | 28092 | 50592 | 19613 | - | 0/7 |
| fallible | invalid-single | bang/match | 10 | 2623 | 6145 | 1964 | - | 0/7 |
| fallible | invalid-single | bang/match | 100 | 28092 | 49619 | 19857 | - | 0/7 |
| fallible | invalid-single | bang/recover | 10 | 2623 | 10810 | 3872 | - | 0/7 |
| fallible | invalid-single | bang/recover | 100 | 28092 | 103751 | 39491 | - | 0/7 |
| fallible | invalid-single | bangTok/recover | 10 | 2623 | 10831 | 3878 | - | 0/7 |
| fallible | invalid-single | bangTok/recover | 100 | 28092 | 103747 | 39492 | - | 0/7 |
| fallible | invalid-dense | plain/match | 10 | 2468 | 841 | 243 | - | 0/7 |
| fallible | invalid-dense | plain/match | 100 | 26348 | 1584 | 488 | - | 0/7 |
| fallible | invalid-dense | plain/recover | 10 | 2468 | 1021 | 232 | - | 0/7 |
| fallible | invalid-dense | plain/recover | 100 | 26348 | 1770 | 232 | - | 0/7 |
| fallible | invalid-dense | bang/match | 10 | 2468 | 846 | 249 | - | 0/7 |
| fallible | invalid-dense | bang/match | 100 | 26348 | 1583 | 486 | - | 0/7 |
| fallible | invalid-dense | bang/recover | 10 | 2468 | 13590 | 3718 | - | 0/7 |
| fallible | invalid-dense | bang/recover | 100 | 26348 | n/a | 37847 | - | 7/7 |
| fallible | invalid-dense | bangTok/recover | 10 | 2468 | 13822 | 3760 | - | 0/7 |
| fallible | invalid-dense | bangTok/recover | 100 | 26348 | n/a | 38089 | - | 7/7 |

## Incremental

Plain grammar, prog/blocks/valid. `edit-one-char+match` replaces one digit in the middle and re-matches on the same matcher; `rematch-unchanged` re-matches with the memo table intact; `fresh-match` builds a new matcher.

| operation | scale | chars | baseline ms | fallible ms | ratio | class | edit == fresh |
| --- | --- | --- | --- | --- | --- | --- | --- |
| edit-one-char+match | 10 | 2633 | 0.029 | 0.032 | 1.10x | within noise | yes |
| rematch-unchanged | 10 | 2633 | 0.000 | 0.000 | 1.09x | slower | yes |
| fresh-match | 10 | 2633 | 3.91 | 3.89 | 0.99x | within noise | yes |
| edit-one-char+match | 100 | 28103 | 0.112 | 0.120 | 1.07x | within noise | yes |
| rematch-unchanged | 100 | 28103 | 0.000 | 0.000 | 1.00x | within noise | yes |
| fresh-match | 100 | 28103 | 52.4 | 50.1 | 0.96x | within noise | yes |
