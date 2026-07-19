# PROPUESTA: Estructura Relacional sin Duplicación

## 1. MÓDULOS DEFINITIVOS

### MÓDULO 1: Planificación de Historias
- **Ruta:** `/planificacion-historias`
- **Acceso:** Agustín (admin), Franco (admin)
- **Propósito:** Organizar producción mensual de Instagram Stories
- **Qué hace:**
  - Crear/editar/eliminar historias para un cliente en un mes
  - Definir cliente, fecha, idea, copy, material
  - Asignar responsable (siempre Augusto diseño)
  - **No edita tareas**, solo crea la pieza original
- **Resultado:** Inserta/actualiza en tabla `historias`

### MÓDULO 2: Planificación de Publicaciones
- **Ruta:** `/planificacion-publicaciones`
- **Acceso:** Agustín (admin), Franco (admin)
- **Propósito:** Organizar feed mensual (reels + carruseles)
- **Qué hace:**
  - Crear/editar/eliminar publicaciones por cliente en un mes
  - Definir tipo (reel/carrusel), cliente, fecha, idea, copy, material
  - Verificar cuotas mensuales del cliente
  - **Opcionalmente genera tareas automáticamente** (para diseño y edición)
  - **No edita tareas**, solo crea la pieza original
- **Resultado:** Inserta/actualiza en tabla `publicaciones`

### MÓDULO 3: Tareas de Diseño
- **Ruta:** `/tareas-diseno`
- **Acceso:** Augusto (diseño)
- **Propósito:** Ver y ejecutar tareas de diseño asignadas
- **Qué ve:**
  - Tareas de diseño que le pertenecen (asignado_a = "Augusto")
  - Vinculadas a historias O publicaciones (carruseles)
  - Tipos: "diseñar", "corregir", "adaptar"
  - NO ve la planificación original, solo sus tareas
- **Qué hace:**
  - Actualiza estado de tarea (pendiente → en_progreso → revision → hecha)
  - Agrega notas/material en tarea
  - **No edita** la historia/publicación original
- **Resultado:** Actualiza `estado` y `propiedades_extra` en tabla `tareas`

### MÓDULO 4: Tareas de Edición
- **Ruta:** `/tareas-edicion`
- **Acceso:** Luciano (edición)
- **Propósito:** Ver y ejecutar tareas de edición asignadas
- **Qué ve:**
  - Tareas de edición que le pertenecen (asignado_a = "Luciano")
  - Vinculadas a publicaciones (reels/videos)
  - Tipos: "editar", "corregir", "exportar", "entregar"
  - NO ve la planificación original, solo sus tareas
- **Qué hace:**
  - Actualiza estado de tarea (pendiente → en_progreso → revision → hecha)
  - Agrega versiones, notas en tarea
  - **No edita** la publicación original
- **Resultado:** Actualiza `estado` y `propiedades_extra` en tabla `tareas`

### MÓDULO 5: Tareas de Producción
- **Ruta:** `/tareas-produccion`
- **Acceso:** Germán (producción)
- **Propósito:** Ver y ejecutar tareas de producción asignadas
- **Qué ve:**
  - Tareas de producción que le pertenecen (asignado_a = "Germán")
  - Pueden estar vinculadas a publicaciones (reels) O ser independientes
  - Tipos: "visita", "grabación", "producción", "búsqueda_material", "entrega", "reprogramacion"
- **Qué hace:**
  - Actualiza estado de tarea
  - Agrega material, notas, resultados
  - **No edita** la pieza original
- **Resultado:** Actualiza `estado` y `propiedades_extra` en tabla `tareas`

---

## 2. DIAGRAMA DE RELACIONES (Sin Duplicación)

