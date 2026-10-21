# Especificación del rediseño

Complementa las capturas y los HTML. Donde el diseño y el código actual difieren en *datos*, manda esta especificación; donde difieren en *forma*, mandan las capturas.

## 1. Reglas de toda la app

- **Un solo botón principal (bermellón) por pantalla, hoja o cajón.** Lo demás es `secondary`, `ghost` o enlace.
- **Asistencia solo Presente / Ausente**, y **toda clase nueva empieza sin marcar** (nunca en Ausente ni en Presente). El resumen cuenta «sin marcar» aparte. El pago de una clase también empieza sin elegir.
- **Estados con palabra y punto de color**, sobrios: Pagado, Pendiente, Vencido, Completada, Programada, Archivado. Nada de etiquetas infantiles.
- **Nada de selectores nativos del navegador.** Grupo, alumno, periodo y demás listas usan `SelectMenu`; fecha usa `DatePicker`; hora usa `TimePicker` (reloj); repetición usa `RepeatPicker`. En móvil, dentro de una hoja, suben en una segunda hoja con «‹ Volver».
- **Móvil**: una columna, listas (`ListRow`) antes que tarjetas, el detalle en `BottomSheet` (máximo dos niveles), P/A grandes de 48 px, y la acción principal a todo lo ancho (en Registrar clase, en una barra fija con el avance).
- **Menús actuales**: se conservan las cinco secciones (Inicio, Comunidad, Clases, Seguimiento, Configuración). No se agregan botones extra en la navegación.
- **Tipografía**: Dela Gothic One solo en títulos de página y momentos del tutorial; Albert Sans en todo lo demás.
- **Textos** en español de México, en tú, con «profe». Montos `$2,395`. Fechas cortas «mar 13 de oct, 5:00 p. m.».

## 2. Componentes nuevos (fase 1)

Las guías completas están en `sistema-de-diseno/componentes/`. Resumen de comportamiento:

- **SelectMenu**: disparador de 44 px (56 px con segunda línea, p. ej. el grupo con «3 alumnos · mar y vie 5:00 p. m. · $90/h»). Menú con opciones de 44 px, contexto en la segunda línea, dato a la derecha y palomita en la elegida. Se cierra al elegir, al tocar fuera o con Escape. Con más de 7 opciones lleva búsqueda (alumnos), que ignora acentos. Versión pequeña de 36 px para formularios compactos.
- **DatePicker**: semana desde lunes; hoy con anillo bermellón; elegida en sumi; días pasados deshabilitados; punto en los días que ya tienen clases; las fechas siguientes de una clase recurrente en kraft; botón «Hoy»; 5 o 6 semanas según el mes.
- **TimePicker (reloj)**: lectura grande «10:00» con la hora o los minutos activos, cambio a. m./p. m., carátula de 12 horas. Elegir hora pasa solo a minutos (00, 15, 30, 45); elegir minutos cierra. El anillo exterior dibuja la duración de la clase (arco sumi; bermellón si choca) y las clases ocupadas de esos días (arcos bermellón suave). Jornada 8:00 a. m.–9:00 p. m. contando la duración: las horas fuera de la jornada van atenuadas; las que chocan en sus cuatro cuartos van tachadas y no se eligen; si solo algunos cuartos están libres, se toma el primero libre. Nota en texto: «Ocupado: Prepa 5:00–6:30 p. m. (mar)». Pie: rango y «Horario libre» o «Choca con otra clase».
- **RepeatPicker**: ver §5.
- **Switch** dentro de un aviso de alcance: «Incluir grupos archivados» (ver §7).
- **BottomSheet**, **FieldRow**, **ListRow**, **AttendanceRing** (jade desde 80 %, bermellón abajo).
- **StudentAvatar**: ocho animales; usa `recursos/StudentAvatar.jsx` (el pingüino no cambia).

## 3. Clases

