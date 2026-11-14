// HTTP handler for POST /api/issue[?txid=…]. Runs as a Vercel function and under the local dev API.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { sweep } from './issue.js';

const TXID = /^[0-9a-f]{64}$/;

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const send = (status: number, body: unknown) => {
    res.statusCode = status;
    res.setHeader('content-type', 'application/json');
    res.setHeader('cache-control', 'no-store');
    res.end(JSON.stringify(body));
  };
  if (req.method !== 'POST') return send(405, { error: 'Use POST' });
  const txid = new URL(req.url ?? '/', 'http://localhost').searchParams.get('txid') ?? undefined;
  if (txid !== undefined && !TXID.test(txid)) return send(400, { error: 'txid must be 64 hex characters' });
  try {
    send(200, { issued: await sweep({ txid }) });
  } catch (error) {
    // Usually two callers racing for the supply output; the caller simply asks again.
    send(503, { error: error instanceof Error ? error.message : String(error) });
  }
}
