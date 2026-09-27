"use client";

import { useNow } from "next-intl";

import { formatDuration } from "@/lib/utils";

/** Live elapsed-time counter (mm:ss) since `since`. */
export function Elapsed({ since, className }: { since: string | null; className?: string }) {
  // Starts from the request time (same on server and client), then ticks every second.
  const now = useNow({ updateInterval: 1000 });
  if (!since) return null;
  return (
    <span className={className} dir="ltr">
      {formatDuration(now.getTime() - Date.parse(since))}
    </span>
  );
}