- **Próxima clase** (escritorio y móvil): lista de alumnos con P/A sin marcar, pago por alumno (✓ – ×) sin elegir, calificación si hay tarea, interruptor de tarea, resumen dinámico («2 presentes · 1 ausente · Faltan 2»). El botón Guardar clase se habilita según las reglas actuales de validación.
- **Calendario**: mes con estados por clase (Completada, Sin registrar, Próxima, Programada) y panel del día elegido. En móvil, cuadrícula con puntos y la clase en una hoja.
- **Historial**: agrupado por semana, con filtros por grupo, KPIs y fila expandible con asistencia, calificación y pago por alumno.
- **Nueva clase** (panel en escritorio, hoja en móvil): Frecuencia (Única/Recurrente), Formato (Grupo/Individual), grupo o alumno (SelectMenu), fecha (DatePicker), hora (TimePicker), duración libre en pasos de 15 min (− / +, también escribible), Repetir (RepeatPicker; los días solo se muestran en semanal), vista de la semana donde la clase se arrastra y se estira, aviso de choque con hasta dos sugerencias, y el **precio por hora editable** (por grupo o por alumno) con «Restaurar» si se cambió.

## 4. Inicio

- Saludo, línea de tiempo del día con «Ahora», tarjeta de la próxima clase con alumnos y avisos («Luna faltó a 2 de sus últimas 3»), y el botón Registrar clase.
- **Para atender**: cosas accionables (clase sin registrar, asistencia bajo 80 %, calificación baja, pagos vencidos, mensualidades que vencen hoy).
- **Tu periodo**: Hoy / Semanal / Mensual / Anual con tres métricas (asistencia, calificación, cobros) que se exploran tocando puntos o barras.
- **Interruptor de archivados** en el bloque del periodo (§7).
- Móvil: agenda vertical, «Para atender» en lista y métricas con mini gráfica; el detalle de cada cifra sube en una hoja.

## 5. Repetición de clases

Modelo propuesto (opcional dentro de la clase o plantilla recurrente):

```js
recurrence: {
  kind: "daily" | "weekly" | "monthly",
  interval: 1,                 // cada N días (1–14), semanas (1–8) o meses (1–12)
  days: [2, 5],                // solo weekly: 0 = domingo … 6 = sábado
  dailyMode: "all" | "weekdays", // solo daily: todos o lunes a viernes
  monthlyMode: "dayOfMonth" | "nthWeekday", // solo monthly
  startDate: "2026-10-17"
}
```

- **Mensual por día del mes**: si el mes no tiene ese día (31), ese mes se salta.
- **Mensual por N.º día de la semana**: «el 3.er sábado» se toma de la fecha de inicio; si la fecha cae en una quinta semana, se guarda como «el último sábado».
- La etiqueta del disparador resume todo: «Cada semana · mar y vie», «Cada 2 días · lun a vie», «Cada mes · el 3.er sábado». El menú muestra siempre las próximas 4 fechas.
- Compatibilidad: lo que hoy es «repetir cada N semanas» equivale a `kind: "weekly", interval: N`.

## 6. Cobro mensual

Hoy cada clase cobra por hora (`customHourlyRate` del alumno → `hourlyRate` del grupo → `hourlyRate` general). Se agrega, de forma opcional y retrocompatible:

```js
group.billing = {
  mode: "perClass" | "monthly",          // ausente = perClass (comportamiento actual)
  monthlyFee: 1200,
  due: { type: "dayOfMonth", day: 5 }     // del 1 al 28
     | { type: "nthClass", nth: 1 | 2 | 3 | 4 | "last" },
  effectiveFrom: "2026-11"                // mes en que empieza a cobrar por mes
}
student.billingByGroup[groupId] = { mode: "group" | "customFee" | "perClass", fee: 1000 }
monthlyCharges: [{ id, studentId, groupId, period: "2026-10", amount, dueDate, status: "pending" | "paid", paidAt, prorated: false }]
```

