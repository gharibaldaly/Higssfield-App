import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { LoginForm } from "@/components/auth/login-form";
import { GhostForm } from "@/components/fx/ghost-form";
import { RevealText } from "@/components/fx/reveal-text";
import { SatinBackground } from "@/components/fx/satin-background";
import { BrandMark } from "@/components/layout/brand-mark";
import { LocaleToggle } from "@/components/layout/preference-toggles";
import { ProductLineBadge } from "@/components/products/product-line-badge";
import { PRODUCT_LINES } from "@/lib/domain/product";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("login");
  return { title: t("title") };
}

export default async function LoginPage() {
  const t = await getTranslations("login");
  const ta = await getTranslations("app");
  return (
    <div className="relative grid min-h-dvh lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
      <SatinBackground />

      {/* The form stage: the brand set huge in outline, the display form turning in front. */}
      <section
        aria-hidden
        className="@container relative hidden min-h-dvh overflow-hidden border-e border-border lg:block"
      >
        <p
          className="absolute inset-x-0 top-1/2 -translate-y-1/2 text-center font-editorial text-[17cqw] leading-none tracking-tighter whitespace-nowrap text-transparent [-webkit-text-stroke:1px_var(--border-strong)]"
          dir="ltr"
        >
          {ta("brand")}
        </p>
        <GhostForm className="absolute inset-x-0 inset-y-10" />
        <div className="absolute inset-x-10 bottom-8 flex flex-wrap items-center gap-3">
          {PRODUCT_LINES.map((line) => (
            <ProductLineBadge key={line} line={line} />
          ))}
        </div>
      </section>

      <div className="relative flex min-h-dvh flex-col px-4 py-6 sm:px-10">
        <header className="flex items-center justify-between gap-4">
          <BrandMark />
          <LocaleToggle />
        </header>
        <main className="my-auto w-full max-w-md self-center py-12">
          <div className="mb-5 flex items-center gap-3 text-accent-ink">
            <span aria-hidden className="h-px w-8 bg-current" />
            <p className="hud">{t("privateNote")}</p>
          </div>
          <h1 className="font-display text-[clamp(3rem,6vw,4.75rem)] leading-[1.02] tracking-tight">
            <RevealText text={t("heading")} />
          </h1>
          <p className="mt-4 text-sm leading-relaxed text-muted-foreground">{t("subheading")}</p>
          <div className="mt-10 rounded-(--radius-panel) p-6 surface-raised sm:p-8">
            <LoginForm />
          </div>
        </main>
      </div>
    </div>
  );
}
