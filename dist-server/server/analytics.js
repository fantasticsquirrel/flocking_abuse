import { createHmac, randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
const emptyStore = () => ({ version: 1, totalPageViews: 0, visitorHashes: [], days: {} });
export class AnalyticsStore {
    path;
    secret;
    now;
    queue = Promise.resolve();
    constructor(path, secret, now = () => new Date()) {
        this.path = path;
        this.secret = secret;
        this.now = now;
    }
    async read() {
        try {
            return JSON.parse(await readFile(this.path, 'utf8'));
        }
        catch (error) {
            if (error.code === 'ENOENT')
                return emptyStore();
            throw error;
        }
    }
    async write(store) {
        await mkdir(dirname(this.path), { recursive: true });
        const temporary = `${this.path}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
        await writeFile(temporary, `${JSON.stringify(store)}\n`, { mode: 0o600 });
        await rename(temporary, this.path);
    }
    hash(visitorId) {
        return createHmac('sha256', this.secret).update(visitorId).digest('base64url');
    }
    async record(visitorId) {
        let result;
        const operation = this.queue.then(async () => {
            const store = await this.read();
            const date = this.now().toISOString().slice(0, 10);
            const hash = this.hash(visitorId);
            const day = store.days[date] ?? { pageViews: 0, visitorHashes: [] };
            day.pageViews += 1;
            if (!day.visitorHashes.includes(hash))
                day.visitorHashes.push(hash);
            store.days[date] = day;
            store.totalPageViews += 1;
            if (!store.visitorHashes.includes(hash))
                store.visitorHashes.push(hash);
            await this.write(store);
            result = this.summarize(store, date);
        });
        this.queue = operation.catch(() => undefined);
        await operation;
        return result;
    }
    async summary() {
        await this.queue;
        return this.summarize(await this.read(), this.now().toISOString().slice(0, 10));
    }
    summarize(store, today) {
        const current = store.days[today] ?? { pageViews: 0, visitorHashes: [] };
        return {
            today: { date: today, pageViews: current.pageViews, visitors: current.visitorHashes.length },
            totalPageViews: store.totalPageViews,
            totalVisitors: store.visitorHashes.length,
            daily: Object.entries(store.days).sort(([left], [right]) => right.localeCompare(left)).slice(0, 90)
                .map(([date, value]) => ({ date, pageViews: value.pageViews, visitors: value.visitorHashes.length })),
        };
    }
}
//# sourceMappingURL=analytics.js.map