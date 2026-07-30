import { mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';

const dataDir = resolve('.local/e2e-data');
await rm(dataDir, { recursive: true, force: true });
await Promise.all([
  mkdir(resolve(dataDir, 'incidents'), { recursive: true }),
  mkdir(resolve(dataDir, 'candidates'), { recursive: true }),
]);
console.log(`Prepared isolated E2E data directory at ${dataDir}`);
