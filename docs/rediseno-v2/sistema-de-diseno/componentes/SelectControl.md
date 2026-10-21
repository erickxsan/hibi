Selector desplegable de la app (grupo, tarea, periodo, estado), con lista flotante y búsqueda opcional.

**Código:** `SelectControl` en `src/components/SelectControl.jsx`, clases `.select-control` y `.select-trigger`.

**Estilo:** disparador como un campo (`papel`, borde `line-control`, `control` 700); abierto, borde `sumi`. La lista flota con `shadow-overlay`; la opción elegida lleva fondo `washi` y una palomita `bermellon-strong`.

**El consumidor aporta:** opciones con etiqueta, valor seleccionado y, en multiselección, los chips; con `disabled`, ningún botón interno (chips o «Limpiar») debe cambiar la selección.

**No hacer:** usarlo para dos o tres opciones visibles a la vez; para eso, `Segmented`.
