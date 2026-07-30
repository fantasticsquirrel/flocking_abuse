import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import express from 'express';
import { z } from 'zod';
import { createApp } from './app.js';
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
    };
}
export function createProductionApp(config) {
    const app = createApp({
        dataDir: config.dataDir,
        passwordHash: config.passwordHash,
        sessionSecret: config.sessionSecret,
        allowedOrigin: config.allowedOrigin,
        secureCookies: config.secureCookies,
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