# Paired (interleaved) comparisons, fallible tree

Ratio = config / reference per iteration, median over pooled iterations (IQR in brackets); `proc spread` = (max - min) / median of the per-process median ratios.

## Matching on valid input, within the fallible tree

| workload | scale | reference | config | ref ms | config ms | ratio | IQR | n | proc spread |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |

## Regression check, both trees in one process, interleaved: fallible / baseline, `!`-free grammar

| workload | scale | baseline ms | fallible ms | ratio | IQR | n | proc spread |
| --- | --- | --- | --- | --- | --- | --- | --- |
| micro/lexical: any-loop | 1 | 7.681 | 7.729 | 0.997x | 0.894-1.236 | 197 | 8.9% |
| micro/lexical: not-per-char | 1 | 10.085 | 9.905 | 0.971x | 0.835-1.191 | 155 | 7.2% |
| micro/lexical: lookahead-per-char | 1 | 10.768 | 11.120 | 1.013x | 0.858-1.184 | 144 | 7.5% |
| micro/lexical: apply-per-char | 1 | 12.314 | 12.306 | 0.989x | 0.904-1.117 | 130 | 2.5% |
| micro/lexical: apply+not-per-char | 1 | 14.850 | 14.956 | 1.016x | 0.927-1.077 | 109 | 3.2% |
| micro/syntactic: any-loop | 1 | 18.331 | 17.759 | 1.015x | 0.886-1.145 | 91 | 19.4% |
| micro/syntactic: not-per-char | 1 | 20.082 | 21.033 | 1.055x | 0.929-1.209 | 80 | 18.0% |
| micro/syntactic: lookahead-per-char | 1 | 19.132 | 20.851 | 1.050x | 0.922-1.170 | 79 | 7.2% |
| micro/syntactic: apply-per-char | 1 | 20.724 | 21.576 | 1.046x | 0.956-1.137 | 74 | 7.9% |
| micro/syntactic: apply+not-per-char | 1 | 24.080 | 25.245 | 1.049x | 0.983-1.134 | 63 | 5.9% |

## Construction, both trees in one process, interleaved: fallible / baseline

| source (operation) | baseline ms | fallible ms | ratio | IQR | n | proc spread |
| --- | --- | --- | --- | --- | --- | --- |

## Construction: source with `!` over its `!`-free twin

| source | ratio | IQR | n | proc spread | plain ms | bang ms |
| --- | --- | --- | --- | --- | --- | --- |
