'use strict';
/**
 * Lógica del Portal Buscador Google con VPN Web y DNS Cifrado
 */

// Elementos del DOM
const searchForm = document.getElementById('search-form');
const searchInput = document.getElementById('search-input');
const clearBtn = document.getElementById('clear-btn');
const suggestionsBox = document.getElementById('suggestions-box');
const searchBoxWrap = document.querySelector('.search-box-wrap');
const homeView = document.getElementById('home-view');
const resultsView = document.getElementById('results-view');
const resultsContainer = document.getElementById('results-container');
const searchStats = document.getElementById('search-stats');
const categoryTabs = document.getElementById('category-tabs');
const paginationBox = document.getElementById('pagination-box');
const logoMain = document.getElementById('logo-main');
const homeLink = document.getElementById('home-link');

// Botones y Controles
const btnSearch = document.getElementById('btn-search');
const btnLucky = document.getElementById('btn-lucky');
const themeToggle = document.getElementById('theme-toggle');
const stealthToggle = document.getElementById('stealth-toggle');
const appsBtn = document.getElementById('apps-btn');
const appsMenu = document.getElementById('apps-menu');
const vpnStatusBtn = document.getElementById('vpn-status-btn');
const avatarBtn = document.getElementById('avatar-btn');
const micBtn = document.getElementById('mic-btn');
const lensBtn = document.getElementById('lens-btn');

// Modal de Seguridad
const securityModal = document.getElementById('security-modal');
const modalCloseBtn = document.getElementById('modal-close-btn');
const modalOkBtn = document.getElementById('modal-ok-btn');
const dohUrlField = document.getElementById('doh-url-field');
const copyDohBtn = document.getElementById('copy-doh-btn');
const openVpnModalBtn = document.getElementById('open-vpn-modal-btn');
const openDnsGuideBtn = document.getElementById('open-dns-guide-btn');
const footerPrivacyBtn = document.getElementById('footer-privacy-btn');
const footerStatusBtn = document.getElementById('footer-status-btn');

// Estado de la aplicación
let activeCategory = 'all';
let currentQuery = '';
let searchAbortController = null;
let suggestAbortController = null;
let suggestDebounceTimer = null;
let selectedSuggestionIndex = -1;
let currentSuggestions = [];
let isStealthMode = false;

/* ---------- Inicialización de tema y DoH URL ---------- */
const savedTheme = localStorage.getItem('google_portal_theme') || 'light';
setTheme(savedTheme);

// Rellenar dinámicamente la URL de DoH de nuestro sitio
if (dohUrlField) {
  dohUrlField.value = `${window.location.origin}/api/dns-query`;
}

function setTheme(theme) {
  if (theme === 'dark') {
    document.body.classList.add('theme-dark');
    document.body.classList.remove('theme-light');
  } else {
    document.body.classList.add('theme-light');
    document.body.classList.remove('theme-dark');
  }
  localStorage.setItem('google_portal_theme', theme);
}

themeToggle.addEventListener('click', () => {
  const isDark = document.body.classList.contains('theme-dark');
  setTheme(isDark ? 'light' : 'dark');
});

/* ---------- Modo Camuflaje (Disfraz de Ciberseguridad) ---------- */
stealthToggle.addEventListener('click', () => {
  isStealthMode = !isStealthMode;
  if (isStealthMode) {
    document.title = 'Ciberseguridad | Centro de Seguridad de Red';
    stealthToggle.style.color = '#34a853';
  } else {
    document.title = currentQuery ? `${currentQuery} - Buscar con Google` : 'Google';
    stealthToggle.style.color = '';
  }
});

/* ---------- Menú de Apps de Google ---------- */
appsBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  appsMenu.classList.toggle('show');
});
document.addEventListener('click', (e) => {
  if (!appsMenu.contains(e.target) && e.target !== appsBtn) {
    appsMenu.classList.remove('show');
  }
});

/* ---------- Modal de Seguridad y DNS ---------- */
function openSecurityModal() {
  securityModal.classList.remove('hidden');
}
function closeSecurityModal() {
  securityModal.classList.add('hidden');
}

