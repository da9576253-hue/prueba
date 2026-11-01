# Mozilla Firefox Web — Navegador Privado en la Nube con VPN y DoH

Ahora tu portal es **literalmente Mozilla Firefox ejecutándose en la web**:
1. **Interfaz Real de Mozilla Firefox (Proton UI)**:
   - **Barra de Pestañas**: Abre múltiples pestañas (`+`), ciérralas (`✕`), navega entre ellas y visualiza sus favicons y títulos en tiempo real.
   - **Barra de Herramientas**: Botones Atrás (`◀`), Adelante (`▶`), Recargar (`⟳`) y Página de Inicio (`🏠`).
   - **Omnibox (Barra de direcciones inteligente)**: Muestra la URL actual, busca en Google o navega directamente a cualquier web (`wikipedia.org`, `youtube.com`, `elpais.com`, etc.).
   - **Barra de Marcadores**: Accesos directos rápidos a Google, Wikipedia, YouTube, Noticias, Reddit, Traductor y DuckDuckGo.
   - **Página de Inicio de Firefox (`about:home`)**: Con el logo oficial del zorro de fuego, buscador integrado y accesos directos principales.
2. **Navegación Cifrada VPN Integrada**:
   - Cada sitio web se carga dentro de una pestaña mediante el proxy VPN seguro (`/proxy?url=...`).
   - Tu IP real está 100% oculta; los sitios web solo ven la IP del servidor en Render.
   - Se eliminan rastreadores, cookies de terceros y scripts criptomineros.
3. **DNS Seguro de Red (DNS-over-HTTPS / DoH - RFC 8484)**:
   - Toda resolución de dominios en el servidor se hace a través de DoH cifrado, impidiendo espionaje de tu proveedor de internet (ISP).
4. **Cero Dependencias Externas**:
   - Corre sobre Node.js nativo puro, garantizando despliegues en segundos sin riesgo de memoria en Render.

---

## 🚀 Inicio y Despliegue

### Local
```bash
node server.js        # Accede a http://localhost:8080
npm test              # Ejecuta las 11 pruebas unitarias
```

### Render
Haz push de tus cambios a GitHub y Render desplegará automáticamente la interfaz de **Mozilla Firefox Web**.
Al entrar a `https://tu-app.onrender.com`, tendrás el navegador Firefox listo para usar en tu pantalla.
