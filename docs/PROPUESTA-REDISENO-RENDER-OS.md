# Propuesta integral de rediseño — RENDER OS

## 1. Objetivo

Convertir RENDER OS en un sistema operativo interno claro, sereno y profesional, donde cualquier integrante del equipo pueda comprender en pocos segundos dónde está, qué requiere atención y cuál es la siguiente acción posible.

El rediseño conservará la identidad y las funciones actuales. No busca “decorar” la interfaz, sino ordenar su lenguaje visual, reducir el esfuerzo mental y lograr que todas las secciones funcionen igual de bien en computadora y celular.

## 2. Diagnóstico actual

### Hallazgos críticos

- **Moodboard no es utilizable en celular:** el contenido principal conserva un ancho de escritorio y queda desplazado fuera de la pantalla.
- **La estructura lateral no usa una única medida:** el menú real mide 236 px, pero Inicio, Drive y el estado de carga todavía reservan 280 px. Esto genera desbordes y saltos al cambiar de sección.
- **La experiencia responsive cambia demasiado entre módulos:** Tareas, Lista, Moodboard, Drive y Publicaciones resuelven el celular con reglas diferentes.
- **La interfaz acumula capas históricas:** existen más de 18.000 líneas de CSS, 161 declaraciones `!important`, 304 estilos en línea y 273 tamaños tipográficos de 10 px o menos. Esto vuelve frágil cualquier ajuste.

### Hallazgos importantes

- Hay controles pequeños o con poco contraste, especialmente en Lista, Publicaciones, Reportes, Perfil y Empleados.
- Algunos botones con solo un ícono no explican su función a lectores de pantalla.
- Las jerarquías de acción varían: una acción principal puede verse verde, negra, blanca o como texto según la pantalla.
- Las pantallas de carga, vacío, error y confirmación no siguen un patrón único.
- Tareas funciona, pero en celular el buscador, el botón “Nueva tarea”, las vistas y los estados compiten por el mismo espacio.
- Lista tiene buenas bases, pero los controles de edición son difíciles de descubrir, el contraste es bajo y la barra superior se comprime en móvil.
- Hay animaciones generales con `transition: all`, que pueden producir movimientos inesperados y difíciles de mantener.

## 3. Dirección visual propuesta

### Concepto: “Operaciones en calma”

El sistema debe sentirse como una mesa de trabajo ordenada: superficies claras, una acción dominante por pantalla, controles silenciosos y estados fáciles de reconocer. La inspiración es la claridad editorial de Notion y Linear, junto con la precisión de interacción de las interfaces de Apple, sin copiar su apariencia ni abandonar la identidad de Render.

### Identidad que se conserva

- Grafito profundo para navegación y texto principal.
- Verde lima Render para acción principal, selección y señalización; no como decoración indiscriminada.
- Fondo cálido y claro para reducir fatiga visual.
- Tarjetas blancas, bordes suaves y sombras discretas.
- Tipografía Poppins ya instalada, con una escala más legible y consistente.

### Paleta funcional

| Uso | Color |
| --- | --- |
| Navegación / grafito | `#171A13` |
| Texto principal | `#202418` |
| Texto secundario | `#6F766C` |
| Fondo | `#F5F6F2` |
| Superficie | `#FFFFFF` |
| Borde | `#E1E5DD` |
| Acción Render | `#B5FC00` |
| Éxito | `#267046` |
| Advertencia | `#9A6A12` |
| Error / peligro | `#B9433D` |

## 4. Sistema visual unificado

### Tipografía

- Título de página: 32–40 px en escritorio y 28–32 px en celular.
- Título de sección: 20–24 px.
- Título de tarjeta: 15–17 px.
- Texto normal: 14–15 px.
- Etiquetas: 12–13 px, evitando textos funcionales inferiores a 11 px.
- Mayúsculas y espaciado de letras solo para etiquetas cortas, nunca para párrafos.

### Espaciado

Se utilizará una escala única de 4, 8, 12, 16, 24, 32 y 48 px.

- Margen de página: 32–40 px en escritorio, 24 px en tablet y 16 px en celular.
- Separación entre bloques: 24–32 px.
- Separación interna de tarjetas: 16–24 px.
- Ningún control importante debe quedar pegado a otro ni depender de espacios vacíos arbitrarios.

### Botones

Todos los botones tendrán al menos 44 px de alto y los botones de ícono un área táctil mínima de 44 × 44 px.

1. **Primario:** verde Render; una acción principal por superficie.
2. **Secundario:** fondo blanco, borde visible y texto grafito.
3. **Fantasma:** sin fondo, para acciones de baja prioridad.
4. **Peligro:** rojo, separado físicamente de las acciones normales.

Cada variante tendrá estados normal, hover, presionado, foco, deshabilitado y cargando. El texto será concreto: “Guardar referencia”, “Crear tarea”, “Aplicar filtros”.

### Movimiento

