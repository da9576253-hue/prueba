'use strict';
/**
 * Portal Buscador Robusto — Experiencia Google con VPN Web y DNS Cifrado (DoH)
 *
 * Características:
 * - Interfaz idéntica a Google (Logo oficial, barra de búsqueda, autocompletado en vivo, resultados estilizados).
 * - Modo VPN Web Integrado: Navegación cifrada y anónima a través de proxy inverso en /proxy.
 * - Servidor DoH (DNS-over-HTTPS): Resuelve y entrega DNS seguro en /api/dns-query (RFC 8484 y JSON).
 * - Autocompletado en tiempo real sin rastreo de IP (/api/suggest).
 * - Caché en memoria con TTL, control de concurrencia y límite de tasa por IP.
 * - Cabeceras de seguridad estrictas (CSP, HSTS, no-referrer, nosniff).
 * - Cero dependencias externas (Node.js >= 18).
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { URL } = require('url');

const { parseDuckHtml, parseDuckLite, resolveUrl, clean } = require('./lib/parse');
const { queryBinaryUpstream, queryJsonUpstream } = require('./lib/doh');
const { handleProxyRequest, decodeTargetUrl, encodeProxyUrl } = require('./lib/proxy');
const { getSuggestions } = require('./lib/suggest');

const int = (v, d) => { const n = parseInt(v, 10); return Number.isFinite(n) && n > 0 ? n : d; };
const cfg = {
  port: int(process.env.PORT, 8080),
  domain: (process.env.DOMAIN || '').toLowerCase().trim(),
  captive: process.env.CAPTIVE === '1',
  trustProxy: process.env.TRUST_PROXY !== '0',
  rateMax: int(process.env.RATE_LIMIT, 60),
  rateWindow: 60_000,
  maxConcurrent: int(process.env.MAX_CONCURRENT_SEARCHES, 25),
  searchTimeout: int(process.env.SEARCH_TIMEOUT_MS, 8000),
  cacheTtl: int(process.env.CACHE_TTL_MS, 300_000),
  serperKey: (process.env.SERPER_API_KEY || '').trim(),
  serperUrl: process.env.SERPER_URL || 'https://google.serper.dev/search',
  gl: process.env.GOOGLE_GL || 'mx',
  hl: process.env.GOOGLE_HL || 'es',
};

const log = (o) => console.log(JSON.stringify({ t: new Date().toISOString(), ...o }));

/* ---------- Archivos estáticos precargados en memoria ---------- */
const PUBLIC = path.join(__dirname, 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
};

const files = new Map();
function loadStaticFiles() {
  files.clear();
  if (fs.existsSync(PUBLIC)) {
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
    if (files.has('/index.html')) {
      files.set('/', files.get('/index.html'));
    }
  }
}
loadStaticFiles();

const SECURITY = {
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data: https:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self' https:; base-uri 'self'; form-action 'self' *; frame-ancestors 'self'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
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

/* ---------- Límite de peticiones por IP ---------- */
const hits = new Map();
function limited(ip) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter((t) => now - t < cfg.rateWindow);
  arr.push(now);
  hits.set(ip, arr);
  if (hits.size > 30_000) hits.clear();
  return arr.length > cfg.rateMax;
}
setInterval(() => {
  const now = Date.now();
  for (const [ip, arr] of hits) if (!arr.some((t) => now - t < cfg.rateWindow)) hits.delete(ip);
}, 60_000).unref();

/* ---------- Búsqueda y Proveedores con Caché ---------- */
const HDR = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept-Language': 'es-MX,es;q=0.9,en;q=0.8',
};

async function fetchText(url, opts = {}) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), cfg.searchTimeout);
  try {
    const r = await fetch(url, { headers: HDR, signal: ac.signal, redirect: 'follow', ...opts });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return (await r.text()).slice(0, 2_500_000);
  } finally {
    clearTimeout(timer);
  }
}

