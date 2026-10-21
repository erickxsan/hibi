Par P/A para marcar la asistencia de cada alumno al registrar una clase.

**Código:** los botones P / A de la lista en `src/features/Classes.jsx` (registro de la próxima clase); clases `.choice-group .attendance-choice`.

**Estados:** sin marcar (las dos opciones neutras), Presente (P en `sumi` con texto `papel`), Ausente (A en `bermellon-soft` con texto y borde `bermellon-ink`). Cada botón mide `segment-height` y lleva `aria-pressed` y `aria-label` («Presente», «Ausente»).

**El consumidor aporta:** el nombre del alumno para el `aria-label` del grupo y el valor (`P`, `A` o vacío).

**Regla:** una clase nueva empieza **sin marcar**, no en Ausente; el resumen cuenta «sin marcar» aparte. Los códigos de retardo (L) y falta justificada (E) del modelo de datos no se muestran aquí.
