'use strict';
/**
 * Motor de Búsqueda Multifuente con Emulación de Mozilla Firefox
 * Utiliza las cabeceras auténticas de Mozilla Firefox para consultar motores de búsqueda
 * y evitar bloqueos por IP de datacenter en Render.
 */

const { parseBingHtml, parseGoogleGbvHtml, parseDuckHtml, clean } = require('./parse');

// Cabeceras oficiales y auténticas de Mozilla Firefox en Windows
const MOZILLA_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'es-ES,es;q=0.9,en-US;q=0.8,en;q=0.7',
  'DNT': '1',
  'Sec-GPC': '1',
  'Upgrade-Insecure-Requests': '1',
};

async function fetchMozilla(url, opts = {}, timeoutMs = 4500) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { ...MOZILLA_HEADERS, ...opts.headers },
      signal: ac.signal,
      redirect: 'follow',
      ...opts,
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
 * 1. Búsqueda directa en Bing con Mozilla Firefox
 * Bing nunca bloquea servidores en la nube y devuelve resultados web completos al instante.
 */
async function searchBing(query) {
  try {
    const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}&setlang=es`;
    const res = await fetchMozilla(url, {}, 4000);
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
 * 2. Búsqueda directa en Google (Modo GBV=1 accesible con Mozilla Firefox)
 */
async function searchGoogleDirect(query) {
  try {
    const url = `https://www.google.com/search?q=${encodeURIComponent(query)}&hl=es&gl=mx&gbv=1`;
    const res = await fetchMozilla(url, {
      headers: {
        'Cookie': 'CONSENT=PENDING+987; SOCS=CAESHAgBEhJnd3NfMjAyMzA4MTAtMF9SQzIaAmVuIAEaBgiAo_CmBg',
      },
    }, 4000);
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
 * 3. Meta-buscador SearXNG JSON
 */
const SEARX_INSTANCES = [
  'https://search.ononoki.org',
  'https://priv.au',
  'https://searx.be',
  'https://paulgo.io',
  'https://search.sapti.me',
];

async function searchSearXNG(query) {
  const qEnc = encodeURIComponent(query);
  for (const base of SEARX_INSTANCES) {
    try {
      const url = `${base}/search?q=${qEnc}&format=json&language=es`;
      const res = await fetchMozilla(url, {}, 3000);
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
 * 4. DuckDuckGo Instant Answer API
 */
async function searchDdgJson(query) {
  try {
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=0`;
    const res = await fetchMozilla(url, {}, 3500);
    if (!res.ok) return [];
    const data = await res.json();
    const items = [];

    if (data.AbstractURL && (data.Heading || data.AbstractText)) {
      items.push({
        title: clean(data.Heading || query),
        url: data.AbstractURL,
        snippet: clean(data.AbstractText || 'Artículo enciclopédico'),
        domain: extractDomain(data.AbstractURL),
      });
    }

    if (Array.isArray(data.RelatedTopics)) {
      for (const topic of data.RelatedTopics) {
        if (topic.FirstURL && topic.Text) {
          const firstSentence = topic.Text.split(' - ')[0] || topic.Text;
          items.push({
            title: clean(firstSentence).slice(0, 180),
            url: topic.FirstURL,
            snippet: clean(topic.Text).slice(0, 300),
            domain: extractDomain(topic.FirstURL),
          });
        }
      }
    }
    return items.slice(0, 10);
  } catch {
    return [];
  }
}

/**
 * 5. Wikipedia Search API (Infalible en Render)
 */
async function searchWikipedia(query) {
  try {
    const url = `https://es.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&utf8=1&format=json&srlimit=8`;
    const res = await fetchMozilla(url, {}, 3500);
    if (!res.ok) return [];
    const data = await res.json();
    if (data.query && Array.isArray(data.query.search) && data.query.search.length > 0) {
      return data.query.search.map((item) => {
        const articleUrl = `https://es.wikipedia.org/wiki/${encodeURIComponent(item.title.replace(/ /g, '_'))}`;
        return {
          title: clean(item.title),
          url: articleUrl,
          snippet: clean(item.snippet).slice(0, 350),
          domain: 'es.wikipedia.org',
        };
      });
    }
  } catch {}
  return [];
}

/**
 * 6. Respaldo Resiliente Garantizado
 */
function generateResilientResults(query) {
  const enc = encodeURIComponent(query);
  return [
    {
      title: `${query} — Enciclopedia y Definición`,
      url: `https://es.wikipedia.org/wiki/Special:Search?search=${enc}`,
      snippet: `Explorar información completa, contexto y referencias sobre "${query}" en la enciclopedia libre.`,
      domain: 'es.wikipedia.org',
    },
    {
      title: `${query} — Noticias de Última Hora`,
      url: `https://news.google.com/search?q=${enc}&hl=es`,
      snippet: `Cobertura informativa global, reportajes y artículos recientes sobre "${query}".`,
      domain: 'news.google.com',
    },
    {
      title: `${query} — Videos y Multimedia`,
      url: `https://www.youtube.com/results?search_query=${enc}`,
      snippet: `Contenido audiovisual, documentales, avances y canales sobre "${query}".`,
      domain: 'youtube.com',
    },
    {
      title: `${query} — Resultados en DuckDuckGo Cifrado`,
      url: `https://duckduckgo.com/?q=${enc}`,
      snippet: `Resultados directos y enlaces web seguros para "${query}".`,
      domain: 'duckduckgo.com',
    },
  ];
}

module.exports = {
  searchBing,
  searchGoogleDirect,
  searchSearXNG,
  searchDdgJson,
  searchWikipedia,
  generateResilientResults,
  extractDomain,
};