Reglas:
- Cuánto paga cada alumno = su ajuste en ese grupo, si lo tiene; si no, el modo del grupo.
- La cuota es fija: no cambia por faltas ni festivos.
- **Vencimiento**: «el día X» o «en la N.ª clase del mes», contada sobre el horario real del grupo (en un grupo de sábados, la 3.ª clase es el tercer sábado). Si una clase se cancela, cuenta la siguiente; si el mes trae menos clases, vence en la última.
- **Estado**: Pendiente hasta la fecha de vencimiento; Vencido después; Pagada al marcarla (guarda `paidAt`).
- **Alumno que entra a mitad de mes**, el profe elige: mes completo, proporcional a las clases que quedan, o desde el próximo mes.
- **Cambiar un grupo existente de por clase a mensual**, el profe elige al guardar: desde el próximo mes, o desde este mes descontando lo ya cobrado por clase (la pantalla muestra la cuenta por alumno).
- En **Registrar clase**, los alumnos con mensualidad no muestran ✓ – ×: muestran el estado de su mensualidad («Octubre pagado · 5 oct» o «Octubre · $1,200 · vence hoy» con «Marcar pagada»). Su registro de clase lleva cargo $0. Los alumnos «por clase» dentro de un grupo mensual siguen igual que hoy.
- **Seguimiento › Pagos**: bloque «Mensualidades · octubre» por grupo, con el avance («2 de 4 pagadas», monto cobrado de esperado) y «Marcar pagada» / «Deshacer» por alumno.
- **Inicio**: una mensualidad que vence hoy o está vencida entra en «Para atender».
- **Proyección del mes**: suma las cuotas de los grupos mensuales y estima por clase el resto.
- Un grupo archivado deja de generar mensualidades.
- La forma de cobro se edita en la ficha del grupo con `FieldRow`: Forma de cobro, Tarifa o Cuota (con «Sugerida $1,350 (9 clases × $150) · Usar»), Vence, Alumnos con ajuste y «Aplicar desde».

## 7. Grupos archivados

Ya está la lógica en `src/domain/groupArchiving.js` y `ArchivedGroupsScope.jsx` (PR #30). Diseño:
- Comunidad: sección «Archivados» plegable; ficha del grupo archivado en kraft con «Reactivar grupo», historial y saldo pendiente.
- Confirmación al archivar: qué se conserva, que salen sus clases de la agenda y el aviso de saldo pendiente.
- Inicio y Seguimiento: interruptor «Incluir grupos archivados» dentro de un aviso de alcance; apagado dice «1 grupo archivado queda fuera de estas cifras» y «Saldo en archivados: $150»; encendido, «Incluye Inglés · conversación (archivado) solo durante esta sesión». Dura solo la sesión y cambia las cifras de verdad.

## 8. Comunidad, Seguimiento y Configuración

- **Comunidad**: alumnos ordenados «Con pendientes» primero; grupos con anillo de asistencia y línea de cobro; ficha del alumno (asistencia, promedio, pagos, últimas clases, contacto) y ficha del grupo (asistencia por clase, directorio, datos y forma de cobro). En móvil, todo en hojas.
- **Seguimiento**: pestañas Calificaciones · Asistencia · Pagos, Resumen/Desglose, alcance por grupo, KPIs que filtran la lista, gráfica que filtra la lista al tocar, historial del alumno y Exportar Excel. Periodo con `SelectMenu` («Este mes · octubre», «Esta semana»).
- **Configuración**: secciones con su valor actual a la vista (valores de clase, tutorial, interfaz, respaldos, privacidad) y la explicación de qué cambia con esos valores.

## 9. Acceso y tutorial

- Inicio de sesión con el logo horizontal, Google y correo.
- Tutorial en tres pasos: Grupo (días, hora, **duración libre** con − / + y **forma de cobro**), Alumnos (cada uno con su animal, que se puede cambiar) y Agenda (resumen con la tarifa). Más el recorrido guiado con resaltado.
