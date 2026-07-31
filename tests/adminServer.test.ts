import { mkdtemp, mkdir, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../server/app.js';
import { buildPublicData } from '../scripts/data-utils.js';
import { bootstrapAdmin } from '../scripts/bootstrap-admin.js';

let passwordHash = '';
beforeAll(async () => { passwordHash = await bcrypt.hash('correct horse battery staple', 4); });
const roots: string[] = [];
const makeHarness = async () => {
  const root = await mkdtemp(join(tmpdir(), 'flocking-admin-'));
  roots.push(root);
  const dataDir = join(root, 'data');
  await mkdir(join(dataDir, 'incidents'), { recursive: true });
  await mkdir(join(dataDir, 'candidates'), { recursive: true });
  const app = createApp({
    dataDir,
    passwordHash,
    sessionSecret: 'test-session-secret-that-is-long-enough-123',
    allowedOrigin: 'https://tracker.test',
    secureCookies: false,
    now: () => new Date('2026-07-30T12:00:00Z'),
  });
  return { root, dataDir, agent: request.agent(app), app };
};
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

const validCandidate = {
  url: 'https://news.example.org/flock-audit',
  archiveUrl: 'https://web.archive.org/example',
  publisher: 'Example News',
  title: 'Reported camera access audit finding',
  publishedDate: '2026-07-29',
  sourceType: 'news',
  reliability: 'corroborating',
  location: { city: 'Example City', county: 'Example', state: 'EX', country: 'US' },
  agency: 'Example Police Department',
  summary: 'Example News reported a synthetic audit finding for integration testing only.',
  incidentTypes: ['retention-or-access-policy'],
  keyClaims: ['The source reported a synthetic audit finding.'],
  notes: 'Synthetic integration record.',
};

async function login(agent: ReturnType<typeof request.agent>) {
  const response = await agent.post('/api/admin/login').set('Origin', 'https://tracker.test').send({ password: 'correct horse battery staple' });
  expect(response.status).toBe(200);
  return response.body.csrfToken as string;
}

describe('admin API security', () => {
  it('returns health and an unauthenticated session without exposing secrets', async () => {
    const { app } = await makeHarness();
    expect((await request(app).get('/live')).body).toEqual({ status: 'ok' });
    expect((await request(app).get('/health')).body).toEqual({ status: 'ready' });
    const response = await request(app).get('/api/admin/session');
    expect(response.body).toEqual({ authenticated: false });
    expect(response.headers['cache-control']).toContain('no-store');
    expect(response.headers.pragma).toBe('no-cache');
    expect(JSON.stringify(response.body)).not.toContain('secret');
    expect(app.get('trust proxy')).toBe('loopback');
  });

  it('rejects a wrong password and establishes a signed HTTP-only session for the correct password', async () => {
    const { agent } = await makeHarness();
    const wrong = await agent.post('/api/admin/login').set('Origin', 'https://tracker.test').send({ password: 'wrong' });
    expect(wrong.status).toBe(401);
    expect(wrong.body).toEqual({ error: 'Invalid credentials' });
    const loginResponse = await agent.post('/api/admin/login').set('Origin', 'https://tracker.test').send({ password: 'correct horse battery staple' });
    expect(loginResponse.status).toBe(200);
    const csrfToken = loginResponse.body.csrfToken as string;
    expect(csrfToken).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    expect(String(loginResponse.headers['set-cookie'])).toMatch(/HttpOnly.*SameSite=Strict/i);
    const session = await agent.get('/api/admin/session');
    expect(session.body).toEqual({ authenticated: true, csrfToken });
  });

  it('requires authentication, trusted origin, and CSRF for candidate mutations', async () => {
    const { agent } = await makeHarness();
    expect((await agent.post('/api/admin/candidates').set('Origin', 'https://tracker.test').send(validCandidate)).status).toBe(401);
    const csrfToken = await login(agent);
    expect((await agent.post('/api/admin/candidates').set('Origin', 'https://evil.test').set('X-CSRF-Token', csrfToken).send(validCandidate)).status).toBe(403);
    expect((await agent.post('/api/admin/candidates').set('Origin', 'https://tracker.test').send(validCandidate)).status).toBe(403);
  });

  it('validates submissions, writes sanitized unique YAML atomically, and never publishes candidates', async () => {
    const { agent, dataDir } = await makeHarness();
    const csrfToken = await login(agent);
    const invalid = await agent.post('/api/admin/candidates').set('Origin', 'https://tracker.test').set('X-CSRF-Token', csrfToken).send({ ...validCandidate, url: 'file:///etc/passwd' });
    expect(invalid.status).toBe(400);
    expect(invalid.body.error).toBe('Validation failed');
    const payload = { ...validCandidate, title: '../../../../../unsafe title' };
    const created = await agent.post('/api/admin/candidates').set('Origin', 'https://tracker.test').set('X-CSRF-Token', csrfToken).send(payload);
    expect(created.status).toBe(201);
    expect(created.body.duplicateWarnings).toEqual([]);
    expect(basename(created.body.filename)).toBe(created.body.filename);
    expect(resolve(dataDir, 'candidates', created.body.filename).startsWith(resolve(dataDir, 'candidates'))).toBe(true);
    const files = await readdir(join(dataDir, 'candidates'));
    expect(files).toEqual([created.body.filename]);
    expect(await buildPublicData(dataDir)).toEqual([]);
    expect(await readFile(join(dataDir, 'candidates', created.body.filename), 'utf8')).toMatch(/status: candidate/);
  });

  it('rejects exact duplicates rather than creating a second file', async () => {
    const { agent, dataDir } = await makeHarness();
    const csrfToken = await login(agent);
    const first = await agent.post('/api/admin/candidates').set('Origin', 'https://tracker.test').set('X-CSRF-Token', csrfToken).send(validCandidate);
    expect(first.status).toBe(201);
    const duplicate = await agent.post('/api/admin/candidates').set('Origin', 'https://tracker.test').set('X-CSRF-Token', csrfToken).send({ ...validCandidate, title: 'Follow-up title' });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.duplicates[0].reasons).toContain('canonical source URL match');
    expect((await readdir(join(dataDir, 'candidates'))).length).toBe(1);
  });

  it('serializes concurrent duplicate submissions into one creation and one conflict', async () => {
    const { agent, dataDir } = await makeHarness();
    const csrfToken = await login(agent);
    const submit = () => agent.post('/api/admin/candidates')
      .set('Origin', 'https://tracker.test')
      .set('X-CSRF-Token', csrfToken)
      .send(validCandidate);
    const responses = await Promise.all([submit(), submit()]);
    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    expect((await readdir(join(dataDir, 'candidates'))).length).toBe(1);
  });

  it('treats malformed cookies as unauthenticated and oversized JSON as 413', async () => {
    const { app } = await makeHarness();
    const malformed = await request(app).get('/api/admin/session').set('Cookie', 'flocking_admin=%E0%A4%A');
    expect(malformed.status).toBe(200);
    expect(malformed.body).toEqual({ authenticated: false });
    const oversized = await request(app).post('/api/admin/login')
      .set('Origin', 'https://tracker.test')
      .set('Content-Type', 'application/json')
      .send({ password: 'x'.repeat(33_000) });
    expect(oversized.status).toBe(413);
    expect(oversized.body).toEqual({ error: 'Request body too large' });
  });

  it('logs out only with a valid CSRF token and clears the session', async () => {
    const { agent } = await makeHarness();
    const csrfToken = await login(agent);
    expect((await agent.post('/api/admin/logout').set('Origin', 'https://tracker.test')).status).toBe(403);
    expect((await agent.post('/api/admin/logout').set('Origin', 'https://tracker.test').set('X-CSRF-Token', csrfToken)).status).toBe(204);
    expect((await agent.get('/api/admin/session')).body.authenticated).toBe(false);
  });
});

describe('admin bootstrap', () => {
  it('writes mode-0600 password and env snippet files without logging secret values', async () => {
    const root = await mkdtemp(join(tmpdir(), 'flocking-bootstrap-'));
    roots.push(root);
    const messages: string[] = [];
    const result = await bootstrapAdmin(root, (message: string) => messages.push(message), 4);
    expect((await stat(result.passwordPath)).mode & 0o777).toBe(0o600);
    expect((await stat(result.envPath)).mode & 0o777).toBe(0o600);
    const password = (await readFile(result.passwordPath, 'utf8')).trim();
    const env = await readFile(result.envPath, 'utf8');
    expect(password.length).toBeGreaterThanOrEqual(32);
    expect(env).toMatch(/^ADMIN_PASSWORD_HASH=\$2/m);
    expect(env).toMatch(/^ADMIN_SESSION_SECRET=.{32,}$/m);
    expect(messages.join('\n')).not.toContain(password);
    expect(messages.join('\n')).not.toContain(env.split('=')[1]);
  });
});
