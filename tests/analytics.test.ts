import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { AnalyticsStore } from '../server/analytics.js';
import { createApp } from '../server/app.js';

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe('privacy-preserving analytics', () => {
  it('counts repeat views without inflating daily or all-time unique visitors and stores only keyed hashes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'flocking-analytics-'));
    roots.push(root);
    const path = join(root, 'analytics.json');
    const store = new AnalyticsStore(path, 'test-secret-long-enough-to-key-hashes', () => new Date('2026-08-01T10:00:00Z'));
    await store.record('visitor-one-identifier-that-is-long-enough');
    await store.record('visitor-one-identifier-that-is-long-enough');
    const result = await store.record('visitor-two-identifier-that-is-long-enough');
    expect(result).toMatchObject({ today: { pageViews: 3, visitors: 2 }, totalPageViews: 3, totalVisitors: 2 });
    const stored = await readFile(path, 'utf8');
    expect(stored).not.toContain('visitor-one');
    expect(stored).not.toContain('visitor-two');
  });

  it('sets a first-party HTTP-only visitor cookie, ignores bots, and protects detailed analytics with admin auth', async () => {
    const root = await mkdtemp(join(tmpdir(), 'flocking-analytics-api-'));
    roots.push(root);
    const dataDir = join(root, 'data');
    await Promise.all(['incidents', 'candidates', 'unverified', 'analytics'].map((name) => mkdir(join(dataDir, name), { recursive: true })));
    const now = () => new Date('2026-08-01T10:00:00Z');
    const analyticsStore = new AnalyticsStore(join(dataDir, 'analytics', 'analytics.json'), 'analytics-hash-secret-that-is-long-enough', now);
    const app = createApp({ dataDir, passwordHash: await bcrypt.hash('password', 4), sessionSecret: 'session-secret-that-is-long-enough-12345', allowedOrigin: 'https://tracker.test', secureCookies: false, now, analyticsStore });
    const human = request.agent(app);
    const first = await human.post('/api/analytics/visit').set('User-Agent', 'Mozilla/5.0');
    expect(first.body).toEqual({ today: { visitors: 1 }, totalVisitors: 1 });
    expect(String(first.headers['set-cookie'])).toMatch(/fat_visitor=.*HttpOnly.*SameSite=Lax/i);
    expect((await human.post('/api/analytics/visit').set('User-Agent', 'Mozilla/5.0')).body.totalVisitors).toBe(1);
    expect((await request(app).post('/api/analytics/visit').set('User-Agent', 'ExampleBot/1.0')).body.totalVisitors).toBe(1);
    expect((await request(app).get('/api/admin/analytics')).status).toBe(401);
    const login = await human.post('/api/admin/login').set('Origin', 'https://tracker.test').send({ password: 'password' });
    const detailed = await human.get('/api/admin/analytics');
    expect(login.status).toBe(200);
    expect(detailed.body).toMatchObject({ today: { pageViews: 2, visitors: 1 }, totalPageViews: 2, totalVisitors: 1 });
    expect(JSON.stringify(detailed.body)).not.toContain('visitorHashes');
  });
});
