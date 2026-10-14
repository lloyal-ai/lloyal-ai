export function Chevron({ up = false }: { up?: boolean }) {
  return (
    <svg
      className="gc-chevron"
      viewBox="0 0 16 16"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d={up ? "m4 10 4-4 4 4" : "m4 6 4 4 4-4"}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
