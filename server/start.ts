import express from 'express';
import { resolve } from 'node:path';
import { createServer } from './index';

const port = Number(process.env.PORT ?? 4173);
const host = process.env.HOST ?? '127.0.0.1';
const origins = process.env.ARENA_ALLOWED_ORIGINS?.split(',').map(value => value.trim()).filter(Boolean) ?? [
  `http://localhost:${port}`, `http://127.0.0.1:${port}`, 'http://localhost:5173', 'http://127.0.0.1:5173',
  'http://localhost:5174', 'http://127.0.0.1:5174', 'http://localhost:5175', 'http://127.0.0.1:5175',
  'capacitor://localhost', 'http://localhost', 'https://localhost',
];
const { app: arena, close } = await createServer({ allowedOrigins: origins });
const app = express();
app.disable('x-powered-by');
app.use((request, response, next) => {
  // Preserve the /api prefix for arena routes; its final 404 must not catch game assets.
  if (request.path.startsWith('/api/')) arena(request, response, next);
  else next();
});
const webRoot = resolve('dist');
app.use(express.static(webRoot, { index: 'index.html', dotfiles: 'deny', fallthrough: true }));
app.use((request, response, next) => {
  if (request.method === 'GET' && !request.path.startsWith('/api/') && request.accepts('html')) response.sendFile(resolve(webRoot, 'index.html'));
  else next();
});
const server = app.listen(port, host, () => console.log(`NOEMA: http://${host}:${port}\nOyun ve gerçek arena aynı sunucuda çalışıyor. Durdurmak için Ctrl+C.`));
async function shutdown() { server.close(); await close(); process.exit(0); }
process.once('SIGINT', shutdown); process.once('SIGTERM', shutdown);
