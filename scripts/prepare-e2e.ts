import { cp, mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';

const dataDir = resolve('.local/e2e-data');
await rm(dataDir, { recursive: true, force: true });
await Promise.all([
  cp(resolve('data', 'incidents'), resolve(dataDir, 'incidents'), { recursive: true }),
  cp(resolve('data', 'approvals'), resolve(dataDir, 'approvals'), { recursive: true }),
  mkdir(resolve(dataDir, 'candidates'), { recursive: true }),
  cp(resolve('data', 'unverified'), resolve(dataDir, 'unverified'), { recursive: true }),
]);
console.log(`Prepared isolated E2E data directory at ${dataDir}`);
