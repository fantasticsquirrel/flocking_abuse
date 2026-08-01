import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { buildPublicData } from './data-utils.js';

const dataDir = resolve(process.env.DATA_DIR ?? 'data');
const output = resolve(process.env.INCIDENTS_OUTPUT ?? 'src/data/incidents.json');
const unverifiedOutput = resolve(process.env.UNVERIFIED_OUTPUT ?? 'src/data/unverified.json');
const includeReview = process.env.INCLUDE_DRAFTS === '1';
if (includeReview && process.env.NODE_ENV === 'production') throw new Error('INCLUDE_DRAFTS is a local-review option and is forbidden in production');
const records = await buildPublicData(dataDir, includeReview);
await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(records, null, 2)}\n`, { encoding: 'utf8' });
const validation = await (await import('./data-utils.js')).validateDataDirectory(dataDir);
await mkdir(dirname(unverifiedOutput), { recursive: true });
await writeFile(unverifiedOutput, `${JSON.stringify(validation.unverifiedRecords, null, 2)}\n`, { encoding: 'utf8' });
console.log(`Built ${records.length} public incident record(s) at ${output}`);
console.log(`Built ${validation.unverifiedRecords.length} reported-but-unverified record(s) at ${unverifiedOutput}`);
