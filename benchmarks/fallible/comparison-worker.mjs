import {PROFILES} from './lib/profiles.mjs';

// Keep the original workload and measurement code; use a bounded live profile
// because the original full profile repeats the old quadratic cases many times.
PROFILES.comparison = {
  ...PROFILES.smoke,
  name: 'comparison',
  scales: [1, 3, 10, 30, 100],
  warmupMs: 30,
  budgetMs: 100,
  minReps: 3,
  maxReps: 30,
  counterScales: [1, 10, 100],
  memScales: [10],
};
await import('./worker.mjs');