vpnStatusBtn.addEventListener('click', openSecurityModal);
avatarBtn.addEventListener('click', openSecurityModal);
if (openVpnModalBtn) openVpnModalBtn.addEventListener('click', openSecurityModal);
if (openDnsGuideBtn) openDnsGuideBtn.addEventListener('click', openSecurityModal);
if (footerPrivacyBtn) footerPrivacyBtn.addEventListener('click', openSecurityModal);
if (footerStatusBtn) footerStatusBtn.addEventListener('click', openSecurityModal);
modalCloseBtn.addEventListener('click', closeSecurityModal);
modalOkBtn.addEventListener('click', closeSecurityModal);
securityModal.addEventListener('click', (e) => {
  if (e.target === securityModal) closeSecurityModal();
});

copyDohBtn.addEventListener('click', () => {
  dohUrlField.select();
  navigator.clipboard.writeText(dohUrlField.value).then(() => {
    copyDohBtn.textContent = '¡Copiado!';
    setTimeout(() => { copyDohBtn.textContent = 'Copiar URL DoH'; }, 2000);
  });
});

/* ---------- Entrada de búsqueda y botón limpiar ---------- */
searchInput.addEventListener('input', () => {
  const val = searchInput.value.trim();
  if (val) {
    clearBtn.classList.remove('hidden');
    triggerSuggestions(val);
  } else {
    clearBtn.classList.add('hidden');
    hideSuggestions();
  }
});

clearBtn.addEventListener('click', () => {
  searchInput.value = '';
  clearBtn.classList.add('hidden');
  hideSuggestions();
  searchInput.focus();
});

/* ---------- Autocompletado / Sugerencias en tiempo real ---------- */
function triggerSuggestions(query) {
  clearTimeout(suggestDebounceTimer);
  suggestDebounceTimer = setTimeout(async () => {
    if (suggestAbortController) suggestAbortController.abort();
    suggestAbortController = new AbortController();
    try {
      const res = await fetch(`/api/suggest?q=${encodeURIComponent(query)}`, {
        signal: suggestAbortController.signal,
      });
      if (!res.ok) return hideSuggestions();
      const items = await res.json();
      if (Array.isArray(items) && items.length) {
        renderSuggestions(items);
      } else {
        hideSuggestions();
      }
    } catch (e) {
      if (e.name !== 'AbortError') hideSuggestions();
    }
  }, 120);
}

function renderSuggestions(list) {
  currentSuggestions = list;
  selectedSuggestionIndex = -1;
  suggestionsBox.innerHTML = '';
  list.forEach((item, idx) => {
    const div = document.createElement('div');
    div.className = 'suggestion-item';
    div.innerHTML = `
      <span class="suggestion-icon">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>
      </span>
      <span>${escapeHtml(item)}</span>
    `;
    div.addEventListener('click', () => {
      searchInput.value = item;
      hideSuggestions();
      executeSearch(item);
    });
    suggestionsBox.appendChild(div);
  });
  suggestionsBox.classList.remove('hidden');
  searchBoxWrap.classList.add('has-suggestions');
}

function hideSuggestions() {
  suggestionsBox.classList.add('hidden');
  searchBoxWrap.classList.remove('has-suggestions');
  currentSuggestions = [];
  selectedSuggestionIndex = -1;
}

// Navegación con teclado en sugerencias
searchInput.addEventListener('keydown', (e) => {
  if (suggestionsBox.classList.contains('hidden') || !currentSuggestions.length) return;

  const items = suggestionsBox.querySelectorAll('.suggestion-item');
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    selectedSuggestionIndex = (selectedSuggestionIndex + 1) % items.length;
    updateSuggestionHighlight(items);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    selectedSuggestionIndex = (selectedSuggestionIndex - 1 + items.length) % items.length;
    updateSuggestionHighlight(items);
  } else if (e.key === 'Escape') {
    hideSuggestions();
  } else if (e.key === 'Enter') {
    if (selectedSuggestionIndex >= 0 && items[selectedSuggestionIndex]) {
      e.preventDefault();
      searchInput.value = currentSuggestions[selectedSuggestionIndex];
      hideSuggestions();
      executeSearch(searchInput.value);
    }
  }
});

