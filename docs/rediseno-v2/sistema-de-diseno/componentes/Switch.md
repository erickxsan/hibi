Interruptor para una opción que cambia lo que se ve al instante, como «Incluir grupos archivados» en Inicio y Seguimiento.

**Código:** `.switch` (botón con `role="switch"` y `aria-checked`), `.is-on` cuando está activo; dentro de un aviso de alcance `.scope-notice` (`.is-on`, `.scope-notice-warn`).

**Estilo:** 44 × 26 px (48 × 28 en móvil); apagado en `line-control`, encendido en `indigo`; perilla en `papel`. El aviso va en `washi` y cambia a `indigo-soft` cuando el interruptor está encendido, para que sea evidente que las cifras incluyen algo más. El saldo pendiente en archivados se muestra en `ocre-ink`.

**Comportamiento:** «Incluir grupos archivados» dura solo la sesión y se apaga al salir; nunca se guarda como preferencia.

**El consumidor aporta:** la etiqueta, una línea que diga qué queda fuera o dentro, y el saldo pendiente si lo hay.

**No hacer:** usar un interruptor para acciones que se guardan (para eso, `Segmented` o casillas en un formulario); interruptores sin etiqueta visible.
