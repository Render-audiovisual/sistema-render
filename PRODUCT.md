# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

El equipo interno de RENDER: líderes, diseño, edición, producción y community. Usan el sistema durante la jornada para organizar, ejecutar, revisar y finalizar trabajo operativo de clientes.

## Product Purpose

RENDER OS centraliza tareas, planificación, publicaciones, clientes, reportes y operación interna. El éxito significa que cada persona puede entender qué debe hacer, trabajar con información actualizada y reducir atrasos u olvidos.

## Positioning

Combina el flujo operativo real de la agencia con planificación editorial, responsables, publicaciones y reportes en un único sistema adaptado al equipo.

## Operating Context

El equipo trabaja principalmente desde el módulo Tareas y consulta información por cliente, responsable, sector, estado y fecha. Wilson también tiene una integración existente con WhatsApp que debe mantener permisos y criterios consistentes con el sistema web.

## Capabilities and Constraints

- Las tareas usan los estados Pendiente, En proceso, Para revisar y Finalizada.
- Solo los responsables autorizados pueden mover sus tareas; los finalizadores tienen permisos adicionales.
- Wilson debe empezar en modo lectura y nunca inventar información.
- Las recomendaciones deben provenir de reglas comprobables y respetar los permisos actuales.
- La interfaz debe preservar la lógica, los datos, los filtros y el guardado existentes.
- Las alertas automáticas proactivas quedan fuera de la primera versión.

## Brand Commitments

El producto se llama RENDER OS. Usa Poppins, superficies claras, grafito y verde lima como acento operativo. La interfaz debe sentirse directa, legible y profesional.

## Evidence on Hand

El repositorio contiene la aplicación React, el backend Express/PostgreSQL, datos reales de tareas y la integración existente de Wilson con WhatsApp.

## Product Principles

- Mostrar primero la información que permite actuar.
- Automatizar criterios sin ocultar el porqué.
- Mantener una única fuente de verdad para web y WhatsApp.
- Preservar permisos y evitar cambios de datos sin confirmación.
- Reducir ruido y alertas innecesarias.
# Wilson dentro de RENDER OS

Wilson es un asistente operativo personal dentro de Tareas. Cada integrante conversa únicamente sobre su propio trabajo; el Líder dispone de una vista de lectura de todas las conversaciones.

- Ordena tareas por entrega, prioridad y antigüedad.
- Una urgencia alta del día va primero; después vencidas altas, demás vencidas y entregas del día.
- Para diseñadores y producción, una tarea en revisión deja de ser accionable. Para Oriana, revisión es precisamente su cola de trabajo.
- Los mensajes se conservan durante el mes actual y el mes siguiente comienza vacío.
- Wilson genera un control los viernes y el día 28 a las 10:00, sin duplicarlo si coinciden.
- Una acción que altera datos exige confirmación y queda registrada en la tarea y en auditoría.
- Wilson nunca finaliza tareas: el equipo las lleva a Revisar y Oriana o un Líder las finalizan.