- Respuesta inmediata al tocar: 120–160 ms.
- Entrada de paneles y cambios de estado: 180–220 ms.
- Solo se animarán `transform`, `opacity`, color y sombra cuando corresponda.
- Se respetará `prefers-reduced-motion`.
- No habrá animaciones ornamentales que ralenticen el trabajo.

## 5. Arquitectura de pantalla

### Escritorio

- Menú principal fijo de 236 px.
- Encabezado de página consistente: contexto, título, ayuda breve y acción principal.
- Contenido con ancho máximo y alineación estable.
- Filtros y acciones secundarias debajo del encabezado, nunca mezclados con el título.

### Celular

- Encabezado global de 64 px y contenido con 16 px laterales.
- Una sola columna por defecto.
- Buscador y acción principal en filas independientes cuando no entren con claridad.
- Pestañas y filtros horizontales con desplazamiento visible y sin cortar texto.
- Paneles de detalle como hojas inferiores o pantalla completa, con cierre y regreso claros.
- Tableros por estado mediante selector de estado, evitando columnas de escritorio comprimidas.

## 6. Componentes que deben quedar normalizados

- `PageHeader`: icono, título, descripción, acción y contexto.
- `Button` e `IconButton`: jerarquía y estados consistentes.
- `SearchField`: icono, borrado, foco y texto accesible.
- `SegmentedControl`: secciones y vistas.
- `FilterBar`: resumen y panel expandible en celular.
- `Card`: encabezado, contenido, metadata y acciones.
- `Modal`, `Drawer` y `BottomSheet`: una sola conducta de apertura, cierre y foco.
- `LoadingState`: indicador visual y mensaje breve.
- `EmptyState`: explicación y siguiente acción.
- `ErrorState`: causa comprensible, reintento y contacto si corresponde.
- `Toast`: confirmaciones no bloqueantes.
- `Table`: encabezado fijo, filas legibles y versión móvil por tarjetas o columnas seleccionables.

## 7. Prioridad por sector

### Fase 0 — Base común

- Consolidar tokens, ancho del menú, foco, controles, movimiento y responsive.
- Eliminar medidas contradictorias y transiciones genéricas.
- Crear una página interna de componentes para revisar todos los estados.

### Fase 1 — Bloqueos visuales

- Corregir Moodboard en celular.
- Corregir desbordes de Inicio, Drive y pantalla de carga.
- Asegurar áreas táctiles, contraste y etiquetas accesibles.

### Fase 2 — Trabajo diario

- Tareas: encabezado móvil, vistas, filtros, estados y tarjetas.
- Lista: edición visible, barra adaptable, tablas navegables y acciones seguras.
- Moodboard: galería, panel de detalle, carga y categorías.

### Fase 3 — Contenido y comunicación

- Feedback, Drive, Historias y Publicaciones.
- Formularios, subida de archivos, calendarios y estados de publicación.

### Fase 4 — Gestión

- Clientes, Reportes, Finanzas, Perfil y Usuarios.
- Tablas, métricas, permisos y formularios administrativos.

### Fase 5 — Verificación final

- Revisión visual y funcional de cada ruta en 390, 768, 1280 y 1440 px.
- Navegación con teclado, foco visible y etiquetas accesibles.
- Estados de carga, vacío, error, éxito y confirmación.
- Pruebas de creación, edición, eliminación, filtros, búsqueda y navegación.
- Comparación visual antes/después y lista de pendientes cero para errores críticos.

## 8. Criterios de aceptación

Una pantalla se considera terminada únicamente cuando:

- No tiene desplazamiento horizontal accidental.
- Se puede operar con mouse, teclado y pantalla táctil.
- Ningún botón funcional mide menos de 44 × 44 px en móvil.
- La acción principal se reconoce sin competir con acciones secundarias.
- Los textos no se cortan ni quedan por debajo de 11 px cuando son funcionales.
- La posición actual y la forma de volver son evidentes.
- Carga, vacío, error y éxito tienen respuesta visual.
- No se pierde ninguna función ni dato existente.
- Se ve correctamente en los cuatro anchos de control.

## 9. Riesgos y resguardos

- **Riesgo:** romper funciones al reemplazar estilos históricos. **Resguardo:** migración por módulos y verificación posterior a cada cambio.
- **Riesgo:** que una mejora de escritorio perjudique celular. **Resguardo:** diseñar y probar ambos tamaños en la misma iteración.
- **Riesgo:** inconsistencias por estilos en línea. **Resguardo:** moverlos gradualmente a componentes y clases comunes.
- **Riesgo:** pérdida de reconocimiento para el equipo. **Resguardo:** conservar colores, nombres, estructura y lógica de trabajo actuales.

## 10. Resultado esperado

RENDER OS conservará su personalidad, pero se sentirá como un único producto y no como pantallas desarrolladas en momentos diferentes. El equipo tendrá menos dudas, menos clics erróneos y una lectura más rápida de prioridades, tanto desde computadora como desde celular.

