Selector de dos a cuatro opciones excluyentes, todas visibles: periodo de Inicio, «Ver por» en Seguimiento, «¿Registrar tarea?» en Clases.

**Código:** `.home-period-tabs`, `.segmented`, `.classes-choice`, `.tracking-mode` (unificados en `.segmented`).

**Estilo:** contenedor `papel` con borde `line`; opción elegida en `sumi` con texto `papel` (no bermellón: el bermellón queda para la acción principal). Altura de opción 36 px.

**El consumidor aporta:** opciones, valor y `aria-pressed` en la elegida.

**No hacer:** más de cuatro opciones (usa `SelectControl`); usarlo para navegar entre secciones (usa `Tabs`). En Inicio, el indicador de sincronización no debe encimarse con este control.
