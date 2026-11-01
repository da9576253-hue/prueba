# Portal Buscador — Experiencia Google con VPN Web y DNS Cifrado (DoH)

Portal de búsqueda de alta privacidad y seguridad:
1. **Interfaz Google Idéntica**: Diseño limpio y oficial de Google (logo, barra de búsqueda, autocompletado en vivo, pestaña de resultados y temas Claro/Oscuro).
2. **Modo VPN Web Integrado (`/proxy`)**: Navegación cifrada donde el servidor actúa como escudo intermedio. Tu IP real no llega a los sitios visitados y tu proveedor de internet (ISP) no puede registrar qué páginas visitas ni qué buscas.
3. **Servidor DNS Seguro de Red (DoH - RFC 8484)**: Resuelve consultas DNS de forma cifrada en `/api/dns-query`. Puedes configurar Chrome, Firefox, Edge o tu teléfono Android para usar este portal como tu servidor DNS privado personal.
4. **Modo Camuflaje**: Botón de escudo para disimular la pestaña y el historial del navegador como *"Ciberseguridad | Centro de Seguridad de Red"* cuando lo necesites.
5. **Cero Dependencias Externas**: Funciona con Node.js puro (`http`, `https`, `crypto`, `zlib`, `stream`), haciéndolo ultraligero y seguro frente a vulnerabilidades de dependencias.

---

## 🚀 Inicio Rápido

### Local
```bash
node server.js        # Accede a http://localhost:8080
npm test              # Ejecuta la suite de pruebas unitarias
```

### Despliegue en Render
1. Sube este repositorio a tu cuenta de GitHub.
2. En Render, crea un **New Web Service** y selecciona tu repositorio.
3. Render detectará automáticamente `render.yaml` y la configuración de Node.
4. (Opcional) Si cuentas con una API Key de [serper.dev](https://serper.dev), configúrala como variable de entorno `SERPER_API_KEY` para obtener resultados nativos de Google con mayor velocidad. Si no se configura, el servidor utiliza automáticamente un motor multirrespaldo con DuckDuckGo.

---

## 🛡️ Características de Seguridad y VPN

### 1. Túnel VPN Web Cifrado (`/proxy?url=...`)
- **Anonimización total de IP**: El sitio web de destino únicamente registra la dirección IP de tu servidor (por ejemplo, los servidores de Render en EE. UU./Europa), nunca tu dirección IP doméstica ni tu ubicación real.
- **Cifrado de Extremo a Extremo**: La comunicación entre tu navegador y el portal viaja cifrada con TLS 1.3 / AES-256.
- **Protección contra Fugas de Historial e ISP**: Tu operador de telefonía o internet únicamente ve tráfico hacia tu propio dominio del portal.
- **Reescritura Dinámica de Enlaces**: Los enlaces dentro de las páginas visitadas se reescriben para que puedas continuar navegando dentro del túnel protegido.
- **Protección SSRF**: Bloqueo automático de direcciones IP locales y de infraestructura interna (`127.0.0.1`, `10.x.x.x`, `192.168.x.x`, metadatos en la nube `169.254.x.x`).

### 2. Servidor DNS Seguro del Sitio (`/api/dns-query`)
Este portal incluye un resolver **DNS-over-HTTPS (DoH)** conforme a la norma **RFC 8484**:
- Soporta consultas binarias `application/dns-message` y consultas JSON `?name=ejemplo.com&type=A`.
- Resuelve a través de proveedores upstream cifrados con bloqueo de malware y privacidad (Cloudflare 1.1.1.1, Quad9 9.9.9.9).
- **Cómo configurarlo en tu dispositivo**:
  - **Google Chrome / Brave / Edge**: Ajustes &rarr; Privacidad y seguridad &rarr; Usar DNS seguro &rarr; Elegir proveedor: *Personalizado* &rarr; Pega la URL: `https://TU-DOMINIO/api/dns-query`.
  - **Mozilla Firefox**: Ajustes &rarr; Privacidad y seguridad &rarr; DNS sobre HTTPS &rarr; *Protección Máxima* &rarr; *Personalizado*.
  - **Android**: Ajustes de red e internet &rarr; *DNS privado*.

---

## 🎨 Experiencia Google Completa
- **Logo oficial de Google**: Diseño vectorial SVG con la paleta de colores oficial.
- **Barra interactiva de búsqueda**:
  - Sugerencias y autocompletado en tiempo real con navegación por teclado (flechas Arriba/Abajo/Enter/Esc).
  - Botón de limpieza rápida (`X`).
  - Botones de reconocimiento de voz (micrófono) y Google Lens.
- **Pestañas de categorías**: Todo, Noticias, Imágenes y Acceso Directo al Túnel VPN.
- **Tarjeta de resultados enriquecida**: Con favicon del sitio web, ruta de navegación legible (breadcrumbs), título en azul Google y botón directo **"🛡️ Navegar Seguro (VPN Web)"**.
- **Temas Claro y Oscuro**: Alterna al instante con el botón de la barra superior.

---

## 🧪 Pruebas Automatizadas
Para verificar el funcionamiento de los parsers, el proxy, la protección SSRF y el servidor DNS DoH:
```bash
npm test
```
Resultados esperados: 8 pruebas pasando al 100%.
