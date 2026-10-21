Hibi es la libreta de trabajo de quien da clases por su cuenta: alumnos, grupos, asistencia, calificaciones y cobros, en un solo lugar y sin ruido. Su firma es un **sello bermellón con orejas de gato**: el gesto de marcar que algo quedó hecho, día a día (日々, *hibi*). Esta guía es la dirección «Sello sereno»: una herramienta seria para profesores, con una sola nota cálida.

## Principios

1. **Herramienta antes que adorno.** Cada pantalla responde qué toca hoy y qué falta cerrar. La marca aparece en el logo, en la acción principal y en los logros; nunca compite con los datos.
2. **Una sola nota viva.** `bermellon` es la firma. Índigo y jade explican datos; ocre solo marca lo pendiente. Todo lo demás es papel y tinta negra.
3. **Proporción de tinta.** Aproximadamente 72 % papel (`washi`, `papel`), 16 % tinta (`sumi`), 7 % bermellón y 5 % tintas de apoyo. Si una pantalla se siente infantil, sobra color.
4. **Cálida en las palabras, sobria en la forma.** El tono amable vive en el texto («¡Buenos días, profe!»), no en ilustraciones ni emojis.

## Contenido y voz

- Habla de **tú** y dile **profe** a quien usa la app. Frases cortas, en positivo, sin tecnicismos: «Registra asistencia, pago y calificación por alumno».
- Saludo y ánimo con mesura: un saludo por pantalla de Inicio y una frase de ánimo por tarjeta de métrica («Muy estable. ¡Sigue así!»). Nada de signos de exclamación en botones ni en errores.
- Botones con verbo + objeto: «Guardar clase», «Agregar alumno», «Crear grupo», «Marcar cancelada». Nunca «Aceptar» o «Enviar» sueltos.
- Estados con una palabra: Pagado, Pendiente, Vencido, Completada, Programada, Activo, Inactivo, Archivado. Una mensualidad es «Pagada» o «Pendiente» hasta su fecha y «Vencida» después; en la línea de contexto se dice cuándo: «vence hoy», «pagó el 5».
- Cifras en pesos con el formato de México: `$2,395`, `9.0 /10`, `100%`. Fechas cortas: «mar 13 de oct, 5:00 p. m.».
- **Sin emojis** en la interfaz. La hoja 🌿 que acompaña a los títulos hoy se elimina: la calidez la da el sello.
- Todo texto de la interfaz va en el idioma elegido; ninguna cadena en inglés cuando la app está en español.

## Color

- Fondo de la app: `washi`. Tarjetas, menú lateral, barra superior, cajones y campos: `papel`, con borde `line` y `shadow-card`.
- Texto: `sumi` para lo principal, `sumi-muted` para lo secundario. `sumi-subtle` nunca es texto.
- **Bermellón**: `bermellon` para el logo, la mascota y los sellos de logro; `bermellon-strong` para el botón principal (uno por pantalla) y los enlaces; `bermellon-soft` marca la sección activa del menú. Errores y «Vencido»: `bermellon-ink` sobre `bermellon-soft`.
- **Datos**: asistencia en `jade`, calificaciones y clases en `indigo`. Texto positivo en `jade-strong`; `jade` solo en trazos y puntos.
- **Pendiente**: punto `ocre`, texto `ocre-ink` sobre `ocre-soft`. El ocre nunca es texto.
- Elección en controles segmentados (periodo, Grupo/Alumno, P): relleno `sumi` con texto `papel`.
- Foco: anillo `focus` de 2 px con 2 px de separación en todo control.
- Los estados siempre llevan palabra además del color; Pagado y Vencido también difieren en luminosidad.

## Tipografía

- `display` (Dela Gothic One) solo para la marca: títulos de página (`page-title`, `page-title-mobile`) y momentos del tutorial (`dialog-title`). Nunca en tarjetas, tablas ni botones.
- `sans` (Albert Sans) para todo lo demás: `section-title` en títulos de tarjeta, `card-title` en métricas, `body` en texto, `control` en botones, pestañas y menú, `small` en metadatos y `caption` para claves y encabezados de tabla (12 px es el mínimo).
- Cifras con `metric-xl`, `metric-md` o `metric-sm` y números tabulares.
- Las dos familias se cargan de Google Fonts (`Dela Gothic One`; `Albert Sans` 400–800). Reemplazan a Georgia y Nunito Sans del código actual.

## Espacio, forma y profundidad

- Escala de 4 px: `space-1` a `space-12`. Tarjetas con padding `space-6` y separadas por `space-6` (`space-4` en móvil). Área principal: `space-10` arriba y `space-12` a los lados en escritorio.
- Esquinas: `radius-md` en botones y campos, `radius-lg` en tarjetas, `radius-xl` en cajones y diálogos, `radius-sm` en las opciones P/A y ✓ – ×, `radius-pill` en estados.
- Profundidad casi plana: `shadow-card` en tarjetas, `shadow-overlay` solo en lo que flota (cajones, diálogos, menús, avisos).
- Controles de al menos `control-height` (44 px). Opciones dentro de filas: `segment-height`.
- Escritorio: menú lateral de `sidebar-width` y barra superior de `topbar-height`. Por debajo de 780 px el menú pasa a la barra inferior (`MobileNav`).

## Móvil

