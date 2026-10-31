'use strict';
// Parsers de resultados de DuckDuckGo (HTML y Lite). Funciones puras, con pruebas en /test.

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decode(s = '') {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => safeChr(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => safeChr(parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (m, n) => ENT[n.toLowerCase()] ?? m);
}
function safeChr(n) { try { return String.fromCodePoint(n); } catch { return ''; } }
const clean = (s = '') => decode(s.replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();

function resolveUrl(raw = '') {
  let u = decode(raw).trim();
  if (u.startsWith('//')) u = 'https:' + u;
  const m = u.match(/[?&]uddg=([^&]+)/);
  if (m) { try { u = decodeURIComponent(m[1]); } catch { return null; } }
  let parsed;
  try { parsed = new URL(u); } catch { return null; }
  if (!/^https?:$/.test(parsed.protocol)) return null;                       // nunca javascript:, data:, etc.
  if (/(^|\.)duckduckgo\.com$/.test(parsed.hostname)) return null;           // anuncios y enlaces internos
  return parsed.href;
}

function attr(tag, name) {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i'));
  return m ? (m[1] ?? m[2]) : '';
}

function collect(html, anchorRe, snippetRe, limit) {
  const anchors = [];
  let m;
  while ((m = anchorRe.exec(html))) anchors.push({ tag: m[1], inner: m[2], start: m.index, end: anchorRe.lastIndex });
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

module.exports = { parseDuckHtml, parseDuckLite, resolveUrl, clean };
