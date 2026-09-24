import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { AmbientBackground } from "@/components/layout/ambient-background";
import { BrandMark } from "@/components/layout/brand-mark";
import { keyStatus } from "@/lib/env";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("setup");
  return { title: t("title") };
}

/** Shown when Supabase is not configured yet (first deploy). Lists names only. */
export default async function SetupPage() {
  const t = await getTranslations("setup");
  const status = keyStatus();
  const rows: { name: string; ok: boolean; required: boolean }[] = [
    {
      name: "NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY",
      ok: status.supabase,
      required: true,
    },
    { name: "SUPABASE_SERVICE_ROLE_KEY", ok: status.supabaseServiceRole, required: false },
    { name: "APP_OWNER_EMAIL", ok: status.ownerEmail, required: false },
    { name: "HIGGSFIELD_API_KEY / HIGGSFIELD_API_SECRET", ok: status.higgsfield, required: false },
    { name: "ANTHROPIC_API_KEY", ok: status.anthropic, required: false },
    { name: "GEMINI_API_KEY", ok: status.gemini, required: false },
  ];
  return (
    <div className="relative grid min-h-dvh place-items-center px-4 py-10">
      <AmbientBackground />
      <main className="specular relative z-10 w-full max-w-xl rounded-[2rem] p-8 glass-strong sm:p-10">
        <BrandMark />
        <h1 className="mt-8 font-display text-3xl font-semibold">{t("heading")}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{t("body")}</p>
        <ul className="mt-6 flex flex-col gap-2">
          {rows.map((row) => (
            <li
              key={row.name}
              className="flex items-center justify-between gap-4 rounded-xl bg-muted px-4 py-3 text-sm"
            >
              <code dir="ltr" className="font-mono text-xs break-all">
                {row.name}
              </code>
              <span
                className={
                  row.ok
                    ? "text-success"
                    : row.required
                      ? "text-destructive"
                      : "text-muted-foreground"
                }
              >
                {row.ok
                  ? t("configured")
                  : row.required
                    ? t("missingRequired")
                    : t("missingOptional")}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-6 text-sm text-muted-foreground">{t("readme")}</p>
      </main>
    </div>
  );
}
