# Google Drive en Render OS

Render OS no guarda copias de los archivos: usa Google Drive como fuente de verdad.

## Activación

1. En Google Cloud, habilitar **Google Drive API** para el proyecto usado por RENDER.
2. En el cliente OAuth web agregar como URI de redirección autorizada:
   `https://sistema.rendercorrientes.com/api/drive/oauth/callback`
3. En Hostinger configurar, sin publicar sus valores:
   - `GOOGLE_DRIVE_CLIENT_ID`
   - `GOOGLE_DRIVE_CLIENT_SECRET`
   - `GOOGLE_DRIVE_REDIRECT_URI`
4. Desplegar y aplicar las migraciones.
5. Entrar como Líder a `/drive` y pulsar **Conectar Google Drive**.
6. Autorizar la cuenta de Google de RENDER que posee las carpetas compartidas.

## Reglas operativas

- Todo usuario autenticado puede ver y subir archivos.
- Solo un Líder puede conectar la cuenta, reemplazar archivos o enviarlos a la papelera.
- Una carga desde Tareas conserva el estado de la tarea y guarda el enlace del archivo.
- Diseños de Augusto y Mariano se resuelven dentro de sus respectivos directorios.
- Producción y destinos no inequívocos usan `RENDER_UPLOADS`.
- Si la carpeta del cliente no coincide claramente, el sistema exige elegirla manualmente.
