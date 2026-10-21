Botón de acción con cinco variantes; `primary` es la única que usa bermellón y aparece una vez por pantalla.

**Código:** `Button` en `src/components/ui.jsx` (`<Button variant="primary" icon={Save}>`), clases `.button .button-<variant>`.

**Cuándo usar cada variante**

- `primary` (`bermellon-strong`, texto blanco): la acción que cierra la tarea de la pantalla — «Guardar clase», «Agregar alumno», «Guardar cambios». Una sola por pantalla o cajón.
- `secondary` (papel con borde `line-control`): acciones de apoyo — «Nueva clase», «Crear grupo», «Exportar Excel», «Editar».
- `soft` (`kraft`): acciones neutras de bajo peso dentro de tarjetas — «Marcar cancelada».
- `ghost` (texto `bermellon-strong`): navegación ligera dentro de una tarjeta — «Ver todas mis clases de hoy», «Ver todo».
- `danger` (borde y texto `bermellon-ink`): acciones destructivas — «Desactivar alumno», «Eliminar». Siempre seguidas de `ConfirmDialog`.

**El consumidor aporta:** el texto (verbo + objeto), un ícono Lucide opcional de 18 px a la izquierda y `disabled` mientras se guarda.

**No hacer:** dos botones `primary` juntos; botones de solo ícono con esta clase (usa `IconButton`); textos en mayúsculas o con signos de exclamación.
