/* eslint-disable no-console */
/*
  Timings for `B ! C` recovery. These are measurements for comparison, not a
  gate.

    node test/_bench-fallible.js [path/to/published/ohm.cjs]

  The optional argument is a published ohm-js build, to compare plain parse
  time on valid input. The file name starts with `_` so ava does not run it.
*/

import {createRequire} from 'node:module';
import {performance} from 'node:perf_hooks';
import process from 'node:process';

import * as ohm from '../index.mjs';

const RECOVER = {recover: true};

const HDL_FALLIBLE = String.raw`
  Hdl {
    Chip = "CHIP" name "{" Parts "}"
    Parts = "PARTS:" Part* ! &"}"
    Part = PartBody ! ";"
    PartBody = name "(" ListOf<Wire, ","> ")"
    Wire = name "=" name
    name = letter alnum*
  }`;
// The same grammar with each `!` removed, so it parses as plain Ohm.
const HDL_PLAIN = HDL_FALLIBLE.replaceAll(' ! ', ' ');

// A chip with `numParts` parts, `numBroken` of them spread evenly and missing
// a comma between wires.
function chip(numParts, numBroken) {
  const broken = new Set();
  for (let i = 0; i < numBroken; i++) {
    broken.add(Math.floor((i * numParts) / numBroken));
  }
  const parts = [];
  for (let i = 0; i < numParts; i++) {
    const wires = broken.has(i) ? 'a=a b=b' : 'a=a, b=b';
    parts.push(`  Nand(${wires}, out=w${i});`);
  }
  return `CHIP Big {\n PARTS:\n${parts.join('\n')}\n}\n`;
}

// Small grammars and inputs that each recover from several errors.
const CORPUS = [
  {
    name: 'chip, two broken parts',
    grammar: String.raw`
      Chips {
        Chip = "CHIP" name "{" Part* "}"
        Part = PartBody ! ";"
        PartBody = name "(" name ")"
        name = letter alnum*
      }`,
    input: 'CHIP A { N(a b); M(c); X(; }',
  },
  {
    name: 'block, three errors',
    grammar: String.raw`
      Exact {
        Block = "{" Stmt* ! &"}" "}"
        Stmt = Body ! ";"
        Body = ident
        ident = letter+
      }`,
    input: '{\naaa;\nb b;\nc c;\nddd;\nxxx\n}',
  },
  {
    name: 'block, thirty stray semicolons',
    grammar: String.raw`
      Blocks {
        Prog = Sub*
        Sub = "sub" "{" Stmt* ! &"}" "}"
        Stmt = StmtBody ! ";"
        StmtBody = Let | Do
        Let = "let" letter
        Do = "do" letter
      }`,
    input: `sub { ${'; '.repeat(30)}}`,
  },
];

// Median milliseconds of `fn` over `runs` runs, after three warm-up runs.
function median(fn, runs = 15) {
  for (let i = 0; i < 3; i++) fn();
  const samples = [];
  for (let i = 0; i < runs; i++) {
    const start = performance.now();
    fn();
    samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  return samples[Math.floor(samples.length / 2)];
}

const ms = x => x.toFixed(2);

console.log(`node ${process.version}, ${new Date().toISOString()}\n`);

// Valid input: what a grammar with `!` costs when nothing needs recovering.
const valid = chip(480, 0);
const fallible = ohm.grammar(HDL_FALLIBLE);
const plain = ohm.grammar(HDL_PLAIN);
console.log(`Valid chip (${valid.length} bytes), median ms:`);
console.log(`- plain grammar: ${ms(median(() => plain.match(valid)))}`);
console.log(`- fallible grammar, no recover: ${ms(median(() => fallible.match(valid)))}`);
console.log(
  `- fallible grammar, recover: ${ms(median(() => fallible.match(valid, undefined, RECOVER)))}`
);
if (process.argv[2]) {
  const published = createRequire(import.meta.url)(process.argv[2]);
  const publishedGrammar = published.grammar(HDL_PLAIN);
  const time = median(() => publishedGrammar.match(valid));
  console.log(`- ohm-js ${published.version}, plain grammar: ${ms(time)}`);
}

// Recovering from the errors in each corpus input.
console.log('\nCorpus inputs with recover, median ms:');
for (const {name, grammar, input} of CORPUS) {
  const g = ohm.grammar(grammar);
  const errors = g.match(input, undefined, RECOVER).getRecoveredFailures().length;
  const time = median(() => g.match(input, undefined, RECOVER));
  console.log(`- ${name} (${errors} errors): ${ms(time)}`);
}

// A large input as the number of broken parts grows.
console.log(`\nChip of ${valid.length} bytes with recover, median ms:`);
for (const broken of [0, 10, 100, 300]) {
  const input = chip(480, broken);
  const errors = fallible.match(input, undefined, RECOVER).getRecoveredFailures().length;
  const time = median(() => fallible.match(input, undefined, RECOVER), 7);
  console.log(`- ${broken} broken parts (${errors} errors): ${ms(time)}`);
}
