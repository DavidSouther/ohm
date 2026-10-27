#!/usr/bin/env node
// Feature test: mechanical soundness check of ../paper.md.
//   node scripts/check_paper.mjs [--online]
// Checks:
//   1. required sections are present;
//   2. citations: every [n] cited exists in References, every reference is cited,
//      every reference has a DOI listed VERIFIED in research/papers.md or carries
//      the literal tag [unverified]; with --online each DOI resolves at doi.org;
//   3. numbered results: Theorem/Proposition/Lemma/Corollary have *Proof.* and ∎,
//      informal Claims have *Argument.*, Observations name an experiment id;
//   4. every table preceded by <!-- exp:ID --> matches scripts/experiments.mjs output;
//   5. no first/second person pronouns in prose (code spans, code blocks and
//      blockquotes excluded).
import {readFileSync, existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

/* global process, fetch */
/* eslint no-console: off */

async function main() {
  const here = dirname(fileURLToPath(import.meta.url));
  const root = join(here, '..');
  const online = process.argv.includes('--online');
  const errors = [];
  const fail = msg => errors.push(msg);

  const paperPath = join(root, 'paper.md');
  if (!existsSync(paperPath)) {
    console.error('FAIL: paper.md does not exist');
    process.exit(1);
  }
  const paper = readFileSync(paperPath, 'utf8');
  const papers = readFileSync(join(root, 'research', 'papers.md'), 'utf8');

  // ---- 1. sections
  const required = [
    /^## Abstract/m,
    /^## \d+\.? Introduction/m,
    /^## \d+\.? Background/m,
    /^## \d+\.? Formal Model/m,
    /^## \d+\.? Complexity of the General Design/m,
    /^## \d+\.? The Ohm Implementation/m,
    /^## \d+\.? Empirical/m,
    /^## \d+\.? Threats to Validity/m,
    /^## \d+\.? Related Work/m,
    /^## References/m,
  ];
  for (const re of required) if (!re.test(paper)) fail(`missing section ${re}`);

  const refIdx = paper.search(/^## References/m);
  const body = refIdx >= 0 ? paper.slice(0, refIdx) : paper;
  const refs = refIdx >= 0 ? paper.slice(refIdx) : '';

  // ---- 2. citations
  const refEntries = new Map();
  for (const m of refs.matchAll(/^\[(\d+)\]\s+(.+)$/gm)) refEntries.set(Number(m[1]), m[2]);
  if (refEntries.size === 0) fail('no reference entries');
  const cited = new Set();
  for (const m of body.matchAll(/\[(\d+(?:\s*[,–-]\s*\d+)*)\]/g)) {
    for (const part of m[1].split(/\s*,\s*/)) {
      const range = part.split(/\s*[–-]\s*/).map(Number);
      if (range.length === 2) for (let i = range[0]; i <= range[1]; i++) cited.add(i);
      else cited.add(range[0]);
    }
  }
  for (const n of cited) {
    if (!refEntries.has(n)) fail(`citation [${n}] has no reference entry`);
  }
  const verifiedDois = new Set();
  for (const line of papers.split('\n')) {
    const row = line.match(/^\|\s*\d+\s*\|.*\|\s*VERIFIED[^|]*\|\s*(.+?)\s*\|$/);
    if (row) {
      for (const d of row[1].split(/\s*;\s*/)) {
        if (d.startsWith('10.')) verifiedDois.add(d.toLowerCase());
      }
    }
  }
  const dois = [];
  for (const [n, text] of refEntries) {
    if (!cited.has(n)) fail(`reference [${n}] is never cited`);
    const doi = text.match(/doi:\s*(10\.[^\s,]+?)\.?(\s|$)/i);
    if (/\[unverified\]/.test(text)) continue;
    // A local artifact inspected in this session (source code at a pinned commit).
    if (/\[source: inspected at commit [0-9a-f]{8}\]/.test(text)) continue;
    if (!doi) {
      fail(`reference [${n}] has no DOI and is not tagged [unverified]`);
      continue;
    }
    if (!verifiedDois.has(doi[1].toLowerCase())) {
      fail(`reference [${n}] DOI ${doi[1]} not VERIFIED in research/papers.md`);
    }
    dois.push([n, doi[1]]);
  }
  if (online) {
    for (const [n, doi] of dois) {
      try {
        const res = await fetch(`https://doi.org/${doi}`, {
          method: 'HEAD',
          redirect: 'manual',
        });
        if (res.status < 300 || res.status >= 400) {
          fail(`reference [${n}] DOI ${doi} -> HTTP ${res.status}`);
        }
      } catch (e) {
        fail(`reference [${n}] DOI ${doi} unreachable: ${e.message}`);
      }
    }
  }

  // ---- 3. numbered results
  const resultKinds =
    'Theorem|Proposition|Lemma|Corollary|Claim|Conjecture|Observation|Definition';
  const resultRe = new RegExp(`\\*\\*(${resultKinds}) (\\d+)([^*]*)\\*\\*`, 'g');
  const results = [...body.matchAll(resultRe)];
  const seen = new Set();
  const observationIds = [];
  results.forEach((m, i) => {
    const [, kind, num, rest] = m;
    const id = `${kind} ${num}`;
    if (seen.has(id)) fail(`duplicate label ${id}`);
    seen.add(id);
    const end = i + 1 < results.length ? results[i + 1].index : body.length;
    const span = body.slice(m.index, end);
    if (['Theorem', 'Proposition', 'Lemma', 'Corollary'].includes(kind)) {
      if (!/\*Proof\.\*/.test(span)) fail(`${id} has no *Proof.*`);
      if (!/∎/.test(span)) fail(`${id} proof does not end with ∎`);
    } else if (kind === 'Claim') {
      if (!/informal/.test(rest)) fail(`${id} must be labelled (informal)`);
      if (!/\*Argument\.\*/.test(span)) fail(`${id} has no *Argument.*`);
    } else if (kind === 'Observation') {
      const ids = [...span.matchAll(/\b(E\d+\w*)\b/g)].map(x => x[1]);
      if (ids.length === 0) fail(`${id} names no experiment id`);
      observationIds.push([id, ids]);
    }
  });
  const counts = kinds => results.filter(m => kinds.includes(m[1])).length;
  if (counts(['Theorem', 'Proposition', 'Lemma', 'Corollary']) === 0) {
    fail('no proven results');
  }

  // ---- 4. empirical tables
  const expOut = execFileSync(process.execPath, [join(here, 'experiments.mjs')], {
    encoding: 'utf8',
  });
  const exps = JSON.parse(expOut);
  const PINNED = 'd55d10ad';
  if (exps._meta?.branchHead !== PINNED) {
    fail(`ohm checkout is at ${exps._meta?.branchHead}, paper analyzes ${PINNED}`);
  }
  if (!paper.includes(PINNED)) fail(`paper does not name the analyzed commit ${PINNED}`);
  for (const [id, ids] of observationIds) {
    for (const e of ids) {
      if (!exps[e]) fail(`${id} cites ${e}, which experiments.mjs does not produce`);
    }
  }

  // ---- 4b. topic coverage required by the request
  const coverage = {
    'grammar construction': /grammar construction/i,
    'left recursion': /left recursion/i,
    memoization: /memoi[sz]ation/i,
    'pass bound': /number of passes|pass bound/i,
    'recovery point count': /recovery (point|key)s?/i,
    'space complexity': /space/i,
    'worst case': /worst[- ]case/i,
    'typical case': /typical/i,
    'diagnostic collection (G3)': /getRecoveredFailures/,
    'formal semantics rules': /\\frac|⟶|⇒|→/,
  };
  for (const [topic, re] of Object.entries(coverage)) {
    if (!re.test(body)) fail(`coverage: no treatment of ${topic}`);
  }
  const tableBlocks = [...paper.matchAll(/<!-- exp:(\w+) -->\s*\n((?:\|.*\|\s*\n?)+)/g)];
  if (tableBlocks.length === 0) fail('no experiment tables');
  for (const [, id, table] of tableBlocks) {
    const exp = exps[id];
    if (!exp) {
      fail(`table exp:${id} has no experiment output`);
      continue;
    }
    const lines = table
      .trim()
      .split('\n')
      .map(l => l.trim());
    const header = lines[0]
      .split('|')
      .slice(1, -1)
      .map(s => s.trim());
    const rows = lines.slice(2).map(l =>
      l
        .split('|')
        .slice(1, -1)
        .map(s => s.trim())
    );
    if (rows.length !== exp.rows.length) {
      fail(`exp:${id}: ${rows.length} rows in paper, ${exp.rows.length} produced`);
    }
    rows.forEach((row, r) => {
      header.forEach((col, c) => {
        const want = exp.rows[r]?.[col];
        if (want === undefined) fail(`exp:${id}: column "${col}" not produced`);
        else if (String(want) !== row[c]) {
          fail(`exp:${id} row ${r + 1} "${col}": paper ${row[c]} vs script ${want}`);
        }
      });
    });
    if (!new RegExp(`\\b${id}\\b`).test(body.replace(/<!--.*?-->/g, ''))) {
      fail(`exp:${id} not referenced in prose`);
    }
  }

  // ---- 5. pronouns
  const prose = body
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[^`]*`/g, '')
    .split('\n')
    .filter(l => !l.startsWith('>'))
    .join('\n');
  for (const m of prose.matchAll(/\b(I|we|We|our|Our|us|you|You|your|Your|my|My)\b/g)) {
    const ctx = prose.slice(Math.max(0, m.index - 30), m.index + 30).replace(/\n/g, ' ');
    // Exclude the mathematical variable I.
    if (m[1] === 'I' && /[A-Z]\s*I\b|\bI[\s)]*[=(,]|\(I\)|I\)/.test(ctx)) continue;
    fail(`pronoun "${m[1]}": …${ctx}…`);
  }

  const summary = [
    `results: ${results.length} labelled`,
    `(${counts(['Theorem', 'Proposition', 'Lemma', 'Corollary'])} proven,`,
    `${counts(['Claim'])} informal, ${counts(['Conjecture'])} conjectures,`,
    `${counts(['Observation'])} observations); refs: ${refEntries.size};`,
    `tables: ${tableBlocks.length}${online ? '; DOIs resolved online' : ''}`,
  ].join(' ');
  if (errors.length) {
    console.error(`FAIL (${errors.length})\n- ` + errors.join('\n- '));
    console.error(summary);
    process.exit(1);
  }
  console.log(`PASS — ${summary}`);
}
main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
