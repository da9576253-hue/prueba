'use strict';
/**
 * Motor del Navegador Mozilla Firefox Web
 * Administra pestañas, historial, barra de direcciones omnibox, navegación
 * a través del túnel VPN y protección contra rastreo con DNS DoH.
 */

// Elementos del DOM
const tabsContainer = document.getElementById('tabs-container');
const newTabBtn = document.getElementById('new-tab-btn');
const navBackBtn = document.getElementById('nav-back-btn');
const navForwardBtn = document.getElementById('nav-forward-btn');
const navReloadBtn = document.getElementById('nav-reload-btn');
const navHomeBtn = document.getElementById('nav-home-btn');
const addressForm = document.getElementById('firefox-address-form');
const addressInput = document.getElementById('firefox-address-input');
const addressClearBtn = document.getElementById('address-clear-btn');
const shieldBtn = document.getElementById('firefox-shield-btn');
const shieldPopup = document.getElementById('shield-popup');
const shieldCloseBtn = document.getElementById('shield-close-btn');
const homePage = document.getElementById('firefox-home-page');
const homeSearchForm = document.getElementById('home-search-form');
const homeSearchInput = document.getElementById('home-search-input');
const webFramesContainer = document.getElementById('web-frames-container');
const themeBtn = document.getElementById('theme-btn');

// Estado del Navegador
let tabIdCounter = 1;
let activeTabId = 1;
const tabs = new Map(); // id -> { id, url, title, favicon, isHome }

/* ---------- Inicialización de la Pestaña Inicial ---------- */
tabs.set(1, {
  id: 1,
  url: '',
  title: 'Nueva pestaña',
  favicon: '🦊',
  isHome: true,
});

/* ---------- Cambio de Tema ---------- */
themeBtn.addEventListener('click', () => {
  document.body.classList.toggle('firefox-theme-light');
  document.body.classList.toggle('firefox-theme-dark');
});

/* ---------- Sistema de Pestañas de Firefox ---------- */
function createTab(initialUrl = '') {
  tabIdCounter++;
  const id = tabIdCounter;
  const newTab = {
    id,
    url: initialUrl,
    title: initialUrl ? extractHost(initialUrl) : 'Nueva pestaña',
    favicon: initialUrl ? '🌐' : '🦊',
    isHome: !initialUrl,
  };
  tabs.set(id, newTab);

  // Crear elemento en la barra de pestañas
  const tabEl = document.createElement('div');
  tabEl.className = 'firefox-tab';
  tabEl.dataset.tabId = id;
  tabEl.innerHTML = `
    <span class="tab-favicon">${newTab.favicon}</span>
    <span class="tab-title">${escapeHtml(newTab.title)}</span>
    <button type="button" class="tab-close-btn" title="Cerrar pestaña">&times;</button>
  `;

  tabEl.addEventListener('click', (e) => {
    if (e.target.classList.contains('tab-close-btn')) {
      e.stopPropagation();
      closeTab(id);
    } else {
      switchTab(id);
    }
  });

  tabsContainer.appendChild(tabEl);

  // Crear iframe asociado para la pestaña
  const iframe = document.createElement('iframe');
  iframe.className = 'web-frame';
  iframe.id = `frame-tab-${id}`;
  webFramesContainer.appendChild(iframe);

  switchTab(id);

  if (initialUrl) {
    navigateTo(initialUrl, id);
  }
}

function switchTab(id) {
  if (!tabs.has(id)) return;
  activeTabId = id;
  const tabData = tabs.get(id);

  // Actualizar pestañas en la barra
  document.querySelectorAll('.firefox-tab').forEach((el) => {
    el.classList.toggle('active', parseInt(el.dataset.tabId, 10) === id);
  });

  // Mostrar el iframe correspondiente o la página de inicio
  document.querySelectorAll('.web-frame').forEach((frame) => {
    frame.classList.remove('active');
  });

  if (tabData.isHome) {
    homePage.classList.remove('hidden');
    addressInput.value = '';
    addressClearBtn.classList.add('hidden');
    homeSearchInput.value = '';
    homeSearchInput.focus();
  } else {
    homePage.classList.add('hidden');
    const activeFrame = document.getElementById(`frame-tab-${id}`);
    if (activeFrame) {
      activeFrame.classList.add('active');
    }
    addressInput.value = tabData.url;
    addressClearBtn.classList.remove('hidden');
  }
}

function closeTab(id) {
  if (tabs.size <= 1) {
    // Si es la última pestaña, reiniciarla a Nueva Pestaña
    const singleTab = tabs.get(id);
    singleTab.url = '';
    singleTab.title = 'Nueva pestaña';
    singleTab.favicon = '🦊';
    singleTab.isHome = true;
    updateTabUI(id);
    switchTab(id);
    const frame = document.getElementById(`frame-tab-${id}`);
    if (frame) frame.src = 'about:blank';
    return;
  }

  // Eliminar iframe y pestaña
  const tabEl = document.querySelector(`.firefox-tab[data-tab-id="${id}"]`);
  if (tabEl) tabEl.remove();
  const frameEl = document.getElementById(`frame-tab-${id}`);
  if (frameEl) frameEl.remove();

  tabs.delete(id);

  // Si cerramos la pestaña activa, cambiar a la última abierta
  if (activeTabId === id) {
    const remainingIds = Array.from(tabs.keys());
    switchTab(remainingIds[remainingIds.length - 1]);
  }
}

function updateTabUI(id) {
  const tabData = tabs.get(id);
  if (!tabData) return;
  const tabEl = document.querySelector(`.firefox-tab[data-tab-id="${id}"]`);
  if (tabEl) {
    tabEl.querySelector('.tab-favicon').textContent = tabData.favicon;
    tabEl.querySelector('.tab-title').textContent = tabData.title;
  }
  if (activeTabId === id) {
    document.title = `${tabData.title} — Mozilla Firefox`;
  }
}

