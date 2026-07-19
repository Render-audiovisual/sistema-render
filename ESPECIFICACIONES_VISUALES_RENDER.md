# 🎨 Especificaciones Visuales - Plataforma Render

**Objetivo:** Mejora visual sutil sobre la plataforma actual  
**Alcance:** Únicamente visual (tipografía, colores, espaciados)  
**Enfoque:** Crear identidad visual coherente sin cambiar estructura ni funcionalidades  

---

## 📌 Principios de Trabajo

### Lo que SÍ hacemos:
- ✅ Unificar tipografía, colores y espaciados
- ✅ Mejorar jerarquía visual
- ✅ Estandarizar tarjetas, bloques, tablas, botones, filtros y modales
- ✅ Redondeados sutiles y consistentes
- ✅ Alineaciones y espaciados mejorados
- ✅ Hacer que todas las pantallas se sientan parte del mismo sistema

### Lo que NO hacemos:
- ❌ Cambiar estructura o lógica
- ❌ Mover módulos o componentes
- ❌ Modificar flujos de trabajo
- ❌ Cambiar estados, datos o permisos
- ❌ Reemplazar componentes que funcionan
- ❌ Agregar sombras fuertes, degradados, animaciones decorativas

---

## 🎯 Paleta de Colores

### Colores Primarios
```
Texto fuerte / Títulos:        #222
Botones, bordes, operativos:   #333
Fondo general:                 #e8e8e8
Tarjetas y contenedores:       #ffffff
```

### Fondos Suaves Permitidos
```
#f5f5f5
#fafafa
#f7f7f7
#f2f2f2
#ececec
```

### Grises de Apoyo
```
Texto secundario:   #666, #777, #888
Texto deshabilitado: #999, #aaa
Bordes, divisores:  #ccc, #ddd
```

### Overlay (Modales)
```
rgba(0, 0, 0, 0.4)
```

---

## ✍️ Tipografía

### Font Principal
```
Font Family: Poppins
Fallback: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif
```

### Escala Tipográfica (CSS)
```css
/* Títulos principales */
h1 { font: 28px / 1.3 Poppins; color: #222; font-weight: 600; }
h2 { font: 22px / 1.3 Poppins; color: #222; font-weight: 600; }
h3 { font: 18px / 1.3 Poppins; color: #222; font-weight: 600; }

/* Texto general */
body { font: 14px / 1.5 Poppins; color: #333; }

/* Etiquetas / Captions */
.caption { font: 12px / 1.4 Poppins; color: #666; }

/* Texto pequeño */
small { font: 12px / 1.4 Poppins; color: #777; }

/* Texto deshabilitado */
[disabled], .disabled { color: #aaa; }
```

---

## 🧩 Componentes Estandarizados

### Tarjetas y Bloques
```css
.card, .box {
  background-color: #ffffff;
  border: 1px solid #ddd;
  border-radius: 6px;
  padding: 16px;
  margin-bottom: 16px;
  box-shadow: none;  /* Sin sombras */
}

.card:hover {
  border-color: #ccc;
  background-color: #fafafa;
}

/* Variante de fondo suave */
.box-subtle {
  background-color: #f7f7f7;
  border: 1px solid #e8e8e8;
}
```

### Botones
```css
.btn {
  background-color: #ffffff;
  color: #333;
  border: 1px solid #ddd;
  border-radius: 6px;
  padding: 8px 16px;
  font: 14px Poppins;
  font-weight: 500;
  cursor: pointer;
  transition: none;  /* Sin transiciones lentas */
}

.btn:hover {
  background-color: #f7f7f7;
  border-color: #ccc;
}

.btn:active {
  background-color: #f2f2f2;
  border-color: #999;
}

.btn:disabled {
  background-color: #ececec;
  color: #aaa;
  border-color: #ddd;
  cursor: not-allowed;
}

/* Botón primario */
.btn-primary {
  background-color: #333;
  color: #ffffff;
  border-color: #333;
}

.btn-primary:hover {
  background-color: #222;
  border-color: #222;
}

/* Botón activo */
.btn-active {
  background-color: #333;
  color: #ffffff;
  border-color: #333;
}
```

