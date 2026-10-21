# Prompt para Claude Code

Copia todo lo que está debajo de la línea y pégalo en Claude Code, abierto en la raíz de `erickxsan/hibi`, con esta carpeta en `docs/rediseno-v2/`.

---

Vamos a implementar el rediseño de Hibi que está en `docs/rediseno-v2/`. Antes de escribir código:

1. Lee `docs/rediseno-v2/LEEME.md`, `ESPECIFICACION.md` y `PANTALLAS.md`, y `docs/REDESIGN_INTEGRATION.md`.
2. Lee la guía `docs/rediseno-v2/sistema-de-diseno/README.md`, `tokens.json`, `componentes.css` y las guías de `componentes/*.md`.
3. Para cada pantalla, mira su captura en `capturas/` y lee su HTML en `pantallas-html/`: ahí están el CSS exacto, el marcado y una lógica de demostración que muestra cómo debe comportarse. Los datos de esos archivos son ficticios: no los copies al código ni a la semilla.

Reglas:
- Respeta `docs/REDESIGN_INTEGRATION.md`: no cambies la persistencia (Supabase, workspace JSONB revisionado, E2EE), conserva los IDs y la semántica de datos, y agrega campos nuevos solo como opcionales, normalizados en la capa de dominio (`src/domain`). Sin migraciones SQL.
- Reutiliza los componentes existentes (`src/components/ui.jsx`, `AppShell.jsx`, `StudentAvatar.jsx`, `SelectControl.jsx`, `ArchivedGroupsScope.jsx`) y extiéndelos; no dupliques.
- Los tokens van en `src/design-system.css`; los estilos de componentes nuevos, con los mismos nombres de clase que `componentes.css`.
- Toda cadena visible pasa por `src/i18n` (español e inglés).
- Cada fase termina con `pnpm quality` en verde y pruebas nuevas para la lógica (modelos y dominio) y para los componentes con interacción.
- Antes de empezar cada fase, dime en una lista corta qué archivos vas a tocar y qué decisiones de datos tomarás. Si algo del diseño choca con el comportamiento actual de producción, pregúntame en vez de adivinar.

Fases (haz una, me la enseñas y seguimos):
1. **Base**: tokens; componentes `SelectMenu`, `DatePicker`, `TimePicker` (reloj), `RepeatPicker`, `Switch`, `BottomSheet`, `FieldRow`, `ListRow`, `AttendanceRing`; avatares nuevos (`docs/rediseno-v2/recursos/StudentAvatar.jsx`). Reemplaza todos los `<select>`, `<input type="date">` y `<input type="time">` de la interfaz por estos componentes.
2. **Clases**: Próxima clase (todo empieza sin marcar), Calendario, Historial, Nueva clase con los selectores nuevos y la repetición diaria/semanal/mensual, y Registrar clase en móvil.
3. **Inicio**: escritorio y móvil, con «Para atender», métricas y el interruptor «Incluir grupos archivados».
4. **Comunidad**: alumnos, grupos (anillo de asistencia), ficha de grupo, archivar y reactivar, y las hojas de móvil.
5. **Seguimiento**: pestañas, gráficas ligadas a la lista, desglose e interruptor de archivados.
6. **Cobro mensual**: el modelo de datos de `ESPECIFICACION.md`, la forma de cobro en el grupo, Registrar clase de un grupo mensual, mensualidades en Seguimiento › Pagos y el aviso en Inicio.
7. **Configuración, acceso y tutorial.**

Empieza por la fase 1.
