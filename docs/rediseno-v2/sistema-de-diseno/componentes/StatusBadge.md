Etiqueta de estado: una palabra con un punto de color, nunca solo el color.

**Código:** `StatusBadge` en `src/components/ui.jsx` (`<StatusBadge tone="success">Pagado</StatusBadge>`), clases `.status-badge .status-<tone>`.

**Tonos:** `success` (Pagado, Activo, Al corriente: `jade-strong` sobre `jade-soft`), `warning` (Pendiente: `ocre-ink` sobre `ocre-soft`), `danger` (Vencido, Error: `bermellon-ink` sobre `bermellon-soft`), `info` (Completada, Confirmada: `indigo` sobre `indigo-soft`), `neutral` (Programada, Inactivo, Archivado: `sumi-muted` sobre `kraft`). Los tonos del código actual `green`, `orange`, `red`, `blue`, `purple` se mapean a estos cinco.

**El consumidor aporta:** la palabra del estado (una o dos palabras) y el tono.

**No hacer:** estados sellados o girados en la interfaz de trabajo; inventar tonos nuevos por sección.
