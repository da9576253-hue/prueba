# Portal Buscador

Servidor Node.js (sin dependencias) + interfaz HTML/CSS/JS con buscador.
La pestaña se guarda en el historial como **"Ciberseguridad | Centro de Seguridad de Red"**.

## Local
    node server.js        # http://localhost:8080
    npm test              # pruebas de los parsers (node test/parse.test.js)

## Render
1. Sube esta carpeta a GitHub.
2. Render → New → Web Service → elige el repo (detecta `render.yaml`).
3. Abre `https://TU-APP.onrender.com` desde cualquier dispositivo.

## Robustez incluida
- Dos proveedores de búsqueda con respaldo automático y timeout por petición.
- Caché de resultados, límite por IP (429), tope de búsquedas simultáneas (503).
- Cabeceras de seguridad (CSP estricta, nosniff, no-referrer, frame-ancestors none).
- Archivos precargados con gzip y ETag; solo GET/HEAD; protección contra rutas maliciosas.
- Filtro de URLs: solo http/https; sin anuncios; el front construye el DOM sin innerHTML.
- `/healthz` para Render, apagado limpio con SIGTERM, timeouts y keep-alive ajustados a Render.
- Captura de errores no controlados; logs JSON (no registra lo que se busca).

## Variables de entorno
`PORT`, `DOMAIN`, `RATE_LIMIT`, `MAX_CONCURRENT_SEARCHES`, `SEARCH_TIMEOUT_MS`, `CACHE_TTL_MS`, `TRUST_PROXY`, `CAPTIVE` (ver cabecera de `server.js`).

## Nota
El plan gratis de Render duerme el servicio tras ~15 min sin uso; la primera visita puede tardar ~30 s.
Los resultados se abren en pestaña nueva y esas páginas se guardan en el historial con su propio título.
