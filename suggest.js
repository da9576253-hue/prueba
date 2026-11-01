'use strict';
/**
 * Módulo de Autocompletado y Sugerencias en Tiempo Real
 * Consulta sugerencias de búsqueda de forma anónima desde el backend para replicar
 * la experiencia interactiva de Google sin exponer la IP del cliente.
 */

const suggestCache = new Map();
const MAX_SUGGEST_CACHE = 2000;

async function getSuggestions(query, timeoutMs = 2500) {
  const q = (query || '').trim().toLowerCase();
  if (!q || q.length < 2) return [];

  const hit = suggestCache.get(q);
  if (hit && hit.exp > Date.now()) {
    return hit.data;
  }

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);

  try {
    // Consulta la API de sugerencias pública y anónima
    const url = `https://suggestqueries.google.com/complete/search?client=chrome&q=${encodeURIComponent(q)}&hl=es`;
    const res = await fetch(url, {
      signal: ac.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
      },
    });
    clearTimeout(timer);

    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && Array.isArray(data[1])) {
        const results = data[1].slice(0, 8);
        suggestCache.set(q, { data: results, exp: Date.now() + 300_000 });
        if (suggestCache.size > MAX_SUGGEST_CACHE) {
          suggestCache.delete(suggestCache.keys().next().value);
        }
        return results;
      }
    }
  } catch {
    clearTimeout(timer);
  }

  // Respaldo DuckDuckGo si Google no responde o está limitado
  try {
    const ac2 = new AbortController();
    const timer2 = setTimeout(() => ac2.abort(), timeoutMs);
    const ddgUrl = `https://duckduckgo.com/ac/?q=${encodeURIComponent(q)}&type=list`;
    const res2 = await fetch(ddgUrl, {
      signal: ac2.signal,
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    clearTimeout(timer2);
    if (res2.ok) {
      const ddgData = await res2.json();
      if (Array.isArray(ddgData) && Array.isArray(ddgData[1])) {
        const results = ddgData[1].slice(0, 8);
        suggestCache.set(q, { data: results, exp: Date.now() + 300_000 });
        return results;
      }
    }
  } catch {
    // Silencioso
  }

  return [];
}

module.exports = { getSuggestions };
