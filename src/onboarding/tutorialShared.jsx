/** The tutorial's sample class: four students, $280 per class. Nothing of it is ever saved. */
export const SAMPLE_PRICE = 280;
export const SAMPLE_STUDENTS = Object.freeze([
  { id: "emilio", name: "Emilio Castro", short: "Emilio", avatarId: "penguin", owes: true },
  { id: "iker", name: "Iker Morales", short: "Iker", avatarId: "dog", owes: true },
  { id: "renata", name: "Renata Ortiz", short: "Renata", avatarId: "frog", owes: false },
  { id: "ximena", name: "Ximena Flores", short: "Ximena", avatarId: "rabbit", owes: false },
]);

/**
 * The stamp cat, drawn inline so it can move: `wave` raises a paw, `happy` smiles, `sleep` nods off,
 * `thump` lands with a bounce. Always decorative.
 */
export function TutorialCat({ mood = "", size = 58 }) {
  return (
    <svg
      className={`tt-cat ${mood}`.trim()}
      style={{ width: size, height: size }}
      viewBox="0 0 120 120"
      aria-hidden="true"
      focusable="false"
    >
      <circle className="tt-cat-ring" cx="60" cy="60" r="56" />
      <circle className="tt-cat-disc" cx="60" cy="60" r="48" />
      <path className="tt-cat-white" d="M34 104 Q34 78 60 78 Q86 78 86 104 Z" />
      <g className="tt-cat-head">
        <path
          className="tt-cat-white"
          d="M40 62 L42 32 L56 45 Q60 44 64 45 L78 32 L80 62 Q82 80 60 80 Q38 80 40 62 Z"
        />
        <path className="tt-cat-eyes" d="M48 62 q4 4 8 0 M64 62 q4 4 8 0" />
      </g>
      <ellipse className="tt-cat-paw" cx="90" cy="72" rx="8" ry="10" />
    </svg>
  );
}

/** The paw that points where to tap. */
export function TapPaw({ className = "" }) {
  return (
    <svg className={`tt-paw ${className}`.trim()} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M12 12.5c-3 0-5.2 2.6-5.2 4.9 0 1.6 1.2 2.6 2.7 2.6 1 0 1.7-.5 2.5-.5s1.5.5 2.5.5c1.5 0 2.7-1 2.7-2.6 0-2.3-2.2-4.9-5.2-4.9zM3.3 11.5a2.2 2.7 0 1 0 4.4 0a2.2 2.7 0 1 0-4.4 0zM7.3 6.8a2.2 2.7 0 1 0 4.4 0a2.2 2.7 0 1 0-4.4 0zM12.3 6.8a2.2 2.7 0 1 0 4.4 0a2.2 2.7 0 1 0-4.4 0zM16.3 11.5a2.2 2.7 0 1 0 4.4 0a2.2 2.7 0 1 0-4.4 0z" />
    </svg>
  );
}
