Calendario de Hibi para elegir una fecha (la de una clase única o el día en que empieza una recurrente).

**Código:** se abre desde un `.select-trigger-hibi` con ícono de calendario; dentro de `.select-menu.date-picker`: `.date-picker-head` (mes y `.date-nav`), `.date-weekdays`, `.date-grid` con `.date-day` y `.date-picker-foot` con la leyenda y «Hoy».

**Estados del día:** `is-today` (anillo `bermellon` de 1.5 px), `is-selected` (relleno `sumi`, número `papel`), `is-repeat` (fondo `kraft`: las siguientes fechas de una clase recurrente), `is-past` (no se puede elegir; número en `line-control`), `is-outside` (días del mes vecino en `sumi-subtle`). Un punto de 4 px bajo el número indica que ese día ya tienes clases. La semana empieza en lunes.

**Comportamiento:** se cierra al elegir; las flechas cambian de mes y la de atrás se apaga en el mes actual. Muestra las semanas que tenga el mes, 5 o 6, sin filas vacías. En móvil sube en una hoja con días de 44 px.

**El consumidor aporta:** la fecha elegida, la fecha de hoy, qué días tienen clases y, si la clase se repite, las próximas fechas.

**No hacer:** `<input type="date">`; marcar días con color sin leyenda.