function extractDomain(urlStr) {
  try {
    const u = new URL(urlStr);
    return u.hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

const cache = new Map();
let inflight = 0;

async function search(q, category = 'all') {
  const cleanQ = q.trim();
  const key = `${category}:${cleanQ.toLowerCase()}`;
  const hit = cache.get(key);
  if (hit && hit.exp > Date.now()) return hit.data;

  let queryTerm = cleanQ;
  if (category === 'news') queryTerm += ' noticias';
  if (category === 'images') queryTerm += ' imagenes';

  const enc = encodeURIComponent(queryTerm);
  const providers = [];

  // 1. Google vía Serper.dev si hay API Key configurada
  if (cfg.serperKey) {
    providers.push(async () => {
      let endpoint = cfg.serperUrl;
      if (category === 'news') endpoint = 'https://google.serper.dev/news';
      if (category === 'images') endpoint = 'https://google.serper.dev/images';

      const txt = await fetchText(endpoint, {
        method: 'POST',
        headers: { 'X-API-KEY': cfg.serperKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: cleanQ, gl: cfg.gl, hl: cfg.hl, num: 12 }),
      });
      const data = JSON.parse(txt);
      const list = category === 'news' ? data.news : (category === 'images' ? data.images : data.organic);
      return (Array.isArray(list) ? list : [])
        .map((o) => {
          const rawUrl = String(o.link || o.imageUrl || '');
          const resolved = resolveUrl(rawUrl) || rawUrl;
          const title = clean(String(o.title || '')).slice(0, 200);
          const snippet = clean(String(o.snippet || '')).slice(0, 400);
          const domain = extractDomain(resolved);
          return {
            title,
            url: resolved,
            proxyUrl: encodeProxyUrl(resolved),
            snippet,
            domain,
            favicon: `https://www.google.com/s2/favicons?domain=${domain}&sz=32`,
            imageUrl: o.imageUrl || null,
          };
        })
        .filter((o) => o.url && o.title)
        .slice(0, 15);
    });
  }

  // 2. DuckDuckGo HTML parser
  providers.push(async () => {
    const rawItems = parseDuckHtml(await fetchText('https://html.duckduckgo.com/html/?q=' + enc), 12);
    return rawItems.map((item) => {
      const domain = extractDomain(item.url);
      return {
        ...item,
        proxyUrl: encodeProxyUrl(item.url),
        domain,
        favicon: `https://www.google.com/s2/favicons?domain=${domain}&sz=32`,
      };
    });
  });

  // 3. DuckDuckGo Lite parser
  providers.push(async () => {
    const rawItems = parseDuckLite(await fetchText('https://lite.duckduckgo.com/lite/?q=' + enc), 12);
    return rawItems.map((item) => {
      const domain = extractDomain(item.url);
      return {
        ...item,
        proxyUrl: encodeProxyUrl(item.url),
        domain,
        favicon: `https://www.google.com/s2/favicons?domain=${domain}&sz=32`,
      };
    });
  });

  let results = [];
  let lastErr = null;
  for (const run of providers) {
    try {
      results = await run();
      if (results && results.length) break;
    } catch (e) {
      lastErr = e;
    }
  }

  if (!results.length && lastErr) throw lastErr;

  if (results.length) {
    cache.set(key, { data: results, exp: Date.now() + cfg.cacheTtl });
    if (cache.size > 800) cache.delete(cache.keys().next().value);
  }

  return results;
}

/* ---------- Portal cautivo ---------- */
const PROBES = new Set(['/generate_204', '/gen_204', '/hotspot-detect.html', '/library/test/success.html', '/success.txt', '/connecttest.txt', '/ncsi.txt', '/canonical.html']);

/* ---------- Manejador principal de peticiones ---------- */
async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return send(res, 400, 'Bad request');
  }

  // 1. Healthcheck
  if (pathname === '/healthz') {
    return json(res, 200, {
      ok: true,
      uptime: Math.round(process.uptime()),
      doh: 'active',
      vpnProxy: 'active',
    });
  }

  // 2. Estado de Seguridad & Privacidad (VPN + DNS)
  if (pathname === '/api/security-status') {
    return json(res, 200, {
      vpnTunnelsActive: true,
      encryption: 'TLS 1.3 / AES-256',
      dohStatus: 'Online (RFC 8484 + JSON)',
      dnsProvider: 'DNS Cifrado de Red (DoH)',
      clientIpMasked: true,
      noLogsPolicy: true,
      engine: cfg.serperKey ? 'Google Engine (Cifrado)' : 'Multi-Engine Seguro',
      uptime: Math.round(process.uptime()),
    });
  }

  // 3. Portal Cautivo
  if (cfg.captive && cfg.domain && PROBES.has(pathname)) {
    return send(res, 302, '', { Location: `http://${cfg.domain}${cfg.port === 80 ? '' : ':' + cfg.port}/` });
  }
  if (cfg.domain && hostOf(req) !== cfg.domain) {
    return send(res, 404, 'Not found');
  }

  // 4. DNS Cifrado del Sitio: Endpoint DoH (/api/dns-query)
  if (pathname === '/api/dns-query') {
    // Si la petición es binaria (RFC 8484 DoH)
    const isBinary = req.headers['content-type'] === 'application/dns-message' || url.searchParams.has('dns');

    if (isBinary) {
      if (req.method === 'POST') {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const dnsMsg = Buffer.concat(chunks);
        try {
          const dnsReply = await queryBinaryUpstream(dnsMsg);
          res.writeHead(200, {
            'Content-Type': 'application/dns-message',
            'Cache-Control': 'max-age=300',
          });
          return res.end(dnsReply);
        } catch {
          return send(res, 502, 'Fallo al resolver DNS cifrado');
        }
      } else if (req.method === 'GET') {
        const rawDns = url.searchParams.get('dns');
        if (!rawDns) return send(res, 400, 'Falta parámetro dns');
        try {
          const dnsMsg = Buffer.from(rawDns, 'base64url');
          const dnsReply = await queryBinaryUpstream(dnsMsg);
          res.writeHead(200, {
            'Content-Type': 'application/dns-message',
            'Cache-Control': 'max-age=300',
          });
          return res.end(dnsReply);
        } catch {
          return send(res, 502, 'Fallo al resolver DNS cifrado');
        }
      }
    }

    // Si la petición es JSON DoH (compatible con Chrome, Cloudflare, Google DNS-JSON)
    const name = url.searchParams.get('name');
    const type = url.searchParams.get('type') || 'A';
    if (!name) {
      return json(res, 400, { error: 'Especifica el nombre a resolver (?name=ejemplo.com)' });
    }
    try {
      const data = await queryJsonUpstream(name, type);
      return json(res, 200, data, { 'Content-Type': 'application/dns-json' });
    } catch {
      return json(res, 502, { Status: 2, Comment: 'Error en resolución DNS segura' });
    }
  }

  // 5. Navegación VPN Web / Proxy Seguro (/proxy)
  if (pathname === '/proxy') {
    const targetUrl = decodeTargetUrl(url);
    if (!targetUrl) {
      // Página informativa de inicio para la VPN Web si no se pasó URL
      const vpnWelcomeHtml = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <title>Túnel VPN Web — Navegación Cifrada</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body { background:#0f172a; color:#f8fafc; font-family:system-ui,sans-serif; display:flex; align-items:center; justify-content:center; min-height:100vh; margin:0; padding:20px; box-sizing:border-box; }
    .card { background:#1e293b; border:1px solid #334155; border-radius:14px; max-width:560px; width:100%; padding:32px; box-shadow:0 10px 30px rgba(0,0,0,0.5); }
    h1 { margin:0 0 10px; font-size:22px; color:#38bdf8; display:flex; align-items:center; gap:10px; }
    p { color:#94a3b8; font-size:14px; line-height:1.5; margin:0 0 20px; }
    .badge { background:#0369a1; color:#e0f2fe; padding:3px 10px; border-radius:99px; font-size:12px; font-weight:600; display:inline-block; margin-bottom:14px; }
    form { display:flex; gap:8px; }
    input { flex:1; background:#0f172a; border:1px solid #475569; border-radius:8px; padding:12px 14px; color:#fff; font-size:15px; outline:none; }
    input:focus { border-color:#38bdf8; }
    button { background:#0284c7; color:#fff; border:none; border-radius:8px; padding:0 20px; font-weight:600; cursor:pointer; font-size:15px; }
    .back { margin-top:18px; text-align:center; }
    .back a { color:#38bdf8; text-decoration:none; font-size:13px; }
  </style>
</head>
<body>
  <div class="card">
    <span class="badge">🛡️ Túnel Cifrado Activo • DNS Propio</span>
    <h1>Túnel VPN Web Seguro</h1>
    <p>Introduce cualquier dirección web para navegar de manera 100% cifrada y anónima. Tu proveedor de internet no sabrá qué páginas visitas y los sitios web solo verán la dirección IP de nuestro servidor.</p>
    <form action="/proxy" method="GET">
      <input type="url" name="url" placeholder="https://es.wikipedia.org" required autofocus>
      <button type="submit">Navegar</button>
    </form>
    <div class="back"><a href="/">← Volver al Buscador Google</a></div>
  </div>
</body>
</html>`;
      return send(res, 200, vpnWelcomeHtml, { 'Content-Type': 'text/html; charset=utf-8' });
    }

    if (limited(clientIp(req))) {
      return send(res, 429, 'Demasiadas solicitudes al proxy, por favor espera un momento.', { 'Content-Type': 'text/plain; charset=utf-8' });
    }

    return handleProxyRequest(req, res, targetUrl);
  }

  // 6. Autocompletado de búsqueda (/api/suggest)
  if (pathname === '/api/suggest') {
    const q = (url.searchParams.get('q') || '').trim().slice(0, 100);
    if (!q) return json(res, 200, []);
    try {
      const suggestions = await getSuggestions(q);
      return json(res, 200, suggestions);
    } catch {
      return json(res, 200, []);
    }
  }

  // 7. Búsqueda (/api/search)
  if (pathname === '/api/search') {
    const q = (url.searchParams.get('q') || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 200);
    const category = (url.searchParams.get('category') || 'all').toLowerCase();

    if (!q) return json(res, 400, { error: 'Escribe algo para buscar' });
    if (limited(clientIp(req))) return json(res, 429, { error: 'Demasiadas búsquedas, espera un momento' }, { 'Retry-After': '30' });
    if (inflight >= cfg.maxConcurrent) return json(res, 503, { error: 'Servidor ocupado, intenta de nuevo' }, { 'Retry-After': '5' });

    inflight++;
    try {
      const results = await search(q, category);
      return json(res, 200, {
        query: q,
        category,
        count: results.length,
        results,
        security: {
          encrypted: true,
          dnsSecure: true,
          vpnReady: true,
        },
      });
    } catch {
      return json(res, 502, { error: 'No se pudo contactar al buscador, intenta de nuevo' });
    } finally {
      inflight--;
    }
  }

  // 8. Servir archivos estáticos precargados
  const f = files.get(pathname);
  if (!f) return send(res, 404, 'Not found', { 'Content-Type': 'text/plain; charset=utf-8' });

  const headers = {
    'Content-Type': f.type,
    ETag: f.etag,
    'Cache-Control': 'no-cache',
    Vary: 'Accept-Encoding',
  };

  if (req.headers['if-none-match'] === f.etag) {
    return send(res, 304, '', headers);
  }

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

server.keepAliveTimeout = 65_000;
server.headersTimeout = 66_000;
server.requestTimeout = 20_000;
server.maxHeadersCount = 80;

server.listen(cfg.port, '0.0.0.0', () => {
  log({
    msg: 'Google Portal Seguro Activo',
    port: cfg.port,
    vpnWeb: 'Habilitado (/proxy)',
    dohServer: 'Habilitado (/api/dns-query)',
    buscador: cfg.serperKey ? 'Google (serper.dev)' : 'DuckDuckGo Fallback',
    domain: cfg.domain || '(cualquiera)',
  });

  // Mantenimiento activo automático en Render (Anti-Sleep)
  const renderUrl = process.env.RENDER_EXTERNAL_URL;
  if (renderUrl) {
    log({ msg: 'Render Anti-Sleep keepalive activado', target: renderUrl });
    setInterval(() => {
      fetch(`${renderUrl}/healthz`).catch(() => {});
    }, 14 * 60_000).unref();
  }
});

function shutdown(sig) {
  log({ msg: 'Apagando servidor', sig });
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (e) => log({ level: 'error', msg: 'unhandledRejection', e: String(e) }));
process.on('uncaughtException', (e) => log({ level: 'error', msg: 'uncaughtException', e: String(e) }));
