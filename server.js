'use strict';
/**
 * Portal con buscador — servidor robusto sin dependencias (Node >= 18).
 *
 * Variables de entorno (todas opcionales):
 *   PORT                      Puerto (Render lo asigna solo)
 *   DOMAIN                    Si se define, solo responde a ese host
 *   CAPTIVE=1                 Modo portal cautivo (solo redes locales; requiere DOMAIN)
 *   TRUST_PROXY=1             Usar X-Forwarded-For para la IP real (por defecto sí, necesario en Render)
 *   RATE_LIMIT                Búsquedas por minuto por IP (30)
 *   MAX_CONCURRENT_SEARCHES   Búsquedas simultáneas máximas (10)
 *   SEARCH_TIMEOUT_MS         Tiempo máximo por proveedor (8000)
 *   CACHE_TTL_MS              Vigencia de la caché de resultados (300000)
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { parseDuckHtml, parseDuckLite } = require('./lib/parse');

const int = (v, d) => { const n = parseInt(v, 10); return Number.isFinite(n) && n > 0 ? n : d; };
const cfg = {
  port: int(process.env.PORT, 8080),
  domain: (process.env.DOMAIN || '').toLowerCase().trim(),
  captive: process.env.CAPTIVE === '1',
  trustProxy: process.env.TRUST_PROXY !== '0',
  rateMax: int(process.env.RATE_LIMIT, 30),
  rateWindow: 60_000,
  maxConcurrent: int(process.env.MAX_CONCURRENT_SEARCHES, 10),
  searchTimeout: int(process.env.SEARCH_TIMEOUT_MS, 8000),
  cacheTtl: int(process.env.CACHE_TTL_MS, 300_000),
};

const log = (o) => console.log(JSON.stringify({ t: new Date().toISOString(), ...o }));

/* ---------- Archivos estáticos (precargados en memoria, con gzip y ETag) ---------- */
const PUBLIC = path.join(__dirname, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' };
const files = new Map();
for (const name of fs.readdirSync(PUBLIC)) {
  const f = path.join(PUBLIC, name);
  if (!fs.statSync(f).isFile()) continue;
  const buf = fs.readFileSync(f);
  files.set('/' + name, {
    buf,
    gz: zlib.gzipSync(buf, { level: 9 }),
    type: MIME[path.extname(name).toLowerCase()] || 'application/octet-stream',
    etag: '"' + crypto.createHash('sha1').update(buf).digest('hex').slice(0, 16) + '"',
  });
}
if (!files.has('/index.html')) throw new Error('Falta public/index.html');
files.set('/', files.get('/index.html'));

const SECURITY = {
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
};

/* ---------- Utilidades ---------- */
const hostOf = (req) => (req.headers.host || '').split(':')[0].toLowerCase();
function clientIp(req) {
  if (cfg.trustProxy) {
    const xf = req.headers['x-forwarded-for'];
    if (xf) return String(xf).split(',')[0].trim();
  }
  return req.socket.remoteAddress || 'unknown';
}
function send(res, status, body, headers = {}) {
  if (res.headersSent) return;
  res.writeHead(status, { ...SECURITY, ...headers });
  res.end(body);
}
const json = (res, status, obj, extra = {}) =>
  send(res, status, JSON.stringify(obj), { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra });

/* ---------- Límite de peticiones por IP (ventana deslizante) ---------- */
const hits = new Map();
function limited(ip) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter((t) => now - t < cfg.rateWindow);
  arr.push(now);
  hits.set(ip, arr);
  if (hits.size > 20_000) hits.clear(); // protección contra agotamiento de memoria
  return arr.length > cfg.rateMax;
}
setInterval(() => {
  const now = Date.now();
  for (const [ip, arr] of hits) if (!arr.some((t) => now - t < cfg.rateWindow)) hits.delete(ip);
}, 60_000).unref();

