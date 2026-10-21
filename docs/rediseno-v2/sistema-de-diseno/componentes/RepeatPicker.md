Selector de repetición: cómo se repite una clase recurrente, con tres ritmos y su intervalo.

**Código:** `.select-menu.repeat-picker` con `.repeat-kinds` (Diario · Semanal · Mensual), `.repeat-row` con `.repeat-stepper` («Cada [1] semana»), `.repeat-days` (solo en semanal), `.repeat-option` tipo radio (`.is-on`) y `.repeat-next` con las próximas fechas.

**Opciones:**
- **Diario:** cada N días (1–14), todos los días o solo de lunes a viernes.
- **Semanal:** cada N semanas (1–8) en los días elegidos; un día que choca se marca en `bermellon-soft`.
- **Mensual:** cada N meses (1–12), el mismo día del mes («el día 17») o el mismo lugar en el mes («el 3.er sábado»; si cae en una quinta semana, «el último sábado»). Si un mes no tiene ese día, la clase se salta ese mes.

**Disparador:** dice el ritmo completo en una línea: «Cada semana · mar y vie», «Cada 2 días · lun a vie», «Cada mes · el 3.er sábado». En el calendario, las fechas siguientes se marcan en `kraft`.

**No hacer:** listas fijas de «1 semana, 2 semanas…»; ocultar las próximas fechas.
