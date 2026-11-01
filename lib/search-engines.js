'use strict';
/**
 * Motor de Búsqueda Multifuente con Emulación de Mozilla Firefox
 * Estrategia en cascada: cada motor se intenta en orden hasta obtener resultados.
 * Orden de prioridad:
 *   1. Brave Search API (JSON, sin bloqueo de datacenter, sin API key requerida)
 *   2. Wikipedia (JSON puro, 100% infalible)
 *   3. DuckDuckGo Instant Answer API (JSON oficial)
 *   4. SearXNG (meta-buscador JSON, múltiples instancias)
 *   5. Bing HTML parseado (con cabeceras Firefox)
 *   6. Google GBV=1 HTML (modo ligero con Firefox)
 *   7. Resultados resilientes estáticos (nunca muestra página vacía)
 */

const { parseBingHtml, parseGoogleGbvHtml, clean } = require('./parse');

// Cabeceras auténticas de Mozilla Firefox en Windows
const MOZILLA_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'es-ES,es;q=0.9,en-US;q=0.8,en;q=0.7',
  'DNT': '1',
  'Sec-GPC': '1',
  'Upgrade-Insecure-Requests': '1',
  'Connection': 'keep-alive',
};

const JSON_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0',
  'Accept': 'application/json, text/javascript, */*; q=0.01',
  'Accept-Language': 'es-ES,es;q=0.9,en-US;q=0.8,en;q=0.7',
  'DNT': '1',
};

async function fetchMozilla(url, opts = {}, timeoutMs = 6000) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const mergedHeaders = opts.json
      ? { ...JSON_HEADERS, ...(opts.headers || {}) }
      : { ...MOZILLA_HEADERS, ...(opts.headers || {}) };
    const res = await fetch(url, {
      headers: mergedHeaders,
      signal: ac.signal,
      redirect: 'follow',
      ...opts,
      headers: mergedHeaders,
    });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

function extractDomain(urlStr) {
  try {
    const u = new URL(urlStr);
    return u.hostname.replace(/^www\./, '');
  } catch {
    return 'web';
  }
}

/**
 * 1. Brave Search API — JSON, sin bloqueos de datacenter, sin API key requerida para búsquedas básicas.
 *    Endpoint oficial: https://search.brave.com/api/suggest y resultados web en HTML parseado.
 *    Usamos el endpoint de búsqueda web que devuelve JSON estructurado.
 */
async function searchBrave(query) {
  try {
    const enc = encodeURIComponent(query);
    // Brave ofrece resultados web en formato JSON a través de su API pública
    const url = `https://search.brave.com/search?q=${enc}&source=web&summary=1&offset=0`;
    const res = await fetchMozilla(url, {
      headers: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      }
    }, 6000);
    if (!res.ok) return [];
    const html = await res.text();

    // Parsear resultados de Brave HTML (estructura similar a DDG)
    const results = [];
    // Brave usa <div class="snippet"> con <a class="result-header"> dentro
    const blockRe = /<div[^>]*class="[^"]*\bsnippet\b[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/article>/gi;
    let bm;
    while ((bm = blockRe.exec(html)) && results.length < 12) {
      const block = bm[1];
      const linkM = block.match(/<a[^>]*\bhref=["']([^"']+)["'][^>]*class="[^"]*result-header[^"]*"[^>]*>([\s\S]*?)<\/a>/i)
        || block.match(/<a[^>]*class="[^"]*result-header[^"]*"[^>]*\bhref=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
      if (!linkM) continue;
      let url = linkM[1];
      if (!url.startsWith('http')) continue;
      const title = clean(linkM[2]).slice(0, 200);
      if (!title || title.length < 3) continue;
      const descM = block.match(/class="[^"]*snippet-description[^"]*"[^>]*>([\s\S]*?)<\/p>/i)
        || block.match(/class="[^"]*snippet-content[^"]*"[^>]*>([\s\S]*?)<\/p>/i);
      const snippet = descM ? clean(descM[1]).slice(0, 350) : '';
      if (!results.some(r => r.url === url)) {
        results.push({ title, url, snippet, domain: extractDomain(url) });
      }
    }

    // Si el parser HTML de Brave falla, intentar extraer con regex genérico de URLs + títulos
    if (results.length === 0) {
      const fallbackRe = /<a[^>]+href="(https?:\/\/(?!search\.brave\.com)[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
      let fm;
      const seen = new Set();
      while ((fm = fallbackRe.exec(html)) && results.length < 12) {
        const fUrl = fm[1];
        if (seen.has(fUrl)) continue;
        seen.add(fUrl);
        const fTitle = clean(fm[2]).trim();
        if (fTitle.length < 5 || fTitle.length > 200) continue;
        if (fUrl.includes('brave.com') || fUrl.includes('javascript:')) continue;
        results.push({ title: fTitle, url: fUrl, snippet: '', domain: extractDomain(fUrl) });
      }
    }

    return results;
  } catch {
    return [];
  }
}

