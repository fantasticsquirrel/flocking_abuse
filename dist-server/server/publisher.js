import { createServer } from 'node:http';
import { access, chmod, link, lstat, mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import yaml from 'js-yaml';
import { z } from 'zod';
import { IncidentCategorySchema, IncidentSchema } from '../src/lib/incidentSchema.js';
import { publicationContentDigest, validateDataDirectory } from '../scripts/data-utils.js';
const dataDir = process.env.DATA_DIR || '/var/lib/flocking-abuse/data';
const docsDir = process.env.DOCS_DIR || '/opt/flocking-abuse/current/docs';
const socketPath = process.env.PUBLISHER_SOCKET || '/run/flocking-abuse/publisher.sock';
const releaseSha = process.env.RELEASE_SHA || '';
if (!/^[a-f0-9]{40}$/i.test(releaseSha))
    throw new Error('RELEASE_SHA must be a full Git SHA');
const RequestSchema = z.object({
    candidateId: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    category: IncidentCategorySchema,
    outcomes: z.array(z.string().trim().min(1).max(1000)).min(1).max(20),
    reviewerNotes: z.string().trim().max(5000),
    confirmation: z.string().max(180),
}).strict().superRefine((input, context) => {
    if (input.confirmation !== `PUBLISH ${input.candidateId}`)
        context.addIssue({ code: 'custom', path: ['confirmation'], message: 'Publication confirmation does not match' });
});
async function atomicInstall(directory, filename, content) {
    await mkdir(directory, { recursive: true, mode: 0o750 });
    const destination = join(directory, filename);
    await access(destination, fsConstants.F_OK).then(() => { throw new Error(`${filename} already exists`); }).catch((error) => {
        if (error.message.endsWith('already exists'))
            throw error;
        if (error.code !== 'ENOENT')
            throw error;
    });
    const temporary = join(directory, `.${filename}.${randomBytes(8).toString('hex')}.tmp`);
    await writeFile(temporary, content, { flag: 'wx', mode: 0o640 });
    try {
        await link(temporary, destination);
    }
    finally {
        await unlink(temporary).catch(() => undefined);
    }
    await chmod(destination, 0o640);
}
async function candidateFile(candidateId) {
    const directory = join(dataDir, 'candidates');
    for (const filename of await readdir(directory)) {
        if (!/^[a-z0-9][a-z0-9.-]*\.ya?ml$/i.test(filename))
            continue;
        const path = join(directory, filename);
        const stats = await lstat(path);
        if (!stats.isFile() || stats.isSymbolicLink() || stats.nlink !== 1)
            continue;
        const parsed = IncidentSchema.safeParse(yaml.load(await readFile(path, 'utf8')));
        if (parsed.success && parsed.data.id === candidateId)
            return { filename, incident: parsed.data };
    }
    throw new Error('Candidate not found');
}
async function publish(input) {
    const existing = await validateDataDirectory(dataDir, join(docsDir, 'approvals'));
    if (!existing.valid)
        throw new Error(`Current data failed validation: ${existing.errors.join('; ')}`);
    const source = await candidateFile(input.candidateId);
    const date = new Date().toISOString().slice(0, 10);
    const approvalId = `approval-admin-publish-${input.candidateId}`;
    const approvalFilename = `${date}-${input.candidateId}.md`;
    const approvalReference = `data/approvals/${approvalFilename}#${approvalId}`;
    const incident = IncidentSchema.parse({
        ...source.incident,
        status: 'verified',
        category: input.category,
        outcomes: input.outcomes,
        review: {
            ...source.incident.review,
            approval: 'human-approved',
            reviewed_by: 'Site owner',
            reviewed_at: date,
            approval_reference: approvalReference,
            notes: input.reviewerNotes,
        },
        updated_at: date,
    });
    const contentSha = publicationContentDigest(incident);
    const metadata = {
        schema_version: 1,
        approval_id: approvalId,
        incident_id: incident.id,
        content_sha256: contentSha,
        approval_scope: 'public-incident-content-v1',
        approved_at: date,
        authorized_by: 'Site owner',
        authorization_evidence: `authenticated-admin-publication:${incident.id}`,
        base_revision: releaseSha,
    };
    const approvalDocument = `<a id="${approvalId}"></a>\n\n# Publication approval: ${incident.title}\n\nApproved from the protected admin publisher.\n\n<!-- approval-metadata\n${JSON.stringify(metadata)}\n-->\n`;
    await atomicInstall(join(dataDir, 'approvals'), approvalFilename, approvalDocument);
    try {
        await atomicInstall(join(dataDir, 'incidents'), `${incident.id}.yaml`, yaml.dump(incident, { noRefs: true, lineWidth: 120, sortKeys: false }));
    }
    catch (error) {
        await unlink(join(dataDir, 'approvals', approvalFilename)).catch(() => undefined);
        throw error;
    }
    await mkdir(join(dataDir, 'published-candidates'), { recursive: true, mode: 0o750 });
    await rename(join(dataDir, 'candidates', source.filename), join(dataDir, 'published-candidates', source.filename));
    return { incidentId: incident.id, status: 'published', publishedAt: new Date().toISOString() };
}
await mkdir(dirname(socketPath), { recursive: true, mode: 0o750 });
await unlink(socketPath).catch((error) => { if (error.code !== 'ENOENT')
    throw error; });
const server = createServer((request, response) => {
    if (request.method !== 'POST' || request.url !== '/publish') {
        response.writeHead(404).end();
        return;
    }
    const chunks = [];
    let size = 0;
    request.on('data', (chunk) => {
        size += chunk.length;
        if (size > 64 * 1024)
            request.destroy(new Error('Request too large'));
        else
            chunks.push(chunk);
    });
    request.on('end', () => {
        void (async () => {
            try {
                const input = RequestSchema.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
                const result = await publish(input);
                response.writeHead(201, { 'Content-Type': 'application/json' }).end(JSON.stringify(result));
            }
            catch (error) {
                response.writeHead(400, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: error instanceof Error ? error.message : 'Publication failed' }));
            }
        })();
    });
});
server.listen(socketPath, async () => { await chmod(socketPath, 0o660); });
//# sourceMappingURL=publisher.js.map