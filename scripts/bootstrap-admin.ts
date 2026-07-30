import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';

export interface BootstrapResult { passwordPath: string; envPath: string }

export async function bootstrapAdmin(root = '.local', log: (message: string) => void = console.log, rounds = 12): Promise<BootstrapResult> {
  const directory = resolve(root);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  const password = randomBytes(32).toString('base64url');
  const passwordHash = await bcrypt.hash(password, rounds);
  const sessionSecret = randomBytes(48).toString('base64url');
  const passwordPath = resolve(directory, 'admin-password.txt');
  const envPath = resolve(directory, 'admin-env.txt');
  await writeFile(passwordPath, `${password}\n`, { mode: 0o600, flag: 'w' });
  await chmod(passwordPath, 0o600);
  await writeFile(envPath, `ADMIN_PASSWORD_HASH=${passwordHash}\nADMIN_SESSION_SECRET=${sessionSecret}\n`, { mode: 0o600, flag: 'w' });
  await chmod(envPath, 0o600);
  log(`Admin bootstrap written. Password: ${passwordPath}`);
  log(`Environment snippet: ${envPath}`);
  log('Read those mode-0600 files locally; no secret values were printed.');
  return { passwordPath, envPath };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  await bootstrapAdmin();
}
