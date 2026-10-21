Anillo de asistencia: el porcentaje de asistencia de un grupo, a la izquierda de su fila en Comunidad y en las fichas de grupo.

**Código:** `.attendance-ring` con las variables `--value` (porcentaje) y `--ring` (color del trazo); la cifra va en un `<b>` dentro.

**Estilo:** 40 px, anillo de 4 px; trazo `jade` a partir de 80 %, `bermellon` por debajo; resto del anillo en `line`; cifra en `caption` 800 `sumi`. Sin animación al cargar.

**El consumidor aporta:** el porcentaje (ya redondeado), el color según el umbral del 80 % y un `aria-label` con la palabra «Asistencia».

**No hacer:** usar el anillo para pagos o calificaciones (para eso hay cifras y barras); poner dos anillos en una misma fila.
