# Rediseño v2 · fase 1

La base se implementa directamente en `main`, por indicación del usuario. Punto de partida: `413f91f`. El paquete original de Descargas se conserva en `docs/rediseno-v2/` como referencia; sus HTML y sus datos de demostración no se importan en la aplicación.

## Componentes

- `SelectMenu` extiende el mismo control de `Select`, `MultiSelect`, `GroupSelect` y `StudentSelect`: búsqueda sin acentos desde ocho opciones, contexto y metadatos, teclado, opciones deshabilitadas y cierre exterior.
- `DatePicker` y `TimePicker` sustituyen los controles nativos a través de `Input`, conservando los contratos `value` y `onChange`. El adaptador admite el `onInput` usado por la fecha de consulta de Seguimiento.
- `RepeatPicker` incluye diario, semanal y mensual, con límites de intervalo y cuatro fechas de vista previa. Nueva clase utiliza su modalidad semanal, que es la que entiende actualmente la persistencia. El guardado diario y mensual corresponde a la fase 2.
- `BottomSheet` comparte con `Drawer` el manejo de foco, fondo inerte, desplazamiento e historial. Los selectores móviles se abren en una segunda hoja. Incluye volver, expansión y cierre deslizando el asa; en escritorio el componente se presenta como cajón.
- `Switch` se reutiliza en `ArchivedGroupsScope`; `FieldRow`, `ListRow` y `AttendanceRing` quedan disponibles desde `ui.jsx`.
- Los ocho avatares conservan sus identificadores. Se usa el dibujo entregado, incluido el pingüino original, con los cinco fondos del sistema.

Los tokens y las fuentes están en `src/design-system.css`. Las fuentes de Google Fonts se sirven localmente desde `public/fonts/`, con sus licencias OFL. Las clases nuevas están en `src/components/base-components.css` y mantienen los nombres de `componentes.css`.

## Datos y compatibilidad

No hay cambios en Supabase, el workspace JSONB revisionado, E2EE, importaciones, semillas ni SQL. No se agregan campos persistidos en esta fase. Las fechas siguen siendo `YYYY-MM-DD`; las horas, `HH:mm`; el domingo de los horarios existentes sigue siendo `7`.

Los modelos puros de `src/domain/pickerModels.js` normalizan los valores de los selectores y generan vistas previas. El adaptador semanal conserva el anclaje de las series existentes; las nuevas opciones mensuales omiten meses sin el día solicitado y consideran la quinta ocurrencia como el último día de la semana.

Decisión confirmada: se mantienen las fechas pasadas para registros históricos, correcciones y filtros. El calendario de Nueva clase impide seleccionar fechas anteriores a la fecha de referencia de la aplicación.

Decisión pendiente: si se limita la programación a 8:00–21:00 contando la duración, o si se conserva la jornada sin límite. El reloj admite ambos casos. Sus valores por defecto siguen la especificación; los adaptadores de formularios conservan los horarios existentes hasta resolver esta consulta. No se alteran ni redondean automáticamente las horas guardadas.

## Verificación y revisión

```sh
pnpm quality
pnpm test:e2e --workers=2
pnpm dev
```

Las pruebas nuevas cubren recurrencias y meses incompletos, compatibilidad semanal, disponibilidad por cuartos, duración, días del calendario, teclado, traducciones, controles deshabilitados, hojas anidadas, avatares y el flujo real de programación en escritorio y móvil. Los escenarios E2E utilizan datos sintéticos propios de las pruebas, únicamente en almacenamiento local.

Para revisar: Clases → Nueva clase → fecha, hora y Repetir; Comunidad → Crear grupo → días y hora; Inicio → filtro de asistencia; Seguimiento → fecha de consulta y alcance de archivados. Las pantallas completas se rediseñan en sus fases correspondientes.
