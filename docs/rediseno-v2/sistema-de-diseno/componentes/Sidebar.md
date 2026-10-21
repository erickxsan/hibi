Marco de la app en escritorio: menú lateral con logo, cinco secciones y el gato sello al pie, más la barra superior con el estado de sincronización.

**Código:** `AppShell` en `src/components/AppShell.jsx`; clases `.hibi-sidebar`, `.hibi-brand`, `.sidebar-nav`, `.sidebar-link`, `.sidebar-companion`, `.hibi-topbar`.

**Estructura:** menú de `sidebar-width` en `papel` con borde `line`; logo horizontal (`assets/Logos/hibi-logo-horizontal.svg`, 40 px de alto) en lugar de «Hibi★» en Georgia; enlaces de 44 px con ícono Lucide de 20 px; la sección activa lleva fondo `bermellon-soft`, texto 800 e ícono `bermellon-strong`. Al pie, `gato-sello.svg` a 64 px girado −8° con la frase de ánimo en `sumi-muted`, sin emoji. Barra superior de `topbar-height` en `papel` con `SyncPill` a la derecha («Sincronizado», o «Solo local» en `kraft`).

**El consumidor aporta:** las cinco secciones (Inicio, Comunidad, Clases, Seguimiento, Configuración) en ese orden, la activa y el estado de sincronización.

**No hacer:** agregar secciones o botones al menú; mostrar el gato en la tarjeta «Clases de hoy» además del pie del menú.
