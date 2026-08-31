/**
 * Flat, geometric logo mark (Frontend Spec §4) — a minimal leaf with a
 * water-drop vein and a blossom accent. Rendered as a flat SVG in the palette
 * colors; deliberately NOT an orb, sphere, blob, or any organic/3D character.
 * This is the single brand mark used on the sidebar header, the home top nav,
 * and anywhere a Kycelius wordmark appears.
 */
export function LogoMark({ size = 40, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden
    >
      <path
        d="M24 5C24 5 11.5 16 11.5 28.5A12.5 12.5 0 0 0 24 41 12.5 12.5 0 0 0 36.5 28.5C36.5 16 24 5 24 5Z"
        fill="#4E8B4A"
      />
      <path d="M24 5v36" stroke="#DCEFFB" strokeWidth="3" strokeLinecap="round" />
      <path d="M24 25c-6.5 0-10.5-4-11.5-9" stroke="#DCEFFB" strokeWidth="2.5" strokeLinecap="round" opacity="0.65" />
      <path d="M24 31c6 0 10-3.5 11-8" stroke="#DCEFFB" strokeWidth="2.5" strokeLinecap="round" opacity="0.65" />
      <circle cx="24" cy="3.5" r="3" fill="#D9709F" />
    </svg>
  );
}

export default LogoMark;