### Inputs y Selects
```css
input, select, textarea {
  background-color: #ffffff;
  color: #333;
  border: 1px solid #ddd;
  border-radius: 6px;
  padding: 8px 12px;
  font: 14px Poppins;
}

input:focus, select:focus, textarea:focus {
  outline: none;
  border-color: #333;
  background-color: #fafafa;
}

input::placeholder, select::placeholder {
  color: #aaa;
}

input:disabled, select:disabled, textarea:disabled {
  background-color: #ececec;
  color: #999;
  border-color: #ddd;
}
```

### Tablas
```css
table {
  width: 100%;
  border-collapse: collapse;
  border: 1px solid #ddd;
  border-radius: 6px;
  overflow: hidden;
}

thead {
  background-color: #f7f7f7;
  border-bottom: 1px solid #ddd;
}

thead th {
  color: #222;
  font-weight: 600;
  font-size: 13px;
  padding: 12px;
  text-align: left;
  border-right: 1px solid #e8e8e8;
}

tbody td {
  color: #333;
  padding: 12px;
  border-bottom: 1px solid #e8e8e8;
  border-right: 1px solid #e8e8e8;
}

tbody tr:last-child td {
  border-bottom: none;
}

tbody td:last-child {
  border-right: none;
}

tbody tr:hover {
  background-color: #fafafa;
}
```

### Modales
```css
.modal-overlay {
  background-color: rgba(0, 0, 0, 0.4);
  display: none;
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  justify-content: center;
  align-items: center;
  z-index: 1000;
}

.modal-overlay.open {
  display: flex;
}

.modal {
  background-color: #ffffff;
  border: 1px solid #ddd;
  border-radius: 8px;
  width: 90%;
  max-width: 600px;
  max-height: 90vh;
  overflow-y: auto;
  box-shadow: none;  /* Sin sombras */
}

.modal-header {
  background-color: #f7f7f7;
  border-bottom: 1px solid #ddd;
  padding: 16px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.modal-header h2 {
  font: 18px Poppins;
  color: #222;
  font-weight: 600;
  margin: 0;
}

.modal-close {
  background: none;
  border: none;
  font-size: 20px;
  color: #666;
  cursor: pointer;
  padding: 0;
}

.modal-close:hover {
  color: #222;
}

.modal-body {
  padding: 20px;
}

.modal-actions {
  background-color: #f7f7f7;
  border-top: 1px solid #ddd;
  padding: 16px;
  display: flex;
  gap: 10px;
  justify-content: flex-end;
}
```

### Filtros y Controles
```css
.filter-group {
  display: flex;
  gap: 12px;
  align-items: center;
  flex-wrap: wrap;
  margin-bottom: 16px;
  padding: 12px;
  background-color: #f7f7f7;
  border: 1px solid #e8e8e8;
  border-radius: 6px;
}

.filter-label {
  font: 13px Poppins;
  font-weight: 500;
  color: #222;
  white-space: nowrap;
}

select.filter {
  background-color: #ffffff;
  color: #333;
  border: 1px solid #ddd;
  border-radius: 4px;
  padding: 6px 10px;
  font: 12px Poppins;
}

select.filter:focus {
  outline: none;
  border-color: #333;
}
```

### Kanban (Tablero)
```css
.kanban {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 16px;
  overflow-x: auto;
  padding: 4px;
}

.kanban-column {
  background-color: #f7f7f7;
  border: 1px solid #e8e8e8;
  border-radius: 6px;
  padding: 12px;
  min-height: 400px;
}

.kanban-header {
  background-color: #ffffff;
  border: 1px solid #ddd;
  border-radius: 4px;
  padding: 10px 12px;
  margin-bottom: 12px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.kanban-header > span {
  font: 13px Poppins;
  font-weight: 600;
  color: #222;
}
```

### Etiquetas y Badges
```css
.badge, .tag {
  display: inline-block;
  padding: 4px 8px;
  border-radius: 4px;
  font: 11px Poppins;
  font-weight: 500;
  border: 1px solid #ddd;
}

.badge-default {
  background-color: #f7f7f7;
  color: #333;
  border-color: #e8e8e8;
}

.badge-prioridad-alta {
  background-color: #ffe8e8;
  color: #c00;
  border-color: #ffcccc;
}

.badge-prioridad-media {
  background-color: #fff5e8;
  color: #c70;
  border-color: #ffddbf;
}

.badge-prioridad-baja {
  background-color: #e8f5f7;
  color: #088;
  border-color: #bfe8f0;
}
```

