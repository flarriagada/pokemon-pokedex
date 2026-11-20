# Mi Pokédex — verificación de identidad con Google

Aplicación de cartas Pokémon TCG para TICS316: React + Vite en el frontend, Deno + SQLite en el backend y catálogo de TCGdex.

Este incremento obtiene un ID token auténtico de Google y lo verifica en Deno. **Todavía no crea una sesión en Mi Pokédex**. El inventario conserva `test-user` y sigue disponible únicamente en desarrollo.

## Ejecutar

Desde la raíz del repositorio, abre una terminal para el backend:

```powershell
cd backend
deno task dev
```

El archivo privado `backend/.env` debe contener el `GOOGLE_CLIENT_ID` existente. Este flujo no utiliza el Client Secret. No copies valores reales a archivos versionados ni a variables `VITE_*`.

En otra terminal, también desde la raíz:

```powershell
cd frontend/client
npm install
npm run dev -- --port 5174 --strictPort
```

Abre **http://localhost:5174**. El puerto 5173 estaba ocupado por otra aplicación durante las comprobaciones. Si eliges otro puerto, autoriza ese origen en Google. Vite redirige `/api` a Deno en `127.0.0.1:8000`; esta prueba usa el servidor de desarrollo, no `npm run preview`.

## Preparar Google y probar una cuenta real

1. Abre Google Cloud Console → Google Auth Platform → Clients. Selecciona el cliente OAuth de tipo **aplicación web** correspondiente al Client ID del backend.
2. En **Orígenes autorizados de JavaScript**, comprueba `http://localhost` y `http://localhost:5174`. Guarda si necesitas añadirlos. El esquema, host y puerto deben coincidir con el navegador. Este flujo de ventana emergente y callback no requiere una nueva URI de redirección.
3. Si tu proyecto restringe el acceso a usuarios de prueba, habilita tu cuenta en Audience. Una cuenta universitaria también puede tener restricciones del administrador.
4. Con ambos servidores ejecutándose, abre http://localhost:5174. Pulsa **Iniciar sesión con Google**, elige tu cuenta y completa el consentimiento.
5. React envía temporalmente el ID token a `POST /api/auth/google/verify`. Solo si Deno confirma `valid: true` con un perfil verificado, aparecerá **«Identidad verificada correctamente con Google.»**.
6. En herramientas de desarrollo → Red, puedes comprobar HTTP 200 y los campos `valid` y `profile` de la respuesta. No copies ni compartas el token de la petición.
7. Recarga: desaparece el mensaje de verificación. La aplicación no conserva tokens, cookies de sesión propias ni un usuario autenticado. Google puede conservar su propia sesión y ofrecer tu cuenta otra vez.

Consulta la [configuración oficial de Google Identity Services](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid).

## Errores y cancelación

- **Configuración ausente (HTTP 503):** mensaje en español y botón Reintentar. Corrige el backend y reintenta.
- **Client ID inválido:** se comprueba su formato. Si tiene formato válido pero el cliente o el origen no están autorizados, Google puede mostrar su propio error; revisa la configuración anterior.
- **Credencial inválida o vencida (HTTP 400/401):** sin mensaje de éxito; pulsa de nuevo el botón para obtener otra credencial.
- **Fallo de conexión:** mensaje en español y límite de espera de 15 segundos. Reintenta la configuración o pulsa el botón, según el estado mostrado.
- **Script de Google bloqueado:** error con reintento; revisa conexión y bloqueadores del navegador.
- **Cancelación o cierre de la ventana:** no se envía nada al backend y puedes volver a pulsar el botón. Google no siempre informa el cierre mediante un callback; por eso solo mostramos «Verificando…» después de recibir la credencial. El mensaje de ayuda explica cómo reintentar.

Comprueba la cabecera a 320 px y en escritorio, la navegación, el catálogo y las operaciones habituales del inventario. La revisión visual y el consentimiento de una cuenta real requieren tu navegador.

## Comprobaciones

En `frontend/client`:

```powershell
npm run lint
npm run build
node --test --test-isolation=none src/services/authService.test.js
```

En `backend`:

```powershell
deno task check
deno task lint
deno test --allow-env=GOOGLE_CLIENT_ID routes/authRoutes_test.ts
```

Las pruebas usan datos ficticios aislados, sin cargar `.env` ni autenticar una cuenta. Comprueban configuración pública, errores, cancelación de peticiones y rechazo HTTP 401 de tokens falsos y sin firma. Las respuestas HTTP simuladas del frontend solo prueban el servicio de comunicación.

Para repetir el rechazo en el servidor real, desde PowerShell:

```powershell
$body = @{ credential = 'token-falso-de-prueba' } | ConvertTo-Json
try {
  Invoke-WebRequest -Uri 'http://localhost:5174/api/auth/google/verify' -Method POST -ContentType 'application/json' -Body $body
} catch {
  [int]$_.Exception.Response.StatusCode
}
```

Debe mostrar `401`.

## Flujo y archivos principales

- `GoogleLoginButton.jsx`: carga configuración, monta el proveedor de Google para el botón y muestra estados. Su estado de React representa mensajes de esta prueba, sin establecer una sesión.
- `GoogleLoginButton.css`: estilos aislados para la cabecera y mensajes.
- `Header.jsx`: integra el botón y conserva el menú.
- `authService.js`: GET de configuración y POST de verificación con errores y tiempos de espera. No decodifica, imprime ni guarda JWT.
- `backend/routes/authRoutes.ts`: añade `GET /api/auth/google/config`, que devuelve exclusivamente `{ clientId }`. La verificación existente usa `jose` para comprobar firma, emisor, audiencia y vencimiento.

