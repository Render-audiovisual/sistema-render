# PROYECTO: Tablero Notion-like para Gestión de Piezas

## 🎯 OBJETIVO FINAL
Crear un tablero centralizado donde ver **todas las tareas de todos los empleados** (como Notion/ClickUp):
- Kanban visual por estados
- Tabla alternativa con filtros
- Toda la información en un lugar
- Vinculado al perfil de cada empleado

---

## 📊 ESTADO ACTUAL (Hoy: 2026-07-18)

### Lo que se completó hoy ✅
**FASE 1: Backend** — **COMPLETO Y FUNCIONANDO**
- Columnas agregadas a BD: `idea`, `copy`, `material_referencia`, `aclaraciones`, `prioridad`
- Endpoints `/api/piezas` funcionando:
  - `GET /piezas` → Todas las piezas (39 piezas: publicaciones + historias unificadas)
  - `GET /piezas/:id` → Detalle de una pieza
  - `POST /piezas` → Crear nueva pieza con todos los datos
  - `PATCH /piezas/:id` → Cambiar estado, prioridad, notas
- Backend sincronizado en http://66.94.104.21:3001

### URL para acceder
**Frontend:** http://66.94.104.21:5173 (Actualiza a Tareas)

---

## 🏗️ ARQUITECTURA

### Base de Datos
```sql
-- Columnas nuevas agregadas a:
publicaciones + historias:
  - idea (text)
  - copy (text)
  - material_referencia (text)
  - aclaraciones (text)
  - prioridad (baja|media|alta)
```

### Backend (Express)
```
GET    /api/piezas           → Todas (unificadas)
GET    /piezas/:id           → Detalle
POST   /piezas               → Crear
PATCH  /piezas/:id           → Actualizar estado
```

### Frontend (React)
```
/piezas                       → Tablero principal
├─ Kanban (7 columnas por estado)
├─ Tabla (vista alternativa)
├─ Filtros (responsable, tipo, cliente, prioridad)
└─ Modal detalle (cambiar estado, ver contexto)
```

---

## 📋 ESTADOS Y FLUJO

**Estados unificados:**
```
Pendiente → En diseño → En edición → En revisión → Lista → Publicada
                                                              ↓
                                                        Bloqueada (opcional)
```

**Tipos de pieza:**
- Historia (📖)
- Reel (🎬)
- Carrusel (📸)
- Flyer (📋)
- Video (📹)

---

## 📈 PLAN DE IMPLEMENTACIÓN (5 semanas)

### FASE 1: Backend ✅ COMPLETA
**Estado:** Endpoints todos funcionando
**Proximo:** Frontend

### FASE 2: Frontend (Próxima - ~5 días)
1. Componente `PiezasTableroPage` básico con tabla
2. Agregar Kanban visual (drag-drop)
3. Agregar filtros (responsable, tipo, cliente, prioridad)
4. Modal detalle con cambios de estado
5. Vista alternativa: tabla con todas las columnas

### FASE 3: Integración (2 días)
- Botón "📋 Tareas" en navbar
- Integrar a home
- Testing completo

### FASE 4: Formulario de carga mejorado (3 días)
- `/piezas/cargar` — Formulario completo
- Campos: Tipo, Cliente, Idea, Copy, Material, Aclaraciones, Prioridad, Responsable, Fecha

### FASE 5: Pulido (2 días)
- QA
- Documentación
- Deploy

---

## 💾 ARCHIVOS CLAVE

| Archivo | Estado | Notas |
|---------|--------|-------|
| `backend/src/server.js` | ✅ Completo | Endpoints /api/piezas listos |
| `frontend/src/main.jsx` | 🔄 En progreso | Agregar PiezasTableroPage mañana |
| `frontend/src/styles.css` | ✅ Listo | Ya tiene .kanban, .card, .modal |

---

## 🎨 CAMPOS DE UNA PIEZA

```json
{
  "id": 16,
  "tipo": "reel",                    // historia|reel|carrusel|flyer|video
  "estado": "en_diseño",             // pendiente|en_diseño|en_edición|en_revisión|lista|publicada|bloqueada
  "cliente_id": 103,
  "cliente_nombre": "Rio de La Plata",
  "responsable": "Luciano",
  "fecha_programada": "2026-07-30",
  "idea": "Testimonio cliente",
  "copy": "Narración sobre el servicio",
  "material_referencia": "https://...",
  "aclaraciones": "Editar en estilo A",
  "prioridad": "alta",               // baja|media|alta
  "created_at": "2026-07-18T...",
  "updated_at": "2026-07-18T..."
}
```

---

## ✅ PRÓXIMOS PASOS (Mañana)

1. **Crear componente PiezasTableroPage** (incremental, sin errores)
   - Paso 1: Tabla simple que liste todas las piezas
   - Paso 2: Agregar Kanban
   - Paso 3: Agregar filtros
   - Paso 4: Agregar modal

2. **Agregar ruta `/piezas`** al router

3. **Botón "📋 Tareas"** en navbar

4. **Test en navegador:** http://66.94.104.21:5173/piezas

---

## 🔗 COMMITS IMPORTANTES

```
5778712 FASE 1: Backend para tablero unificado de piezas
039883e Tidy the app skeleton: consistent shared nav + remove wireframe banners
```

---

## ⚠️ NOTAS TÉCNICAS

- **No usar drag-drop nativo** aún (agregar después del MVP)
- **Filtros:** Select dropdowns simples (sin librerías)
- **Modal:** Usar el patrón existente (.modal-overlay)
- **Styling:** Ya existe .kanban, .card, .modal en styles.css
- **Sin BreakingChanges:** Dashboards antiguos (Franco, Luciano) siguen igual

---

## 📞 DECISIONES TOMADAS

✅ **Opción A (Minimal):** Mantener publicaciones + historias separadas, agregar columnas (menos riesgo)
✅ **MVP:** Kanban + Tabla (ambos)
✅ **Estados:** 7 estados unificados
✅ **Acceso:** Ruta `/piezas` + botón en navbar (para todos)

---

## 🚀 COMANDOS ÚTILES

```bash
# Ver las 39 piezas en BD:
curl http://66.94.104.21:3001/piezas | jq

# Crear una pieza:
curl -X POST http://66.94.104.21:3001/piezas \
  -H "Content-Type: application/json" \
  -d '{
    "tipo": "reel",
    "cliente_id": 103,
    "responsable": "Luciano",
    "fecha_programada": "2026-07-30",
    "idea": "Testimonio",
    "prioridad": "alta"
  }'

# Cambiar estado:
curl -X PATCH http://66.94.104.21:3001/piezas/16 \
  -H "Content-Type: application/json" \
  -d '{"estado": "en_revisión"}'
```

---

**Guardado:** `/Users/agustinobregon/Desktop/CLAUDE : PAGINAS/SISTEMA RENDER/PROYECTO_TABLERO_PIEZAS.md`