```
┌─────────────────────────────────────────────────────────────────┐
│                    FLUJO GENERAL                               │
└─────────────────────────────────────────────────────────────────┘

PASO 1: PLANIFICACIÓN (Admin)
  ┌──────────────────────────────────────────────────────────────┐
  │ /planificacion-historias → INSERT historias                  │
  │ Crea: id, cliente_id, fecha, idea, copy, responsable="Augusto"
  └────────┬─────────────────────────────────────────────────────┘
           │
           ├─→ ¿Generar tarea automáticamente?
           │   SI → Crea en tabla TAREAS: tipo="diseno", historia_id=X
           │
           ▼
  ┌──────────────────────────────────────────────────────────────┐
  │ /planificacion-publicaciones → INSERT publicaciones           │
  │ Crea: id, cliente_id, tipo, fecha, idea, copy, responsable  │
  └────────┬─────────────────────────────────────────────────────┘
           │
           ├─→ ¿Generar tareas automáticamente?
           │   SI (tipo=reel) → Crea TAREAS: tipo="edicion", publicacion_id=X
           │   SI (tipo=carrusel) → Crea TAREAS: tipo="diseno", publicacion_id=X
           │
           ▼
PASO 2: ASIGNACIÓN (Admin - Opcional, puede ser automática)
  ┌──────────────────────────────────────────────────────────────┐
  │ Si tarea generada automáticamente:                            │
  │   - asignado_a = rol específico (Augusto, Luciano, Germán)   │
  │   - estado = "pendiente"                                      │
  │ Si tarea manual:                                              │
  │   - Admin define fecha_limite, prioridad, asignado_a         │
  └────────┬─────────────────────────────────────────────────────┘
           │
           ▼
PASO 3: EJECUCIÓN (Por Rol)
  ┌──────────────────────────────────────────────────────────────┐
  │ /tareas-diseno (Augusto)    → UPDATE tareas SET estado=...   │
  │ /tareas-edicion (Luciano)   → UPDATE tareas SET estado=...   │
  │ /tareas-produccion (Germán) → UPDATE tareas SET estado=...   │
  │                                                               │
  │ IMPORTANTE:                                                  │
  │ - No actualizan historias/publicaciones originales            │
  │ - Todos cambios van en tabla TAREAS (estado, propiedades_extra)
  └────────┬─────────────────────────────────────────────────────┘
           │
           ▼
PASO 4: REVISIÓN (Admin/Franco)
  ┌──────────────────────────────────────────────────────────────┐
  │ Admin revisa tarea (estado = "revision")                     │
  │ Aprueba o solicita corrección                                │
  └────────┬─────────────────────────────────────────────────────┘
           │
           ▼
PASO 5: PUBLICACIÓN (Admin/Scheduler)
  ┌──────────────────────────────────────────────────────────────┐
  │ Una vez aprobada la tarea → UPDATE historias/publicaciones   │
  │ SET estado = "publicada"                                     │
  └──────────────────────────────────────────────────────────────┘
```

---

## 3. TABLA ACTUAL vs NUEVA - ESTRUCTURA RELACIONAL

### TABLAS QUE SE MANTIENEN (SIN CAMBIOS):
- `historias` (id, cliente_id, estado, fecha_programada, idea, copy, material_referencia, aclaraciones, prioridad, responsable, ...)
- `publicaciones` (id, cliente_id, tipo, estado, fecha_programada, idea, copy, material_referencia, aclaraciones, prioridad, responsable, ...)
- `usuarios` - sin cambios
- `clientes` - sin cambios

### TABLA EXISTENTE QUE SE EXTIENDE:
**`tareas` - Agregar estas columnas:**

```sql
ALTER TABLE tareas ADD COLUMN IF NOT EXISTS (
  -- RELACIÓN CON PIEZA ORIGINAL (una tarea vincula a UNA pieza)
  historia_id INTEGER REFERENCES historias(id) ON DELETE CASCADE,
  publicacion_id INTEGER REFERENCES publicaciones(id) ON DELETE CASCADE,
  
  -- TIPO DE TAREA (para filtrar)
  tipo_tarea TEXT CHECK (tipo_tarea IN (
    'diseno', 'edicion', 'produccion'  -- categoría amplia
  )),
  subtipo TEXT,  -- "diseñar", "corregir", "editar", "exportar", etc.
  
  -- PRIORIDAD (heredada de pieza, pero puede sobrescribirse)
  prioridad TEXT DEFAULT 'media' CHECK (prioridad IN ('baja', 'media', 'alta')),
  
  -- TRACKING
  created_from_id INTEGER REFERENCES tareas(id),  -- si es copia/derivada de otra tarea
  
  -- CONSTRAINT: Una tarea debe referenciar UNA pieza (no ambas)
  CHECK (
    (historia_id IS NOT NULL AND publicacion_id IS NULL) OR
    (historia_id IS NULL AND publicacion_id IS NOT NULL) OR
    (historia_id IS NULL AND publicacion_id IS NULL)  -- tarea independiente
  )
);
```

