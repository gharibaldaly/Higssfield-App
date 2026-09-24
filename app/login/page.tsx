import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { LoginForm } from "@/components/auth/login-form";
import { AmbientBackground } from "@/components/layout/ambient-background";
import { BrandMark } from "@/components/layout/brand-mark";
import { LocaleToggle } from "@/components/layout/preference-toggles";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("login");
  return { title: t("title") };
}

export default async function LoginPage() {
  const t = await getTranslations("login");
  return (
    <div className="relative grid min-h-dvh place-items-center px-4 py-10">
      <AmbientBackground />
      <div className="absolute end-4 top-4 z-10">
        <LocaleToggle />
      </div>
      <main className="relative z-10 w-full max-w-md">
        <div className="specular rounded-[2rem] p-8 glass-strong sm:p-10">
          <BrandMark />
          <h1 className="mt-10 font-display text-4xl leading-tight font-semibold tracking-tight">
            {t("heading")}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">{t("subheading")}</p>
          <LoginForm />
        </div>
        <p className="mt-6 text-center text-xs text-muted-foreground">{t("privateNote")}</p>
      </main>
    </div>
  );
}
