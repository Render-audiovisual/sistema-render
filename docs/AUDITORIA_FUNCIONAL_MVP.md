# Auditoría Funcional Final — MVP Render

Recorrido completo del producto desde el punto de vista del usuario (los 6 roles), verificado en navegador real y contra los datos reales de la base. No se evalúa código, seguridad, arquitectura ni diseño visual.

---

## 1. Clientes

✅ Panorama de clientes con semáforo (rojo/amarillo/verde) por historias y feed.
✅ Selector de cliente al cargar una tarea nueva.
🟡 El modal de detalle de cliente muestra sus piezas, pero "Escribir a Augusto" / "Escalar a Franco" son botones decorativos (no hacen nada).
🔴 **No hay forma de crear, editar o dar de baja un cliente desde la plataforma.** Tampoco de cambiar su cuota mensual — "Editar cuotas por cliente" y "Buscar cliente puntual" existen visualmente pero no están conectados a nada. Hoy, para dar de alta un cliente hay que tocar la base de datos directamente.
🔴 El filtro "Todos ▾" en el panorama es decorativo — no filtra.
💡 Historial de cambios de cuota por cliente en el tiempo.

---

## 2. Producción (Historias / Carruseles / Reels / Flyers / Videos)

✅ **Historias**: flujo completo y funcional — pendiente → en_diseño → en_revisión → lista → publicada, con aprobación real de Franco (aprobar / pedir corrección / escalar a Agustín).
✅ Reels y carruseles se cargan, se listan por estado y se pueden marcar publicados una vez en estado "lista".
🔴 **Reels y carruseles no tienen aprobación real.** El estado "en_revisión" existe en la base, pero ningún botón en toda la plataforma lo mueve a "lista" — y confirmé en el código que **Franco ni siquiera trae publicaciones en su cola** (su dashboard solo pide `/api/historias`). Hoy es imposible aprobar un reel o carrusel desde la plataforma; queda atascado para siempre.
🔴 **Flyers y Videos no existen como tipo de contenido.** La base de datos solo permite `'reel'` o `'carrusel'`. Si Render produce flyers o videos institucionales (vi referencias a "impresos" en el historial del workspace), hoy no tienen dónde vivir — Germán maneja producción de foto/video como tareas genéricas sueltas, sin fecha de publicación ni estado de aprobación.
💡 Unificar historias + publicaciones en un solo concepto de "pieza" con tipo (historia/reel/carrusel/flyer/video) para no duplicar la lógica de estados dos veces.

---

## 3. Empleados

✅ Vista de "atrasadas" y "bloqueadas" por persona en el dashboard de Agustín.
✅ Cada rol ve su propio avance (reels editados/objetivo en Luciano, producciones entregadas/objetivo en Germán, etc.).
🟡 Esos objetivos (ej. "48" reels) están hardcodeados en el código, no vienen de una configuración real editable.
🔴 **No existe una vista de "Equipo" real.** El tab "Equipo" aparece en la barra de Agustín y Franco pero es texto decorativo, no lleva a ningún lado. Para comparar carga entre dos personas hay que abrir un dashboard por vez.
🔴 **No hay métrica de carga de trabajo total** — solo se ven atrasos y bloqueos puntuales, nunca el volumen total asignado a cada persona.
💡 Ranking o vista comparativa de cumplimiento por empleado, igual que el semáforo de clientes.

---

## 4. Dashboard (Franco / Agustín) — Respondiendo las 6 preguntas puntuales

| Pregunta | ¿Se responde hoy? |
|---|---|
| ¿Quién está atrasado? | ✅ Sí — resumen de equipo de Agustín |
| ¿Qué cliente está en riesgo? | ✅ Sí — semáforo rojo (con la salvedad de la sección 5) |
| ¿Qué cliente ya cumplió? | ✅ Sí — semáforo verde (misma salvedad) |
| ¿Quién está sobrecargado? | 🔴 No — no hay métrica de volumen, solo atrasos puntuales |
| ¿Qué piezas vencen hoy? | 🟡 Parcial — solo Oriana lo ve en su calendario; Agustín y Franco no |
| ¿Qué requiere aprobación? | 🔴 Incompleto — Franco solo ve historias, nunca reels/carruseles |