**Tabla `tareas` estructura completa (después de cambios):**
```
id (PK)
titulo
estado (pendiente | en_progreso | revision | hecha | bloqueada)
asignado_a (nombre del rol: "Augusto", "Luciano", "Germán")
requiere_aprobacion (boolean)
tarea_padre_id (jerarquía)
propiedades_extra (JSONB para notas, versiones, etc)
cliente_id (puede venir de historia_id o publicacion_id)
fecha_vencimiento
prioridad
tipo_tarea (diseno | edicion | produccion)
subtipo (diseñar | corregir | editar | exportar | etc)
historia_id (FK → historias.id) - NUEVA
publicacion_id (FK → publicaciones.id) - NUEVA
created_from_id (FK → tareas.id) - NUEVA para rastrear origen
created_at
updated_at
```

### TABLAS NUEVAS: NINGUNA
No se crean nuevas tablas. Todo se resuelve con:
1. Extender tabla `tareas` existente
2. Agregar foreign keys (historia_id, publicacion_id)
3. Agregar columnas de clasificación (tipo_tarea, subtipo)

---

## 4. CÓMO EVITAR DUPLICACIÓN DE DATOS

### Principio Central:
**UNA PIEZA ORIGINAL + MÚLTIPLES TAREAS VINCULADAS**

### Ejemplo 1: Historia
```
Pieza Original (tabla historias):
  id: 101
  cliente_id: 5
  fecha_programada: 2026-08-15
  idea: "Testimonio cliente"
  copy: "Lorem ipsum..."
  estado: "en_diseño"

Tareas Derivadas (tabla tareas, vinculadas por historia_id=101):
  Tarea 1:
    id: 501
    historia_id: 101 ← vinculada a la pieza
    titulo: "Diseñar historia - Testimonio cliente"
    asignado_a: "Augusto"
    tipo_tarea: "diseno"
    subtipo: "diseñar"
    estado: "en_progreso"
    fecha_vencimiento: 2026-08-14
    propiedades_extra: { notas: "..." }
    
  (Podrían existir más tareas si hay correcciones)
```

**¿QUÉ PASA CUANDO LA HISTORIA CAMBIA?**
- Si idea/copy/material cambia en HISTORIAS → todos ven el cambio
- Las tareas NO copian esos datos, REFERENCIAN la historia
- Una query típica: `SELECT * FROM tareas JOIN historias ON tareas.historia_id = historias.id`

### Ejemplo 2: Publicación (Reel)
```
Pieza Original (tabla publicaciones):
  id: 202
  cliente_id: 5
  tipo: "reel"
  fecha_programada: 2026-08-20
  idea: "Promo producto X"
  responsable: "Luciano" (editor)
  estado: "pendiente"

Tareas Derivadas (tabla tareas, vinculadas por publicacion_id=202):
  Tarea 1 (Diseño):
    id: 601
    publicacion_id: 202 ← vinculada
    titulo: "Diseñar reel - Promo producto X"
    asignado_a: "Augusto" (diseño)
    tipo_tarea: "diseno"
    subtipo: "diseñar"
    estado: "pendiente"
    fecha_vencimiento: 2026-08-18
    
  Tarea 2 (Edición):
    id: 602
    publicacion_id: 202 ← vinculada
    titulo: "Editar reel - Promo producto X"
    asignado_a: "Luciano" (edición)
    tipo_tarea: "edicion"
    subtipo: "editar"
    estado: "pendiente"
    fecha_vencimiento: 2026-08-19
    
  (Tareas de producción pueden o no existir, según sea necesario)
```

