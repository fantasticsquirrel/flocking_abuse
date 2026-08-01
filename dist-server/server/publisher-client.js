import http from 'node:http';
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
                        reject(new Error(payload.error || 'Publisher rejected the request'));
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