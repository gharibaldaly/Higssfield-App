import { getTranslations } from "next-intl/server";

import { SatinBackground } from "@/components/fx/satin-background";
import { GhostBatchRunner } from "@/components/ghost-batch/batch-runner";
import { Masthead } from "@/components/layout/masthead";
import { SideRails } from "@/components/layout/side-rails";
import { requireMember } from "@/lib/auth/owner";
import { keyStatus } from "@/lib/env";
import { hasRunningGhostBatch } from "@/lib/ghost-batches/runner";
import { getEffects, getTheme } from "@/lib/preferences";
import { ensureOwnerDefaults } from "@/lib/settings/service";

/**
 * The studio shell for the owner and for guests. A guest (Generate only) gets
 * the same chrome with only their sections in it; every owner-only page under
 * this layout sends them back to Generate itself (requireOwner).
 */
export default async function StudioLayout({ children }: { children: React.ReactNode }) {
  const member = await requireMember();
  const owner = member.role === "owner";
  await ensureOwnerDefaults(member.supabase, member.user.id, { presets: owner });
  const status = keyStatus();
  const [theme, effects, t, batchRunning] = await Promise.all([
    getTheme(),
    getEffects(),
    getTranslations("nav"),
    owner ? hasRunningGhostBatch(member.supabase) : Promise.resolve(false),
  ]);
  return (
    <div className="relative min-h-dvh">
      <a
        href="#main"
        className="sr-only rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground focus:not-sr-only focus:fixed focus:start-4 focus:top-4 focus:z-50"
      >
        {t("skipToContent")}
      </a>
      <SatinBackground />
      <SideRails />
      <Masthead
        email={member.user.email ?? null}
        role={member.role}
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
      {owner ? <GhostBatchRunner active={batchRunning} /> : null}
    </div>
  );
}
