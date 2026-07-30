import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { buildPublicData } from './data-utils.js';

const dataDir = resolve(process.env.DATA_DIR ?? 'data');
const output = resolve(process.env.INCIDENTS_OUTPUT ?? 'src/data/incidents.json');
const records = await buildPublicData(dataDir, process.env.INCLUDE_DRAFTS === '1');
await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(records, null, 2)}\n`, { encoding: 'utf8' });
console.log(`Built ${records.length} public incident record(s) at ${output}`);
