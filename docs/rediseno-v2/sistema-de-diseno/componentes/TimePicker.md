Selector de hora de Hibi: un reloj de verdad. La carátula marca con un arco la duración de la clase y en otro color lo que ya está ocupado.

**Código:** se abre desde un `.select-trigger-hibi` con ícono de reloj. Dentro, `.time-clock`: la lectura grande `.time-clock-read` (hora y minutos; la parte activa va sobre `washi`), el cambio `.time-clock-ampm` (a. m. / p. m.), la carátula `.time-dial` (SVG con `.time-dial-track`, `.time-dial-face`, `.time-dial-busy`, `.time-dial-class`, la manecilla `.time-dial-hand` y su perilla `.time-dial-knob`) y los números `.time-dial-num` encima (`is-selected`, `is-off`, `is-busy`, `is-tick`). Abajo van la leyenda, la nota de lo ocupado y `.time-foot` con el rango y el estado.

**Cómo se usa:** primero se toca la hora y el reloj pasa solo a los minutos, en cuartos de hora (00, 15, 30, 45); al elegir los minutos se cierra. El anillo exterior es la media jornada que se ve: la clase nueva es un arco `sumi` (`bermellon` si choca) y las clases que ya tienes en esos días son arcos `bermellon-soft`. En modo minutos los arcos se ocultan.

**Restricción:** las horas fuera de la jornada (8:00 a. m. a 9:00 p. m., contando la duración) van atenuadas, y las que chocarían con otra clase en todos sus cuartos de hora van tachadas en `bermellon-ink` y no se pueden elegir. Si una hora está libre solo en parte, el reloj se queda en el primer cuarto libre. La nota dice en palabras qué está ocupado («Prepa 5:00–6:30 p. m. (mar)»).

**El consumidor aporta:** hora, duración, días activos y las clases existentes de esos días.

**No hacer:** `<input type="time">`; esconder los choques hasta guardar; permitir elegir una hora ocupada.
