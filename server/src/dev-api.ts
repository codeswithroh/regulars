// Local stand-in for the Vercel function. Vite proxies /api here during `npm run dev`.
import { createServer } from 'node:http';
import handler from './handler.js';

const port = Number(process.env.API_PORT ?? 8787);
createServer((req, res) => {
  if (req.url?.startsWith('/api/issue')) return void handler(req, res);
  res.statusCode = 404;
  res.end();
}).listen(port, () => console.log(`Regulars dev API on http://localhost:${port}`));
