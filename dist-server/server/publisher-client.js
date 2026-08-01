import http from 'node:http';
export class PublisherRejectionError extends Error {
    statusCode;
    constructor(message, statusCode) {
        super(message);
        this.statusCode = statusCode;
        this.name = 'PublisherRejectionError';
    }
}
export function createPublisherClient(socketPath) {
    return (input) => new Promise((resolve, reject) => {
        const body = JSON.stringify(input);
        const request = http.request({
            socketPath,
            path: '/publish',
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
            timeout: 20_000,
        }, (response) => {
            const chunks = [];
            response.on('data', (chunk) => chunks.push(chunk));
            response.on('end', () => {
                try {
                    const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
                    if (response.statusCode !== 201) {
                        const statusCode = response.statusCode && response.statusCode >= 400 && response.statusCode < 500
                            ? response.statusCode
                            : 502;
                        reject(new PublisherRejectionError(payload.error || 'Publisher rejected the request', statusCode));
                        return;
                    }
                    resolve(payload);
                }
                catch (error) {
                    reject(error);
                }
            });
        });
        request.on('timeout', () => request.destroy(new Error('Publisher timed out')));
        request.on('error', reject);
        request.end(body);
    });
}
//# sourceMappingURL=publisher-client.js.map