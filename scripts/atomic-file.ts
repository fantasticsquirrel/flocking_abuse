import { chmod, open, rename, unlink } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';

export async function atomicWriteRestricted(destination: string, content: string): Promise<void> {
  const directory = dirname(destination);
  const temporary = join(directory, `.${basename(destination)}.${randomBytes(8).toString('hex')}.tmp`);
  const handle = await open(temporary, 'wx', 0o600);
  try {
    await handle.writeFile(content, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(temporary, destination);
    await chmod(destination, 0o600);
    const directoryHandle = await open(directory, 'r');
    try { await directoryHandle.sync(); }
    finally { await directoryHandle.close(); }
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}
