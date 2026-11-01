'use strict';
/**
 * Parsers de resultados de búsqueda para Google, Bing y DuckDuckGo
 * Funciones puras con soporte de decodificación de entidades HTML y filtrado de seguridad.
 */

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decode(s = '') {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => safeChr(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => safeChr(parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (m, n) => ENT[n.toLowerCase()] ?? m);
}

function safeChr(n) {
  try { return String.fromCodePoint(n); } catch { return ''; }
}

const clean = (s = '') => decode(s.replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();

function resolveUrl(raw = '') {
  let u = decode(raw).trim();
  if (u.startsWith('//')) u = 'https:' + u;

  // Extraer URL de parámetros uddg (DuckDuckGo) o q (Google /url?q=...)
  const ddgMatch = u.match(/[?&]uddg=([^&]+)/);
  if (ddgMatch) {
    try { u = decodeURIComponent(ddgMatch[1]); } catch { return null; }
  }
  const gMatch = u.match(/(?:^|\/url\?)[?&]q=([^&]+)/);
  if (gMatch && !u.startsWith('http://') && !u.startsWith('https://')) {
    try { u = decodeURIComponent(gMatch[1]); } catch { return null; }
  }

  let parsed;
  try { parsed = new URL(u); } catch { return null; }
  if (!/^https?:$/.test(parsed.protocol)) return null; // Rechazar javascript:, data:, etc.
  if (/(^|\.)duckduckgo\.com$/.test(parsed.hostname)) return null;
  if (/(^|\.)google\.[a-z.]+$/.test(parsed.hostname) && (parsed.pathname === '/search' || parsed.pathname === '/url')) return null;

  return parsed.href;
}

function attr(tag, name) {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i'));
  return m ? (m[1] ?? m[2]) : '';
}

function collect(html, anchorRe, snippetRe, limit) {
  const anchors = [];
  let m;
  while ((m = anchorRe.exec(html))) {
    anchors.push({ tag: m[1], inner: m[2], start: m.index, end: anchorRe.lastIndex });
  }
  const out = [];
  for (let i = 0; i < anchors.length && out.length < limit; i++) {
    const a = anchors[i];
    const url = resolveUrl(attr(a.tag, 'href'));
    const title = clean(a.inner);
    if (!url || !title) continue;
    const chunk = html.slice(a.end, anchors[i + 1] ? anchors[i + 1].start : a.end + 4000);
    const sm = chunk.match(snippetRe);
    out.push({ title: title.slice(0, 200), url, snippet: sm ? clean(sm[1]).slice(0, 400) : '' });
  }
  return out;
}

function parseDuckHtml(html, limit = 10) {
  return collect(
    html,
    /(<a\b[^>]*class=["'][^"']*\bresult__a\b[^"']*["'][^>]*>)([\s\S]*?)<\/a>/gi,
    /class=["'][^"']*result__snippet[^"']*["'][^>]*>([\s\S]*?)<\/(?:a|td|div|span)>/i,
    limit
  );
}

function parseDuckLite(html, limit = 10) {
  return collect(
    html,
    /(<a\b[^>]*class=["'][^"']*\bresult-link\b[^"']*["'][^>]*>)([\s\S]*?)<\/a>/gi,
    /class=["'][^"']*result-snippet[^"']*["'][^>]*>([\s\S]*?)<\/td>/i,
    limit
  );
}

/**
 * Parser de resultados directos de Bing con cabecera de Mozilla Firefox
 */
function parseBingHtml(html, limit = 12) {
  const out = [];
  const blocks = html.split(/<li class=["']b_algo["']/i);
  for (let i = 1; i < blocks.length && out.length < limit; i++) {
    const block = blocks[i];
    const h2Match = block.match(/<h2\b[^>]*>\s*<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
    if (!h2Match) continue;
    const url = resolveUrl(h2Match[1]);
    const title = clean(h2Match[2]);
    if (!url || !title) continue;

    const pMatch = block.match(/<(?:p|div)\b[^>]*class=["'][^"']*(?:b_lineclamp|b_caption)[^"']*["'][^>]*>([\s\S]*?)<\/(?:p|div)>/i)
      || block.match(/<p\b[^>]*>([\s\S]*?)<\/p>/i);
    const snippet = pMatch ? clean(pMatch[1]).slice(0, 400) : '';

    if (!out.some((x) => x.url === url)) {
      out.push({ title: title.slice(0, 200), url, snippet });
    }
  }
  return out;
}

/**
 * Parser de resultados directos de Google (GBV=1 modo ligero accesible)
 */
function parseGoogleGbvHtml(html, limit = 12) {
  const out = [];
  const regex = /<a\b[^>]*href=["'](?:\/url\?q=)(https?:\/\/[^&"']+)&amp;[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = regex.exec(html)) && out.length < limit) {
    let rawUrl = '';
    try { rawUrl = decodeURIComponent(match[1]); } catch { rawUrl = match[1]; }
    const url = resolveUrl(rawUrl);
    const title = clean(match[2]);
    if (!url || !title || title.length < 2) continue;

    const chunk = html.slice(regex.lastIndex, regex.lastIndex + 1200);
    const snipMatch = chunk.match(/class=["'][^"']*BNeawe s3v9rd[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
    const snippet = snipMatch ? clean(snipMatch[1]).slice(0, 400) : '';

    if (!out.some((x) => x.url === url)) {
      out.push({ title: title.slice(0, 200), url, snippet });
    }
  }
  return out;
}

module.exports = {
  parseDuckHtml,
  parseDuckLite,
  parseBingHtml,
  parseGoogleGbvHtml,
  resolveUrl,
  clean,
};
