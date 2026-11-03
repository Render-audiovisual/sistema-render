# Visualizaciones de Instagram y Facebook

La cifra principal es `crossposted_views` de Meta. Ya contiene Facebook:
**nunca sumar `facebook_views` otra vez al total**. `views` se conserva como
Instagram; Facebook se muestra por separado. Si el formato no ofrece el total
directo, se suman únicamente Instagram y Facebook cuando ambos están informados.
El alcance no es visualizaciones. Colaboraciones sin acceso a una métrica no
impiden sincronizar las demás publicaciones de esa cuenta.

Si Meta no ofrece un contador, se devuelve null, no cero. Un resumen mensual
solo presenta un total combinado cuando todas sus publicaciones lo tienen.
Los clientes sin cuenta vinculada no reciben cantidades inventadas.
El resumen muestra además **Visualizaciones disponibles**: toma una sola vez el
total combinado de cada publicación o, si falta, únicamente sus componentes
conocidos. Presenta el desglose disponible y cuántas publicaciones no informan
Facebook/Instagram. El total completo sigue siendo null cuando falta cobertura;
no se lo confunde con esta suma parcial ni se reemplaza un desconocido por cero.

Cada nueva medición conserva la fila histórica de `instagram_media_metricas`
y agrega un registro `media_views_v1` en la auditoría existente, en la misma
transacción y bajo la comprobación de vinculación de cuenta. Su lectura exige
ID de publicación, cuenta, cliente y fecha de medición exactos. No hay cambios
de esquema ni escrituras en tareas, publicaciones, objetivos o finanzas.

El cron existente sigue usando `run`. Las publicaciones de los últimos 90 días
sin desglose se miden en su próxima pasada; las demás mantienen la cadencia.

Una actualización solicitada por un operador puede usar:

```
node --env-file=<configuración privada existente> backend/scripts/run-instagram-automation.js refresh
```

`refresh` conserva mantenimiento, TLS, identidad, esquema y mutex compartido;
solo ejecuta Instagram y vuelve a medir los últimos 90 días. No ejecuta
WhatsApp, editorial ni IA, no borra checkpoints y no crea otro programador.
Las credenciales se cargan del entorno privado del hosting y nunca se imprimen.

## Publicaciones independientes en Facebook

Un operador puede registrar un vínculo `facebook_verified_media_link_v1` en la
auditoría existente **solo tras verificar el contenido y los dos enlaces**.
No se emparejan publicaciones por texto, fecha ni proximidad temporal.
El vínculo contiene cliente, cuenta IG, ID IG, Página y video de Facebook,
referencias canónicas y fecha de verificación; nunca credenciales.

Solo cuando falta `facebook_views`, la sincronización consulta ese video usando
la autenticación normal de su Página, efímera en memoria. Revalida el propietario
del video y toma `fb_reels_total_plays` (reproducciones + repeticiones), no
impresiones ni `blue_reels_play_count`, que excluye las repeticiones.
Un total nativo disponible conserva prioridad; Facebook no se agrega dos veces.
Vínculos duplicados, revocados o de otra cuenta/Página no se aplican. El vínculo
se vuelve a validar bajo el bloqueo de la cuenta antes de guardar cada medición.
No hay rutas de escritura nuevas ni migraciones. Las tareas no participan.

Validación: pruebas de Graph mockeado, fallback sin métricas, vinculación exacta,
transacción de sincronización, ejecutor manual y fixture PostgreSQL desechable.
El fixture comprueba que cliente, publicación y reporte muestran 3.320.213,
desglosado en 2.934.060 + 386.153, y que la huella de tareas no cambia.
