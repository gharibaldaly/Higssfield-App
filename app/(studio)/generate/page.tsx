import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";

import { PageHeader } from "@/components/common/page-header";
import { FreeStudio } from "@/components/free/free-studio";
import { GuestHistory } from "@/components/free/guest-history";
import { HistorySwitch, type HistoryChoice } from "@/components/free/history-switch";
import { guestsWithAccounts, listGuests } from "@/lib/auth/guests";
import { requireMember } from "@/lib/auth/owner";
import { listFreeGenerations } from "@/lib/generations/free";
import { ownerRegistry } from "@/lib/generations/models";
import { toModelOptions } from "@/lib/providers/higgsfield/options";
import { getOwnerSettings } from "@/lib/settings/service";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("free");
  return { title: t("title") };
}

/**
 * Free generation: the account's own prompt and references, any image or video
 * model, the size and quality they choose. Nothing is added to the prompt.
 *
 * Open to the owner and to guests; each sees their own history. The owner can
 * also open a guest's history (`?history=<user id>`), read only.
 */
export default async function FreeGenerationPage({
  searchParams,
}: {
  searchParams: Promise<{ history?: string | string[] }>;
}) {
  const { supabase, user, role } = await requireMember();
  const params = await searchParams;
  const requested = typeof params.history === "string" ? params.history : null;
  const [t, locale, settings, guests] = await Promise.all([
    getTranslations("free"),
    getLocale(),
    getOwnerSettings(supabase, user.id),
    role === "owner" ? listGuests(supabase) : Promise.resolve([]),
  ]);
  const accounts = guestsWithAccounts(guests);
  const guest = requested ? (accounts.find((item) => item.userId === requested) ?? null) : null;
  const choices: HistoryChoice[] = [
    { id: null, label: t("history.mine") },
    ...accounts.map((item) => ({ id: item.userId, label: item.email })),
  ];
  const switcher =
    role === "owner" && accounts.length > 0 ? (
      <HistorySwitch choices={choices} current={guest?.userId ?? null} />
    ) : null;

  if (guest) {
    const history = await listFreeGenerations(supabase, settings, guest.userId);
    return (
      <>
        <PageHeader
          eyebrow={t("history.eyebrow")}
          title={t("history.title")}
          description={t("history.description", { email: guest.email })}
          actions={switcher}
        />
        <GuestHistory email={guest.email} items={history} />
      </>
    );
  }

  const [registry, history] = await Promise.all([
    ownerRegistry(settings),
    listFreeGenerations(supabase, settings, user.id),
  ]);
  const imageModels = toModelOptions(registry, "image", ["text-to-image", "image-to-image"]);
  const videoModels = toModelOptions(registry, "video", ["text-to-video", "image-to-video"]);
  const usable = (models: typeof imageModels, preferred: string | null) =>
    (
      models.find((model) => model.id === preferred && !model.disabledReason) ??
      models.find((model) => !model.disabledReason)
    )?.id ?? null;

  return (
    <>
      <PageHeader
        eyebrow={t("eyebrow")}
        title={t("title")}
        description={t(role === "guest" ? "descriptionGuest" : "description")}
        actions={switcher}
      />
      <FreeStudio
        ownerId={user.id}
        locale={locale === "ar" ? "ar" : "en"}
        imageModels={imageModels}
        videoModels={videoModels}
        defaultImageModelId={usable(imageModels, settings.defaultImageModel)}
        defaultVideoModelId={usable(videoModels, settings.defaultVideoModel)}
        history={history}
      />
    </>
  );
}
