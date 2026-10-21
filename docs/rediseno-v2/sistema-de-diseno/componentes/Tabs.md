Pestañas subrayadas para cambiar de vista dentro de una sección: Comunidad (Todos, Alumnos, Grupos), Clases (Próxima clase, Calendario, Historial), Seguimiento (Calificaciones, Asistencia, Pagos).

**Código:** `Tabs` en `src/components/ui.jsx` y `.community-tabs`, `.classes-workspace-tabs`, `.tracking-tabs`, `.progress-tabs`.

**Estilo:** texto `control` 700 en `sumi-muted`; activa en `sumi` con un subrayado de 3 px en `bermellon`. Línea base `line`. Altura 48 px.

**El consumidor aporta:** las vistas (dos a cuatro) y la activa, con `role="tab"` y `aria-selected`.

**No hacer:** relleno de color en la pestaña activa; usar pestañas para filtros de dos estados (usa `Segmented`).
