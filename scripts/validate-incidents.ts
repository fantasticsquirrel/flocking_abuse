import { resolve } from 'node:path';
import { validateDataDirectory } from './data-utils.js';

const dataDir = resolve(process.env.DATA_DIR ?? 'data');
const result = await validateDataDirectory(dataDir);
if (!result.valid) {
  console.error(result.errors.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`Validated ${result.records.length} incident record(s) in ${dataDir}`);
}
