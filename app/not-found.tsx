import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { SatinBackground } from "@/components/fx/satin-background";
import { Button } from "@/components/ui/button";

export default async function NotFound() {
  const t = await getTranslations("errors");
  return (
    <main className="relative grid min-h-dvh place-items-center px-4">
      <SatinBackground />
      <div className="flex max-w-lg flex-col items-center gap-6 text-center">
        <p
          aria-hidden
          className="font-editorial text-[clamp(7rem,24vw,14rem)] leading-none text-transparent [-webkit-text-stroke:1.5px_var(--primary)]"
          dir="ltr"
        >
          404
        </p>
        <h1 className="font-display text-[clamp(2.25rem,5vw,3.5rem)] leading-tight">
          {t("notFound")}
        </h1>
        <div aria-hidden className="stitch w-40 text-border-strong" />
        <Button asChild size="lg">
          <Link href="/">{t("home")}</Link>
        </Button>
      </div>
    </main>
  );
}