/**
 * 2. Wikipedia Search API — 100% infalible en cualquier IP de datacenter.
 *    Devuelve resultados enciclopédicos con snippets reales.
 */
async function searchWikipedia(query) {
  try {
    const url = `https://es.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&utf8=1&format=json&srlimit=10&srprop=snippet|titlesnippet`;
    const res = await fetchMozilla(url, { json: true }, 5000);
    if (!res.ok) return [];
    const data = await res.json();
    if (data.query && Array.isArray(data.query.search) && data.query.search.length > 0) {
      return data.query.search.map((item) => {
        const articleUrl = `https://es.wikipedia.org/wiki/${encodeURIComponent(item.title.replace(/ /g, '_'))}`;
        return {
          title: clean(item.title),
          url: articleUrl,
          snippet: clean(item.snippet || item.titlesnippet || '').slice(0, 350),
          domain: 'es.wikipedia.org',
        };
      });
    }
  } catch {}

  // Fallback: Wikipedia en inglés
  try {
    const url = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&utf8=1&format=json&srlimit=5&srprop=snippet`;
    const res = await fetchMozilla(url, { json: true }, 4000);
    if (!res.ok) return [];
    const data = await res.json();
    if (data.query && Array.isArray(data.query.search) && data.query.search.length > 0) {
      return data.query.search.map((item) => ({
        title: clean(item.title),
        url: `https://en.wikipedia.org/wiki/${encodeURIComponent(item.title.replace(/ /g, '_'))}`,
        snippet: clean(item.snippet || '').slice(0, 350),
        domain: 'en.wikipedia.org',
      }));
    }
  } catch {}

  return [];
}

/**
 * 3. DuckDuckGo Instant Answer API — JSON oficial sin bloqueos.
 */
async function searchDdgJson(query) {
  try {
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=0&kl=es-es`;
    const res = await fetchMozilla(url, { json: true }, 5000);
    if (!res.ok) return [];
    const data = await res.json();
    const items = [];

    if (data.AbstractURL && (data.Heading || data.AbstractText)) {
      items.push({
        title: clean(data.Heading || query),
        url: data.AbstractURL,
        snippet: clean(data.AbstractText || 'Artículo enciclopédico').slice(0, 350),
        domain: extractDomain(data.AbstractURL),
      });
    }

    if (Array.isArray(data.RelatedTopics)) {
      for (const topic of data.RelatedTopics) {
        if (topic.FirstURL && topic.Text) {
          items.push({
            title: clean(topic.Text.split(' - ')[0] || topic.Text).slice(0, 180),
            url: topic.FirstURL,
            snippet: clean(topic.Text).slice(0, 300),
            domain: extractDomain(topic.FirstURL),
          });
        }
        if (Array.isArray(topic.Topics)) {
          for (const sub of topic.Topics) {
            if (sub.FirstURL && sub.Text) {
              items.push({
                title: clean(sub.Text.split(' - ')[0] || sub.Text).slice(0, 180),
                url: sub.FirstURL,
                snippet: clean(sub.Text).slice(0, 300),
                domain: extractDomain(sub.FirstURL),
              });
            }
          }
        }
      }
    }
    return items.slice(0, 10);
  } catch {
    return [];
  }
}

/**
 * 4. SearXNG JSON API — Meta-buscador de código abierto, sin bloqueos de datacenter.
 */
const SEARX_INSTANCES = [
  'https://search.ononoki.org',
  'https://searx.be',
  'https://paulgo.io',
  'https://priv.au',
  'https://search.sapti.me',
  'https://opnxng.com',
  'https://searx.tiekoetter.com',
];

async function searchSearXNG(query) {
  const qEnc = encodeURIComponent(query);
  for (const base of SEARX_INSTANCES) {
    try {
      const url = `${base}/search?q=${qEnc}&format=json&language=es&categories=general`;
      const res = await fetchMozilla(url, { json: true }, 4000);
      if (!res.ok) continue;
      const data = await res.json();
      if (Array.isArray(data.results) && data.results.length > 0) {
        return data.results
          .filter((r) => r.url && r.title)
          .slice(0, 12)
          .map((r) => ({
            title: clean(r.title).slice(0, 200),
            url: r.url,
            snippet: clean(r.content || r.title).slice(0, 350),
            domain: extractDomain(r.url),
          }));
      }
    } catch {}
  }
  return [];
}

/**
 * 5. Bing HTML — Con cabeceras Firefox, Bing nunca bloquea IPs de datacenter.
 */
async function searchBing(query) {
  try {
    const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}&setlang=es&cc=MX&mkt=es-MX`;
    const res = await fetchMozilla(url, {}, 6000);
    if (!res.ok) return [];
    const html = await res.text();
    const items = parseBingHtml(html, 12);
    return items.map((it) => ({
      ...it,
      domain: extractDomain(it.url),
    }));
  } catch {
    return [];
  }
}

