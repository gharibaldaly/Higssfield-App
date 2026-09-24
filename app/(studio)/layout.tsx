import { AmbientBackground } from "@/components/layout/ambient-background";
import { AppNav } from "@/components/layout/app-nav";
import { BrandMark } from "@/components/layout/brand-mark";
import { TopBar } from "@/components/layout/top-bar";
import { requireOwner } from "@/lib/auth/owner";
import { keyStatus } from "@/lib/env";
import { getTheme } from "@/lib/preferences";
import { ensureOwnerDefaults } from "@/lib/settings/service";

export default async function StudioLayout({ children }: { children: React.ReactNode }) {
  const owner = await requireOwner();
  await ensureOwnerDefaults(owner.supabase, owner.user.id);
  const status = keyStatus();
  const theme = await getTheme();
  return (
    <div className="relative min-h-dvh">
      <AmbientBackground />
      <div className="relative z-10 flex min-h-dvh">
        <aside className="sticky top-0 hidden h-dvh w-72 shrink-0 p-4 lg:block">
          <div className="specular flex h-full flex-col gap-8 overflow-y-auto rounded-[1.75rem] p-4 glass">
            <div className="px-2 pt-2">
              <BrandMark />
            </div>
            <AppNav />
          </div>
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar
            email={owner.user.email}
            theme={theme}
            mockImages={status.higgsfieldMock}
            mockBrain={!status.anthropic && !status.gemini}
          />
          <main
            id="main"
            className="mx-auto w-full max-w-[1600px] flex-1 px-4 pt-6 pb-20 sm:px-6 lg:px-8"
          >
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
