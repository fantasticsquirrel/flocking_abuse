import http from 'node:http';
import type { PublicationInput, PublicationResult } from './app.js';

export class PublisherRejectionError extends Error {
  constructor(message: string, readonly statusCode: number) {
    super(message);
    this.name = 'PublisherRejectionError';
  }
}

export function createPublisherClient(socketPath: string): (input: PublicationInput) => Promise<PublicationResult> {
  return (input) => new Promise((resolve, reject) => {
    const body = JSON.stringify(input);
    const request = http.request({
      socketPath,
      path: '/publish',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      timeout: 20_000,
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => {
        try {
          const payload = JSON.parse(Buffer.concat(chunks).toString('utf8')) as PublicationResult & { error?: string };
          if (response.statusCode !== 201) {
            const statusCode = response.statusCode && response.statusCode >= 400 && response.statusCode < 500
              ? response.statusCode
              : 502;
            reject(new PublisherRejectionError(payload.error || 'Publisher rejected the request', statusCode));
            return;
          }
          resolve(payload);
        } catch (error) { reject(error); }
      });
    });
    request.on('timeout', () => request.destroy(new Error('Publisher timed out')));
    request.on('error', reject);
    request.end(body);
  });
}
