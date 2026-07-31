import { randomBytes } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import yaml from 'js-yaml';
import { validateDataDirectory } from './data-utils.js';
import { IncidentSchema, type Incident } from '../src/lib/incidentSchema.js';
import { findDuplicates, type DuplicateComparison } from '../src/lib/dedupe.js';

export interface CandidateFile { path: string; content: string }

export function candidateRelativePath(repositoryRoot: string, candidatePath: string): string {
  const root = resolve(repositoryRoot);
  const candidateRoot = resolve(root, 'data', 'candidates');
  const absolute = resolve(candidatePath);
  const inside = relative(candidateRoot, absolute);
  if (!inside || inside === '..' || inside.startsWith(`..${sep}`) || isAbsolute(inside)) throw new Error('Candidate files must be inside data/candidates');
  if (!['.yaml', '.yml'].includes(extname(absolute).toLocaleLowerCase('en-US'))) throw new Error('Candidate files must use YAML');
  return relative(root, absolute).split(sep).join('/');
}

export function renderReviewPatch(files: CandidateFile[]): string {
  return files.map((file) => {
    if (!/^data\/candidates\/[A-Za-z0-9._/-]+\.ya?ml$/i.test(file.path) || file.path.includes('..')) throw new Error('Unsafe candidate patch path');
    const lines = file.content.replace(/\r\n/g, '\n').replace(/\n?$/, '\n').split('\n');
    const additions = lines.slice(0, -1).map((line) => `+${line}`).join('\n');
    return `diff --git a/${file.path} b/${file.path}\nnew file mode 100644\n--- /dev/null\n+++ b/${file.path}\n@@ -0,0 +1,${lines.length - 1} @@\n${additions}\n`;
  }).join('\n');
}

export async function archiveDeliveredCandidates(repositoryRoot: string, files: CandidateFile[]): Promise<{ archived: string[]; preserved: string[] }> {
  const archived: string[] = [];
  const preserved: string[] = [];
  const archiveDirectory = resolve(repositoryRoot, '.local', 'delivered-candidates');
  await mkdir(archiveDirectory, { recursive: true, mode: 0o700 });
  await chmod(archiveDirectory, 0o700);
  for (const file of files) {
    const relativePath = candidateRelativePath(repositoryRoot, resolve(repositoryRoot, file.path));
    const absolutePath = resolve(repositoryRoot, relativePath);
    const tracked = spawnSync('git', ['ls-files', '--error-unmatch', '--', relativePath], {
      cwd: repositoryRoot, encoding: 'utf8', stdio: 'ignore',
    }).status === 0;
    if (tracked) {
      preserved.push(relativePath);
      continue;
    }
    try {
      const basename = relativePath.split('/').at(-1) ?? 'candidate.yaml';
      const destination = resolve(archiveDirectory, `${Date.now()}-${randomBytes(8).toString('hex')}-${basename}`);
      await rename(absolutePath, destination);
      await chmod(destination, 0o600);
      archived.push(destination);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }
  }
  return { archived, preserved };
}

export interface CandidateDeliveryMatch extends DuplicateComparison { candidateId: string }

export function evaluateCandidateDelivery(candidates: Incident[], existing: Incident[]): {
  exact: CandidateDeliveryMatch[];
  probable: CandidateDeliveryMatch[];
} {
  const matches: CandidateDeliveryMatch[] = [];
  const selectedIds = new Set(candidates.map((candidate) => candidate.id));
  const frontier = existing.filter((record) => !selectedIds.has(record.id));
  for (const candidate of candidates) {
    matches.push(...findDuplicates(candidate, frontier).map((match) => ({ ...match, candidateId: candidate.id })));
  }
  for (let left = 0; left < candidates.length; left += 1) {
    for (let right = left + 1; right < candidates.length; right += 1) {
      const candidate = candidates[left];
      const peer = candidates[right];
      if (!candidate || !peer) continue;
      matches.push(...findDuplicates(candidate, [peer]).map((match) => ({ ...match, candidateId: candidate.id })));
    }
  }
  return {
    exact: matches.filter((match) => match.classification === 'exact'),
    probable: matches.filter((match) => match.classification === 'probable'),
  };
}

const commandEnvironment = (): NodeJS.ProcessEnv => ({
  ...process.env,
  ...(process.env.GH_TOKEN ? {} : process.env.GITHUB_TOKEN ? { GH_TOKEN: process.env.GITHUB_TOKEN } : {}),
});

