# Deploy a Hostinger

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

## Opción 2: Full stack (Recomendado)

Si tienes Node.js disponible en Hostinger:

1. Compilar frontend: `cd frontend && npm run build`
2. Subir TODO (backend + frontend compilado)
3. El `server.js` ya maneja los redirects automáticamente

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
