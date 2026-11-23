# Mi Pokédex — Gestor de cartas Pokémon TCG

Proyecto académico individual de Diseño de Software (TICS316). Mi Pokédex es una aplicación web para consultar cartas Pokémon TCG y administrar una colección personal, con autenticación de Google, mazos, seguimiento de expansiones, historial de compras y ventas y reconocimiento de cartas mediante fotografías.

Repositorio: <https://github.com/flarriagada/pokemon-pokedex>

La interfaz está disponible en español e inglés (español por defecto). En desarrollo local, el frontend se ejecuta en `http://localhost:5173` y la API en `http://127.0.0.1:8000`.

## Funcionalidades

- **Catálogo:** búsqueda por nombre, número de colección, HP, tipo, rareza y expansión; ordenamiento, paginación numérica, imágenes, detalles y precios de mercado referenciales de TCGplayer cuando están disponibles.
- **Autenticación con Google:** verificación de identidad en el backend, sesiones persistentes en SQLite y cierre de sesión. Las operaciones privadas se asocian al usuario autenticado.
- **Mi colección:** agregar cartas, consultar y modificar cantidades, eliminar registros y marcar cartas disponibles para intercambio.
- **Etiquetas personalizadas:** crear y eliminar etiquetas, asignarlas a cartas y filtrarlas en la colección. Las etiquetas se muestran como badges sobre cada tarjeta, sin cubrir su imagen.
- **Cartas faltantes por expansión:** seleccionar una expansión, comparar su lista oficial con el inventario y consultar cartas obtenidas, faltantes y porcentaje de completitud.
- **Mazos:** crear, editar y eliminar mazos. Cada mazo permite **Ver cartas** en una galería o **Gestionar cartas** en un borrador local; los cambios se aplican mediante **Actualizar mazo** o se descartan con **Cancelar**.
- **Historial:** registrar compras y ventas con carta, cantidad, fecha y precio, y consultar los movimientos con filtros y paginación. El historial es independiente de las cantidades actuales del inventario.
- **Identificación por fotografía:** cargar una imagen, procesarla con Tesseract.js en español e inglés, extraer nombre/número/expansión, buscar candidatos reales en TCGdex, corregir los datos manualmente y confirmar antes de agregar la carta.
- **Imágenes alternativas:** intentar las imágenes de TCGdex en ambos idiomas y, cuando corresponde, CardCorpus. Las respuestas se validan y se reutilizan mediante cachés; si no hay una imagen válida se muestra un marcador de posición.
- **Multilenguaje:** traducciones propias ES/EN para la interfaz. Al cambiar de idioma se actualizan los datos visibles sin modificar el inventario.
- **Diseño responsive:** adaptación a escritorio, tablet y celular, incluido el fondo visual de la pantalla de Inicio.

La aplicación administra digitalmente una colección de cartas físicas. No procesa pagos reales ni ejecuta compraventas o intercambios con otros usuarios. Los precios son referenciales y pueden no estar disponibles.

## Tecnologías

| Área | Tecnología | Uso |
| --- | --- | --- |
| Interfaz | React + JavaScript (JSX) | Componentes, estado, formularios y renderizado |
| Entorno frontend | Vite | Servidor de desarrollo y compilación |
| Navegación | React Router | Inicio, catálogo, colección, mazos e historial |
| Estilos | CSS | Diseño adaptable y presentación |
| API | Deno + TypeScript | Endpoints, validaciones y lógica de negocio |
| Persistencia | SQLite mediante `node:sqlite` | Usuarios, sesiones, inventario, etiquetas, mazos y transacciones |
| Identidad | Google Identity Services / OpenID Connect | Inicio y cierre de sesión |
| Catálogo externo | TCGdex | Cartas, expansiones, datos e imágenes |
| Respaldo de imágenes | CardCorpus y TCGdex alternativo | Complemento de imágenes válidas |
| OCR | Tesseract.js | Extracción de texto de fotografías |
| Calidad | Deno check/lint, Oxlint y Vite build | Comprobaciones estáticas y compilación |

## Arquitectura