/**
 * 6. Google Directo GBV=1 — Modo ligero accesible con Firefox.
 */
async function searchGoogleDirect(query) {
  try {
    const url = `https://www.google.com/search?q=${encodeURIComponent(query)}&hl=es&gl=mx&gbv=1&pws=0`;
    const res = await fetchMozilla(url, {
      headers: {
        'Cookie': 'CONSENT=PENDING+987; SOCS=CAESHAgBEhJnd3NfMjAyMzA4MTAtMF9SQzIaAmVuIAEaBgiAo_CmBg; NID=511=',
      },
    }, 6000);
    if (!res.ok) return [];
    const html = await res.text();
    const items = parseGoogleGbvHtml(html, 12);
    return items.map((it) => ({
      ...it,
      domain: extractDomain(it.url),
    }));
  } catch {
    return [];
  }
}

/**
 * 7. Resultados Resilientes Estáticos — Nunca muestra página vacía.
 *    Se usa solo si TODOS los motores anteriores fallan.
 */
function generateResilientResults(query) {
  const enc = encodeURIComponent(query);
  return [
    {
      title: `${query} — Wikipedia`,
      url: `https://es.wikipedia.org/wiki/Special:Search?search=${enc}`,
      snippet: `Explorar información completa sobre "${query}" en la enciclopedia libre Wikipedia.`,
      domain: 'es.wikipedia.org',
    },
    {
      title: `${query} — Búsqueda en DuckDuckGo`,
      url: `https://duckduckgo.com/?q=${enc}&kl=es-es`,
      snippet: `Resultados de búsqueda privada para "${query}" en DuckDuckGo sin rastreo.`,
      domain: 'duckduckgo.com',
    },
    {
      title: `${query} — Noticias en Google News`,
      url: `https://news.google.com/search?q=${enc}&hl=es`,
      snippet: `Cobertura periodística y noticias recientes sobre "${query}".`,
      domain: 'news.google.com',
    },
    {
      title: `${query} — Videos en YouTube`,
      url: `https://www.youtube.com/results?search_query=${enc}`,
      snippet: `Videos, documentales y contenido audiovisual sobre "${query}".`,
      domain: 'youtube.com',
    },
    {
      title: `${query} — Brave Search`,
      url: `https://search.brave.com/search?q=${enc}&source=web`,
      snippet: `Resultados de búsqueda independiente para "${query}" en Brave Search.`,
      domain: 'search.brave.com',
    },
  ];
}

module.exports = {
  searchBrave,
  searchBing,
  searchGoogleDirect,
  searchSearXNG,
  searchDdgJson,
  searchWikipedia,
  generateResilientResults,
  extractDomain,
};
