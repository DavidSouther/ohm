import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath, URL} from 'node:url';

export const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
export const BASELINE_COMMIT = '4a40f38f4140';
export const FALLIBLE_COMMIT = 'd55d10ad9661993027416dbbf18311446404f108';
const cacheRoot = fileURLToPath(new URL('../.cache/node_modules/', import.meta.url));
const manifestName = '.benchmark-source.json';
const sourcePaths = ['src', 'dist', 'index.mjs', 'package.json'];
const git = (root, ...args) =>
  execFileSync('git', ['-C', root, ...args], {encoding: 'utf8'}).trim();

function fingerprint(root) {
  const hash = createHash('sha256');
  const visit = relative => {
    const full = path.join(root, relative);
    if (fs.statSync(full).isDirectory()) {
      for (const name of fs.readdirSync(full).sort()) visit(path.join(relative, name));
    } else {
      hash.update(relative).update('\0').update(fs.readFileSync(full)).update('\0');
    }
  };
  for (const entry of sourcePaths) visit(path.join('packages/ohm-js', entry));
  return hash.digest('hex');
}

/** Materialize the runtime package from a local Git commit, without a worktree or build. */
export function ensureTree(revision) {
  const commit = git(repositoryRoot, 'rev-parse', '--verify', `${revision}^{commit}`);
  const root = path.join(cacheRoot, commit);
  if (fs.existsSync(path.join(root, manifestName))) {
    const metadata = treeMetadata(root);
    const manifest = JSON.parse(fs.readFileSync(path.join(root, manifestName), 'utf8'));
    if (metadata.commit !== commit || metadata.status !== manifest.fingerprint) {
      throw new Error(`Cached benchmark source changed; remove ${root} and retry`);
    }
    return root;
  }
  fs.mkdirSync(cacheRoot, {recursive: true});
  const temporary = fs.mkdtempSync(path.join(cacheRoot, 'extract-'));
  try {
    const archive = execFileSync(
      'git',
      [
        '-C',
        repositoryRoot,
        'archive',
        commit,
        ...sourcePaths.map(entry => `packages/ohm-js/${entry}`),
      ],
      {maxBuffer: 32 * 2 ** 20}
    );
    execFileSync('tar', ['-xf', '-', '-C', temporary], {input: archive});
    fs.writeFileSync(
      path.join(temporary, manifestName),
      JSON.stringify(
        {
          commit,
          fingerprint: fingerprint(temporary),
        },
        null,
        2
      ) + '\n'
    );
    fs.renameSync(temporary, root);
  } finally {
    fs.rmSync(temporary, {recursive: true, force: true});
  }
  return root;
}

/** Archives carry their own provenance; Git in their parent directory is unrelated. */
export function treeMetadata(root) {
  const manifest = path.join(root, manifestName);
  if (fs.existsSync(manifest)) {
    const {commit} = JSON.parse(fs.readFileSync(manifest, 'utf8'));
    return {commit, branch: 'HEAD', status: fingerprint(root)};
  }
  return {
    commit: git(root, 'rev-parse', 'HEAD'),
    branch: git(root, 'rev-parse', '--abbrev-ref', 'HEAD'),
    status: git(root, 'status', '--porcelain'),
  };
}

export function resolveTrees({baseline, fallible} = {}) {
  return {
    baseline: baseline ? path.resolve(baseline) : ensureTree(BASELINE_COMMIT),
    fallible: fallible ? path.resolve(fallible) : ensureTree(FALLIBLE_COMMIT),
  };
}

/** Linear scan estimates below describe only the historical implementation. */
export function assertHistoricalCounters(root, label) {
  const metadata = treeMetadata(root);
  const expected = label === 'baseline' ? BASELINE_COMMIT : FALLIBLE_COMMIT;
  if (!metadata.commit.startsWith(expected)) {
    throw new Error(
      `Historical counters require ${label} ${expected}; got ${metadata.commit}`
    );
  }
  if (fs.existsSync(path.join(root, manifestName))) {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, manifestName), 'utf8'));
    if (metadata.status !== manifest.fingerprint) {
      throw new Error('Cached source was modified');
    }
  } else {
    git(
      root,
      'diff',
      '--exit-code',
      'HEAD',
      '--',
      ...sourcePaths.map(entry => `packages/ohm-js/${entry}`)
    );
  }
}
