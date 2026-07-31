import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import yaml from 'js-yaml';
import { IncidentSchema } from '../src/lib/incidentSchema.js';
async function yamlFiles(directory) {
    try {
        return (await readdir(directory, { withFileTypes: true }))
            .filter((entry) => entry.isFile() && /\.ya?ml$/i.test(entry.name))
            .map((entry) => join(directory, entry.name))
            .sort();
    }
    catch (error) {
        if (error.code === 'ENOENT')
            return [];
        throw error;
    }
}
export async function validateDataDirectory(dataDir) {
    const publicFiles = await yamlFiles(join(dataDir, 'incidents'));
    const candidateFiles = await yamlFiles(join(dataDir, 'candidates'));
    const files = [
        ...publicFiles.map((file) => ({ file, storage: 'public' })),
        ...candidateFiles.map((file) => ({ file, storage: 'candidate' })),
    ];
    const records = [];
    const publicRecords = [];
    const candidateRecords = [];
    const errors = [];
    const ids = new Map();
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
            if (prior)
                errors.push(`${relativePath}: duplicate id ${result.data.id} (also in ${prior})`);
            else
                ids.set(result.data.id, relativePath);
            records.push(result.data);
            if (storage === 'public')
                publicRecords.push(result.data);
            else
                candidateRecords.push(result.data);
        }
        catch (error) {
            errors.push(`${relativePath}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    return { valid: errors.length === 0, records, publicRecords, candidateRecords, errors };
}
export async function buildPublicData(dataDir, includeHistorical = false) {
    const result = await validateDataDirectory(dataDir);
    if (!result.valid)
        throw new Error(`Incident data validation failed:\n${result.errors.join('\n')}`);
    const statuses = includeHistorical ? new Set(['verified', 'disputed', 'retracted']) : new Set(['verified', 'disputed']);
    return result.publicRecords.filter((record) => statuses.has(record.status)).sort((left, right) => left.id.localeCompare(right.id));
}
//# sourceMappingURL=data-utils.js.map