```text
Navegador (React/Vite)
  ├─ Componentes y páginas
  ├─ OCR con Tesseract.js
  └─ Solicitudes relativas a /api/*
          │
          ▼
Proxy de desarrollo de Vite
          │
          ▼
Backend Deno (127.0.0.1:8000)
  ├─ Autenticación y sesiones de Google
  ├─ Colección, etiquetas y transacciones
  ├─ Mazos
  ├─ Catálogo y expansiones (TCGdex)
  └─ SQLite, cachés e índices
```

El proxy de Vite envía `/api` al backend Deno. El backend valida idioma, filtros, identificadores y autenticación antes de consultar SQLite o servicios externos.

### Organización principal

```text
pokemon-pokedex/
├─ backend/
│  ├─ db/                  # SQLite, sesiones y mantenimiento
│  ├─ routes/              # Autenticación, colección y mazos
│  ├─ services/            # Google y TCGdex/CardCorpus
│  ├─ server.ts            # Entrada de la API
│  └─ deno.json            # Tareas y permisos de Deno
├─ frontend/client/
│  ├─ src/components/      # Catálogo, tarjetas, cabecera y login
│  ├─ src/pages/           # Inicio, colección y mazos
│  ├─ src/services/        # Comunicación con la API
│  ├─ src/translations.js  # Fuente de traducciones ES/EN
│  ├─ src/App.jsx          # Rutas principales
│  ├─ package.json
│  └─ vite.config.js
├─ fondo.png              # Fondo usado exclusivamente en Inicio
└─ README.md
```

## Instalación y ejecución local

### Requisitos

- Git.
- Node.js y npm compatibles con `frontend/client/package.json` (se recomienda Node.js 22 reciente).
- Deno 2.x con soporte para `node:sqlite`.
- Conexión a Internet para Google, TCGdex y los proveedores de imágenes.
- Un Client ID OAuth 2.0 de Google para una aplicación web.

### Descargar

```powershell
git clone https://github.com/flarriagada/pokemon-pokedex.git
cd pokemon-pokedex
```

### Configurar Google

Crea el archivo privado `backend/.env`:

```env
GOOGLE_CLIENT_ID=TU_CLIENT_ID_DE_GOOGLE.apps.googleusercontent.com
```

En Google Cloud Console agrega `http://localhost:5173` como origen JavaScript autorizado. Si la aplicación OAuth está restringida a usuarios de prueba, registra también la cuenta que utilizarás.

No publiques `.env`, tokens, cookies ni credenciales. El Client ID no reemplaza las verificaciones que realiza el backend.

### Iniciar backend

En una terminal, desde la raíz:

```powershell
cd backend
deno task dev
```

La API queda disponible en `http://127.0.0.1:8000`. Puedes comprobarla en `http://127.0.0.1:8000/api/health`. La base de datos de desarrollo se crea en `backend/data/pokedex.db`, fuera del repositorio.

### Iniciar frontend

En otra terminal:

```powershell
cd frontend/client
npm install
npm run dev -- --port 5173 --strictPort
```

Abre <http://localhost:5173>. Ambas terminales deben permanecer ejecutándose. El origen documentado es el puerto 5173; cambiarlo requiere actualizar la configuración OAuth y puede provocar respuestas 403.

### Comprobaciones disponibles

Desde `backend/`:

```powershell
deno task check
deno task lint
```

Desde `frontend/client/`:

```powershell
npm run lint
npm run build
```

Desde la raíz:

```powershell
git diff --check
```

Estas órdenes comprueban tipos, lint y compilación; no sustituyen una revisión funcional en el navegador.

## Rendimiento y límites considerados

- La colección se consulta por páginas desde SQLite. La página visible se muestra sin esperar todos los detalles externos y los metadatos de TCGdex se cargan progresivamente con concurrencia limitada.
- SQLite utiliza una caché reconstruible `card_metadata`, índices para inventario, etiquetas, transacciones y filtros, `WAL` y `busy_timeout`.
- Las solicitudes de detalles y respaldos de imágenes reutilizan promesas/cachés en memoria para evitar duplicados, incluidos los renders de React StrictMode. Los errores temporales no se guardan como fallos permanentes.
- La última página del catálogo se calcula bajo demanda mediante búsqueda exponencial y binaria, con caché temporal por idioma, búsqueda y filtros.
- El historial y las búsquedas de cartas para mazos usan paginación para no cargar colecciones grandes completas en una sola respuesta.
- El respaldo de imágenes solo se consulta cuando es necesario; nunca se ejecuta una auditoría completa durante el uso normal.

