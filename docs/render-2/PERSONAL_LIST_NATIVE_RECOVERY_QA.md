# Recuperación nativa de Mi lista

El navegador real confirmó recuperación por recibo después de perder una respuesta de creación, reintento con el mismo UUID cuando la petición no llegó al servidor y conservación del intento al cancelar la salida. Los datos persistieron en PostgreSQL. También se corrigió el retorno del login a una página anterior y se aclaró que salir no revierte operaciones ya guardadas. Es aceptación parcial local, no autorización de despliegue.

## Entorno y coordinación

Se usaron dos clústeres descartables en55837 con HTTP52804 y cuentas QA. El primer clúster confirmó identidad exacta y directorio `/private/tmp/render2-local-n7yMdG`; el observador consultó en REPEATABLE READ READ ONLY. No se importaron datos comerciales, no se modificó backend y no se conectaron proveedores externos.

Hypatia revisó el contrato de creación y sus límites en modo de solo lectura. Carver confirmó mediante el gate real extraído el error de retorno de sesión. El coordinador ejecutó las interacciones, las comprobaciones de red/SQL y los dos cambios de frontend. Las skills de trabajo estructurado, verificación y documentación guiaron el alcance y la separación entre evidencia nativa y pruebas de código.

## Creación confirmada con respuesta perdida

1. Luciano QA eligió la plantilla Pendientes. Se retuvo únicamente la respuesta Fetch de creación en localhost, después de observar201. La espera excedió el timeout del cliente. El intento posterior de fallar esa interceptación ya expirada no tuvo efecto; el fallo efectivo fue la respuesta retenida y el timeout, no un corte de socket afirmado retrospectivamente.
2. PostgreSQL confirmó una página, un bloque y un recibo del actor91003 antes de recuperar. La interfaz mostró el resultado incierto, bloqueó nuevas plantillas y ofreció Verificar creación.
3. Cerrar el diálogo conservó el intento. Verificar creación hizo solo GET al UUID original `38022331-97a0-450a-a7bc-5f363c98b031`, sin segundo POST, y abrió la misma página1.
4. Editar título y checklist, guardar y recargar conservó página1 y bloque1 en versión2. El recibo mantuvo UUID, hash y fecha exactos.

La interceptación se limitó a recursos Fetch de Mi lista y se retiró mediante patrones vacíos. Una operación de preparación del navegador tuvo una demora prolongada; el PID del harness se verificó vivo antes de continuar, sin reiniciarlo por timeout de observación.

## Petición no enviada y salida cancelada

Se cortó un POST en la fase Request, antes de enviarlo. Verificar devolvió404 y solo entonces habilitó Reintentar la misma creación. La captura de red confirmó un POST de reintento con cuerpo serializado idéntico, incluido el UUID `3c7266e9-c31c-4c1b-a312-d5eecd3eaabb`; el servidor respondió201 y creó exactamente la página2.

El caso se repitió con Plan diario en390×844. Tras cerrar la plantilla y elegir Tareas, el guard impidió salir sin confirmación. Seguir editando conservó la URL y el intento. GET404 y reintento conservaron el cuerpo y UUID `7ac539a2-b8d2-477e-8695-3826ab2a7138`, creando únicamente la página3 con dos bloques. El ancho de documento fue390px, sin desbordamiento horizontal en esa vista.

El corte SQL final verificó tres páginas y tres recibos distintos, todos de Luciano; la checklist y recibo iniciales permanecieron intactos. Un logout/login genuino con Designer QA en el mismo navegador devolvió200 y colección vacía. El enlace a la página ajena mostró no disponible; no transfirió contenido ni autoridad.

## Correcciones verificadas

El logout previo construía next desde el estado route retenido por App, aunque PersonalLists hubiera actualizado la query mediante replaceState. Se reprodujo `/lista?lista=3` con retorno incorrecto a lista1. App ahora lee `readRouteKey(window)` al construir ese retorno, conservando el sanitizador cerrado `loginHrefForDestination` y las restricciones posteriores por rol. No se emite popstate adicional ni se modifica historial, logout o permisos.

En el segundo clúster, con build `index-FL6jybC9.js`, se crearon dos páginas nativamente sin recargar. Logout desde lista2 generó exactamente `/login?next=%2Flista%3Flista%3D2`; el nuevo login de Luciano volvió a lista2.

El aviso compartido de salida agrega: «Salir no cancela lo que ya se haya guardado». Una petición PATCH cortada antes de enviarse dejó el borrador local. El diálogo corregido se mostró nativamente; Seguir editando y Reintentar guardado conservaron el título, y la recarga confirmó versión2. No cambió el mecanismo de consentimiento, foco ni autorización.

## Pruebas y limpieza

Pasaron51 pruebas focales iniciales de creación/guard y37 de host/destinos. La regresión frontend completa pasó2374, cero fallos u omitidas; después de quitar un caso redundante de la tabla de fixtures, destinos volvió a pasar22. Build y diff-check pasaron. No se repitió la regresión backend porque no cambió su código; las comprobaciones nativas sí utilizaron API y PostgreSQL reales.

Logs: `/private/tmp/render2-audit179-frontend.log`, `/private/tmp/render2-audit179-login-final.log` y `/private/tmp/render2-audit179-build.log`. Scripts temporales: `/private/tmp/render2-list179-native.mjs` y `/private/tmp/render2-list179-observe.mjs`. Capturas: `/private/tmp/render2-list179-mobile-recovered.png`, `/private/tmp/render2-list179-mobile-exit-guard.png` y `/private/tmp/render2-list179-exit-warning-fixed.png`.

Ambos harness terminaron con código0 y ENOENT de `/private/tmp/render2-local-n7yMdG` y `/private/tmp/render2-local-05hjvF`. Solo se eliminaron sus datos sintéticos. El viewport se restauró y la pestaña temporal se cerró; no quedó interceptación en una pestaña de trabajo.

## Límites y siguiente aceptación

El UUID pendiente vive en memoria. Esta prueba no acredita recuperación automática del intento después de recargar antes de resolverlo, cerrar la pestaña o aceptar salir. Tampoco acredita operación offline de negocio, todos los intercalados concurrentes MIA/UI ni dispositivos independientes. El error de transporte de guardado aún puede mostrar Failed to fetch; su presentación en español queda por mejorar. La aceptación transversal y los requisitos de producción continúan pendientes.
