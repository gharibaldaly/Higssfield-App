"use client";

import { useEffect, useState } from "react";

import { formatDuration } from "@/lib/utils";

/** Live elapsed-time counter (mm:ss) since `since`. */
export function Elapsed({ since, className }: { since: string | null; className?: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  if (!since) return null;
  return (
    <span className={className} dir="ltr">
      {formatDuration(now - Date.parse(since))}
    </span>
  );
}
