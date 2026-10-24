# Filtros legibles del calendario móvil

El calendario canónico apila Ámbito, Tipo y Cliente hasta600px. Cada select ocupa el ancho interior disponible, sin el límite desktop de240px. Corrige el recorte observado a390px en el recorrido audiovisual conectado. Desde601px se conserva la distribución flex anterior. No cambia opciones, callbacks, URL, API, evidencia editorial ni permisos.

## Implementación y pruebas

Calendar.css sustituye las tres reglas móviles existentes, sin agregar una capa de overrides. El control compartido FilterSelect conserva texto móvil16px, altura44px, flecha con margen interior y foco visible. La prueba añadida en filterSelectAdoption.test.js comprueba el media query, ancho de campos/selects, retirada del cap móvil y conservación del desktop; renderiza además los controles JSX reales con Publicaciones confirmadas, Programación y un nombre de cliente largo. CSS AST y SSR no acreditan geometría computada.

Pasaron52 pruebas focales de FilterSelect/adopción/calendario/navegación,2361 pruebas de frontend y npm run build. Logs locales: `/private/tmp/render2-calendar172-focused.log`, `/private/tmp/render2-calendar172-frontend.log` y `/private/tmp/render2-calendar172-build.log`. Build servido: index-gpBnBq_Z.js. No se modificó backend; no se repitió su suite global en este corte.

## Aplicación conectada

El scaffold `/private/tmp/render2-calendar172-native.mjs` creó un clúster temporal, verificó base render2_local_test, usuario render2_fixture, dirección127.0.0.1, puerto55830 y directorio generado antes de preparar el cliente sintético Estudio audiovisual QA por HTTP. Sirvió el build canónico en52798, sin sustitución de sesión, API o adaptadores. Se ingresó desde Login con qa_franco y cookie real.

En390×844 los tres selects midieron358×44px, con x16 y y331/413/495. El texto seleccionado Publicaciones confirmadas y el cliente se vieron completos. La captura inspeccionada es `/private/tmp/render2-calendar172-mobile.png`; no hay desbordamiento horizontal: scrollWidth390. A320 y600px midieron288 y568px de ancho, respectivamente, en tres filas. A601px volvieron a flex con wrapping; a1440px conservaron flex y tamaños92.5/221.5/195.5px. En todos esos anchos scrollWidth coincidió con innerWidth.

El cambio nativo a Programación mantuvo mes, día, ámbito y cliente, y dejó pagina0. Recargar conservó programacion; Atrás restituyó publicacion. No hubo errores de consola en el recorrido observado. Captura desktop: `/private/tmp/render2-calendar172-desktop.png`. Se restauró el viewport y se cerró la pestaña157.

El proceso propio7097 se verificó antes de SIGTERM. Su handle79661 terminó exit0, comprobó cero tareas y cero eventos editoriales y confirmó limpieza con absent:true/ENOENT de `/private/tmp/render2-local-mjMxwv`. Se eliminó solo ese fixture descartable; no se usaron ni detuvieron bases previas.

## Límites y coordinación

Hypatia revisó la cascade y detectó la necesidad de retirar el cap240px en móvil. Carver revisó la cobertura de selección, URL y evidencia. El coordinador editó CSS/test y ejecutó la comprobación nativa. Las skills de diseño conservaron la presentación compartida sin cambios de negocio.

La cohorte tiene agenda vacía: valida filtros y navegación, no repite el recorrido de tres publicaciones documentado en NATIVE_THREE_VIDEO_PROGRESS.md. Nombres arbitrariamente extensos pueden exceder incluso un select de ancho completo; no se promete ausencia de recorte para cualquier contenido. No se verificó de nuevo accesibilidad global, drag con PostgreSQL, fotos, proveedores externos ni despliegue. El objetivo maestro continúa abierto.
