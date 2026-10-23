# Navegación por teclado y foco de secciones

El shell conectado incorpora un enlace «Ir al contenido» y mueve el foco al contenido cuando cambia la sección. Los cambios de filtros, páginas, días y enlaces internos de una misma sección no lo mueven. Implementado y verificado en desarrollo local; no desplegado.

## Contrato de integración

`App.jsx` mantiene separados el ciclo de navegación que protege cambios sin guardar y el ciclo de presentación que administra el foco. Este último depende de la sección y del epoch opaco de la sesión, no de nombres ni credenciales. `/clientes?gestion=1` cuenta como sección distinta de objetivos; el resto de los parámetros no cambia la sección.

`SectionContentFocus.jsx` devuelve dos hermanos independientes: un enlace nativo y un marcador oculto. No envuelve los dashboards ni altera la relación CSS de Sidebar y contenido. `section-focus.js` busca el primer main utilizable después del marcador, prefiere su h1 y utiliza el main cuando no hay h1. No enfoca la pantalla de carga ni contenido oculto, inerte, de navegación o de diálogo.

Durante una carga diferida se mantiene como máximo un observador por ciclo vigente, sin límite temporal arbitrario. Interacción del usuario, pérdida de visibilidad/foco de ventana, apertura de un modal/menú móvil, cambio de propietario/sección o desmontaje lo cancelan. No hay polling ni reintentos de red. Una carga tardía no recupera una intención cancelada.

La navegación automática no desplaza el scroll ni roba el foco a controles interactivos del destino. El salto explícito sí desplaza el contenido hasta el comienzo. Las decoraciones y tabindex temporales se retiran al perder el foco o desmontar; la limpieza de un ciclo anterior no elimina las de su reemplazo. No se cambia historial, almacenamiento, permisos ni información operativa.

## Responsabilidades y archivos

- Integración principal: `frontend/src/App.jsx`, revisión y endurecimiento del controlador, QA nativo, documentación y regresión completa.
- Poincare: `frontend/src/shared/navigation/section-focus.js` y `section-focus.test.js`.
- Carver: `frontend/src/components/SectionContentFocus.jsx`, `.css` y `.test.js`.
- Hypatia: `frontend/src/shared/navigation/section-focus-integration.test.js` y revisión independiente.
- Beauvoir: revisión independiente del contrato, consentimiento de salida y límites de ciclo de sesión.

Las asignaciones se integraron sin ediciones concurrentes de App ni modificaciones de backend, esquema, variables, dependencias o datos existentes. Los estilos reutilizan los tokens vigentes; no introducen otro tema visual.

## Pruebas automatizadas

Desde `frontend`:

```sh
node --test src/shared/navigation/section-focus.test.js src/shared/navigation/section-focus-integration.test.js src/components/SectionContentFocus.test.js
node --test $(rg --files src -g '*.test.js')
npm run build
```

Pasaron las 31 pruebas focales y las 2208 pruebas totales de frontend, sin fallos ni omitidas. Build correcto, entrada `index-DM8zU7Nm.js`. Las pruebas focales cubren resolución del destino, cargas diferidas, cancelación por interacción/overlay, filtro sin refoco, cambio de identidad, ABA, limpieza tardía, SSR, teclado y límites de integración real de App. Las simulaciones de DOM y hooks no sustituyen la aceptación en navegador.

Desde `backend`, `npm test`: 1940 aprobadas, 118 omitidas y cero fallos. Las omitidas requieren fixtures físicos habilitados expresamente; este resultado no las acredita como ejecutadas.

## Recorrido en navegador local

Servidor estático del build y PostgreSQL nuevos, con cuentas y registros sintéticos. El fixture creó mediante API un cliente y una tarea; no se usaron cuentas ni proveedores reales. Comprobaciones realizadas:

1. Inicio y navegación diferida a Calendario y Producciones enfocan el h1 real. Activar «Ir al contenido» con Return no cambia la URL; el siguiente Tab entra en controles del main, no recorre Sidebar.
2. Cambiar Ámbito de Lo mío a Equipo conserva SELECT como elemento activo y actualiza la URL. La selección se realizó con la API documentada de select después de darle foco con teclado; los intentos previos con flechas no cambiaron el valor y no se cuentan como selección nativa exitosa. Elegir otro día mantiene el botón de ese día enfocado.
3. Abrir la tarea desde Calendario conserva el foco dentro de su diálogo, no en el h1 exterior. Se cerró sin editar ni guardar.
4. Crear un borrador de visita y salir muestra el diálogo de descarte, enfocado en «Seguir editando». Cancelar conserva URL y título; confirmar «Descartar y salir» navega y enfoca Calendario.
5. A 390 × 844, Escape cierra el menú y devuelve el foco al botón Abrir menú. Navegar desde el menú a Producciones lo cierra y enfoca su h1. Shift+Tab alcanza el enlace de salto; Return enfoca el h1 a 80 px del borde superior, por debajo de la cabecera. Ancho documental 390 px y consola sin errores ni advertencias capturadas.

Capturas locales: `/private/tmp/render2-focus160-skip-desktop.jpg` y `/private/tmp/render2-focus160-mobile.jpg`. Logs: `/private/tmp/render2-focus160-unit.log`, `/private/tmp/render2-focus160-frontend.log`, `/private/tmp/render2-focus160-build.log` y `/private/tmp/render2-focus160-native.log`. Son evidencia temporal de esta ejecución, no fixtures versionados reutilizables.

Se restauró el viewport y cerró la pestaña propia antes de apagar el fixture verificado. La comprobación final registró la tarea sin alteraciones y cero visitas. El cluster `/private/tmp/render2-local-bMQnE8` fue eliminado por su propio harness; se verificó su ausencia. No se ejecutó el servidor ordinario contra una base configurada ni se migró producción.

## Límites y siguientes validaciones

UX155-03 queda resuelto para este contrato del shell y los recorridos indicados. No es certificación global de accesibilidad, lectores de pantalla, zoom, contraste ni todos los modales legacy. Tampoco acredita el drag nativo dentro de una columna ni el recorrido UI íntegro de tres videos. Los recorridos físicos previos mantienen su evidencia propia.

La revisión de diseño fue local; no se descargaron reglas externas de diseño. El sistema completo continúa pendiente de los gates de aceptación del prompt maestro y de la revisión de configuración real antes de autorizar un despliegue.
