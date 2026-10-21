# Hibi · rediseño para implementar

Paquete de traspaso del rediseño «Sello sereno» (lienzo «Hibi — Identidad y rediseño»), listo para que Claude Code lo implemente en `erickxsan/hibi`.

## Qué hay aquí

| Carpeta / archivo | Para qué sirve |
|---|---|
| `PROMPT-claude-code.md` | El mensaje para pegar en Claude Code. Empieza por aquí. |
| `ESPECIFICACION.md` | Reglas, comportamiento de cada pantalla y la lógica nueva (cobro mensual, repetición, reloj, archivados). |
| `PANTALLAS.md` | Mapa: cada pantalla con su captura, su HTML de diseño y el archivo del código donde vive hoy. |
| `capturas/` | 52 capturas PNG, a tamaño real (escritorio 1440 px; móvil 390 px a 2×). |
| `pantallas-html/` | El HTML de cada pantalla del lienzo: estructura, CSS exacto y una lógica de demostración en JavaScript que muestra el comportamiento esperado. **No se copia tal cual**: es la referencia visual y de interacción. Los datos son ficticios. |
| `sistema-de-diseno/` | Guía de marca (`README.md`), tokens (`tokens.json`), la hoja de estilos de los componentes (`componentes.css`) y la guía de cada componente (`componentes/*.md`). |
| `recursos/` | Logo horizontal, sello y sello plano (los mismos que muestran las pantallas) y `StudentAvatar.jsx` con los avatares nuevos. |

La mascota se queda como está hoy en el código: no forma parte de esta entrega.

## Cómo usarlo con Claude Code

1. Descomprime esta carpeta dentro del repositorio, en `docs/rediseno-v2/`. Así Claude Code la lee como parte del proyecto.
2. Crea una rama, por ejemplo `git switch -c rediseno-v2`.
3. Abre Claude Code en la raíz del repositorio y pega el contenido de `PROMPT-claude-code.md`.
4. Pídele que avance **una fase a la vez** (vienen en el prompt). Al terminar cada una, que corra `pnpm quality`, y revisa en `pnpm dev` comparando con las capturas antes de seguir.
5. Un PR por fase facilita revisar y, si algo falla, regresar.

## Cosas que conviene saber

- El repo ya tiene reglas en `docs/REDESIGN_INTEGRATION.md`: nada de datos de demostración en producción, conservar la semántica de datos, y que los campos nuevos sean opcionales (sin migración SQL). El prompt le pide a Claude Code respetarlas.
- Los HTML usan un motor de plantillas del lienzo (`{{...}}`, `<sc-for>`, `<sc-if>`) y no abren solos en el navegador. Para ver la interacción, ábrelos en el lienzo; para el código, léelos aquí.
- Los textos de las pantallas ya están en español y en el tono de Hibi.
