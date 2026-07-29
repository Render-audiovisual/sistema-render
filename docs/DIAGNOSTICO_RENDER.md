# DIAGNÓSTICO SISTEMA RENDER
**Fecha:** 2026-07-18  
**Estado:** Prototipo funcional con riesgos críticos

---

## 📊 ESTADO GENERAL

**Veredicto:** Sistema en fase MVP temprana. Funciona básicamente pero tiene vulnerabilidades críticas de seguridad y falta estructura general. Necesita reorganización antes de cualquier expansión de features.

---

## 🏗️ ESTRUCTURA DEL PROYECTO

### Frontend
- **Tech Stack:** React 19 + Vite + TypeScript
- **Entrada:** `frontend/src/main.jsx` (~2,000 LOC en un único archivo)
- **Styles:** `frontend/src/styles.css` (~8KB)
- **Deployment:** Vite dev server en `http://0.0.0.0:5173`
- **Estado:** Monolítico, sin componentes reutilizables

### Backend
- **Tech Stack:** Express.js 5 + Node.js + PostgreSQL + JWT + bcryptjs
- **Archivos:**
  - `server.js` (333 LOC) - rutas principales
  - `db.js` (12 LOC) - conexión a BD
  - `db-check.js` (10 LOC) - verificación de BD
  - `setup-demo-data.js` (35 LOC) - seed inicial
- **Deployment:** Node en `http://0.0.0.0:3001`
- **Puerto:** 3001 (sin proxy reverso directo)

### Base de Datos
- **Engine:** PostgreSQL 16 en localhost:5432
- **Base:** `render_platform`
- **Tablas:** 5 (usuarios, clientes, tareas, historias, publicaciones)
- **Datos:** 6 usuarios, 13 clientes, 12 tareas, 31 historias, 8 publicaciones
- **Estado:** Funcionando, sin migrations ni schema.sql

### Deployment
- **Proxy Reverso:** Caddy en :80 y :443 (configurado para otro proyecto: lavalle-market)
- **URL de acceso:** http://66.94.104.21:5173 (acceso directo a Vite)
- **Procesos:** ✅ PostgreSQL, ✅ Vite, ✅ Express funcionando

---

## ⚠️ RIESGOS CRÍTICOS (Seguridad)

### ✅ RESUELTO: autenticación en rutas
**Estado actualizado:** resuelto. El backend valida JWT en todas las rutas
protegidas y aplica rol administrador en operaciones sensibles. Ver
`backend/src/auth.js` y `docs/DEPLOY.md`.

Sin token válido, esas rutas devuelven `401`. Las acciones administrativas
sensibles devuelven `403` a roles no administradores.

---

### 🔴 CRÍTICO: Token en localStorage
**Problema:** Token JWT almacenado en `localStorage` (vulnerable a XSS):
```javascript
localStorage.setItem("render_sesion", JSON.stringify({ token, usuario }))
```

**Impacto:** Si hay una vulnerabilidad XSS, cualquier script puede acceder al token y abusar de la cuenta.

**Solución:** Usar httpOnly cookies en su lugar.

---

### 🟡 ALTO: RBAC parcial
**Estado:** ya se distingue `admin` en gestión de usuarios, clientes,
configuración global y eliminaciones. Falta granular permisos por responsable
en algunas actualizaciones operativas.

**Impacto:** Imposible delegar responsabilidades. Todos tienen acceso igual.

---

### 🟡 ALTO: Sin validación robusta de entrada
**Problema:** Solo se validan algunos estados. Falta validación de:
- Rangos de IDs
- Tipos de datos
- Longitud de strings
- SQL injection prevention (aunque uses parameterized queries)

**Impacto:** Posibles errores inesperados o exploits.

---

### 🟡 MEDIO: Sin schema.sql / migrations
**Problema:** No hay archivo SQL que defina la estructura de la BD. Las tablas fueron creadas manualmente.

**Setup-demo-data.js solo crea tabla `clientes`. Las otras 4 tablas no se crean desde código.**

**Impacto:**
- Imposible reproducir schema en nuevo servidor
- Imposible versionar cambios de BD
- Riesgo de pérdida de datos sin backup estructurado

---

### ✅ RESUELTO: CORS para frontend separado
La API responde preflight y permite `Content-Type` y `Authorization`.

---

## 📋 QUÉ FALTA POR ORDENAR

