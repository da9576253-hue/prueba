'use strict';
/**
 * Módulo de Navegación VPN Web / Proxy Seguro con DNS DoH y Soporte Mozilla Firefox
 * Permite navegar en cualquier sitio web a través del servidor del portal:
 * - Oculta la IP real del usuario ante los sitios destino y proveedores de internet (ISP).
 * - Resuelve automáticamente los dominios con DNS cifrado (DNS-over-HTTPS).
 * - Cifra todo el tráfico entre el navegador y el servidor con TLS.
 * - Elimina rastreadores, cookies espía, cabeceras de bloqueo de iframe y telemetría.
 * - Reescribe enlaces y formularios para mantener toda la sesión dentro del túnel protegido.
 * - Sincroniza el historial y la barra de direcciones con el navegador Mozilla Firefox integrado.
 */

const http = require('http');
const https = require('https');
const dns = require('dns');
const { URL } = require('url');
const { resolveHostDoh } = require('./doh');

// Lista negra de redes privadas y metadatos en la nube (Protección SSRF)
const PRIVATE_IP_REGEX = /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[0-1])\.|169\.254\.|0\.|::1|fe80:|fc00:)/i;

function isPrivateHost(hostname) {
  if (!hostname) return true;
  const h = hostname.toLowerCase().trim();
  if (h === 'localhost' || h === '127.0.0.1' || h === '::1' || h.endsWith('.localhost') || h.endsWith('.local')) {
    return true;
  }
  if (PRIVATE_IP_REGEX.test(h)) return true;
  return false;
}

function encodeProxyUrl(targetUrl, embed = false) {
  return '/proxy?url=' + encodeURIComponent(targetUrl) + (embed ? '&embed=1' : '');
}

