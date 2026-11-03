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

Validación: pruebas de Graph mockeado, fallback sin métricas, vinculación exacta,
transacción de sincronización, ejecutor manual y fixture PostgreSQL desechable.
El fixture comprueba que cliente, publicación y reporte muestran 3.320.213,
desglosado en 2.934.060 + 386.153, y que la huella de tareas no cambia.