| Categoría | Qué falta | Prioridad |
|-----------|-----------|-----------|
| **Seguridad** | Middleware JWT validación | ✅ Resuelto |
| **Seguridad** | Completar permisos por responsable | 🟡 ALTO |
| **Seguridad** | httpOnly cookies | 🟡 ALTO |
| **Seguridad** | Validación robusta de entrada | 🟡 ALTO |
| **BD** | schema.sql | 🟡 ALTO |
| **BD** | Migrations | 🟡 ALTO |
| **Frontend** | Componentes reutilizables | 🟡 ALTO |
| **Frontend** | Separación de concerns | 🟡 ALTO |
| **Tests** | Tests unitarios | 🟡 ALTO |
| **Tests** | Tests de integración | 🟡 MEDIO |
| **Docs** | Documentación de API | 🟡 MEDIO |
| **DevOps** | Logging centralizado | 🟡 MEDIO |
| **DevOps** | Error handling centralizado | 🟡 MEDIO |
| **DevOps** | Rate limiting | 🟡 MEDIO |
| **DevOps** | Backup automatizado | 🟡 MEDIO |

---

## 🎯 PLAN RECOMENDADO

### **FASE 1: Seguridad (1-2 semanas)**
Hacer el sistema seguro antes de cualquier otra mejora.

- [x] Crear middleware JWT que valide en todas las rutas protegidas
- [ ] Implementar RBAC: admin, manager, editor, viewer
- [ ] Mover token a httpOnly cookies
- [ ] Validar entrada en todas las rutas
- [x] Tests de autenticación
- [x] Documentar permisos administrativos actuales

**Resultado:** Sistema seguro. Imposible acceder sin autenticación.

---

### **FASE 2: Estructura (1-2 semanas)**
Hacer el código mantenible.

- [ ] Crear `schema.sql` con todas las tablas
- [ ] Crear migrations de BD
- [ ] Setup-demo-data.js que corra todas las tables
- [ ] Refactorizar frontend: separar componentes
- [ ] Crear `api/` carpeta en backend con rutas organizadas
- [ ] Añadir error handling centralizado
- [ ] Logging básico

**Resultado:** Código limpio, reproducible, fácil de extender.

---

### **FASE 3: Robustez (1 semana)**
Hacer el sistema resiliente.

- [ ] Tests unitarios (backend endpoints)
- [ ] Tests de integración (BD)
- [ ] Documentación de API (OpenAPI/Swagger)
- [ ] CORS configurado
- [ ] Rate limiting en rutas sensibles
- [ ] Backup automático de BD
- [ ] Monitoreo básico

**Resultado:** Sistema en producción listo.

---

### **FASE 4: Features (Según roadmap)**
Una vez que base está sólida.

- [ ] Nuevos endpoints según requisitos
- [ ] Integraciones externas (ClickUp, Drive, etc)
- [ ] Analytics/dashboard
- [ ] Notificaciones

---

## 📈 VOLUMEN DE CAMBIOS

| Fase | Frontend | Backend | BD | Tests | Tiempo |
|------|----------|---------|----|----|--------|
| 1 (Seguridad) | 200 LOC | 300 LOC | 0 | 200 LOC | 5-7 días |
| 2 (Estructura) | 1,500 LOC | 500 LOC | 100 LOC | 300 LOC | 7-10 días |
| 3 (Robustez) | 200 LOC | 200 LOC | 50 LOC | 500 LOC | 5-7 días |

---

## ✅ LO BUENO

- ✅ Stack moderno (React 19, Vite, Express, TypeScript)
- ✅ BD bien normalizada (relaciones FK)
- ✅ Validación de estados con CHECK constraints
- ✅ Usa bcryptjs (hashing seguro)
- ✅ Usa JWT (tokens stateless)
- ✅ Usa parameterized queries (safe vs SQL injection)
- ✅ Procesos corriendo sin problemas
- ✅ Interfaz funcional y clara

---

## 🚫 LO MALO

- 🚫 **Sin autenticación en rutas** (vulnerabilidad crítica)
- 🚫 **Sin RBAC** (imposible delegar)
- 🚫 **Frontend monolítico** (difícil mantener)
- 🚫 **Sin tests** (sin garantías de corrección)
- 🚫 **Sin schema.sql** (no reproducible)
- 🚫 **Sin migrations** (cambios manuales)
- 🚫 **Sin documentación** (difícil onboarding)
- 🚫 **Sin logging** (difícil debuggear en producción)
- 🚫 **Token en localStorage** (vulnerable a XSS)

---

## 📝 RECOMENDACIÓN FINAL

La exposición anónima quedó cerrada. Antes de dar por terminada la seguridad,
conviene completar permisos por responsable y evaluar cookies `httpOnly`.

### Prioridades:
1. **Primero:** completar permisos por responsable.
2. **Segundo:** evaluar cookies `httpOnly` y protección CSRF.
3. **Tercero:** ampliar tests de integración de permisos.
4. **Luego:** retomar mejoras de UX.

Con este plan, en ~2 semanas tendrás un sistema seguro, mantenible y listo para producción.

---

**¿Aprobas este plan o querés modificar prioridades?**
