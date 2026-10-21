Hoja que sube desde abajo: el detalle de algo que se tocó en móvil (un alumno, un grupo, una barra de la gráfica, un ajuste) sin salir de la pantalla.

**Código:** se usa en las vistas móviles en lugar del `Drawer`; clases `.bottom-sheet-layer`, `.bottom-sheet-scrim`, `.bottom-sheet`, `.bottom-sheet-grab`, `.bottom-sheet-header`, `.bottom-sheet-kicker`, `.bottom-sheet-close` y el modificador `.is-expanded`.

**Estilo:** velo `overlay`; hoja en `papel` con esquinas superiores de 20 px, ancho completo del teléfono y alto máximo de 82 % (94 % expandida). Arriba, el asa (36 × 4 px en `line-control`) que expande o reduce. Encabezado: clave en `caption` mayúsculas `sumi-muted` (o el color del estado: «Vence hoy» en `ocre-ink`), título `section-title` de 22 px y una línea en `sumi-muted`; botón de cerrar redondo en `washi`. Entra con un deslizamiento de 350 ms y el velo con un fundido.

**Comportamiento:** se cierra con el velo, con la ✕, deslizando hacia abajo y con Atrás del teléfono. Una hoja puede llevar a otra (de una barra de asistencia a la ficha de un alumno) con «Volver» en el encabezado, nunca más de dos niveles.

**El consumidor aporta:** clave, título, subtítulo, el contenido (cifras, lista corta, nota) y como máximo una acción, a todo lo ancho: `primary` solo si es la acción de la pantalla («Registrar clase»), si no `secondary` («Abrir en Seguimiento»).

**No hacer:** formularios largos en una hoja (usa una pantalla); dos acciones principales; hojas en escritorio (ahí se usa `Drawer` o el panel lateral).
