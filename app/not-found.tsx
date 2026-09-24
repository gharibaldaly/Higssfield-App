import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { AmbientBackground } from "@/components/layout/ambient-background";
import { Button } from "@/components/ui/button";

export default async function NotFound() {
  const t = await getTranslations("errors");
  return (
    <div className="relative grid min-h-dvh place-items-center px-4">
      <AmbientBackground />
      <div className="specular relative z-10 flex max-w-md flex-col items-center gap-4 rounded-[2rem] p-10 text-center glass-strong">
        <p className="font-display text-7xl font-semibold text-champagne-ink">404</p>
        <h1 className="font-display text-2xl font-semibold">{t("notFound")}</h1>
        <Button asChild>
          <Link href="/">{t("home")}</Link>
        </Button>
      </div>
    </div>
  );
}