const run = (command: string, arguments_: string[], cwd: string, allowFailure = false): string => {
  const result = spawnSync(command, arguments_, { cwd, env: commandEnvironment(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (result.error) throw result.error;
  if (result.status !== 0 && !allowFailure) throw new Error(`${command} ${arguments_[0] ?? ''} failed: ${(result.stderr || result.stdout).trim()}`);
  return (result.stdout || '').trim();
};

async function candidateFiles(repositoryRoot: string, explicit: string[]): Promise<CandidateFile[]> {
  const paths = explicit.length > 0
    ? explicit.map((path) => resolve(repositoryRoot, path))
    : (await readdir(resolve(repositoryRoot, 'data', 'candidates'), { withFileTypes: true }))
      .filter((entry) => entry.isFile() && /\.ya?ml$/i.test(entry.name))
      .map((entry) => resolve(repositoryRoot, 'data', 'candidates', entry.name));
  if (paths.length === 0) throw new Error('No candidate YAML files found');
  return await Promise.all(paths.sort().map(async (path) => ({ path: candidateRelativePath(repositoryRoot, path), content: await readFile(path, 'utf8') })));
}

const ghAvailable = (repositoryRoot: string): boolean => {
  if (!process.env.GH_TOKEN && !process.env.GITHUB_TOKEN) return false;
  return spawnSync('gh', ['auth', 'status'], { cwd: repositoryRoot, env: commandEnvironment(), stdio: 'ignore' }).status === 0;
};

async function openPullRequest(repositoryRoot: string, files: CandidateFile[]): Promise<string> {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'flocking-candidate-pr-'));
  const branch = `candidate-review/${new Date().toISOString().slice(0, 10)}-${randomBytes(4).toString('hex')}`;
  let worktreeCreated = false;
  try {
    run('git', ['worktree', 'add', '-b', branch, temporaryRoot, 'HEAD'], repositoryRoot);
    worktreeCreated = true;
    for (const file of files) {
      const destination = resolve(temporaryRoot, file.path);
      if (!destination.startsWith(`${resolve(temporaryRoot, 'data', 'candidates')}${sep}`)) throw new Error('Candidate destination escaped worktree');
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, file.content, { mode: 0o644, flag: 'wx' });
    }
    run('git', ['add', '--', ...files.map((file) => file.path)], temporaryRoot);
    run('git', ['commit', '-m', `data: add ${files.length} Flock abuse candidate${files.length === 1 ? '' : 's'}`], temporaryRoot);
    run('git', ['push', '--set-upstream', 'origin', branch], temporaryRoot);
    return run('gh', ['pr', 'create', '--title', `Candidate review: ${files.length} Flock abuse report${files.length === 1 ? '' : 's'}`, '--body', 'Automated discovery candidate(s). Human source and uniqueness review is required before publication.', '--base', 'main', '--head', branch], temporaryRoot);
  } finally {
    if (worktreeCreated) run('git', ['worktree', 'remove', '--force', temporaryRoot], repositoryRoot, true);
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

interface CliOptions { candidates: string[]; patchPath: string }
const parseCli = (arguments_: string[]): CliOptions => {
  const options: CliOptions = { candidates: [], patchPath: 'candidate-review.patch' };
  for (let index = 0; index < arguments_.length; index += 1) {
    const value = arguments_[index]; const next = arguments_[index + 1];
    if (value === '--candidate' && next) { options.candidates.push(next); index += 1; }
    else if (value === '--patch' && next) { options.patchPath = next; index += 1; }
    else throw new Error(`Unknown or incomplete option: ${value}`);
  }
  return options;
};

async function runCli(): Promise<void> {
  const repositoryRoot = process.cwd();
  const options = parseCli(process.argv.slice(2));
  const validation = await validateDataDirectory(resolve(repositoryRoot, 'data'));
  if (!validation.valid) throw new Error(`Candidate validation failed:\n${validation.errors.join('\n')}`);
  const files = await candidateFiles(repositoryRoot, options.candidates);
  const candidates = files.map((file) => IncidentSchema.parse(yaml.load(file.content)));
  if (candidates.some((candidate) => !['candidate', 'draft'].includes(candidate.status))) throw new Error('Candidate delivery accepts only candidate or draft status');
  const delivery = evaluateCandidateDelivery(candidates, validation.records);
  if (delivery.exact.length > 0) {
    const detail = delivery.exact.map((match) => `${match.candidateId} duplicates ${match.incidentId}: ${match.reasons.join(', ')}`).join('\n');
    throw new Error(`Candidate delivery blocked by exact duplicate(s):\n${detail}`);
  }
  if (delivery.probable.length > 0) {
    console.log(`Probable duplicate warning(s): ${delivery.probable.map((match) => `${match.candidateId} ~ ${match.incidentId} (${match.score})`).join('; ')}`);
  }
  if (ghAvailable(repositoryRoot)) {
    const url = await openPullRequest(repositoryRoot, files);
    const cleanup = await archiveDeliveredCandidates(repositoryRoot, files);
    console.log(`Candidate review pull request: ${url}`);
    if (cleanup.archived.length > 0) console.log(`Archived ${cleanup.archived.length} delivered candidate file(s).`);
    if (cleanup.preserved.length > 0) console.log(`Preserved ${cleanup.preserved.length} tracked candidate file(s).`);
    return;
  }
  const destination = resolve(repositoryRoot, options.patchPath);
  await writeFile(destination, renderReviewPatch(files), { mode: 0o600 });
  const archive = await archiveDeliveredCandidates(repositoryRoot, files);
  console.log(`GitHub authentication unavailable; review patch written to ${destination}`);
  if (archive.archived.length > 0) console.log(`Archived ${archive.archived.length} delivered candidate file(s) under ${resolve(repositoryRoot, '.local', 'delivered-candidates')}.`);
  if (archive.preserved.length > 0) console.log(`Preserved ${archive.preserved.length} tracked or changed candidate file(s).`);
  console.log('Apply in a clean checkout with: git apply --check <patch>, then git apply <patch>.');
}

const isEntrypoint = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isEntrypoint) await runCli().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