## 11. Primera etapa implementada y verificada

Esta propuesta ya empezó a aplicarse sobre la base real del sistema:

- Se definió una única medida para el menú principal: 236 px.
- Se corrigieron Inicio, Drive, Lista y el estado de carga para usar esa medida sin generar desbordes.
- Se corrigió el Moodboard móvil, que heredaba un ancho cercano a 1.900 px.
- Se incorporaron variables compartidas para ancho del menú, alto del encabezado móvil, controles, márgenes y movimiento.
- Se eliminaron las dos transiciones genéricas `transition: all` encontradas en la base común.
- Se elevaron a 44 px los objetivos táctiles pequeños detectados en Historias, Publicaciones, Reportes, Perfil, Usuarios y estados de error de Tareas.
- Se mejoró la legibilidad y visibilidad de controles de edición, navegación de tablas y acciones en Lista.

### Matriz de comprobación inicial

| Ruta | 390 px | 768 px | 1280 px | Estado inicial |
| --- | --- | --- | --- | --- |
| Inicio | Sin desborde | Sin desborde | Sin desborde | Base corregida |
| Tareas | Sin desborde | Sin desborde | Sin desborde | Navegación móvil normalizada |
| Lista | Sin desborde | Sin desborde | Sin desborde | Base y controles corregidos |
| Moodboard | Sin desborde | Sin desborde | Sin desborde | Bloqueo móvil corregido |
| Feedback | Sin desborde | Sin desborde | Sin desborde | Pendiente revisión detallada |
| Drive | Sin desborde | Sin desborde | Sin desborde | Base corregida |
| Historias | Sin desborde | Sin desborde | Sin desborde | Controles táctiles corregidos |
| Publicaciones | Sin desborde | Sin desborde | Sin desborde | Controles táctiles corregidos |
| Clientes | Sin desborde | Sin desborde | Sin desborde | Pendiente revisión detallada |
| Reportes | Sin desborde | Sin desborde | Sin desborde | Controles táctiles corregidos |
| Finanzas | Sin desborde | Sin desborde | Sin desborde | Contratos convertidos a tarjetas responsive |
| Perfil | Sin desborde | Sin desborde | Sin desborde | Controles táctiles corregidos |
| Usuarios | Sin desborde | Sin desborde | Sin desborde | Controles táctiles corregidos |

La ausencia de desborde confirma la estructura, pero no reemplaza la revisión visual y funcional de cada estado. Esa revisión continúa por fases antes de considerar terminado el objetivo.

Referencia de revisión: [Web Interface Guidelines de Vercel](https://github.com/vercel-labs/web-interface-guidelines), consultada el 2 de octubre de 2026.

## 12. Segunda etapa: revisión visual con datos reales

La segunda revisión se realizó sobre las rutas de producción con sesión activa, tanto en 390 px como en 1280 px. Esto permitió detectar problemas que no aparecían en estados vacíos o sin conexión al backend.

### Correcciones incorporadas

- **Tareas:** el buscador y “Nueva tarea” dejan de competir por ancho en celular; las vistas tienen desplazamiento horizontal propio; Feedback queda claramente separado y visible; filtros, Papelera y estados respetan un área táctil de 44 px.
- **Lista:** las acciones de cada pendiente pasan a un menú compacto en celular, evitando que el texto quede cortado; el botón de eliminar página deja de aparecer vacío; se conserva el acceso directo en escritorio.
- **Drive:** pestañas, búsqueda, enlace externo y migas de navegación alcanzan tamaño táctil y se pueden recorrer horizontalmente sin cortar contenido.
- **Finanzas:** se eliminó la tabla rígida de contratos. En escritorio conserva una lectura por columnas y en celular cada contrato se transforma en una tarjeta con etiquetas, campos, estado y acciones completas. El formulario de alta también pasa de cinco columnas a una sola columna en celular.
- **Perfil y Usuarios:** se normalizaron botones de foto, filtros de acceso y búsqueda para evitar controles táctiles demasiado pequeños.

### Verificación técnica de esta etapa

- Build productivo del frontend sin errores.
- Suite del backend: 342 pruebas, 339 aprobadas y 3 omitidas por requerir infraestructura de QA; 0 fallidas.
- Verificación de whitespace y conflictos de diff sin errores.
- Auditoría automatizada de ancho en las 13 rutas principales a 390 px.
- Auditoría de estructura a 1280 px, confirmando que las correcciones comunes eliminan las diferencias históricas de ancho en Inicio, Drive y Lista.

### Criterio de cierre

El trabajo no se considera terminado con una comprobación de ancho. Cada módulo debe conservar datos, acciones y estados reales, y debe volver a revisarse en producción después del despliegue autorizado. La publicación no forma parte automática de esta propuesta: se realizará únicamente cuando exista autorización explícita para subir el commit y desplegarlo.
