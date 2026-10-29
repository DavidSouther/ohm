#!/usr/bin/env node
// Regenerate report-tables.md: node benchmarks/fallible/regen-report.mjs <out dir>
import fs from 'node:fs';
import path from 'node:path';
import {writeReport} from './lib/report.mjs';
const dir = path.resolve(process.argv[2]);
writeReport(
  JSON.parse(fs.readFileSync(path.join(dir, 'results.json'), 'utf8')),
  path.join(dir, 'report-tables.md')
);
console.log('wrote', path.join(dir, 'report-tables.md'));
