'use strict';
/**
 * Módulo de DNS Seguro (DNS-over-HTTPS / DoH)
 * Proporciona:
 * 1. Resolución segura y cifrada para el backend (evita fugas DNS con el ISP local).
 * 2. Endpoint DoH compatible con RFC 8484 (application/dns-message) y formato JSON.
 *    Permite configurar Chrome / Firefox / Android con este portal como servidor DNS privado.
 */

const UPSTREAMS = [
  'https://cloudflare-dns.com/dns-query',
  'https://dns.quad9.net/dns-query',
  'https://dns.google/dns-query',
];

const dnsCache = new Map();
const MAX_CACHE_SIZE = 5000;

function cleanCache() {
  const now = Date.now();
  for (const [k, v] of dnsCache) {
    if (v.expiresAt <= now) dnsCache.delete(k);
  }
}
setInterval(cleanCache, 60_000).unref();

/**
 * Consulta un servidor DoH upstream con un payload binario (RFC 8484).
 */
async function queryBinaryUpstream(buffer, timeoutMs = 5000) {
  for (const endpoint of UPSTREAMS) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/dns-message',
          'Accept': 'application/dns-message',
        },
        body: buffer,
        signal: ac.signal,
      });
      clearTimeout(timer);
      if (res.ok) {
        const arrBuf = await res.arrayBuffer();
        return Buffer.from(arrBuf);
      }
    } catch {
      clearTimeout(timer);
      // Prueba el siguiente upstream si uno falla
    }
  }
  throw new Error('Todos los servidores DNS cifrados fallaron');
}

/**
 * Consulta un servidor DoH upstream en formato JSON (RFC 8427 / Google / Cloudflare).
 */
async function queryJsonUpstream(name, type = 'A', timeoutMs = 4000) {
  const cacheKey = `${name.toLowerCase()}:${type.toUpperCase()}`;
  const hit = dnsCache.get(cacheKey);
  if (hit && hit.expiresAt > Date.now()) {
    return hit.data;
  }

  for (const endpoint of UPSTREAMS) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const url = `${endpoint}?name=${encodeURIComponent(name)}&type=${encodeURIComponent(type)}`;
      const res = await fetch(url, {
        headers: { 'Accept': 'application/dns-json' },
        signal: ac.signal,
      });
      clearTimeout(timer);
      if (res.ok) {
        const data = await res.json();
        const minTtl = Array.isArray(data.Answer) && data.Answer[0] && data.Answer[0].TTL
          ? Math.max(30, Math.min(data.Answer[0].TTL, 3600))
          : 300;
        dnsCache.set(cacheKey, { data, expiresAt: Date.now() + minTtl * 1000 });
        if (dnsCache.size > MAX_CACHE_SIZE) {
          dnsCache.delete(dnsCache.keys().next().value);
        }
        return data;
      }
    } catch {
      clearTimeout(timer);
    }
  }
  throw new Error('No se pudo resolver el nombre DNS vía DoH');
}

/**
 * Resuelve una IP para un nombre de host usando DoH de forma segura en Node.js.
 */
async function resolveHostDoh(host) {
  // Si ya es una IP literal, retornarla
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(host) || host.includes(':')) {
    return host;
  }
  const res = await queryJsonUpstream(host, 'A');
  if (res && Array.isArray(res.Answer)) {
    const aRecord = res.Answer.find((r) => r.type === 1 && r.data);
    if (aRecord) return aRecord.data;
  }
  return null;
}

module.exports = {
  queryBinaryUpstream,
  queryJsonUpstream,
  resolveHostDoh,
  dnsCache,
};
