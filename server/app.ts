import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, link, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import bcrypt from 'bcryptjs';
import express, { type NextFunction, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import yaml from 'js-yaml';
import { z } from 'zod';
import { findDuplicates } from '../src/lib/dedupe.js';
import { IncidentSchema, IncidentTypeSchema, SourceReliabilitySchema, SourceTypeSchema, type Incident } from '../src/lib/incidentSchema.js';
import { validateDataDirectory } from '../scripts/data-utils.js';

const SESSION_COOKIE = 'flocking_admin';
const SESSION_TTL_SECONDS = 30 * 60;

const httpUrl = z.string().url().refine((value) => {
  try { return ['http:', 'https:'].includes(new URL(value).protocol); }
  catch { return false; }
}, 'URL must use http or https');
const CandidateInputSchema = z.object({
  url: httpUrl,
  archiveUrl: z.union([httpUrl, z.literal('')]).optional(),
  publisher: z.string().trim().min(1).max(200),
  title: z.string().trim().min(4).max(240),
  publishedDate: z.iso.date(),
  sourceType: SourceTypeSchema,
  reliability: SourceReliabilitySchema,
  location: z.object({
    city: z.string().trim().max(120), county: z.string().trim().max(120),
    state: z.string().trim().max(80), country: z.string().trim().min(2).max(80),
  }).strict(),
  agency: z.string().trim().min(1).max(200),
  summary: z.string().trim().min(20).max(3000),
  incidentTypes: z.array(IncidentTypeSchema).min(1),
  keyClaims: z.array(z.string().trim().min(1).max(1000)).min(1).max(20),
  notes: z.string().max(5000),
}).strict();

type CandidateInput = z.infer<typeof CandidateInputSchema>;
interface Session { exp: number; csrf: string }
export interface AppOptions {
  dataDir: string;
  passwordHash: string;
  sessionSecret: string;
  allowedOrigin: string;
  secureCookies: boolean;
  now?: () => Date;
  loginLimit?: number;
}

const cookieValue = (request: Request, name: string): string | undefined => {
  const pair = request.headers.cookie?.split(';').map((item) => item.trim()).find((item) => item.startsWith(`${name}=`));
  return pair ? decodeURIComponent(pair.slice(name.length + 1)) : undefined;
};
const signature = (payload: string, secret: string): string => createHmac('sha256', secret).update(payload).digest('base64url');
const createSessionToken = (session: Session, secret: string): string => {
  const payload = Buffer.from(JSON.stringify(session)).toString('base64url');
  return `${payload}.${signature(payload, secret)}`;
};
const readSession = (request: Request, options: AppOptions): Session | undefined => {
  const token = cookieValue(request, SESSION_COOKIE);
  if (!token) return undefined;
  const [payload, receivedSignature, extra] = token.split('.');
  if (!payload || !receivedSignature || extra) return undefined;
  const expected = signature(payload, options.sessionSecret);
  const left = Buffer.from(receivedSignature);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) return undefined;
  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Partial<Session>;
    if (typeof session.exp !== 'number' || typeof session.csrf !== 'string' || session.exp <= Math.floor((options.now?.() ?? new Date()).getTime() / 1000)) return undefined;
    return session as Session;
  } catch { return undefined; }
};
const setSessionCookie = (response: Response, value: string, secure: boolean, maxAge = SESSION_TTL_SECONDS): void => {
  response.append('Set-Cookie', `${SESSION_COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? '; Secure' : ''}`);
};
const requireOrigin = (options: AppOptions) => (request: Request, response: Response, next: NextFunction): void => {
  if (request.get('Origin') !== options.allowedOrigin) { response.status(403).json({ error: 'Origin rejected' }); return; }
  next();
};
const requireAdmin = (options: AppOptions) => (request: Request, response: Response, next: NextFunction): void => {
  const session = readSession(request, options);
  if (!session) { response.status(401).json({ error: 'Authentication required' }); return; }
  response.locals.session = session;
  next();
};
const requireCsrf = (request: Request, response: Response, next: NextFunction): void => {
  const session = response.locals.session as Session | undefined;
  const token = request.get('X-CSRF-Token');
  if (!session || !token) { response.status(403).json({ error: 'CSRF validation failed' }); return; }
  const left = Buffer.from(token);
  const right = Buffer.from(session.csrf);
  if (left.length !== right.length || !timingSafeEqual(left, right)) { response.status(403).json({ error: 'CSRF validation failed' }); return; }
  next();
};
const slugify = (value: string): string => value.toLocaleLowerCase('en-US').normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 70) || 'candidate';

