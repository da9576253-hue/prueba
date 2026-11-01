'use strict';
/**
 * Controlador de Mozilla Firefox con Iframe Central Integrado
 * Todo el tráfico del iframe navega protegido por el túnel VPN y DNS DoH.
 */

// Elementos del DOM
const iframe = document.getElementById('firefox-iframe');
const addressForm = document.getElementById('address-form');
const addressInput = document.getElementById('address-input');
const addressClear = document.getElementById('address-clear');
const tabTitle = document.getElementById('tab-title');
const tabFavicon = document.getElementById('tab-favicon');
const tabResetBtn = document.getElementById('tab-reset-btn');
const newTabBtn = document.getElementById('new-tab-btn');

// Botones de Navegación Toolbar
const navBackBtn = document.getElementById('nav-back-btn');
const navForwardBtn = document.getElementById('nav-forward-btn');
const navReloadBtn = document.getElementById('nav-reload-btn');
const navHomeBtn = document.getElementById('nav-home-btn');

// Controles y Modales
const themeBtn = document.getElementById('theme-btn');
const shieldToggleBtn = document.getElementById('shield-toggle-btn');
const dohStatusBtn = document.getElementById('doh-status-btn');
const shieldModal = document.getElementById('shield-modal');
const shieldXBtn = document.getElementById('shield-x-btn');
const shieldOkBtn = document.getElementById('shield-ok-btn');

// Marcadores Rápidos
const bookmarkBtns = document.querySelectorAll('.bm-btn');

/* ---------- Alternar Tema Claro / Oscuro ---------- */
themeBtn.addEventListener('click', () => {
  document.body.classList.toggle('firefox-theme-light');
  document.body.classList.toggle('firefox-theme-dark');
});

/* ---------- Modal del Escudo de Protección ---------- */
function toggleShield() {
  shieldModal.classList.toggle('hidden');
}
shieldToggleBtn.addEventListener('click', toggleShield);
dohStatusBtn.addEventListener('click', toggleShield);
shieldXBtn.addEventListener('click', () => shieldModal.classList.add('hidden'));
shieldOkBtn.addEventListener('click', () => shieldModal.classList.add('hidden'));
shieldModal.addEventListener('click', (e) => {
  if (e.target === shieldModal) shieldModal.classList.add('hidden');
});

/* ---------- Detección Inteligente de URL o Búsqueda ---------- */
function isDirectWebAddress(str) {
  const s = str.trim();
  if (/^https?:\/\//i.test(s)) return true;
  if (/^[a-zA-Z0-9-]+(\.[a-zA-Z0-9-]+)+([\/?#].*)?$/i.test(s) && !s.includes(' ')) {
    return true;
  }
  return false;
}

function extractHost(urlStr) {
  try {
    return new URL(urlStr).hostname.replace(/^www\./, '');
  } catch {
    return urlStr;
  }
}

/**
 * Navega el Iframe de Firefox a cualquier destino de forma segura
 */
function navigateTo(target) {
  const q = (target || '').trim();
  if (!q) return;

  let finalUrl = '';
  let displayTitle = '';

  if (isDirectWebAddress(q)) {
    finalUrl = /^https?:\/\//i.test(q) ? q : 'https://' + q;
    displayTitle = extractHost(finalUrl);
  } else {
    // Si es un término de búsqueda (como 'lupin'), buscar directamente en Google dentro del iframe
    finalUrl = `https://www.google.com/search?q=${encodeURIComponent(q)}&hl=es`;
    displayTitle = `${q} - Búsqueda de Google`;
  }

  // Actualizar la interfaz de Firefox
  addressInput.value = finalUrl;
  addressClear.classList.remove('hidden');
  tabTitle.textContent = displayTitle;
  document.title = `${displayTitle} — Mozilla Firefox`;

  // Cargar dentro del iframe a través del proxy seguro
  iframe.src = `/proxy?url=${encodeURIComponent(finalUrl)}&embed=1`;
}

/* ---------- Formulario de la Barra de Direcciones ---------- */
addressForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const val = addressInput.value.trim();
  if (val) navigateTo(val);
});

addressInput.addEventListener('input', () => {
  addressClear.classList.toggle('hidden', !addressInput.value.trim());
});

addressClear.addEventListener('click', () => {
  addressInput.value = '';
  addressClear.classList.add('hidden');
  addressInput.focus();
});

/* ---------- Botones de Navegación del Iframe ---------- */
navBackBtn.addEventListener('click', () => {
  try { iframe.contentWindow.history.back(); } catch {}
});

navForwardBtn.addEventListener('click', () => {
  try { iframe.contentWindow.history.forward(); } catch {}
});

navReloadBtn.addEventListener('click', () => {
  if (iframe.src) iframe.src = iframe.src;
});

navHomeBtn.addEventListener('click', () => {
  navigateTo('https://www.google.com');
});

tabResetBtn.addEventListener('click', () => {
  navigateTo('https://www.google.com');
});

newTabBtn.addEventListener('click', () => {
  navigateTo('https://www.google.com');
  addressInput.value = '';
  addressInput.focus();
});

/* ---------- Marcadores Rápidos ---------- */
bookmarkBtns.forEach((btn) => {
  btn.addEventListener('click', () => {
    const url = btn.dataset.url;
    if (url) navigateTo(url);
  });
});

/* ---------- Sincronización Automática con el Iframe ---------- */
window.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'FIREFOX_SYNC_URL') {
    const rawUrl = event.data.url;
    if (rawUrl) {
      addressInput.value = rawUrl;
      const host = extractHost(rawUrl);
      const title = event.data.title || host;
      tabTitle.textContent = title;
      document.title = `${title} — Mozilla Firefox`;
      addressClear.classList.remove('hidden');
    }
  }
});

/* ---------- Carga Inicial Automática al entrar a Render ---------- */
window.addEventListener('DOMContentLoaded', () => {
  const urlParams = new URLSearchParams(window.location.search);
  const qParam = urlParams.get('q');
  const targetUrlParam = urlParams.get('url');

  if (targetUrlParam) {
    navigateTo(targetUrlParam);
  } else if (qParam) {
    navigateTo(qParam);
  } else {
    // Por defecto, carga Google directamente dentro del iframe de Firefox
    addressInput.value = 'https://www.google.com';
    tabTitle.textContent = 'Google en Firefox';
  }
});