/* ---------- Búsqueda: 2 proveedores, timeout, caché y tope de concurrencia ---------- */
const HDR = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  'Accept-Language': 'es-MX,es;q=0.9,en;q=0.8',
};
async function fetchText(url) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), cfg.searchTimeout);
  try {
    const r = await fetch(url, { headers: HDR, signal: ac.signal, redirect: 'follow' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return (await r.text()).slice(0, 2_000_000);
  } finally { clearTimeout(timer); }
}

const cache = new Map();
let inflight = 0;
async function search(q) {
  const key = q.toLowerCase();
  const hit = cache.get(key);
  if (hit && hit.exp > Date.now()) return hit.data;

  const enc = encodeURIComponent(q);
  const providers = [
    async () => parseDuckHtml(await fetchText('https://html.duckduckgo.com/html/?q=' + enc)),
    async () => parseDuckLite(await fetchText('https://lite.duckduckgo.com/lite/?q=' + enc)),
  ];
  let results = [];
  let lastErr = null;
  for (const run of providers) {
    try { results = await run(); if (results.length) break; } catch (e) { lastErr = e; }
  }
  if (!results.length && lastErr) throw lastErr;
  if (results.length) {
    cache.set(key, { data: results, exp: Date.now() + cfg.cacheTtl });
    if (cache.size > 500) cache.delete(cache.keys().next().value);
  }
  return results;
}

/* ---------- Portal cautivo (opcional, solo redes locales) ---------- */
const PROBES = new Set(['/generate_204', '/gen_204', '/hotspot-detect.html', '/library/test/success.html', '/success.txt', '/connecttest.txt', '/ncsi.txt', '/canonical.html']);

/* ---------- Manejador principal ---------- */
async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  let pathname;
  try { pathname = decodeURIComponent(url.pathname); } catch { return send(res, 400, 'Bad request'); }

  if (pathname === '/healthz') return json(res, 200, { ok: true, uptime: Math.round(process.uptime()) });

  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed', { Allow: 'GET, HEAD' });

  if (cfg.captive && cfg.domain && PROBES.has(pathname)) {
    return send(res, 302, '', { Location: `http://${cfg.domain}${cfg.port === 80 ? '' : ':' + cfg.port}/` });
  }
  if (cfg.domain && hostOf(req) !== cfg.domain) return send(res, 404, 'Not found');

  if (pathname === '/api/search') {
    const q = (url.searchParams.get('q') || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 200);
    if (!q) return json(res, 400, { error: 'Escribe algo para buscar' });
    if (limited(clientIp(req))) return json(res, 429, { error: 'Demasiadas búsquedas, espera un momento' }, { 'Retry-After': '30' });
    if (inflight >= cfg.maxConcurrent) return json(res, 503, { error: 'Servidor ocupado, intenta de nuevo' }, { 'Retry-After': '5' });
    inflight++;
    try { return json(res, 200, await search(q)); }
    catch { return json(res, 502, { error: 'No se pudo contactar al buscador, intenta de nuevo' }); }
    finally { inflight--; }
  }

  const f = files.get(pathname);
  if (!f) return send(res, 404, 'Not found', { 'Content-Type': 'text/plain; charset=utf-8' });
  const headers = { 'Content-Type': f.type, ETag: f.etag, 'Cache-Control': 'no-cache', Vary: 'Accept-Encoding' };
  if (req.headers['if-none-match'] === f.etag) return send(res, 304, '', headers);
  const gzip = /\bgzip\b/.test(req.headers['accept-encoding'] || '');
  const body = gzip ? f.gz : f.buf;
  if (gzip) headers['Content-Encoding'] = 'gzip';
  headers['Content-Length'] = body.length;
  return send(res, 200, req.method === 'HEAD' ? '' : body, headers);
}

const server = http.createServer((req, res) => {
  const start = Date.now();
  res.on('finish', () => log({ m: req.method, p: req.url.split('?')[0], s: res.statusCode, ms: Date.now() - start }));
  handle(req, res).catch((e) => {
    log({ level: 'error', msg: e && e.message });
    send(res, 500, 'Internal error', { 'Content-Type': 'text/plain; charset=utf-8' });
  });
});
// Render mantiene conexiones ~60 s; el keep-alive debe ser mayor para evitar errores 502 intermitentes.
server.keepAliveTimeout = 65_000;
server.headersTimeout = 66_000;
server.requestTimeout = 15_000;
server.maxHeadersCount = 50;

server.listen(cfg.port, '0.0.0.0', () => log({ msg: 'Portal activo', port: cfg.port, domain: cfg.domain || '(cualquiera)', captive: cfg.captive }));

/* ---------- Apagado limpio y red de seguridad ---------- */
function shutdown(sig) {
  log({ msg: 'Apagando', sig });
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (e) => log({ level: 'error', msg: 'unhandledRejection', e: String(e) }));
process.on('uncaughtException', (e) => log({ level: 'error', msg: 'uncaughtException', e: String(e) }));
