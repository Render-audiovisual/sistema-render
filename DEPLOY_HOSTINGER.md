# Deploy a Hostinger

Contrato local, no autorización ni afirmación de despliegue. Antes de preparar
un servicio consultar [arranque seguro](docs/DEPLOY.md) y
[contrato](docs/render-2/STARTUP_SAFETY_CONTRACT.md).
Build, migración aprobada y arranque son fases separadas. Ni `npm start` ni
`npm run start:hostinger` instalan dependencias, migran o siembran datos.
La base debe declararse y tener ledger/esquema completos: si falta algo,
el servidor debe abortar, no repararlo. `setup` está deshabilitado.
No ejecutar seeds históricos ni bootstrap de cuentas compartidas.

## Opción 1: Frontend solo (SPA estática) 

Si alojas solo el frontend en Hostinger:

### Pasos:

1. **Compilar el frontend:**
```bash
cd frontend
npm run build
```

2. **Subir contenido de `frontend/dist/` a Hostinger:**
   - Abre cPanel → File Manager
   - Entra en la carpeta `public_html` (o tu dominio)
   - Sube TODO el contenido de `frontend/dist/` incluyendo el `.htaccess`

3. **Verificar:**
   - El archivo `.htaccess` **debe estar en la raíz** (junto a index.html)
   - Permisos: `.htaccess` debe tener permisos 644

### Qué hace el `.htaccess`:
- Redirige todas las rutas a `index.html` (necesario para SPA React)
- Cachea archivos `/assets/*` por 1 año (tienen hash)
- No cachea `index.html` para que siempre sea fresco

---

## Opción 2: Full stack

Si tienes Node.js disponible en Hostinger:

1. Compilar frontend: `cd frontend && npm run build`
2. Subir TODO (backend + frontend compilado)
3. El `server.js` ya maneja los redirects automáticamente
4. Configurar DATABASE_URL y RENDER_DB_ENVIRONMENT explícitos, sin imprimir
   secretos. Mantener SETUP_DEMO_DATA=false, RENDER_BACKGROUND_JOBS vacío y
   RENDER_ALLOW_BACKGROUND_WRITES=false. No usar el arranque para aplicar SQL.
5. La CLI de migración permite ayuda/status/apply separados; apply solo para
   un destino local no productivo autorizado y con plan/identidad confirmados.
   No hay override de producción en este bloque. Ver docs/DEPLOY.md.

---

## Troubleshooting

**"404 no encontrado" en rutas como `/historias`**
- ✅ `.htaccess` está en la raíz
- ✅ `mod_rewrite` habilitado en Apache (casi siempre lo está)
- ✅ Limpia caché del navegador (Ctrl+Shift+Del)

**Los archivos CSS/JS no cargan**
- Verifica que `frontend/dist/` tiene una carpeta `assets/` con los archivos compilados
- Confirma que subiste TODO el contenido de `dist/`

---

## URLs útiles
- Documentación Hostinger: https://support.hostinger.es/es/articles/4960217-como-subir-archivos-mediante-administrador-de-archivos
