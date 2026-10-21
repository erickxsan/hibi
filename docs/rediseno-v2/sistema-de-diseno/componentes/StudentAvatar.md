Avatar de alumno: una de las ocho caras de animal de Hibi, en trazo `sumi` sobre un fondo suave, con un gesto tierno pero sobrio.

**Código:** `StudentAvatar` y `AvatarPicker` en `src/components/StudentAvatar.jsx` (`avatarId`: cat, dog, penguin, fox, rabbit, bear, frog, owl; respaldo: cat); clases `.student-animal-avatar .avatar-tone-<tono> .avatar-size-<tamaño>`.

**Estilo:** cuadro redondeado (12 px; 18 px en tamaño grande), no círculo, para hacer eco del sello. Cabezas redondeadas, trazo `sumi` de 2 px, ojos de 1.8 px rellenos, nariz de punto y boca en «w». Las mejillas son elipses en `currentColor` al 16 % de opacidad: dan calidez sin agregar color. El búho lleva ojos grandes con pupila, penachos cortos y patitas; el pingüino conserva su dibujo original (cuerpo ovalado y pecho), que es la referencia de proporción del resto.

**Fondos:** gato y pingüino `indigo-soft`; zorro y búho `ocre-soft`; conejo `bermellon-soft`; rana `jade-soft`; perro y oso `kraft`. Un alumno puede tener otro de los cinco fondos si dos alumnos del mismo grupo comparten animal.

**El consumidor aporta:** `avatarId`, el nombre del alumno para el `aria-label` (o `aria-hidden` si el nombre ya está al lado) y el tamaño: 34–40 px en listas, 72 px en la ficha.

**No hacer:** avatares con iniciales cuando existe un animal elegido; colores fuera de los cinco fondos; rellenar la cara completa o añadir accesorios.