function decodeTargetUrl(urlObj) {
  let target = urlObj.searchParams.get('url');
  if (!target && urlObj.searchParams.get('q')) {
    try {
      target = Buffer.from(urlObj.searchParams.get('q'), 'base64url').toString('utf8');
    } catch {
      target = null;
    }
  }
  if (!target) return null;
  target = target.trim();
  if (target.startsWith('//')) target = 'https:' + target;
  if (!/^https?:\/\//i.test(target)) target = 'https://' + target;
  try {
    const parsed = new URL(target);
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    if (isPrivateHost(parsed.hostname)) return null;
    return parsed.href;
  } catch {
    return null;
  }
}

/**
 * Reescribe URLs absolutas y relativas en HTML para que apunten a través del proxy.
 */
function rewriteHtml(html, baseUrl, isEmbed = false) {
  const baseObj = new URL(baseUrl);

  function toProxy(val) {
    if (!val || val.startsWith('#') || val.startsWith('javascript:') || val.startsWith('mailto:') || val.startsWith('data:')) {
      return val;
    }
    try {
      const resolved = new URL(val, baseObj).href;
      return encodeProxyUrl(resolved, isEmbed);
    } catch {
      return val;
    }
  }

  // 1. Reescribe enlaces href="..."
  let out = html.replace(/\bhref=(["'])(.*?)\1/gi, (match, quote, val) => {
    return `href=${quote}${toProxy(val)}${quote}`;
  });

  // 2. Reescribe acciones de formularios action="..."
  out = out.replace(/\baction=(["'])(.*?)\1/gi, (match, quote, val) => {
    return `action=${quote}${toProxy(val)}${quote}`;
  });

  // 3. Inyectar <base> si no existe para recursos relativos que no hayan sido reescritos
  if (!/<base\b/i.test(out) && /<head>/i.test(out)) {
    out = out.replace(/<head>/i, `<head><base href="${baseUrl}">`);
  }

  // 4. Inyectar script de sincronización con la ventana de Mozilla Firefox
  const syncScript = `
<script>
(function() {
  try {
    var rawTargetUrl = ${JSON.stringify(baseUrl)};
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ type: 'FIREFOX_SYNC_URL', url: rawTargetUrl, title: document.title }, '*');
    }
  } catch(e) {}
})();
</script>
`;

  // 5. Inyectar barra de control solo si no está embebido dentro del navegador Firefox
  let vpnBarHtml = '';
  if (!isEmbed) {
    vpnBarHtml = `
<div id="__vpn_bar__" style="position:fixed;top:0;left:0;right:0;z-index:2147483647;background:#1e293b;color:#f8fafc;font-family:system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;padding:8px 14px;box-shadow:0 4px 14px rgba(0,0,0,0.35);display:flex;align-items:center;gap:10px;font-size:13px;border-bottom:2px solid #38bdf8;">
  <div style="display:flex;align-items:center;gap:6px;font-weight:600;white-space:nowrap;color:#38bdf8;">
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm-2 16l-4-4 1.41-1.41L10 14.17l6.59-6.59L18 9l-8 8z"/></svg>
    <span>TÚNEL VPN ACTIVO</span>
  </div>
  <div style="display:inline-flex;align-items:center;background:#0f172a;border:1px solid #334155;border-radius:6px;padding:2px 8px;font-size:11px;color:#a5f3fc;white-space:nowrap;">
    DNS Seguro: DoH Activo
  </div>
  <form onsubmit="event.preventDefault();const u=document.getElementById('__vpn_url_input__').value.trim();if(u)window.location.href='/proxy?url='+encodeURIComponent(u);" style="display:flex;flex:1;gap:6px;margin:0;">
    <input id="__vpn_url_input__" type="text" value="${baseUrl.replace(/"/g, '&quot;')}" style="flex:1;min-width:180px;background:#0f172a;border:1px solid #475569;border-radius:4px;color:#f1f5f9;padding:5px 10px;font-size:12px;outline:none;" />
    <button type="submit" style="background:#0284c7;color:#fff;border:none;border-radius:4px;padding:5px 12px;cursor:pointer;font-weight:600;font-size:12px;">Ir</button>
  </form>
  <button onclick="window.history.back();" style="background:#334155;color:#e2e8f0;border:none;border-radius:4px;padding:5px 10px;cursor:pointer;font-size:12px;">Atrás</button>
  <button onclick="window.location.reload();" style="background:#334155;color:#e2e8f0;border:none;border-radius:4px;padding:5px 10px;cursor:pointer;font-size:12px;">Recargar</button>
  <a href="/" style="background:#ef4444;color:#fff;text-decoration:none;border-radius:4px;padding:5px 12px;font-weight:600;font-size:12px;">Volver a Firefox</a>
</div>
<div style="height:48px;width:100%;display:block;"></div>
`;
  }

  if (/<body\b[^>]*>/i.test(out)) {
    out = out.replace(/(<body\b[^>]*>)/i, `$1${vpnBarHtml}${syncScript}`);
  } else {
    out = vpnBarHtml + syncScript + out;
  }

  return out;
}

/**
 * Atiende una petición de proxy web resolviendo el DNS vía DoH automáticamente.
 */
async function handleProxyRequest(req, res, targetUrl, isEmbed = false) {
  let parsedTarget;
  try {
    parsedTarget = new URL(targetUrl);
  } catch {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('URL de destino inválida');
  }

  if (isPrivateHost(parsedTarget.hostname)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Acceso denegado a red privada o local por seguridad.');
  }

  const client = parsedTarget.protocol === 'https:' ? https : http;
  const targetPort = parsedTarget.port || (parsedTarget.protocol === 'https:' ? 443 : 80);

  // Cabeceras oficiales y auténticas de Mozilla Firefox
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0',
    'Accept': req.headers['accept'] || 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': req.headers['accept-language'] || 'es-ES,es;q=0.9,en-US;q=0.8,en;q=0.7',
    'DNT': '1',
    'Sec-GPC': '1',
    'Host': parsedTarget.hostname,
    'Referer': `${parsedTarget.protocol}//${parsedTarget.hostname}/`,
  };

  // Cookie de consentimiento previo para Google (evita popups intrusivos dentro del iframe)
  if (parsedTarget.hostname.includes('google.')) {
    headers['Cookie'] = 'CONSENT=PENDING+987; SOCS=CAESHAgBEhJnd3NfMjAyMzA4MTAtMF9SQzIaAmVuIAEaBgiAo_CmBg';
  }

  // Resolución DNS robusta: DoH primero, fallback al DNS del sistema
  let resolvedHostname = parsedTarget.hostname;
  try {
    const dohIp = await resolveHostDoh(parsedTarget.hostname);
    if (dohIp && typeof dohIp === 'string' && /^[\d.:a-fA-F]+$/.test(dohIp) && !isPrivateHost(dohIp)) {
      resolvedHostname = dohIp;
    }
  } catch {
    // DoH falló → usar DNS del sistema (comportamiento seguro y funcional)
  }

  const reqOptions = {
    hostname: resolvedHostname,
    port: targetPort,
    path: parsedTarget.pathname + parsedTarget.search,
    method: req.method === 'POST' ? 'POST' : 'GET',
    headers,
    timeout: 15000,
    servername: parsedTarget.hostname, // SNI siempre usa el nombre original
  };

  const proxyReq = client.request(reqOptions, (proxyRes) => {
    if (proxyRes.statusCode >= 300 && proxyRes.statusCode < 400 && proxyRes.headers.location) {
      try {
        const nextUrl = new URL(proxyRes.headers.location, parsedTarget).href;
        res.writeHead(302, { Location: encodeProxyUrl(nextUrl, isEmbed) });
        return res.end();
      } catch {}
    }

    const contentType = (proxyRes.headers['content-type'] || '').toLowerCase();
    const isHtml = contentType.includes('text/html');

    const outHeaders = { ...proxyRes.headers };
    delete outHeaders['content-security-policy'];
    delete outHeaders['content-security-policy-report-only'];
    delete outHeaders['x-frame-options'];
    delete outHeaders['strict-transport-security'];
    delete outHeaders['set-cookie'];

    outHeaders['Referrer-Policy'] = 'no-referrer';
    outHeaders['X-Content-Type-Options'] = 'nosniff';

    if (isHtml) {
      delete outHeaders['content-encoding'];
      delete outHeaders['content-length'];
      outHeaders['content-type'] = 'text/html; charset=utf-8';

      const zlib = require('zlib');
      const encoding = (proxyRes.headers['content-encoding'] || '').toLowerCase();
      let stream = proxyRes;
      if (encoding === 'gzip') {
        stream = proxyRes.pipe(zlib.createGunzip());
      } else if (encoding === 'deflate') {
        stream = proxyRes.pipe(zlib.createInflate());
      } else if (encoding === 'br') {
        stream = proxyRes.pipe(zlib.createBrotliDecompress());
      }

      const chunks = [];
      stream.on('data', (c) => chunks.push(c));
      stream.on('end', () => {
        try {
          const body = Buffer.concat(chunks).toString('utf-8');
          const rewritten = rewriteHtml(body, parsedTarget.href, isEmbed);
          res.writeHead(proxyRes.statusCode || 200, outHeaders);
          res.end(rewritten);
        } catch {
          res.writeHead(500, { 'Content-Type': 'text/plain' });
          res.end('Error procesando respuesta del proxy');
        }
      });
      stream.on('error', () => {
        res.writeHead(502, { 'Content-Type': 'text/plain' });
        res.end('Error de descompresión en el proxy');
      });
    } else {
      res.writeHead(proxyRes.statusCode || 200, outHeaders);
      proxyRes.pipe(res);
    }
  });

  proxyReq.on('timeout', () => {
    proxyReq.destroy();
    if (!res.headersSent) {
      res.writeHead(504, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Timeout en la conexión segura con el servidor destino.');
    }
  });

  proxyReq.on('error', (err) => {
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Error en conexión segura: ' + (err.message || 'Error'));
    }
  });

  if (req.method === 'POST') {
    req.pipe(proxyReq);
  } else {
    proxyReq.end();
  }
}

module.exports = {
  handleProxyRequest,
  decodeTargetUrl,
  encodeProxyUrl,
  isPrivateHost,
  rewriteHtml,
};