- Una sola columna y listas antes que tarjetas: `ListRow` con avatar, una línea de contexto y una cifra. Lo que requiere atención va primero.
- El detalle no abre otra pantalla: sube en una `BottomSheet` (alumno, grupo, barra de una gráfica, un ajuste). Como máximo dos niveles, con «Volver».
- Una acción principal por pantalla, a todo lo ancho; en Registrar clase vive en una barra fija abajo con el avance («3 de 5 marcados»).
- Pasar lista con P / A grandes (48 px). Cada clase empieza sin marcar.
- Formularios cortos con `FieldRow`; por debajo de 520 px la etiqueta pasa arriba del control.
- Nunca el `<select>`, el calendario ni el reloj del navegador: se usan `SelectMenu`, `DatePicker` y `TimePicker`. En una hoja, grupo, alumno, fecha y hora suben en una segunda hoja con «‹ Volver».

## Cobro por clase y mensual

- Cada grupo cobra **por clase** (precio por hora × duración) o **mensual** (cuota fija). Cada alumno puede seguir la regla del grupo, tener otra cuota o pagar por clase.
- La mensualidad vence «el día X» o «en la N.ª clase» del mes, contada sobre el horario real del grupo.
- En Inicio, una mensualidad que vence hoy o vencida aparece en «Para atender»; en Seguimiento › Pagos se muestra el avance del mes («2 de 4 pagadas») con «Marcar pagada» como acción secundaria por alumno.
- En Registrar clase, el alumno con mensualidad no muestra el trío ✓ – ×: muestra el estado de su mensualidad.

## Grupos archivados

- Archivar conserva todo el historial y saca las clases de la agenda. Un grupo archivado se ve en `kraft` con el estado «Archivado».
- Inicio y Seguimiento lo excluyen por defecto; el interruptor «Incluir grupos archivados» (`Switch` dentro de un aviso de alcance) lo suma solo durante la sesión y avisa si queda saldo pendiente.

## Logo y mascota

- **Sello** (`assets/Logos/hibi-sello.svg`): «hi» sobre «bi» calados en un cuadro bermellón con dos orejas. Es el ícono de la app y el logo en espacios cuadrados. Úsalo en `bermellon` con el calado en `washi`; sobre fondo oscuro, `hibi-sello-sumi.svg`.
- **Logo horizontal** (`hibi-logo-horizontal.svg`): sello + «hibi» en `sumi`. Es el de la barra lateral y del inicio de sesión. Sobre `sumi`, la versión `-inverso`.
- **Textura de tinta**: solo en el sello a 40 px o más, en la mascota y en los sellos de logro. Debajo de 40 px, `hibi-sello-plano.svg`; a 32 px, `hibi-favicon.svg` («h»); a 16 px, `hibi-favicon-16.svg` (solo la silueta).
- Nunca cambiar la tinta del logo, girarlo, ni separar las orejas del cuadro. Espacio libre alrededor: la altura de una oreja.
- **Mascota** (`assets/Mascota/gato-sello.svg`): el gato es un sello redondo, no un personaje. Aparece en la bienvenida, en los estados vacíos y en el pie del menú lateral, girado −8°. Sustituye a los gatos de acuarela actuales (`hibi-companion.png` y las ilustraciones del tutorial).
- **Sellos de logro** (`sello-excelente.svg`, `sello-mes-cobrado.svg`): solo en hitos reales (calificación perfecta, mes cobrado). Como máximo uno visible por pantalla.

## Iconografía

- Íconos de **Lucide** (ya instalado en el código, `lucide-react`), trazo 1.8 y 20 px en menú y botones; 18 px dentro de botones; trazo 2.4 en las opciones ✓ – ×.
- Íconos en `sumi`; el ícono de la sección activa en `bermellon-strong`. Sin rellenos de color detrás de los íconos del menú.
- Íconos del menú: `house` Inicio, `users-round` Comunidad, `calendar-days` Clases, `chart-column` Seguimiento, `settings` Configuración.
- Avatares de alumnos: las ocho caras de animal de `StudentAvatar` (gato, perro, pingüino, zorro, conejo, oso, rana, búho), dibujadas en `sumi` sobre un fondo suave (`indigo-soft`, `jade-soft`, `ocre-soft`, `bermellon-soft` o `kraft`). Son tiernas pero sobrias: cabezas redondas, ojos de punto, boca en «w» y mejillas al 16 %; nada de accesorios ni colores extra.

## Del código actual a este sistema

| Variable o fuente actual | Token nuevo |
| --- | --- |
| `--hibi-canvas`, `--canvas` | `washi` |
| `--hibi-surface`, `--surface` | `papel` |
| `--hibi-forest`, `--hibi-forest-dark` (acción) | `bermellon-strong` |
| `--hibi-forest` (subrayado de pestaña activa) | `bermellon` |
| `--hibi-sage` (opción elegida, sección activa) | `sumi` en segmentados; `bermellon-soft` en el menú |
| `--hibi-text`, `--ink` | `sumi` |
| `--hibi-muted`, `--muted` | `sumi-muted` |
| `--hibi-border`, `--border` | `line` (tarjetas) y `line-control` (campos) |
| `--teal`, `--olive` (positivo, pagado) | `jade` / `jade-strong` |
| `--mustard` (pendiente) | `ocre` / `ocre-ink` |
| `--coral`, `--danger` (vencido, error) | `bermellon-ink` / `bermellon-soft` |
| `--blue`, `--lilac` (datos) | `indigo` / `indigo-soft` |
| `--pink`, `--hibi-peach`, `--hibi-lilac` | se retiran |
| `--hibi-card-radius` 16px | `radius-lg` 12px |
| `--hibi-control-radius` 12px | `radius-md` 10px |
| Georgia (títulos), Nunito Sans | `display`, `sans` |

## Componentes

Cada componente de esta guía corresponde a uno del código (`src/components/ui.jsx`, `AppShell.jsx`, `StudentAvatar.jsx` y los controles de `features/`) y usa sus mismos nombres de clase. Las vistas previas son reproducciones estáticas del estilo nuevo: no ejecutan el código de la app.
