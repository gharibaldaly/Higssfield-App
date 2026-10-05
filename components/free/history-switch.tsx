import { History } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";

import { cn } from "@/lib/utils";

export type HistoryChoice = {
  /** Null for the owner's own history; a guest's user id otherwise. */
  id: string | null;
  label: string;
  /** The account exists but has not signed in yet. */
  dormant?: boolean;
};

/**
 * Whose free-generation history the Generate page shows: the owner's own, or
 * a guest's (read only). Only shown to the owner, and only when a guest has
 * an account.
 */
export function HistorySwitch({
  choices,
  current,
}: {
  choices: HistoryChoice[];
  current: string | null;
}) {
  const t = useTranslations("free.history");
  return (
    <nav aria-label={t("label")} className="flex flex-wrap items-center gap-2">
      <span className="flex items-center gap-1.5 hud text-muted-foreground">
        <History className="size-3.5" aria-hidden />
        {t("label")}
      </span>
      <ul className="flex flex-wrap gap-1.5">
        {choices.map((choice) => {
          const active = choice.id === current;
          return (
            <li key={choice.id ?? "mine"}>
              <Link
                href={choice.id ? `/generate?history=${choice.id}` : "/generate"}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-flex h-8 items-center rounded-full border px-3 text-sm transition-colors",
                  active
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border-strong text-muted-foreground hover:text-foreground",
                )}
                dir={choice.id ? "ltr" : undefined}
              >
                {choice.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
