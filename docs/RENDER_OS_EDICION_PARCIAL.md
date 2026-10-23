# Edición de material registrado en una visita parcial

El cliente firmado de WhatsApp admite `tarea_origen_id` en el payload de creación y validación. No es una excepción libre de duplicados: el servidor comprueba que el origen sea una visita activa de RENDER OS, del mismo cliente, con producción declarada y exactamente el mismo material. Solo esa visita se excluye de las coincidencias; cualquier otra tarea coincidente sigue bloqueando el alta, incluso si se solicita permitir duplicados.

La edición conserva `tarea_padre_id` y `propiedades_extra.origen_visita_parcial_id`. No utiliza `origen_visita_id`, reservado al traspaso automático de la visita completa, ni altera registros, cantidades, estado o confirmación de la visita. Este flujo conservador admite una edición del material registrado; no infiere piezas adicionales.

Las altas se serializan por cliente y bloquean el origen dentro de la misma transacción. Se mantienen firma, identidad, permisos, confirmación exacta, idempotencia y auditoría. `notificar_asignacion: false`, incluido en la firma y confirmación, omite el aviso al equipo y queda auditado; no modifica configuración ni programaciones.

Verificación: `node --test backend/test/wilson-production-link.test.js backend/test/wilson-integration.test.js`.