function updateSuggestionHighlight(items) {
  items.forEach((it, i) => {
    if (i === selectedSuggestionIndex) {
      it.classList.add('selected');
      searchInput.value = currentSuggestions[i];
    } else {
      it.classList.remove('selected');
    }
  });
}

document.addEventListener('click', (e) => {
  if (!searchBoxWrap.contains(e.target)) hideSuggestions();
});

/* ---------- Envío de búsqueda ---------- */
searchForm.addEventListener('submit', (e) => {
  e.preventDefault();
  hideSuggestions();
  const q = searchInput.value.trim();
  if (q) executeSearch(q);
});

// Botón "Me siento con suerte"
btnLucky.addEventListener('click', async () => {
  const q = searchInput.value.trim();
  if (!q) return;
  try {
    const res = await fetch(`/api/search?q=${encodeURIComponent(q)}&category=all`);
    const data = await res.json();
    if (data.results && data.results.length) {
      // Abre el primer resultado directamente a través del túnel VPN web
      window.location.href = data.results[0].proxyUrl || `/proxy?url=${encodeURIComponent(data.results[0].url)}`;
      return;
    }
  } catch {
    // Si falla, ejecuta búsqueda normal
  }
  executeSearch(q);
});

// Pestañas de categoría
categoryTabs.querySelectorAll('.cat-tab:not(.proxy-tab)').forEach((tab) => {
  tab.addEventListener('click', () => {
    categoryTabs.querySelectorAll('.cat-tab').forEach((t) => t.classList.remove('active'));
    tab.classList.add('active');
    activeCategory = tab.dataset.cat || 'all';
    if (currentQuery) executeSearch(currentQuery, activeCategory);
  });
});

/* ---------- Ejecución y Renderizado de Búsqueda ---------- */
async function executeSearch(query, category = activeCategory) {
  currentQuery = query;
  if (!isStealthMode) {
    document.title = `${query} - Buscar con Google`;
  }

  // Activar vista de resultados
  document.body.classList.add('in-results');
  resultsView.classList.remove('hidden');
  resultsContainer.innerHTML = '<div style="padding:20px 0;color:var(--text-muted);font-size:15px;">🔍 Buscando en red segura cifrada…</div>';
  searchStats.textContent = 'Cargando resultados a través del túnel VPN seguro…';

  if (searchAbortController) searchAbortController.abort();
  searchAbortController = new AbortController();

  const startTime = Date.now();
  try {
    const res = await fetch(`/api/search?q=${encodeURIComponent(query)}&category=${encodeURIComponent(category)}`, {
      signal: searchAbortController.signal,
    });
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      resultsContainer.innerHTML = `
        <div style="padding:24px 0;">
          <h3 style="color:#ea4335;margin-bottom:8px;">No se pudo realizar la búsqueda</h3>
          <p style="color:var(--text-sub);">${escapeHtml(data.error || 'Error de conexión con el proveedor de búsqueda.')}</p>
        </div>`;
      return;
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    const results = Array.isArray(data.results) ? data.results : [];

    searchStats.textContent = `Cerca de ${results.length * 1420} resultados (${duration} segundos) • 🛡️ Conexión cifrada vía túnel VPN & DoH`;

    if (!results.length) {
      resultsContainer.innerHTML = `
        <div style="padding:24px 0;">
          <p style="color:var(--text-main);font-size:16px;margin-bottom:12px;">No se han encontrado resultados para <strong>${escapeHtml(query)}</strong>.</p>
          <ul style="color:var(--text-sub);font-size:14px;padding-left:20px;line-height:1.6;">
            <li>Asegúrate de que todas las palabras estén escritas correctamente.</li>
            <li>Prueba con otras palabras clave o términos más generales.</li>
            <li>Prueba a buscar navegando con la <a href="/proxy" style="color:var(--link-color);">VPN Web directa</a>.</li>
          </ul>
        </div>`;
      paginationBox.classList.add('hidden');
      return;
    }

    renderResults(results);
    paginationBox.classList.remove('hidden');
  } catch (err) {
    if (err.name !== 'AbortError') {
      resultsContainer.innerHTML = `
        <div style="padding:24px 0;">
          <p style="color:#ea4335;">Sin conexión con el servidor. Revisa tu red o intenta de nuevo.</p>
        </div>`;
    }
  }
}