newTabBtn.addEventListener('click', () => createTab());

// Click en la primera pestaña inicial
document.querySelector('.firefox-tab').addEventListener('click', (e) => {
  if (e.target.classList.contains('tab-close-btn')) {
    e.stopPropagation();
    closeTab(1);
  } else {
    switchTab(1);
  }
});

/* ---------- Navegación Inteligente (URLs y Búsquedas) ---------- */
function isDirectWebAddress(str) {
  const s = str.trim();
  if (/^https?:\/\//i.test(s)) return true;
  if (/^[a-zA-Z0-9-]+(\.[a-zA-Z0-9-]+)+([\/?#].*)?$/i.test(s) && !s.includes(' ')) {
    return true;
  }
  return false;
}

function navigateTo(queryOrUrl, targetTabId = activeTabId) {
  const q = queryOrUrl.trim();
  if (!q) return;

  const tabData = tabs.get(targetTabId);
  if (!tabData) return;

  let finalTargetUrl = '';

  if (isDirectWebAddress(q)) {
    finalTargetUrl = /^https?:\/\//i.test(q) ? q : 'https://' + q;
  } else {
    // Si es un término de búsqueda (como 'lupin'), buscar directamente en Google o Bing vía VPN
    finalTargetUrl = `https://www.google.com/search?q=${encodeURIComponent(q)}&hl=es`;
  }

  tabData.url = finalTargetUrl;
  tabData.title = extractHost(finalTargetUrl);
  tabData.favicon = '🌐';
  tabData.isHome = false;

  homePage.classList.add('hidden');
  addressInput.value = finalTargetUrl;
  addressClearBtn.classList.remove('hidden');

  let frame = document.getElementById(`frame-tab-${targetTabId}`);
  if (!frame) {
    frame = document.createElement('iframe');
    frame.className = 'web-frame';
    frame.id = `frame-tab-${targetTabId}`;
    webFramesContainer.appendChild(frame);
  }

  // Carga dentro del túnel VPN seguro con embed=1
  frame.src = `/proxy?url=${encodeURIComponent(finalTargetUrl)}&embed=1`;
  frame.classList.add('active');

  updateTabUI(targetTabId);
}

/* ---------- Formularios de Búsqueda y Omnibox ---------- */
addressForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const val = addressInput.value.trim();
  if (val) navigateTo(val);
});

homeSearchForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const val = homeSearchInput.value.trim();
  if (val) navigateTo(val);
});

addressInput.addEventListener('input', () => {
  addressClearBtn.classList.toggle('hidden', !addressInput.value.trim());
});

addressClearBtn.addEventListener('click', () => {
  addressInput.value = '';
  addressClearBtn.classList.add('hidden');
  addressInput.focus();
});

/* ---------- Botones de Navegación Toolbar ---------- */
navBackBtn.addEventListener('click', () => {
  const frame = document.getElementById(`frame-tab-${activeTabId}`);
  if (frame && frame.contentWindow) {
    try { frame.contentWindow.history.back(); } catch {}
  }
});

navForwardBtn.addEventListener('click', () => {
  const frame = document.getElementById(`frame-tab-${activeTabId}`);
  if (frame && frame.contentWindow) {
    try { frame.contentWindow.history.forward(); } catch {}
  }
});

navReloadBtn.addEventListener('click', () => {
  const frame = document.getElementById(`frame-tab-${activeTabId}`);
  if (frame && frame.src) {
    frame.src = frame.src;
  }
});

navHomeBtn.addEventListener('click', () => {
  const tabData = tabs.get(activeTabId);
  if (tabData) {
    tabData.isHome = true;
    tabData.title = 'Nueva pestaña';
    tabData.favicon = '🦊';
    updateTabUI(activeTabId);
    switchTab(activeTabId);
  }
});

/* ---------- Marcadores y Atajos ---------- */
document.querySelectorAll('.bookmark-item, .shortcut-tile').forEach((item) => {
  item.addEventListener('click', () => {
    const url = item.dataset.url;
    if (url) navigateTo(url);
  });
});

/* ---------- Popup del Escudo Firefox ---------- */
shieldBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  shieldPopup.classList.toggle('hidden');
});
if (shieldCloseBtn) {
  shieldCloseBtn.addEventListener('click', () => shieldPopup.classList.add('hidden'));
}
document.addEventListener('click', (e) => {
  if (!shieldPopup.contains(e.target) && e.target !== shieldBtn) {
    shieldPopup.classList.add('hidden');
  }
});

/* ---------- Sincronización de URLs entre el Iframe y Firefox ---------- */
window.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'FIREFOX_SYNC_URL') {
    const rawUrl = event.data.url;
    const tabData = tabs.get(activeTabId);
    if (tabData && rawUrl) {
      tabData.url = rawUrl;
      if (event.data.title) {
        tabData.title = event.data.title;
      } else {
        tabData.title = extractHost(rawUrl);
      }
      addressInput.value = rawUrl;
      updateTabUI(activeTabId);
    }
  }
});

/* ---------- Utilidades ---------- */
function extractHost(urlStr) {
  try {
    return new URL(urlStr).hostname.replace(/^www\./, '');
  } catch {
    return urlStr;
  }
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ---------- Carga Automática inicial con ?q= o ?url= ---------- */
window.addEventListener('DOMContentLoaded', () => {
  const urlParams = new URLSearchParams(window.location.search);
  const qParam = urlParams.get('q');
  const targetUrlParam = urlParams.get('url');

  if (targetUrlParam) {
    navigateTo(targetUrlParam);
  } else if (qParam) {
    navigateTo(qParam);
  }
});
