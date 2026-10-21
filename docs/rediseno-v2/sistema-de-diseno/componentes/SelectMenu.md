Caja desplegable de Hibi: reemplaza al `<select>` del navegador en todo lugar donde se elige una opción de una lista (grupo, alumno, «Repetir», periodo de consulta, cómo vence una mensualidad).

**Código:** `.select-menu-wrap` (posición relativa), `.select-trigger-hibi` (`.is-open`, `.is-two-line`, `.is-small` de 36 px, `.is-add` punteado para «+ Ajustar a un alumno»), `.select-value` con `small` para la segunda línea, `.select-menu` (el menú; `.is-right` para alinearlo a la derecha), `.select-option` (`.is-selected`), `.select-option-text`, `.select-option-meta`, `.select-check` y `.select-mark` (el distintivo de grupo de 32 px en `kraft`). Para alumnos, `.select-option` lleva el `StudentAvatar` de 32 px y el menú una búsqueda (`.select-search`).

**Estilo:** el disparador es un `Field` de 44 px con borde `line-control`; al abrir, el borde pasa a `sumi`, aparece un halo suave y la flecha gira. El menú es una hoja de `papel` con borde `line`, `radius-lg` y `shadow-overlay`, a 6 px del campo. Cada opción mide 44 px (56 px en móvil): nombre en 14 px 700, contexto en `small` `sumi-muted`, dato a la derecha (tarifa) y la palomita `sumi` en la elegida, que además va sobre `washi`.

**Comportamiento:** se cierra al elegir, al tocar fuera o con Escape; en listas de más de 7 opciones se agrega búsqueda. En móvil, cuando el selector vive dentro de una `BottomSheet` y es una decisión principal (grupo, alumno, fecha, hora), sube en una segunda hoja con «‹ Nueva clase» para volver; los selectores cortos de un formulario abren el menú en su lugar.

**El consumidor aporta:** etiqueta visible, opciones con una línea de contexto útil (horario, número de alumnos, próximas fechas) y la opción elegida.

**No hacer:** usar el `<select>` nativo; opciones sin contexto cuando dos se parecen; más de una acción dentro del menú.
