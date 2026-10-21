Aviso breve tras guardar, sincronizar o fallar, abajo a la derecha (arriba de la barra inferior en móvil).

**Código:** `ToastRegion` en `src/components/ui.jsx`, clases `.toast`, `.toast-<tono>`, `.toast-cat`.

**Estilo:** fondo `sumi` con texto `papel` y `shadow-overlay`; en éxito, el gato sello de 36 px en lugar del gato reactivo actual; error en `bermellon-ink`. Botón de cierre de 32 px.

**El consumidor aporta:** una frase con el resultado y el dato clave («Clase guardada. 3 presentes, $300 cobrados.»). Región `aria-live="polite"`.

**No hacer:** avisos para acciones que ya se ven en pantalla; más de dos a la vez.
