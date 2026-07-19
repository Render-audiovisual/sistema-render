# AUDITORÍA: Estructura Actual vs Requerida

## Estado ACTUAL del Sistema

### Base de Datos
**Tablas existentes:**
- `historias` (relato_id, cliente_id, estado, responsable, fecha_programada, metadata, idea, copy, material_referencia, aclaraciones, prioridad)
- `publicaciones` (id, cliente_id, tipo: [reel|carrusel|flyer|video], estado, responsable, fecha_programada, metadata, idea, copy, material_referencia, aclaraciones, prioridad)
- `tareas` (id, titulo, estado, asignado_a, requiere_aprobacion, tarea_padre_id, propiedades_extra, cliente_id, fecha_vencimiento)
- `workflow_historia` (referencia historias)
- Otras: usuarios, clientes, estructura_cliente, fechas_especiales, check_publicacion

### Frontend - Dashboards Actuales
**Luciano (edición):**
- Ve: `publicaciones` filtradas por `responsable === "Luciano"`
- Muestra: Reels, carruseles que le asignaron para editar
- PROBLEMA: Mezcla planificación con tareas de trabajo

**Augusto (diseño):**
- Ve: `historias` filtradas por `responsable === "Augusto"`
- Muestra: Historias que le asignaron para diseñar
- PROBLEMA: Mezcla planificación con tareas de trabajo

**Otros espacios:**
- `/calendario` - estructura de historias por día
- `/piezas` - tablero unificado (implementado en Fase 1/2)
- `NuevaTareaPage` - crear tareas genéricas

### El PROBLEMA Identificado

1. **Historias y Publicaciones están mezcladas en lógica:**
   - Ambas usan la misma tabla de `tareas` para trabajo específico
   - No hay clara separación entre "planificación" y "ejecución"

2. **Falta de módulos específicos por proceso:**
   - No hay "Planificación de Historias" (crear historias mensuales)
   - No hay "Planificación de Publicaciones" (crear feed mensual)
   - No hay "Tareas de Edición de Video" exclusivas para Luciano
   - No hay "Tareas de Diseño" exclusivas para Augusto

3. **Flujo de trabajo poco claro:**
   - Hoy: Se crean items → se asignan por `responsable` → se ven en dashboards
   - Debería ser: Se PLANIFICAN items → se ASIGNAN → cada rol ve sus TAREAS específicas

---

## Estructura REQUERIDA (Lo que el usuario quiere)

### Módulo 1: Planificación de Historias
**Propósito:** Organizar la producción mensual de Instagram Stories (todas para 1 cliente)
**Quién accede:** Admin + Planificador
**Qué ve:**
- Calendario mensual de historias por cliente
- Estado de cada historia (para diseño, en diseño, lista, publicada)
- Responsable asignado (Augusto para diseño)
**Resultado:** Items en tabla `historias` con estado = "pendiente" o "en_diseño"

### Módulo 2: Planificación de Publicaciones
**Propósito:** Organizar el feed mensual (Carruseles + Reels)
**Quién accede:** Admin + Planificador
**Qué ve:**
- Tabla similar a Google Sheet actual (fecha, cliente, tipo, idea, copy, responsable)
- Cuotas mensuales por cliente (carruseles, reels)
- Seguimiento visual por mes
**Resultado:** Items en tabla `publicaciones` con estado = "pendiente" o "en_diseño"

### Módulo 3: Tareas para Edición de Video
**Propósito:** Workspace exclusivo de Luciano para editar
**Quién accede:** Luciano (edición)
**Qué ve:**
- Tareas claras: "Editar Reel - Cliente X", "Exportar Video - Cliente Y", etc.
- NO ve historias (eso es para Augusto)
- NO ve publicaciones del feed (eso es otra cosa)
- SOLO sus tareas de edición asignadas
**Resultado:** Items en tabla `tareas_edicion` con tipo="edicion", asignado_a="Luciano"

### Módulo 4: Tareas para Diseño
**Propósito:** Workspace exclusivo de Augusto para diseñar
**Quién accede:** Augusto (diseño)
**Qué ve:**
- Tareas claras: "Diseñar Historia - Cliente X - Día 1", "Diseñar Carrusel - Cliente Y", etc.
- NO ve directamente historias/publicaciones (ve sus TAREAS asignadas)
- SOLO sus tareas de diseño asignadas
**Resultado:** Items en tabla `tareas_diseno` con tipo="diseno", asignado_a="Augusto"

