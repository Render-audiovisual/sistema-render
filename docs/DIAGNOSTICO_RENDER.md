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

### 🔴 CRÍTICO: Sin autenticación en rutas
**Problema:** El backend NO valida tokens JWT en ninguna ruta protegida. Solo `/login` requiere credenciales; el resto está completamente abierto.

**Rutas sin protección:**
- `GET /clientes` - acceso libre a todos los clientes
- `GET /historias`, `PATCH /historias/:id` - cualquiera puede ver/modificar historias
- `GET /publicaciones`, `PATCH /publicaciones/:id` - cualquiera puede modificar publicaciones
- `GET /tareas`, `POST /tareas`, `PATCH /tareas/:id` - cualquiera puede crear/modificar tareas

**Impacto:** Vulnerabilidad de seguridad grave. Cualquiera con acceso de red puede:
- Leer datos sensibles (clientes, tareas, etc)
- Modificar estados de proyectos
- Crear tareas fake
- Comprometer la integridad de datos

**Código:** `server.js` línea 65+ no tiene middleware de verificación JWT

---

### 🔴 CRÍTICO: Token en localStorage
**Problema:** Token JWT almacenado en `localStorage` (vulnerable a XSS):
```javascript
localStorage.setItem("render_sesion", JSON.stringify({ token, usuario }))
```

**Impacto:** Si hay una vulnerabilidad XSS, cualquier script puede acceder al token y abusar de la cuenta.

**Solución:** Usar httpOnly cookies en su lugar.

---

### 🟡 ALTO: Sin roles y permisos (RBAC)
**Problema:** La tabla `usuarios` tiene campo `rol`, pero no se valida en ninguna ruta. No hay diferencia entre usuarios normales y admins.

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

### 🟡 MEDIO: Sin CORS configurado
**Problema:** No hay configuración de CORS en Express.

**Impacto:** Solo funciona si accedes desde el mismo dominio. Si frontend se mueve a otro host, va a fallar.

---

## 📋 QUÉ FALTA POR ORDENAR

| Categoría | Qué falta | Prioridad |
|-----------|-----------|-----------|
| **Seguridad** | Middleware JWT validación | 🔴 CRÍTICO |
| **Seguridad** | RBAC (roles y permisos) | 🔴 CRÍTICO |
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

- [ ] Crear middleware JWT que valide en todas las rutas protegidas
- [ ] Implementar RBAC: admin, manager, editor, viewer
- [ ] Mover token a httpOnly cookies
- [ ] Validar entrada en todas las rutas
- [ ] Tests de autenticación
- [ ] Documentar permisos por rol

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

**No hacer cambios de features hasta que Fase 1 esté hecha.**

El sistema es vulnerable a ataques. Alguien conectado a la red puede leer/modificar cualquier dato sin autenticación.

### Prioridades:
1. **Primero:** Implementar autenticación JWT + validación (máx 3 días)
2. **Segundo:** Refactorizar código en componentes + schema.sql (máx 5 días)  
3. **Tercero:** Tests + documentación (máx 3 días)
4. **Luego:** Nuevas features

Con este plan, en ~2 semanas tendrás un sistema seguro, mantenible y listo para producción.

---

**¿Aprobas este plan o querés modificar prioridades?**