### Flujo de Actualización (Sin Duplicación):
```
1. Admin crea publicación (INSERT publicaciones)
2. Sistema genera automáticamente 2 tareas en tabla tareas
3. Augusto edita su tarea (UPDATE tareas SET estado='en_progreso')
4. Luciano edita su tarea (UPDATE tareas SET estado='en_progreso')
5. Admin aprueba ambas tareas (UPDATE tareas SET estado='revision' → 'hecha')
6. Una vez ambas tareas = 'hecha', publicación puede cambiar a 'lista'

PUNTO CLAVE: La información de la publicación original (cliente_id, tipo, fecha, idea, copy)
está EN UN SOLO LUGAR (tabla publicaciones). Las tareas solo REFERENCIAN.
Si la idea cambió → todos ven el cambio automático.
```

---

## 5. QUERIES TÍPICAS (Para entender relaciones)

### Query: Luciano ve sus tareas de edición
```sql
SELECT 
  t.id,
  t.titulo,
  t.estado,
  t.fecha_vencimiento,
  p.cliente_id,
  c.nombre AS cliente,
  p.tipo,
  p.idea,
  p.copy
FROM tareas t
JOIN publicaciones p ON t.publicacion_id = p.id
JOIN clientes c ON p.cliente_id = c.id
WHERE t.asignado_a = 'Luciano'
  AND t.tipo_tarea = 'edicion'
  AND t.estado != 'hecha'
ORDER BY t.fecha_vencimiento ASC;
```

### Query: Augusto ve sus tareas de diseño (de historias Y carruseles)
```sql
SELECT 
  t.id,
  t.titulo,
  t.estado,
  t.fecha_vencimiento,
  COALESCE(h.cliente_id, p.cliente_id) AS cliente_id,
  COALESCE(h.idea, p.idea) AS idea,
  CASE 
    WHEN h.id IS NOT NULL THEN 'historia'
    WHEN p.id IS NOT NULL THEN p.tipo
  END AS tipo_pieza
FROM tareas t
LEFT JOIN historias h ON t.historia_id = h.id
LEFT JOIN publicaciones p ON t.publicacion_id = p.id
WHERE t.asignado_a = 'Augusto'
  AND t.tipo_tarea = 'diseno'
ORDER BY t.fecha_vencimiento ASC;
```

### Query: Ver todas las tareas vinculadas a una publicación
```sql
SELECT 
  t.id,
  t.titulo,
  t.asignado_a,
  t.tipo_tarea,
  t.subtipo,
  t.estado,
  t.fecha_vencimiento
FROM tareas t
WHERE t.publicacion_id = 202
ORDER BY t.asignado_a, t.tipo_tarea;
```

---

## 6. RESUMEN EJECUTIVO

| Aspecto | Solución |
|---------|----------|
| **Duplicación de datos** | NO. Pieza original en historias/publicaciones. Tareas solo REFERENCIAN con FK |
| **Múltiples tareas por pieza** | SÍ. Una historia → N tareas de diseño. Un reel → tareas de diseño + edición |
| **Actualización centralizada** | SÍ. Cambios en historia/publicación se ven en todas las tareas vinculadas |
| **Tablas nuevas** | NO. Se extiende tabla `tareas` existente con nuevas columnas |
| **Separación de módulos** | SÍ. Cada rol ve solo sus tareas, no la planificación |
| **Flujo claro** | SÍ. Planificación → Tareas automáticas → Ejecución → Revisión → Publicación |

---

## 7. PRÓXIMOS PASOS (Después de Aprobación)

Una vez que apruebes esta estructura:

1. **Script SQL**: Crear migrations para agregar columnas a `tareas`
2. **Backend API**: Endpoints para C.R.U.D. de tareas con foreign keys
3. **Frontend**: Crear 4 módulos de tareas (`/tareas-diseno`, `/tareas-edicion`, `/tareas-produccion`)
4. **Lógica de generación automática**: Cuando se crea historia/publicación → generar tareas
5. **Dashboard**: Modificar dashboards para que NOT muestren planificación, solo resumen