---

## Cambios Necesarios en BD

### Nuevas tablas a crear:
1. `tareas_diseno` - tareas específicas de diseño (con link a historia_id O publicacion_id)
2. `tareas_edicion` - tareas específicas de edición (con link a publicacion_id)

### Estructura de tarea de diseño:
```sql
CREATE TABLE tareas_diseno (
  id SERIAL PRIMARY KEY,
  tipo TEXT CHECK (tipo IN ('historia', 'carrusel', 'reel')),
  relacionada_a_id INTEGER,  -- historia_id O publicacion_id
  titulo TEXT NOT NULL,
  asignado_a TEXT NOT NULL,  -- siempre "Augusto" actualmente
  estado TEXT CHECK (estado IN ('pendiente', 'en_progreso', 'revision', 'hecha', 'bloqueada')),
  fecha_vencimiento DATE,
  propiedades_extra JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Estructura de tarea de edición:
```sql
CREATE TABLE tareas_edicion (
  id SERIAL PRIMARY KEY,
  tipo TEXT CHECK (tipo IN ('editar', 'corregir', 'exportar', 'entregar')),
  publicacion_id INTEGER NOT NULL REFERENCES publicaciones(id),
  titulo TEXT NOT NULL,
  asignado_a TEXT NOT NULL,  -- siempre "Luciano" actualmente
  estado TEXT CHECK (estado IN ('pendiente', 'en_progreso', 'revision', 'hecha', 'bloqueada')),
  fecha_vencimiento DATE,
  propiedades_extra JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## Cambios en Frontend

### Navigation (Sidebar)
```
MI TRABAJO
  📌 Mi tablero (rol-específico)

PLANIFICACIÓN (solo admin)
  📅 Historias del Mes
  📋 Publicaciones del Mes

HERRAMIENTAS
  📊 Reportes

TAREAS (según rol)
  Para Augusto: ✏️ Mis Diseños
  Para Luciano: 🎬 Mis Ediciones
  Para Germán: 🎯 Mis Tareas (producción)

CUENTA
  ⚙️ Perfil
```

### Rutas nuevas:
- `/planificacion-historias` - crear/editar historias mensuales
- `/planificacion-publicaciones` - crear/editar feed mensual
- `/tareas-diseno` - dashboard de Augusto (solo sus tareas de diseño)
- `/tareas-edicion` - dashboard de Luciano (solo sus tareas de edición)

---

## Plan de Implementación

**Phase 3a - Estructura Base (TODO):**
1. Crear tablas `tareas_diseno` y `tareas_edicion` en BD
2. Crear endpoints API para C.R.U.D. de ambas

**Phase 3b - Frontend Planificación (TODO):**
1. Componente `PlanificacionHistoriasPage` 
2. Componente `PlanificacionPublicacionesPage`
3. Integrar en navigation

**Phase 3c - Frontend Tareas (TODO):**
1. Rediseñar `AugustoDashboard` → `/tareas-diseno` (solo tareas de diseño)
2. Rediseñar `LucianoDashboard` → `/tareas-edicion` (solo tareas de edición)
3. Integrar en navigation

**Phase 3d - Testing:**
1. Verificar flujo completo: planificación → tareas → ejecución

---

## DECISIÓN REQUERIDA

Antes de implementar, necesitamos decidir:

1. **¿Las tablas `tareas_diseno` y `tareas_edicion` se crean automáticamente desde historias/publicaciones o se crean manualmente?**
   - Opción A: Al planificar una historia → automáticamente crea tareas_diseno para Augusto
   - Opción B: Admin crea tareas manualmente en el módulo de tareas

2. **¿Dónde va el módulo de Planificación?**
   - Opción A: En Dashboard de Admin (Agustín)
   - Opción B: Rutas separadas `/planificacion-historias` y `/planificacion-publicaciones`

3. **¿Germán (producción) qué ve?**
   - Sus tareas de producción (en tabla `tareas` actual)
   - O necesita módulo específico también?