function toIncident(input: CandidateInput, now: Date): Incident {
  const date = now.toISOString().slice(0, 10);
  const actor = slugify(input.agency);
  const canonicalKey = `${slugify(input.location.state || input.location.country)}/${slugify(input.location.county || input.location.city)}:${input.publishedDate.slice(0, 7)}:${actor}:${input.incidentTypes[0]}`;
  return IncidentSchema.parse({
    id: `${date}-${slugify(input.title)}`,
    title: input.title,
    status: 'candidate',
    summary: input.summary,
    incident_type: input.incidentTypes,
    location: input.location,
    actors: { agencies: [input.agency], officials_or_entities: [], vendor_entities: ['Flock Safety'] },
    dates: { occurred: input.publishedDate, discovered: date, reported: input.publishedDate },
    sources: [{
      url: input.url, title: input.title, publisher: input.publisher, published_date: input.publishedDate,
      source_type: input.sourceType, ...(input.archiveUrl ? { archive_url: input.archiveUrl } : {}),
      reliability: input.reliability, key_claims: input.keyClaims,
    }],
    legal_or_policy_context: { case_numbers: [], statutes_or_policies: [] },
    outcomes: ['Unknown — candidate awaiting review'],
    uniqueness: { canonical_key: canonicalKey, duplicate_of: null },
    review: { added_by: 'manual', reviewed_by: '', reviewed_at: '', notes: input.notes },
    updated_at: date,
  });
}

async function writeCandidate(dataDir: string, incident: Incident): Promise<string> {
  const directory = join(dataDir, 'candidates');
  await mkdir(directory, { recursive: true });
  const stem = incident.id;
  const content = yaml.dump(incident, { noRefs: true, lineWidth: 120, sortKeys: false });
  for (let suffix = 0; suffix < 1000; suffix += 1) {
    const filename = `${stem}${suffix === 0 ? '' : `-${suffix + 1}`}.yaml`;
    const destination = join(directory, filename);
    const temporary = join(directory, `.${stem}.${randomBytes(8).toString('hex')}.tmp`);
    await writeFile(temporary, content, { flag: 'wx', mode: 0o600 });
    try {
      await link(temporary, destination);
      await unlink(temporary);
      return filename;
    } catch (error) {
      await unlink(temporary).catch(() => undefined);
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
  }
  throw new Error('Unable to allocate a unique candidate filename');
}

export function createApp(options: AppOptions): express.Express {
  if (options.sessionSecret.length < 32) throw new Error('ADMIN_SESSION_SECRET must be at least 32 characters');
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');
  app.use(helmet());
  app.use(express.json({ limit: '32kb', strict: true }));
  app.use('/api/admin', (_request, response, next) => {
    response.set({ 'Cache-Control': 'no-store, max-age=0', Pragma: 'no-cache', Expires: '0' });
    next();
  });
  app.get('/health', (_request, response) => response.json({ status: 'ok' }));
  app.get('/api/admin/session', (request, response) => {
    const session = readSession(request, options);
    response.json(session ? { authenticated: true, csrfToken: session.csrf } : { authenticated: false });
  });

  const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: options.loginLimit ?? 8, standardHeaders: true, legacyHeaders: false });
  app.post('/api/admin/login', requireOrigin(options), loginLimiter, async (request, response) => {
    const supplied = z.object({ password: z.string() }).strict().safeParse(request.body);
    const valid = await bcrypt.compare(supplied.success ? supplied.data.password : '', options.passwordHash).catch(() => false);
    if (!valid || !supplied.success) { response.status(401).json({ error: 'Invalid credentials' }); return; }
    const csrf = randomBytes(24).toString('base64url');
    const nowSeconds = Math.floor((options.now?.() ?? new Date()).getTime() / 1000);
    setSessionCookie(response, createSessionToken({ exp: nowSeconds + SESSION_TTL_SECONDS, csrf }, options.sessionSecret), options.secureCookies);
    response.json({ authenticated: true, csrfToken: csrf });
  });

  app.post('/api/admin/logout', requireOrigin(options), requireAdmin(options), requireCsrf, (_request, response) => {
    setSessionCookie(response, '', options.secureCookies, 0);
    response.status(204).end();
  });

  app.post('/api/admin/candidates', requireOrigin(options), requireAdmin(options), requireCsrf, async (request, response, next) => {
    try {
      const parsed = CandidateInputSchema.safeParse(request.body);
      if (!parsed.success) { response.status(400).json({ error: 'Validation failed', issues: parsed.error.flatten() }); return; }
      const incident = toIncident(parsed.data, options.now?.() ?? new Date());
      const existingResult = await validateDataDirectory(options.dataDir);
      if (!existingResult.valid) { response.status(500).json({ error: 'Existing data failed validation' }); return; }
      const duplicates = findDuplicates(incident, existingResult.records);
      const exact = duplicates.filter((duplicate) => duplicate.score === 1);
      if (exact.length > 0) { response.status(409).json({ error: 'Exact duplicate', duplicates: exact }); return; }
      const filename = await writeCandidate(options.dataDir, incident);
      response.status(201).json({ filename, id: incident.id, duplicateWarnings: duplicates });
    } catch (error) { next(error); }
  });

  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    if (error instanceof SyntaxError) { response.status(400).json({ error: 'Invalid JSON' }); return; }
    console.error(error instanceof Error ? error.message : 'Unknown server error');
    response.status(500).json({ error: 'Internal server error' });
  });
  return app;
}