### Divisores y Bordes
```css
hr, .divider {
  border: none;
  border-top: 1px solid #ddd;
  margin: 16px 0;
}

.border-bottom {
  border-bottom: 1px solid #ddd;
  padding-bottom: 12px;
  margin-bottom: 12px;
}
```

---

## 📐 Espaciados Estandarizados

```css
/* Base 4px */
--spacing-xs: 4px;   /* Entre elementos muy cercanos */
--spacing-sm: 8px;   /* Espaciado pequeño */
--spacing-md: 12px;  /* Espaciado estándar */
--spacing-lg: 16px;  /* Espaciado generoso */
--spacing-xl: 20px;  /* Espaciado grande */
--spacing-xxl: 24px; /* Espaciado extra grande */

/* Aplicación */
margin: var(--spacing-lg);
padding: var(--spacing-md);
gap: var(--spacing-sm);
```

---

## 🔄 Redondeados Estandarizados

```css
--radius-sm: 4px;     /* Botones, inputs, badges */
--radius-md: 6px;     /* Tarjetas, modales, cajas */
--radius-lg: 8px;     /* Contenedores principales */

/* Aplicación */
border-radius: var(--radius-md);
```

---

## 🔄 Plan de Implementación

### Fase 1: Base CSS (Sin cambios visuales)
1. Agregar estilos base a `styles.css`
2. Definir variables CSS (colores, espaciados, redondeados)
3. No tocar componentes React aún

### Fase 2: Tipografía (Cambio visible)
1. Cambiar font-family a Poppins (con fallbacks)
2. Estandarizar jerarquía (h1-h3, body, small, caption)
3. Revisar cada pantalla

### Fase 3: Colores (Cambio visible)
1. Aplicar paleta a tarjetas, botones, inputs
2. Actualizar bordes y fondos
3. Revisar cada pantalla

### Fase 4: Espaciados y Redondeados (Refinamiento)
1. Unificar padding y margins
2. Aplicar redondeados consistentes
3. Ajustar alineaciones
4. Revisar cada pantalla

### Fase 5: Componentes Especiales (Kanban, Modales, Tablas)
1. Aplicar estilos a Kanban
2. Aplicar estilos a Modales
3. Aplicar estilos a Tablas
4. Revisar dashboards específicos

### Fase 6: Testing y Ajustes
1. Revisar cada pantalla
2. Probar en móvil
3. Ajustar detalles menores
4. Deploy final

---

## ⚠️ Checklist de No-Romper

- [ ] Los botones siguen funcionando
- [ ] Los inputs reciben input correctamente
- [ ] Los modales se abren y cierran
- [ ] Las tablas se renderean sin errores
- [ ] Los dashboards cargan sus datos
- [ ] Los filtros funcionan
- [ ] Los permisos se respetan
- [ ] Los flujos de navegación funcionan
- [ ] Responsive en móvil

---

## 💾 Rollback Point

Antes de comenzar:
```bash
git checkout -b feature/visual-improvements
git tag checkpoint/antes-visual-improvements
```

Si algo se rompe:
```bash
git reset --hard checkpoint/antes-visual-improvements
```

---

## 📝 Ejemplo de cambio (Antes → Después)

### Antes
```css
.card {
  background: white;
  border: 1px solid gray;
  padding: 20px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  border-radius: 8px;
}

.btn {
  background: #007bff;
  color: white;
  border: none;
  padding: 10px 20px;
  border-radius: 4px;
  cursor: pointer;
}
```

### Después
```css
.card {
  background-color: #ffffff;
  border: 1px solid #ddd;
  padding: 16px;
  box-shadow: none;
  border-radius: 6px;
}

.btn {
  background-color: #ffffff;
  color: #333;
  border: 1px solid #ddd;
  padding: 8px 16px;
  border-radius: 6px;
  cursor: pointer;
  font: 14px Poppins;
}

.btn-primary {
  background-color: #333;
  color: #ffffff;
  border-color: #333;
}
```

---

**Estado:** Listo para implementación  
**Prioridad:** Baja (mejora visual, no funcional)  
**Estimado:** 2-3 días de trabajo  
**Risk:** Muy bajo (cambios solo visuales)
