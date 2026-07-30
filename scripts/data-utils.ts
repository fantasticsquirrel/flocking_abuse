import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import yaml from 'js-yaml';
import { IncidentSchema, type Incident } from '../src/lib/incidentSchema.js';

export interface ValidationResult { valid: boolean; records: Incident[]; errors: string[] }

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

export async function validateDataDirectory(dataDir: string): Promise<ValidationResult> {
  const files = [
    ...(await yamlFiles(join(dataDir, 'incidents'))),
    ...(await yamlFiles(join(dataDir, 'candidates'))),
  ];
  const records: Incident[] = [];
  const errors: string[] = [];
  const ids = new Map<string, string>();
  for (const file of files) {
    try {
      const parsed = yaml.load(await readFile(file, 'utf8'));
      const result = IncidentSchema.safeParse(parsed);
      if (!result.success) {
        const detail = result.error.issues.map((issue) => `${issue.path.join('.') || 'record'}: ${issue.message}`).join('; ');
        errors.push(`${relative(dataDir, file)}: ${detail}`);
        continue;
      }
      const prior = ids.get(result.data.id);
      if (prior) errors.push(`${relative(dataDir, file)}: duplicate id ${result.data.id} (also in ${prior})`);
      else ids.set(result.data.id, relative(dataDir, file));
      records.push(result.data);
    } catch (error) {
      errors.push(`${relative(dataDir, file)}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { valid: errors.length === 0, records, errors };
}

export async function buildPublicData(dataDir: string, includeDrafts = false): Promise<Incident[]> {
  const result = await validateDataDirectory(dataDir);
  if (!result.valid) throw new Error(`Incident data validation failed:\n${result.errors.join('\n')}`);
  const statuses = includeDrafts ? new Set(['candidate', 'draft', 'verified', 'disputed', 'retracted']) : new Set(['verified', 'disputed']);
  return result.records.filter((record) => statuses.has(record.status)).sort((left, right) => left.id.localeCompare(right.id));
}
