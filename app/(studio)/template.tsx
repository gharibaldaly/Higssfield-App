/**
 * Runs each time a studio section opens: the page rises in (pure CSS, see .page-enter), so it is
 * never held back waiting for scripts. The liquid transition between sections lives in Providers.
 */
export default function StudioTemplate({ children }: { children: React.ReactNode }) {
  return <div className="page-enter">{children}</div>;
}
