import { getTranslations } from "next-intl/server";

import { SatinBackground } from "@/components/fx/satin-background";
import { Masthead } from "@/components/layout/masthead";
import { requireOwner } from "@/lib/auth/owner";
import { keyStatus } from "@/lib/env";
import { getEffects, getTheme } from "@/lib/preferences";
import { ensureOwnerDefaults } from "@/lib/settings/service";

export default async function StudioLayout({ children }: { children: React.ReactNode }) {
  const owner = await requireOwner();
  await ensureOwnerDefaults(owner.supabase, owner.user.id);
  const status = keyStatus();
  const [theme, effects, t] = await Promise.all([getTheme(), getEffects(), getTranslations("nav")]);
  return (
    <div className="relative min-h-dvh">
      <a
        href="#main"
        className="sr-only rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground focus:not-sr-only focus:fixed focus:start-4 focus:top-4 focus:z-50"
      >
        {t("skipToContent")}
      </a>
      <SatinBackground />
      <Masthead
        email={owner.user.email ?? null}
        theme={theme}
        effects={effects}
        mockImages={status.higgsfieldMock}
        mockBrain={!status.anthropic && !status.gemini}
      />
      <main
        id="main"
        tabIndex={-1}
        className="relative mx-auto w-full max-w-[1680px] px-4 pt-8 pb-24 outline-none sm:px-6 lg:px-10 lg:pt-12"
      >
        {children}
      </main>
    </div>
  );
}