function renderResults(results) {
  resultsContainer.innerHTML = '';

  results.forEach((item) => {
    const card = document.createElement('article');
    card.className = 'result-card';

    const safeUrl = item.url;
    const proxyUrl = item.proxyUrl || `/proxy?url=${encodeURIComponent(safeUrl)}`;
    const domain = item.domain || extractHost(safeUrl);
    const faviconUrl = item.favicon || `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;

    card.innerHTML = `
      <div class="result-meta">
        <img class="result-favicon" src="${escapeHtml(faviconUrl)}" alt="" onerror="this.style.display='none'">
        <div class="result-source-box">
          <span class="result-site-name">${escapeHtml(domain || 'Sitio web')}</span>
          <span class="result-breadcrumb">${escapeHtml(safeUrl)}</span>
        </div>
      </div>
      <h3 class="result-title">
        <a href="${escapeHtml(proxyUrl)}" title="Abrir de forma segura en VPN">${escapeHtml(item.title)}</a>
      </h3>
      <p class="result-snippet">${escapeHtml(item.snippet || '')}</p>
      <div class="result-actions">
        <a href="${escapeHtml(proxyUrl)}" class="vpn-badge-btn" title="Navegar sin exponer tu IP real ni consultar tu DNS local">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm-2 16l-4-4 1.41-1.41L10 14.17l6.59-6.59L18 9l-8 8z"/></svg>
          Navegar Seguro (VPN Web)
        </a>
        <a href="${escapeHtml(safeUrl)}" target="_blank" rel="noopener noreferrer" class="direct-link-btn" title="Abrir enlace original en pestaña nueva">
          Enlace Directo ↗
        </a>
      </div>
    `;

    resultsContainer.appendChild(card);
  });
}

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

/* ---------- Regresar al inicio al hacer clic en Google ---------- */
if (homeLink) {
  homeLink.addEventListener('click', (e) => {
    e.preventDefault();
    resetToHome();
  });
}
if (logoMain) {
  logoMain.addEventListener('click', resetToHome);
}

function resetToHome() {
  document.body.classList.remove('in-results');
  resultsView.classList.add('hidden');
  resultsContainer.innerHTML = '';
  searchInput.value = '';
  clearBtn.classList.add('hidden');
  hideSuggestions();
  if (!isStealthMode) document.title = 'Google';
  searchInput.focus();
}

/* ---------- Reconocimiento de voz / Micrófono ---------- */
micBtn.addEventListener('click', () => {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (SpeechRecognition) {
    const recognition = new SpeechRecognition();
    recognition.lang = 'es-ES';
    recognition.start();
    searchInput.placeholder = 'Escuchando… habla ahora';
    recognition.onresult = (evt) => {
      const transcript = evt.results[0][0].transcript;
      searchInput.value = transcript;
      searchInput.placeholder = '';
      executeSearch(transcript);
    };
    recognition.onerror = () => {
      searchInput.placeholder = '';
    };
    recognition.onend = () => {
      searchInput.placeholder = '';
    };
  } else {
    alert('Búsqueda por voz activa. Escribe tu consulta en el buscador.');
  }
});

/* ---------- Google Lens ---------- */
lensBtn.addEventListener('click', () => {
  const imgUrl = prompt('Introduce la URL de una imagen para buscarla o analizarla:');
  if (imgUrl && imgUrl.trim()) {
    searchInput.value = imgUrl.trim();
    executeSearch(imgUrl.trim(), 'images');
  }
});
