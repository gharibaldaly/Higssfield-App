/**
 * Deep, softly moving ambient background behind the glass panels. Pure CSS
 * (GPU transforms only); animations stop under prefers-reduced-motion.
 */
export function AmbientBackground() {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 -z-0 overflow-hidden bg-(--ambient-base)"
    >
      <div className="absolute -top-1/3 -left-1/4 size-[70vmax] animate-drift-a rounded-full bg-[radial-gradient(circle_at_center,var(--ambient-a),transparent_62%)] blur-3xl" />
      <div className="absolute -right-1/4 -bottom-1/3 size-[65vmax] animate-drift-b rounded-full bg-[radial-gradient(circle_at_center,var(--ambient-b),transparent_60%)] blur-3xl" />
      <div className="absolute top-1/4 left-1/3 size-[45vmax] animate-drift-c rounded-full bg-[radial-gradient(circle_at_center,var(--ambient-c),transparent_65%)] blur-3xl" />
      <div
        className="absolute inset-0 opacity-[0.035] mix-blend-overlay dark:opacity-[0.06]"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>\")",
        }}
      />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,transparent_40%,color-mix(in_srgb,var(--ambient-base)_70%,transparent))]" />
    </div>
  );
}
