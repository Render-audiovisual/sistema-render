# Revisión 153: selección segura y compartible de Mi lista

## Implementación local

`PersonalLists.jsx` inicializa la selección con `/lista?lista=ID`, restaura popstate y conserva query ajena/hash. `personalListLocation.js` admite IDs BIGSERIAL canónicos hasta 9223372036854775807 como strings, sin redondear ni convertir valores grandes a Number. Distingue ausencia, enlace inválido y selección válida; duplicados/brackets se rechazan. Un ID explícito inválido, inexistente o ajeno no abre la primera lista. La primera lista solo se elige cuando no existe selección explícita, y se incorpora a la URL mediante replace conservando history.state.

El rail navega con el mecanismo compartido. Las transiciones link/traverse dentro del mismo `/lista` conservan el componente montado, el inventario y la cola de borradores por ID; no significan descarte y no fuerzan flush/relectura. La guarda sigue bloqueando operaciones estructurales pendientes. Salir del módulo, recargar, unload y contextos desconocidos conservan las reglas estrictas de dirty/busy. La revisión independiente detectó y permitió cerrar una exención inicial demasiado amplia que incluía refresh.

ACK de creación solo cambia selección si mantiene la observación original de lista; una selección diferente o A→B→A durante la espera no es reemplazada. ACK de eliminación retira únicamente la selección de URL que todavía apunta a la lista eliminada; cancelar o fallar no cambia inventario/URL/selección. Back a un ID ya no disponible muestra el aviso. Se puede elegir otra página desde ese estado, también en móvil.

No se introdujo almacenamiento comercial en navegador: únicamente selección en URL y borradores efímeros ya existentes en memoria. PostgreSQL sigue siendo la fuente compartida de listas y contenidos; el servidor conserva el filtro de propietario. Sin backend, esquema, dependencia, estilos ni permisos nuevos. Sin despliegue.

## Coordinación

- Integrador: componente y helper, prueba existente de guarda ejecutable en vez de regex antigua, prueba adicional de eliminación cancelada/fallida y recorrido nativo.
- Carver: personal-list-location.test.js, originalmente 11 pruebas; integrador añadió la duodécima.
- Beauvoir: revisión independiente de vida del componente/cola, tipos de navegación y respuestas tardías; favorable tras cerrar refresh.
- Hypatia: script temporal nativo, sin ejecución ni ediciones de producto. Integrador revisó y ejecutó.

## Evidencia

- Suite frontend final: 2.108 pruebas aprobadas, cero fallos, cancelaciones u omisiones. Comando desde frontend: `node --test src/**/*.test.js src/**/**/*.test.js src/**/**/**/*.test.js src/**/**/**/**/*.test.js`.
- Build local satisfactorio, bundle `index-CG2TUlRT.js`. git diff --check satisfactorio.
- Pruebas puras/callbacks/efectos reales: bigint exacto, enlaces inválidos, no fallback, guards antes de debounce/render, restore sin fetch/flush/discard, navegación denegada/obsoleta, canonicalización, ACK de creación ABA y eliminación en selección diferente/sesión obsoleta, cancelación/fallo sin cambios. Se mantiene cobertura existente de cola y transporte de sesión.
- Prueba nativa con backend real, cookie de administrador sintético y PostgreSQL nuevo propio puerto55802/HTTP52785. Dos listas creadas mediante API real, IDs1/2. Enlace directo abrió Dos y no Uno. Editar título, ir a Uno y Back conservó el texto de Dos; después se restauró su título y se esperó Guardado. Reload conservó Dos y Forward restauró Uno. Este recorrido no afirma el instante exacto del debounce durante el cambio; las pruebas temporales de cola acreditan ese contrato.
- Enlace con BIGINT máximo inexistente mostró aviso sin fallback. Elegir Uno desde el aviso permitió continuar. En móvil, elegir Dos cerró el rail y actualizó URL. Se conservaron `qa=preservar#pagina`.
- Visual/DOM a 390×844 y 1280×900 sin overflow horizontal del documento. Capturas inspeccionadas: `/private/tmp/render2-personal153-mobile.jpg` y `/private/tmp/render2-personal153-desktop.jpg`.
- SQL final: IDs1/2, títulos originales QA153 Uno/Dos, propietario91001 para ambas. No se borraron listas durante el recorrido nativo. La eliminación tiene pruebas automatizadas de callbacks, no nueva certificación nativa.
- PID42909 identificado por log propio y terminado con SIGTERM. Cleanup ENOENT y ausencia posterior de `/private/tmp/render2-local-cZgeRg` confirmados. Pestaña propia131 cerrada, viewport restaurado; sin emulación de red/CDP.
- Logs temporales: `/private/tmp/render2-personal153-verified-frontend.log`, `/private/tmp/render2-personal153-final-build.log`, `/private/tmp/render2-personal153-native.log`. Script revisado: `/private/tmp/render2-personal153-native.mjs`. Backend sin cambios ni nueva corrida completa en esta revisión.

## Límites y pendientes globales

La exención interna depende de la vida actual de PersonalListsPage sin key por query en App; si cambia ese montaje, debe revisarse antes de conservar la exención. Borradores en memoria no implican recuperación tras cierre/crash. La guarda de salidas mantiene la limitación existente de Back no cancelable; no hay history compensatoria.

El diálogo de plantillas aún necesita foco, Escape y uso del componente compartido. Persisten filtros de Seguimiento y gates globales de UX, permisos, integración y despliegue del prompt maestro. Esta entrega no certifica Render completo ni producción; objetivo global abierto.