## Uso básico

1. Abre <http://localhost:5173> e inicia sesión con Google.
2. En **Catálogo**, busca una carta y revisa sus detalles, imagen y precio referencial.
3. En **Mi colección**, agrega cartas, ajusta cantidades, administra etiquetas y marca cartas intercambiables.
4. En **Faltantes**, selecciona una expansión para revisar el progreso.
5. En **Mis mazos**, crea un mazo. Usa **Ver cartas** para la galería o **Gestionar cartas** para editar un borrador y luego **Actualizar mazo** o **Cancelar**.
6. En **Historial**, registra y consulta compras y ventas.
7. Usa **Identificar por foto** para obtener candidatos a partir de una fotografía; la incorporación al inventario siempre requiere confirmación.
8. Cambia entre español e inglés con el selector del encabezado.

## Historial Git

La tabla muestra el historial cronológico de los commits en `master`. 

| Fecha y hora | Título del commit | Qué se hizo |
| --- | --- | --- |
| 2026-10-18 22:34:51 | Estructura, Home, Header, App | Se creó la estructura inicial de React/Vite, la pantalla de Inicio, la cabecera y el punto de entrada. |
| 2026-10-18 22:52:23 | PokemonCard | Se incorporó el componente visual de cartas Pokémon. |
| 2026-10-25 23:59:15 | Detalles ortografía | Se ajustaron textos, idioma base y detalles iniciales de presentación. |
| 2026-10-26 00:00:06 | Conexión con API | Se conectó el frontend con el catálogo externo TCGdex. |
| 2026-10-26 01:14:09 | Estructura y navegación en la página | Se organizó la navegación entre las pantallas principales. |
| 2026-10-26 01:31:38 | Arreglo | Se realizó un ajuste de mantenimiento en la aplicación. |
| 2026-11-03 13:12:06 | Buscar cartas y ordenar | Se añadió búsqueda y ordenamiento de cartas. |
| 2026-11-03 13:19:06 | Conectar catálogo con API TCGdex | Se integraron las solicitudes del catálogo en la interfaz. |
| 2026-11-03 14:09:21 | Paginación, catálogo y búsqueda de cartas | Se construyó el catálogo visual con carga, errores y paginación. |
| 2026-11-08 14:15:29 | Crear servidor backend con Deno | Se creó el servidor Deno y el endpoint de salud. |
| 2026-11-08 15:19:14 | BD de cartas directamente en el backend | Se incorporó el servicio TCGdex al backend y sus tareas de ejecución. |
| 2026-11-08 15:58:45 | Integrar React y Deno con API | Se configuró el proxy de Vite y las rutas `/api`. |
| 2026-11-15 14:32:39 | Implementación base de usuarios, agregar y mostrar cartas | Se creó SQLite para usuarios e inventario y las rutas iniciales de cartas. |
| 2026-11-15 16:13:14 | Operaciones CRUD | Se ampliaron las operaciones para modificar y eliminar registros. |
| 2026-11-15 17:57:06 | Inventario de cartas | Se incorporó la pantalla de colección y sus acciones principales. |
| 2026-11-15 18:57:10 | CRUD completo en React | Se conectaron las operaciones de inventario con React y los detalles de cartas. |
| 2026-11-15 20:26:14 | Integrar inicio de sesión con Google y verificar tokens JWT | Se incorporó el login de Google y la verificación JWT en Deno. |
| 2026-11-18 21:28:37 | Tabla de sesiones a SQL | Se añadió el modelo de sesiones persistentes en SQLite. |
| 2026-11-18 22:29:12 | Implementar sesiones con Google y SQLite | Se asociaron cuentas Google con usuarios locales y sesiones almacenadas. |
| 2026-11-19 00:38:16 | Gestionar persistencia y duración de sesiones | Se implementó recuperación, expiración y limpieza de sesiones. |
| 2026-11-19 01:09:07 | Logout en backend | Se revocaron sesiones y se eliminó la cookie al cerrar sesión. |
| 2026-11-19 17:49:38 | Logout en React | Se integró el cierre de sesión en la interfaz. |
| 2026-11-19 21:16:42 | Proteger el inventario de cada usuario | Se aislaron las operaciones del inventario por usuario autenticado. |
| 2026-11-19 21:26:55 | Aviso de autenticación y redirección al cerrar sesión | Se añadieron mensajes de autenticación y redirección después del logout. |
| 2026-11-19 22:25:27 | Mostrar tipo, rareza y expansión | Se mostraron atributos oficiales de las cartas. |
| 2026-11-20 12:27:58 | Mazo en backend, crear, ver, editar y eliminar mazos | Se crearon tablas, rutas y operaciones para mazos y sus cartas. |
| 2026-11-20 14:59:22 | Multilenguaje | Se incorporaron traducciones ES/EN y solicitudes de catálogo por idioma. |
| 2026-11-20 16:32:16 | Intercambio de cartas | Se añadió el estado de disponibilidad para intercambio y sus filtros. |
| 2026-11-21 17:42:13 | Identificar cartas faltantes | Se incorporó la comparación de expansiones con el inventario. |
| 2026-11-21 19:15:04 | Historial de compra y venta | Se añadieron transacciones de compras/ventas y su visualización. |
| 2026-11-22 11:35:46 | Mejorar tarjetas, precios y respaldo de imágenes TCGdex | Se mejoraron las tarjetas, precios referenciales y respaldos de imágenes. |
| 2026-11-22 15:33:24 | Integrar búsqueda por fotos con OCR y mejorar diseño | Se incorporó el flujo de identificación por fotografía y ajustes visuales. |
| 2026-11-22 16:52:11 | Mejorar búsqueda por foto | Se reforzó el preprocesamiento OCR, la extracción de nombres y la selección de coincidencias. |
| 2026-11-22 17:24:36 | Filtros y etiquetas para colección e historial | Se agregaron filtros, etiquetas personalizadas, paginación del historial y el fondo visual. |
| 2026-11-22 19:12:05 | Optimizar colección, mazos e identificación de cartas | Se optimizaron consultas de colecciones grandes, SQLite, cachés, carga progresiva, mazos e identificación. |

