# Perfiles de dueños dentro de Inicio — implementación local

Una cuenta Render autenticada puede seleccionar Franco o Agustín dentro de Inicio sin volver a ingresar. La selección cambia el usuario operativo por un ID explícitamente autorizado por el servidor. No es una autenticación independiente de la persona física.

## Contrato

- `POST /api/sesion/perfil-dueno`, cuerpo cerrado `{ profile: 'franco' | 'agustin' }`.
- Solo sesión de navegador, con cookie, contexto vigente y protección CSRF. Se rotan cookie, contexto y CSRF al cambiar.
- `owner_profiles` en la sesión informa cuenta principal, perfil activo e IDs autorizados. Sin esta capacidad no aparece el selector.
- El vencimiento original de la cuenta principal limita todas las sesiones delegadas. Desactivar o revocar la cuenta principal invalida la delegación.
- Inicio consulta por el ID operativo. Cambiar perfil no mueve tareas, no edita asignaciones y no reparte las de Líder.
- El frontend invalida solicitudes y datos del perfil anterior; no guarda la identidad operativa en LocalStorage.

## Alcance y límites

Activación únicamente en desarrollo/pruebas con PostgreSQL local y configuración explícita `RENDER_OWNER_PROFILES`. Se rechaza su activación en producción. No se crean usuarios ni se promueven cuentas por nombre. Franco Romero (Desarrollo) no se utiliza como director.

Antes de habilitar este modo en producción falta integrar la comprobación transaccional de la cuenta principal en todos los circuitos de escritura. La comprobación en middleware no elimina por sí sola la carrera entre revocación y escritura. Este trabajo local no autoriza publicación ni modifica la base vigente.

## Responsabilidades de archivos

- `backend/src/owner-profile-authority.js`: configuración, autorización y delegación por ID.
- `backend/src/auth.js` y `browser-session-transport.js`: validación y emisión de sesiones.
- `backend/src/server.js`: endpoints de sesión y cambio de perfil.
- `frontend/src/shared/session/owner-profiles.js` y `owner-profile-actions.js`: capacidad y acción de cambio.
- `frontend/src/shared/session/browser-session-controller.js`: coordinación y aislamiento entre sesiones.
- `frontend/src/pages/QuickHome.jsx`: selector dentro de Inicio; no en Login.
- `backend/test/render2-owner-profiles.integration.test.js`: recorrido HTTP con base nueva, tareas sintéticas y verificación de asignaciones intactas.

El paquete de publicación preparado antes de este cambio no incluye esta implementación y no debe reutilizarse como evidencia de validación.
