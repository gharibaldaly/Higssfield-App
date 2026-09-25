/**
 * Runs each time a studio section opens: a sheer veil sweeps across while the page rises in.
 * Pure CSS (see .veil / .page-enter), so the page is never held back waiting for scripts.
 */
export default function StudioTemplate({ children }: { children: React.ReactNode }) {
  return (
    <>
      <div aria-hidden className="veil" />
      <div className="page-enter">{children}</div>
    </>
  );
}
