Botón cuadrado de 44 px con un solo ícono, para acciones repetidas en filas y cabeceras.

**Código:** `IconButton` en `src/components/ui.jsx` (`<IconButton label="Editar" icon={Pencil} />`), clase `.icon-button`.

**Úsalo para:** editar, copiar, cerrar un cajón, el «+» de Comunidad y Clases en móvil, más opciones (⋮).

**El consumidor aporta:** `label`, que se vuelve `aria-label` y `title` (obligatorio), y el ícono Lucide de 20 px en `sumi`.

**No hacer:** usarlo para la acción principal de la pantalla; ponerle color de fondo de marca.
