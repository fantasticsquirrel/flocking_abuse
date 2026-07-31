import { randomBytes } from 'node:crypto';
import { chmod, link, mkdir, mkdtemp, readFile, readdir, rename, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import yaml from 'js-yaml';
import { atomicWriteRestricted } from './atomic-file.js';
import { validateDataDirectory } from './data-utils.js';
import { IncidentSchema, type Incident } from '../src/lib/incidentSchema.js';
import { findDuplicates, type DuplicateComparison } from '../src/lib/dedupe.js';

export interface CandidateFile { path: string; content: string; sourcePath?: string }

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
  const repository = resolve(repositoryRoot);
  for (const file of files) {
    const relativePath = candidateRelativePath(repositoryRoot, resolve(repositoryRoot, file.path));
    const sourcePath = resolve(file.sourcePath ?? resolve(repositoryRoot, relativePath));
    const sourceInsideRepository = relative(repository, sourcePath);
    const sourceIsInRepository = sourceInsideRepository !== '..' && !sourceInsideRepository.startsWith(`..${sep}`) && !isAbsolute(sourceInsideRepository);
    const tracked = sourceIsInRepository && spawnSync('git', ['ls-files', '--error-unmatch', '--', sourceInsideRepository.split(sep).join('/')], {
      cwd: repositoryRoot, encoding: 'utf8', stdio: 'ignore',
    }).status === 0;
    if (tracked) {
      preserved.push(relativePath);
      continue;
    }

    const claimPath = join(dirname(sourcePath), `.${sourcePath.split(sep).at(-1) ?? 'candidate.yaml'}.claim-${randomBytes(8).toString('hex')}`);
    try { await rename(sourcePath, claimPath); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }
    const claimedContent = await readFile(claimPath, 'utf8');
    if (claimedContent !== file.content) {
      let restorePath = sourcePath;
      try {
        await link(claimPath, restorePath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        const extension = extname(sourcePath);
        const stem = sourcePath.slice(0, -extension.length);
        restorePath = `${stem}-revised-${randomBytes(4).toString('hex')}${extension}`;
        await link(claimPath, restorePath);
      }
      await unlink(claimPath);
      preserved.push(sourceIsInRepository ? relative(repository, restorePath).split(sep).join('/') : restorePath);
      continue;
    }

    const archiveDirectory = sourceIsInRepository
      ? resolve(repositoryRoot, '.local', 'delivered-candidates')
      : resolve(dirname(sourcePath), '..', '.delivered-candidates');
    await mkdir(archiveDirectory, { recursive: true, mode: 0o700 });
    await chmod(archiveDirectory, 0o700);
    const basename = relativePath.split('/').at(-1) ?? 'candidate.yaml';
    const destination = resolve(archiveDirectory, `${Date.now()}-${randomBytes(8).toString('hex')}-${basename}`);
    await rename(claimPath, destination);
    await chmod(destination, 0o600);
    archived.push(destination);
  }
  return { archived, preserved };
}

export interface CandidateDeliveryMatch extends DuplicateComparison { candidateId: string }

export function evaluateCandidateDelivery(
  candidates: Incident[],
  existing: Incident[],
  options: { selfRecordIds?: ReadonlySet<string> } = {},
): { exact: CandidateDeliveryMatch[]; probable: CandidateDeliveryMatch[] } {
  const matches: CandidateDeliveryMatch[] = [];
  const selfRecordIds = options.selfRecordIds ?? new Set<string>();
  const frontier = existing.filter((record) => !selfRecordIds.has(record.id));
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

export async function loadCandidateFiles(repositoryRoot: string, explicit: string[], inboxDirectory?: string): Promise<CandidateFile[]> {
  const inboxRoot = inboxDirectory ? resolve(inboxDirectory) : undefined;
  const repositoryCandidateRoot = resolve(repositoryRoot, 'data', 'candidates');
  const paths = explicit.length > 0
    ? explicit.map((path) => isAbsolute(path) ? resolve(path) : resolve(repositoryRoot, path))
    : await (async () => {
      const sourceDirectory = inboxRoot ?? repositoryCandidateRoot;
      return (await readdir(sourceDirectory, { withFileTypes: true }))
        .filter((entry) => entry.isFile() && /\.ya?ml$/i.test(entry.name))
        .map((entry) => resolve(sourceDirectory, entry.name));
    })();
  if (paths.length === 0) throw new Error('No candidate YAML files found');
  const files = await Promise.all(paths.sort().map(async (path): Promise<CandidateFile> => {
    let patchPath: string;
    const relativeToRepositoryCandidates = relative(repositoryCandidateRoot, path);
    const inRepositoryCandidates = relativeToRepositoryCandidates && relativeToRepositoryCandidates !== '..'
      && !relativeToRepositoryCandidates.startsWith(`..${sep}`) && !isAbsolute(relativeToRepositoryCandidates);
    if (inRepositoryCandidates) patchPath = candidateRelativePath(repositoryRoot, path);
    else {
      if (!inboxRoot) throw new Error('External candidate files require --candidate-inbox');
      const relativeToInbox = relative(inboxRoot, path);
      if (!relativeToInbox || relativeToInbox === '..' || relativeToInbox.startsWith(`..${sep}`) || isAbsolute(relativeToInbox) || relativeToInbox.includes(sep)) {
        throw new Error('Candidate files must be direct YAML children of the configured inbox');
      }
      if (!/\.ya?ml$/i.test(relativeToInbox)) throw new Error('Candidate files must use YAML');
      patchPath = `data/candidates/${relativeToInbox}`;
    }
    return { path: patchPath, sourcePath: path, content: await readFile(path, 'utf8') };
  }));
  const targets = new Set<string>();
  for (const file of files) {
    if (targets.has(file.path)) throw new Error(`Multiple candidate sources map to ${file.path}`);
    targets.add(file.path);
  }
  return files;
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

interface CliOptions { candidates: string[]; patchPath: string; candidateInbox?: string }
const parseCli = (arguments_: string[]): CliOptions => {
  const options: CliOptions = { candidates: [], patchPath: 'candidate-review.patch' };
  for (let index = 0; index < arguments_.length; index += 1) {
    const value = arguments_[index]; const next = arguments_[index + 1];
    if (value === '--candidate' && next) { options.candidates.push(next); index += 1; }
    else if (value === '--patch' && next) { options.patchPath = next; index += 1; }
    else if (value === '--candidate-inbox' && next) { options.candidateInbox = next; index += 1; }
    else throw new Error(`Unknown or incomplete option: ${value}`);
  }
  return options;
};

async function runCli(): Promise<void> {
  const repositoryRoot = process.cwd();
  const options = parseCli(process.argv.slice(2));
  const validation = await validateDataDirectory(resolve(repositoryRoot, 'data'));
  if (!validation.valid) throw new Error(`Candidate validation failed:\n${validation.errors.join('\n')}`);
  const files = await loadCandidateFiles(repositoryRoot, options.candidates, options.candidateInbox);
  const candidates = files.map((file) => IncidentSchema.parse(yaml.load(file.content)));
  if (candidates.some((candidate) => !['candidate', 'draft'].includes(candidate.status))) throw new Error('Candidate delivery accepts only candidate or draft status');
  const repositoryCandidateRoot = resolve(repositoryRoot, 'data', 'candidates');
  const selfRecordIds = new Set(candidates.filter((_candidate, index) => {
    const sourcePath = files[index]?.sourcePath;
    if (!sourcePath) return false;
    const candidatePath = relative(repositoryCandidateRoot, resolve(sourcePath));
    return Boolean(candidatePath) && candidatePath !== '..' && !candidatePath.startsWith(`..${sep}`) && !isAbsolute(candidatePath);
  }).map((candidate) => candidate.id));
  const delivery = evaluateCandidateDelivery(candidates, validation.records, { selfRecordIds });
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
  await atomicWriteRestricted(destination, renderReviewPatch(files));
  const archive = await archiveDeliveredCandidates(repositoryRoot, files);
  console.log(`GitHub authentication unavailable; review patch written to ${destination}`);
  if (archive.archived.length > 0) console.log(`Archived ${archive.archived.length} delivered candidate file(s) under ${resolve(repositoryRoot, '.local', 'delivered-candidates')}.`);
  if (archive.preserved.length > 0) console.log(`Preserved ${archive.preserved.length} tracked or changed candidate file(s).`);
  console.log('Apply in a clean checkout with: git apply --check <patch>, then git apply <patch>.');
}

const isEntrypoint = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isEntrypoint) await runCli().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
