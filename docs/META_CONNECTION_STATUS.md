# Estado de conexión Meta

`GET /api/instagram/conexion/estado` usa `withLeaderRead`, la sesión real y los
guards existentes de perfiles de Líder. No admite parámetros ni credenciales
enviadas desde React. La respuesta tiene `Cache-Control: no-store`.

## Uso

1. El usuario configura el token privadamente en Hostinger, mediante la variable
   existente `META_SYSTEM_USER_TOKEN`. No pegarlo en el chat, repositorio o navegador.
2. Ingresar como Líder y abrir **Reportes → Estado de conexión Meta**.
3. Revisar validez, vencimiento, scopes esperados y faltantes, páginas y tareas,
   y las cuentas publicitarias accesibles. Verde/rojo también tiene etiquetas
   textuales: Presente/Falta. «No informado» no confirma que el permiso exista.
4. Si Meta rechaza una sección o no se pudo validar el token, aparece como no
   disponible/sin comprobar; no se presenta una lista parcial como completa.

La consulta es bajo demanda. No activa publicaciones, anuncios, mensajes,
comentarios ni sincronización. Los permisos de cuentas publicitarias no equivalen
a las tareas asignadas en cada página.

El backend reutiliza el transporte Graph (HTTPS, host fijo, sin redirecciones,
paginación limitada y errores saneados). `debug_token` requiere enviar el token
como `input_token` exclusivamente a Graph, además de Authorization. No se registra
esa URL, los headers o el cuerpo, ni se devuelve información cruda de depuración.
Los inventarios usan `/me/accounts`, con fallback a ambos edges del Business
configurado, y `/me/adaccounts`. Si el edge no admite `tasks`, se conservan las
páginas y se indica que sus tareas no fueron informadas.

## Pruebas sin token real

```sh
cd backend
node --test test/instagram-connection.test.js test/instagram-graph.test.js
RENDER2_RUN_LOCAL_INTEGRATION=true node --test test/instagram-team-access.integration.test.js
cd ../frontend
node --test src/components/MetaConnectionStatus.test.js
npm run build
```

La integración usa PostgreSQL temporal y credenciales ficticias. No hay migraciones
nuevas, cambios en métricas, cron, tareas o datos operativos.
