Contenedor de tablas con desplazamiento horizontal; aquí, la lista de alumnos de una clase con asistencia, pago y calificación.

**Código:** `TableShell` en `src/components/ui.jsx` (`role="region"`, enfocable) y las tablas de `Classes.jsx`, `Community.jsx` y `Tracking.jsx`.

**Estilo:** `papel`, borde `line`, `radius-lg`. Encabezados `caption` 700 en `sumi-muted`; filas de 12 × 16 px con separador `line-soft`. La primera celda de cada fila es un `th scope="row"` con `StudentAvatar`, nombre en `body-strong` y clave en `caption`.

**El consumidor aporta:** `label` de la región, encabezados reales (`thead` con `th scope="col"`) y filas. Usa tabla HTML, no `div` con `role="table"`.

**No hacer:** paginación decorativa que no pagina; columnas que se cortan sin desplazamiento.