---

## 5. Cumplimiento

🔴 **El % de cumplimiento no usa la cuota real del cliente.** Se calcula como "piezas publicadas / piezas cargadas en el sistema" — confirmé en el código que `cuota_reels` y `cuota_carruseles` (que sí existen en la base) **no se usan en ningún cálculo**. Si a un cliente le cargaron 2 historias y se publicaron 2, marca 100% verde, aunque su cuota contratada sea 8 al mes. El número no representa cumplimiento de contrato real.
🔴 **No hay corte por mes ni por semana.** El título dice "Julio 2026" pero es un texto fijo — el cálculo toma todo lo históricamente cargado para ese cliente, sin filtrar por período. Si se acumulan meses sin limpiar datos viejos, el número se diluye.
🔴 No existe cumplimiento semanal en ningún lugar, solo un agregado mensual.
🔴 No existe cumplimiento por empleado, solo por cliente.
💡 Guardar snapshots de cumplimiento por período para poder comparar mes a mes.

---

## 6. Organización / Flujo de trabajo

✅ Cada rol tiene su propio dashboard con prioridades claras al entrar.
✅ El estado "bloqueada" se visualiza con el motivo, cuando el dato existe.
🔴 **Muchos botones de acción son decorativos y no hacen nada**, algo que rompe la confianza en el uso diario:
  - "Marcar como desbloqueada" / "Avisar a Germán" (modal de Augusto)
  - "Coordinar fecha" / "Marcar material entregado" (modal de Germán)
  - "Ver" (aprobaciones escaladas a Agustín)
  - "Confirmar y subir" (checklist de Oriana)
  - Tabs "Aprobación creativa" / "Bloqueo operativo" (Franco)
🔴 **No hay forma de avisar/notificar a otra persona desde la plataforma** — todo lo que depende de otra persona sigue resolviéndose por WhatsApp, igual que antes de tener el sistema.
🟡 Oriana (community, quien sube el contenido) no puede marcar sus propias piezas como publicadas — solo un admin puede. Puede ser una regla de negocio a propósito; si no lo es, hoy se siente como una limitación, no una decisión.

---

## 7. Experiencia de uso

✅ Login rápido, redirección directa al dashboard según el rol.
✅ Los flujos principales (aprobar historia, cambiar estado, marcar publicada) toman 1-2 clics.
🔴 Varios elementos parecen interactivos (tabs, botones, filtros) pero no responden — genera la sensación de "¿esto anda o no?" en el uso diario.
🟡 No hay confirmación visual de "guardado" consistente más allá de que la lista se refresca — falta un mensaje de éxito uniforme.

---

## Veredicto Final

### ¿Si este sistema fuera para un cliente que paga por él, hoy lo lanzarías?

**No.**

### Qué falta exactamente para que la respuesta sea sí (en orden de impacto):

1. **Aprobación real de reels/carruseles.** Franco debe verlos en su cola y poder aprobarlos/rechazarlos — hoy ese contenido queda atascado para siempre en "en_revisión".
2. **Conectar el % de cumplimiento a la cuota real del cliente**, y acotarlo por mes/semana. Hoy el número que ve Agustín no significa lo que él cree que significa.
3. **Sacar o implementar de verdad los botones decorativos.** Un botón que no hace nada, en un sistema de uso diario, genera desconfianza rápido.
4. **Definir dónde viven Flyers y Videos** si son parte real del trabajo de Render — hoy no tienen dónde cargarse.
5. **Vista real de "Equipo"** con carga de trabajo comparada entre personas, no solo atrasos puntuales.

Con esos 5 puntos resueltos, sí sería lanzable como MVP funcional real.
