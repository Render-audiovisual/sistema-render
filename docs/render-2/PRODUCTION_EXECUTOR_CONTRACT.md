# Ejecutor dedicado: contrato y límites

Estado: implementación en desarrollo; resultados del ensayo se registran en CURRENT_ACCEPTANCE. No se ejecutó en producción. No es un desplegador de Hostinger.

## Separación de responsabilidades

- `prepare-hostinger-release.js` permanece offline y NOT_EXECUTABLE.
- `execute-production-release.js` es una entrada explícita, nunca forma parte de build/start. Verifica bytes e inventario del artefacto instalado, dependencias y manifiesto v2 antes de conectar.
- `production-release-executor.js` conserva un cliente y una transacción para el tren específico de41migraciones y sus asignaciones explícitas. No ofrece migración genérica ni reparación automática del historial.
- El migrador local y la conciliación local anteriores conservan sus restricciones. No se los habilitó para producción mediante un override.

## Autoridad y alcance

La solicitud y aprobación externa son archivos privados del operador, fuera del repositorio y del artefacto. No se genera una autorización productiva a partir de los planes anteriores. La posesión/escritura de ese directorio constituye una frontera de confianza del sistema operativo: un hash no autentica al aprobador.

El alcance vincula identidad real, ambiente y propósito, expiración, estado completo previo,58entradas exactas del historial,41nombres y hashes SQL, política de seguridad, artefacto/commit/inventario, plan de asignaciones, respaldo/restauración, revisión de configuración, conexión directa/de sesión y mantenimiento. Las declaraciones externas de respaldo, restauración, pausa de escritores y configuración requieren revisión humana auténtica; no se vuelven hechos comprobados solo por tener un hash o un booleano.

`isolated-rehearsal` requiere una dirección loopback y ambiente test/sandbox real. No se cambia production por sandbox ni se presenta un ensayo como autorización para la base viva. La aprobación productiva requiere propósito y ambiente productivos explícitos, más una ventana futura autorizada. **No existe una aprobación productiva emitida en esta etapa.**

## Aplicación y preservación

El ejecutor retiene el cliente, adquiere exclusión de migrador y bloquea las tablas públicas previas; vuelve a comprobar identidad, huella completa, historial y universo de tareas antes de consumir la autorización. El mantenimiento externo sigue siendo obligatorio: los locks no detienen proveedores externos ni certifican exclusividad global del esquema.

Los SQL se ejecutan íntegros, sin dividir por punto y coma. No se repiten los imports/limpiezas históricos ni se inventan entradas para eludir incompatibilidades. La protección de objetos públicos nuevos aplica RLS y revoca accesos API antes del COMMIT.

Las asignaciones usan IDs explícitos y cubren todas las tareas mediante elección o excepción motivada. Usuarios inexistentes/inactivos, asignaciones ya existentes o tareas nuevas no cubiertas detienen el intento. Las tareas de Líder no se reparten: el intent del respaldo reciente tiene56responsables de esa cuenta;62era una referencia anterior, no un número a forzar. No se promueve a Franco Romero por coincidencia de nombre.

Antes de confirmar, se comprueban todas las filas proyectadas sobre columnas originales y sus identidades físicas, los permisos anteriores, la identidad de objetos y las adiciones exactas de historial/asignaciones. No se reemplaza ni importa sobre la base viva el contenido de la copia. Un estado previo obsoleto obliga a generar y revisar un nuevo alcance que incluya los datos nuevos.

## Fallos y reintentos

La marca privada de consumo utiliza creación exclusiva y sincronización. Se conserva incluso tras fallos; no es un recibo global entre máquinas. No mover/copiar aprobaciones a otro directorio para reintentar. Mantener propiedad exclusiva del artefacto y de sus directorios: no se promete protección contra un proceso hostil que los modifique concurrentemente.

Un fallo anterior al COMMIT intenta revertir la transacción completa. Un fallo de COMMIT se clasifica como resultado incierto y descarta la conexión, sin reintento automático ni afirmación de rollback. Si falla la escritura del recibo, inspeccionar la base: un archivo de salida fallido no prueba que la transacción falló. Los valores de secuencias pueden avanzar aun al revertir una transacción; no reutilizar huecos ni “corregirlos” automáticamente.

Consultar el estado por una nueva conexión de solo lectura antes de emitir otra autorización. Un restore antiguo no es un rollback seguro después de confirmar cambios o recibir datos nuevos. El arranque/publicación/HTTPS/proveedores y la apertura del tráfico son pasos separados.

## Uso previsto

```sh
node backend/scripts/execute-production-release.js help
```

El help describe los cinco archivos/directorios explícitos requeridos, incluido el backup cuyos bytes se verifican. Esa verificación no demuestra por sí sola correspondencia con el snapshot ni restaurabilidad. No hay comandos `force`, `deploy` ni generación automática de aprobaciones. No incluir URLs con credenciales en argumentos. La preparación y el ensayo aislado no habilitan la ejecución sobre producción.