Los cambios que todavía no tienen commit, como el ajuste del fondo para limitarlo a Inicio, no aparecen en este historial hasta que se confirmen en Git.

## Decisiones y consideraciones

- Las rutas privadas comprueban la sesión del usuario en el backend; no se confía en un identificador enviado libremente por el cliente.
- React administra la interfaz y Deno aplica validaciones y reglas de persistencia; SQLite conserva los datos.
- TCGdex es la fuente principal del catálogo. Las imágenes alternativas solo complementan campos faltantes y se validan por identificador, nombre, número y expansión.
- Los precios son estimaciones externas y no garantizan el valor de una carta.
- El OCR depende de la calidad, orientación y legibilidad de la fotografía. Por eso se muestran candidatos y se permite corregir antes de agregar.
- Registrar una compra o venta no modifica automáticamente el inventario actual.
- La configuración incluida está orientada al desarrollo local. Un despliegue público requiere revisar HTTPS, cookies, orígenes OAuth y permisos del servidor.

## Créditos y atribuciones

- [TCGdex](https://tcgdex.dev/) — catálogo, expansiones, datos e imágenes compatibles con su servicio.
- CardCorpus — fuente alternativa de datos e imágenes, utilizada solo cuando la coincidencia es verificable.
- [Tesseract.js](https://github.com/naptha/tesseract.js) — reconocimiento óptico de caracteres en el navegador.
- [Google Identity Services](https://developers.google.com/identity/gsi/web) — autenticación con Google.
- TCGplayer — fuente de referencia de precios cuando TCGdex entrega esa información.

