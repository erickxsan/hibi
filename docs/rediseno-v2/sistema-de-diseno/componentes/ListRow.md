Fila de lista para móvil y listas laterales: avatar, nombre, una línea de contexto, una cifra y la flecha que abre el detalle en una `BottomSheet`.

**Código:** `.list-rows`, `.list-row`, `.list-row-text`, `.list-row-value`, `.list-row-chev`; el avatar es `StudentAvatar` o `AttendanceRing` para grupos.

**Estilo:** al menos 62 px de alto, separadas por `line-soft`, sin tarjeta alrededor; nombre en 15 px 700, contexto en `small` `sumi-muted` (o el color del estado cuando la línea es el estado: `bermellon-ink` vencido, `ocre-ink` pendiente); cifra en 15 px 800 tabular, en `sumi` o en el color del estado. Toda la fila es el objetivo táctil.

**Orden:** lo que requiere atención primero (vencido, pendiente, asistencia baja) y después lo que está al día; si hay muchas, se agrupan en «Con pendientes» y «Al día».

**El consumidor aporta:** nombre, una línea de contexto de máximo ~40 caracteres, la cifra y el destino al tocar.

**No hacer:** más de una cifra por fila; botones dentro de la fila salvo una acción secundaria corta («Marcar pagada»); etiquetas de estado y además color de texto en la misma línea.
