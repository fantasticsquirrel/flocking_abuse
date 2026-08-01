import { createHash } from 'node:crypto';
import { access, readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import yaml from 'js-yaml';
import { z } from 'zod';
import { compareIncidents } from '../src/lib/dedupe.js';
import { IncidentSchema, type Incident } from '../src/lib/incidentSchema.js';
import { UnverifiedReportSchema, type UnverifiedReport } from '../src/lib/unverifiedSchema.js';

export interface ValidationResult {
  valid: boolean;
  records: Incident[];
  publicRecords: Incident[];
  candidateRecords: Incident[];
  errors: string[];
  unverifiedRecords: UnverifiedReport[];
}

const ApprovalMetadataSchema = z.object({
  schema_version: z.literal(1),
  approval_id: z.string().regex(/^approval-[a-z0-9-]+$/),
  incident_id: z.string().min(1),
  content_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  approval_scope: z.literal('public-incident-content-v1'),
  approved_at: z.iso.date(),
  authorized_by: z.string().min(1),
  authorization_evidence: z.string().min(1),
  base_revision: z.string().regex(/^[a-f0-9]{40}$/),
}).strict();

export function publicationContentDigest(record: Incident): string {
  const approvalNeutral = {
    ...record,
    review: { ...record.review, approval_reference: '' },
  };
  return createHash('sha256').update(JSON.stringify(approvalNeutral)).digest('hex');
}

function approvalMetadata(document: string) {
  const match = /<!-- approval-metadata\n([\s\S]*?)\n-->/.exec(document);
  if (!match?.[1]) throw new Error('approval metadata block is missing');
  return ApprovalMetadataSchema.parse(JSON.parse(match[1]));
}

async function yamlFiles(directory: string): Promise<string[]> {
  try {
    return (await readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && /\.ya?ml$/i.test(entry.name))
      .map((entry) => join(directory, entry.name))
      .sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

export async function validateDataDirectory(dataDir: string, approvalRoot = join(process.cwd(), 'docs', 'approvals')): Promise<ValidationResult> {
  const publicFiles = await yamlFiles(join(dataDir, 'incidents'));
  const candidateFiles = await yamlFiles(join(dataDir, 'candidates'));
  const unverifiedFiles = await yamlFiles(join(dataDir, 'unverified'));
  const files = [
    ...publicFiles.map((file) => ({ file, storage: 'public' as const })),
    ...candidateFiles.map((file) => ({ file, storage: 'candidate' as const })),
  ];
  const records: Incident[] = [];
  const publicRecords: Incident[] = [];
  const candidateRecords: Incident[] = [];
  const errors: string[] = [];
  const unverifiedRecords: UnverifiedReport[] = [];
  for (const file of unverifiedFiles) {
    const relativePath = relative(dataDir, file);
    try {
      const result = UnverifiedReportSchema.safeParse(yaml.load(await readFile(file, 'utf8')));
      if (!result.success) errors.push(`${relativePath}: ${result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')}`);
      else unverifiedRecords.push(result.data);
    } catch (error) { errors.push(`${relativePath}: ${error instanceof Error ? error.message : String(error)}`); }
  }
  const ids = new Map<string, string>();
  for (const { file, storage } of files) {
    const relativePath = relative(dataDir, file);
    try {
      const parsed = yaml.load(await readFile(file, 'utf8'));
      const result = IncidentSchema.safeParse(parsed);
      if (!result.success) {
        const detail = result.error.issues.map((issue) => `${issue.path.join('.') || 'record'}: ${issue.message}`).join('; ');
        errors.push(`${relativePath}: ${detail}`);
        continue;
      }
      const allowed = storage === 'public'
        ? new Set(['verified', 'disputed', 'retracted'])
        : new Set(['candidate', 'draft']);
      if (!allowed.has(result.data.status)) {
        errors.push(storage === 'public'
          ? `${relativePath}: public storage accepts only verified, disputed, or retracted status`
          : `${relativePath}: candidate storage accepts only candidate or draft status`);
        continue;
      }
      const prior = ids.get(result.data.id);
      if (prior) errors.push(`${relativePath}: duplicate id ${result.data.id} (also in ${prior})`);
      else ids.set(result.data.id, relativePath);
      records.push(result.data);
      if (storage === 'public') publicRecords.push(result.data);
      else candidateRecords.push(result.data);
    } catch (error) {
      errors.push(`${relativePath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  let approvalDocumentsAvailable = true;
  try { await access(approvalRoot); }
  catch (error) {
    approvalDocumentsAvailable = false;
    errors.push(`approval document root cannot be read: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (approvalDocumentsAvailable) {
    const usedApprovalReferences = new Map<string, string>();
    for (const record of publicRecords) {
      const reference = record.review.approval_reference;
      const priorRecord = usedApprovalReferences.get(reference);
      if (priorRecord) errors.push(`${record.id}: approval reference is already used by ${priorRecord}`);
      else usedApprovalReferences.set(reference, record.id);
      const [documentPath, anchor] = reference.split('#');
      try {
        const approvalFilename = (documentPath ?? '').replace(/^docs\/approvals\//, '');
        const document = await readFile(join(approvalRoot, approvalFilename), 'utf8');
        if (!anchor || !document.includes(`<a id="${anchor}"></a>`)) {
          errors.push(`${record.id}: approval reference anchor is missing from ${documentPath}`);
          continue;
        }
        const metadata = approvalMetadata(document);
        if (metadata.approval_id !== anchor) errors.push(`${record.id}: approval metadata id does not match the referenced anchor`);
        if (metadata.incident_id !== record.id) errors.push(`${record.id}: approval incident id does not match the accepted record`);
        if (metadata.content_sha256 !== publicationContentDigest(record)) errors.push(`${record.id}: approval content digest does not match the accepted record`);
        if (metadata.approved_at !== record.review.reviewed_at) errors.push(`${record.id}: approval date does not match the record review date`);
        if (metadata.authorized_by !== record.review.reviewed_by) errors.push(`${record.id}: approval authority does not match the record reviewer`);
      } catch (error) {
        errors.push(`${record.id}: approval reference document cannot be read or validated: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  for (let left = 0; left < records.length; left += 1) {
    for (let right = left + 1; right < records.length; right += 1) {
      const first = records[left];
      const second = records[right];
      if (!first || !second) continue;
      const comparison = compareIncidents(first, second);
      if (comparison.classification === 'exact') {
        errors.push(`exact duplicate ${first.id} and ${second.id}: ${comparison.reasons.join(', ')}`);
      }
    }
  }
  return { valid: errors.length === 0, records, publicRecords, candidateRecords, unverifiedRecords, errors };
}

export async function buildPublicData(dataDir: string, includeReview = false, approvalRoot = join(process.cwd(), 'docs', 'approvals')): Promise<Incident[]> {
  const result = await validateDataDirectory(dataDir, approvalRoot);
  if (!result.valid) throw new Error(`Incident data validation failed:\n${result.errors.join('\n')}`);
  const records = includeReview ? [...result.publicRecords, ...result.candidateRecords] : result.publicRecords;
  return records.sort((left, right) => left.id.localeCompare(right.id));
}
