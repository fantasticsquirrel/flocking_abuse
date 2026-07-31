import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { createProductionApp, readRuntimeConfig } from '../server/index.js';

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

const validEnv = {
  NODE_ENV: 'production',
  ADMIN_PASSWORD_HASH: '$2b$04$p0ebYL5Qf.wGWel0.6WHO./g3KFgN/zTwaspLDvDD9.zlcPE7sqgm',
  ADMIN_SESSION_SECRET: 'a-production-session-secret-with-more-than-32-bytes',
  APP_ORIGIN: 'https://tracker.example.org',
  PORT: '4173',
  RELEASE_SHA: '0123456789abcdef0123456789abcdef01234567',
};

describe('production server configuration', () => {
  it('fails closed when required production settings are missing or unsafe', () => {
    expect(() => readRuntimeConfig({ NODE_ENV: 'production' }, '/srv/tracker')).toThrow(/ADMIN_PASSWORD_HASH/);
    expect(() => readRuntimeConfig({ ...validEnv, APP_ORIGIN: 'javascript:alert(1)' }, '/srv/tracker')).toThrow(/APP_ORIGIN/);
    expect(() => readRuntimeConfig({ ...validEnv, ADMIN_SESSION_SECRET: 'short' }, '/srv/tracker')).toThrow(/ADMIN_SESSION_SECRET/);
    expect(() => readRuntimeConfig({ ...validEnv, PORT: '70000' }, '/srv/tracker')).toThrow(/PORT/);
    expect(() => readRuntimeConfig({ ...validEnv, APP_ORIGIN: 'http://tracker.example.org' }, '/srv/tracker')).toThrow(/https/i);
  });

  it('binds to loopback and resolves data, static, and docs paths from the working directory', () => {
    const config = readRuntimeConfig(validEnv, '/srv/tracker');
    expect(config.host).toBe('127.0.0.1');
    expect(config.dataDir).toBe('/srv/tracker/data');
    expect(config.distDir).toBe('/srv/tracker/dist');
    expect(config.docsDir).toBe('/srv/tracker/docs');
    expect(config.secureCookies).toBe(true);
  });

  it('serves health, real documentation downloads, static assets, and SPA product routes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'flocking-server-'));
    roots.push(root);
    await mkdir(join(root, 'dist', 'assets'), { recursive: true });
    await mkdir(join(root, 'docs', 'approvals'), { recursive: true });
    await mkdir(join(root, 'data', 'candidates'), { recursive: true });
    await writeFile(join(root, 'dist', 'index.html'), '<!doctype html><title>tracker app</title><div id="root"></div>');
    await writeFile(join(root, 'dist', 'assets', 'app.js'), 'console.log("static")');
    await writeFile(join(root, 'docs', 'source-policy.md'), '# Source Policy');
    const config = readRuntimeConfig({ ...validEnv, NODE_ENV: 'test', DATA_DIR: join(root, 'data'), DIST_DIR: join(root, 'dist'), DOCS_DIR: join(root, 'docs') }, root);
    const app = createProductionApp(config);
    expect((await request(app).get('/live')).body).toEqual({ status: 'ok' });
    expect((await request(app).get('/health')).body).toMatchObject({ status: 'ready' });
    const documentation = await request(app).get('/docs/source-policy.html');
    expect(documentation.status).toBe(200);
    expect(documentation.type).toMatch(/html/);
    expect(documentation.text).toContain('<h1>Source Policy</h1>');
    expect((await request(app).get('/assets/app.js')).text).toContain('static');
    expect((await request(app).get('/admin')).text).toContain('tracker app');
    expect((await request(app).get('/../../etc/passwd')).status).toBe(200);
    expect((await request(app).get('/docs/not-present.md')).status).toBe(404);
  });
});
