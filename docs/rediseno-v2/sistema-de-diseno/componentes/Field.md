Campo de formulario con etiqueta arriba, control de 44 px y una línea opcional de ayuda o error.

**Código:** `Field`, `Input` y `TextArea` en `src/components/ui.jsx`; clases `.field`, `.field-label`, `.control`, `.control.textarea`, `.field-hint`, `.field-error`.

**Estilo:** etiqueta en `small` 700 y `sumi-muted`; control en `papel` con borde `line-control` (3.7:1) y `radius-md`; foco con el anillo `focus`. Con error: borde `bermellon-ink`, fondo `bermellon-soft` y mensaje en `bermellon-ink`.

**El consumidor aporta:** `label`, `required` (muestra un asterisco en `bermellon-ink`), `hint` y `error`. El error debe vincularse con `aria-describedby` y `aria-invalid` también cuando el control ya tiene nombre accesible (hoy no se hace).

**No hacer:** usar el placeholder como etiqueta; mensajes de error que culpen («Dato incorrecto»): di qué pasó y cómo seguir.
