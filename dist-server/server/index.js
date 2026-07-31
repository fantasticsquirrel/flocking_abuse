import { constants as fsConstants } from 'node:fs';
import { access, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import express from 'express';
import { marked } from 'marked';
import { z } from 'zod';
import { createApp } from './app.js';
import { validateDataDirectory } from '../scripts/data-utils.js';
const portSchema = z.coerce.number().int().min(1).max(65_535);
const originSchema = z.string().url().superRefine((value, context) => {
    const parsed = new URL(value);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== value.replace(/\/$/, '') || parsed.username || parsed.password) {
        context.addIssue({ code: 'custom', message: 'APP_ORIGIN must be an http(s) origin without a path or credentials' });
    }
});
const requireValue = (env, name) => {
    const value = env[name]?.trim();
    if (!value)
        throw new Error(`${name} is required`);
    return value;
};
export function readRuntimeConfig(env, cwd = process.cwd()) {
    const nodeEnv = env.NODE_ENV?.trim() || 'development';
    const passwordHash = requireValue(env, 'ADMIN_PASSWORD_HASH');
    if (!/^\$2[aby]\$\d{2}\$[^\s]{53}$/.test(passwordHash))
        throw new Error('ADMIN_PASSWORD_HASH must be a bcrypt hash');
    const sessionSecret = requireValue(env, 'ADMIN_SESSION_SECRET');
    if (sessionSecret.length < 32)
        throw new Error('ADMIN_SESSION_SECRET must be at least 32 characters');
    const parsedPort = portSchema.safeParse(env.PORT ?? '4173');
    if (!parsedPort.success)
        throw new Error('PORT must be an integer from 1 through 65535');
    const fallbackOrigin = `http://127.0.0.1:${parsedPort.data}`;
    const origin = nodeEnv === 'production' ? requireValue(env, 'APP_ORIGIN') : (env.APP_ORIGIN?.trim() || fallbackOrigin);
    const parsedOrigin = originSchema.safeParse(origin.replace(/\/$/, ''));
    if (!parsedOrigin.success)
        throw new Error(`APP_ORIGIN is invalid: ${parsedOrigin.error.issues.map((issue) => issue.message).join('; ')}`);
    if (nodeEnv === 'production' && new URL(parsedOrigin.data).protocol !== 'https:')
        throw new Error('APP_ORIGIN must use https in production');
    const releaseSha = nodeEnv === 'production' ? requireValue(env, 'RELEASE_SHA') : (env.RELEASE_SHA?.trim() || 'development');
    if (nodeEnv === 'production' && !/^[a-f0-9]{40}$/i.test(releaseSha))
        throw new Error('RELEASE_SHA must be a full 40-character Git commit SHA');
    return {
        nodeEnv,
        host: '127.0.0.1',
        port: parsedPort.data,
        dataDir: resolve(cwd, env.DATA_DIR || 'data'),
        distDir: resolve(cwd, env.DIST_DIR || 'dist'),
        docsDir: resolve(cwd, env.DOCS_DIR || 'docs'),
        passwordHash,
        sessionSecret,
        allowedOrigin: parsedOrigin.data,
        secureCookies: nodeEnv === 'production',
        releaseSha,
    };
}
export function createProductionApp(config) {
    const app = createApp({
        dataDir: config.dataDir,
        approvalRoot: resolve(config.docsDir, 'approvals'),
        passwordHash: config.passwordHash,
        sessionSecret: config.sessionSecret,
        allowedOrigin: config.allowedOrigin,
        secureCookies: config.secureCookies,
        readiness: async () => {
            try {
                await access(resolve(config.distDir, 'index.html'), fsConstants.R_OK);
                await access(resolve(config.dataDir, 'candidates'), fsConstants.R_OK | fsConstants.W_OK);
                const validation = await validateDataDirectory(config.dataDir, resolve(config.docsDir, 'approvals'));
                if (!validation.valid)
                    return { ready: false, release: config.releaseSha, error: 'Incident data validation failed' };
                return { ready: true, release: config.releaseSha };
            }
            catch (error) {
                return { ready: false, release: config.releaseSha, error: error instanceof Error ? error.message : 'Readiness check failed' };
            }
        },
    });
    const documentation = new Map([
        ['source-policy', 'Source policy'],
        ['reporting-format', 'Reporting format'],
        ['manual-admin', 'Admin manual'],
        ['automation', 'Discovery automation'],
        ['dedupe-policy', 'Deduplication policy'],
    ]);
    app.get('/docs/:document.html', async (request, response, next) => {
        try {
            const documentName = request.params.document ?? '';
            const title = documentation.get(documentName);
            if (!title) {
                response.status(404).json({ error: 'Not found' });
                return;
            }
            const markdown = await readFile(resolve(config.docsDir, `${documentName}.md`), 'utf8');
            const content = await marked.parse(markdown, { gfm: true });
            response.type('html').send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} — Flocking Abuse Tracker</title><style>body{max-width:76ch;margin:auto;padding:2rem;font:18px/1.65 system-ui;background:#050907;color:#eef8ee}a{color:#72ff9d}code,pre{background:#0d1712}pre{padding:1rem;overflow:auto}</style></head><body><header><nav aria-label="Primary"><a href="/">Public ledger</a> · <a href="/admin">Admin intake</a></nav></header><main>${content}</main></body></html>`);
        }
        catch (error) {
            next(error);
        }
    });
    app.use('/docs', express.static(config.docsDir, {
        dotfiles: 'deny',
        fallthrough: true,
        index: false,
        maxAge: config.nodeEnv === 'production' ? '1h' : 0,
    }));
    app.use(express.static(config.distDir, {
        dotfiles: 'deny',
        fallthrough: true,
        index: 'index.html',
        maxAge: config.nodeEnv === 'production' ? '1h' : 0,
    }));
    app.use((request, response, next) => {
        if (request.method !== 'GET' || request.path.startsWith('/api/') || request.path.startsWith('/docs/')) {
            next();
            return;
        }
        response.sendFile('index.html', { root: config.distDir, dotfiles: 'deny' }, (error) => {
            if (error)
                next(error);
        });
    });
    app.use((_request, response) => response.status(404).json({ error: 'Not found' }));
    return app;
}
const isEntrypoint = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isEntrypoint) {
    try {
        const config = readRuntimeConfig(process.env);
        const app = createProductionApp(config);
        app.listen(config.port, config.host, () => {
            console.log(`Flocking Abuse Tracker listening on http://${config.host}:${config.port}`);
        });
    }
    catch (error) {
        console.error(error instanceof Error ? error.message : 'Unable to start Flocking Abuse Tracker');
        process.exitCode = 1;
    }
}
//# sourceMappingURL=index.js.map