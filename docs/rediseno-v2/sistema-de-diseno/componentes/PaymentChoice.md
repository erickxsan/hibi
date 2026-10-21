Trío ✓ – × para registrar el pago de cada alumno en una clase: pagado, pendiente o no pagado.

**Código:** los botones de pago de la lista en `src/features/Classes.jsx` (estados `Paid`, `Pending`, `Unpaid` de `PAYMENT_RECORD_STATES`); clases `.choice-group .payment-choice`.

**Estados:** Pagado (✓ blanco sobre `jade-strong`), Pendiente (– `sumi` sobre `ocre`), No pagado (× `bermellon-ink` sobre `bermellon-soft`). Íconos Lucide `check`, `minus`, `x` con trazo 2.4. Cada botón lleva `aria-label` con la palabra completa, porque los íconos solos no bastan.

**El consumidor aporta:** el nombre del alumno, el estado y, si aplica, el monto a cobrar para el resumen de la clase.

**Regla:** como la asistencia, una clase nueva empieza sin pago elegido; no se asume «Pendiente».
