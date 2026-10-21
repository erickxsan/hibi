Diálogo de confirmación para acciones que cambian o borran datos: desactivar, eliminar, descartar cambios, restaurar respaldo.

**Código:** `ConfirmDialog` en `src/components/ui.jsx`, clases `.dialog`, `.dialog-message`, `.dialog-actions`.

**Estilo:** 420 px de ancho en `papel`, `radius-xl`, `shadow-overlay`; título como pregunta en `section-title`; mensaje en `sumi-muted` que diga qué se conserva y cómo deshacer. Acciones: «Cancelar» (`secondary`) y la acción con su verbo exacto (`danger` si destruye, `primary` si no).

**El consumidor aporta:** pregunta, consecuencia y verbo de la acción.

**No hacer:** «¿Estás seguro?» sin contexto; botones «Sí» / «No».
