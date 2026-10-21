Cajón lateral para crear y editar: agregar alumno, crear grupo, nueva clase, editar clase.

**Código:** `Drawer` en `src/components/ui.jsx` (`size` normal o ancho), clases `.overlay`, `.drawer`, `.drawer-header`, `.drawer-body`, `.drawer-footer`.

**Estilo:** velo `overlay`; cajón de `drawer-width` en `papel` con `radius-xl` en el lado izquierdo y `shadow-overlay`. Encabezado con título `section-title`, una línea en `sumi-muted` y `IconButton` para cerrar. Pie fijo con «Cancelar» (`secondary`) y la acción principal (`primary`) a la derecha.

**El consumidor aporta:** título, descripción, cuerpo con `Field`s y las dos acciones. Debe atrapar el foco, cerrar con Escape y con el botón Atrás del teléfono, y avisar si hay cambios sin guardar.

**No hacer:** dos acciones principales; formularios de un solo campo (resuélvelos en línea).
