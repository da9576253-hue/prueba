'use strict';
const form = document.getElementById('form');
const input = document.getElementById('q');
const box = document.getElementById('results');
const main = document.getElementById('main');
const TITLE = document.title; // fijo: el historial siempre muestra la página de ciberseguridad
let controller = null;

function el(tag, props = {}, ...kids) {
  const n = document.createElement(tag);
  Object.assign(n, props);
  kids.forEach((k) => n.append(k));
  return n;
}
function message(text) { box.replaceChildren(el('p', { className: 'msg', textContent: text })); }
function safeUrl(u) {
  try { const p = new URL(u); return /^https?:$/.test(p.protocol) ? p.href : null; } catch { return null; }
}

async function search(q) {
  if (controller) controller.abort();
  controller = new AbortController();
  main.classList.add('top');
  message('Analizando…');
  try {
    const r = await fetch('/api/search?q=' + encodeURIComponent(q), { signal: controller.signal });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return message(data.error || 'No se pudo realizar la búsqueda.');
    const items = (Array.isArray(data) ? data : []).filter((x) => safeUrl(x.url));
    if (!items.length) return message('Sin resultados.');
    box.replaceChildren(...items.map((x) => el('div', { className: 'r' },
      el('a', { href: safeUrl(x.url), target: '_blank', rel: 'noopener noreferrer', textContent: x.title }),
      el('small', { textContent: x.url }),
      el('p', { textContent: x.snippet || '' }))));
  } catch (e) {
    if (e.name !== 'AbortError') message('Sin conexión. Revisa tu internet e inténtalo otra vez.');
  } finally {
    document.title = TITLE;
  }
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const q = input.value.trim();
  if (q) search(q);
});
