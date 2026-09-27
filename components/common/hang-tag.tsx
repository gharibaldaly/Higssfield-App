import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * A notice cut like a garment hang tag: a notched end with an eyelet and a loop of string.
 * Used for things that need the owner's attention (setup, mock mode, missing details).
 */
export function HangTag({
  title,
  children,
  action,
  icon,
  className,
}: {
  title: React.ReactNode;
  children?: React.ReactNode;
  action?: React.ReactNode;
  icon?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("relative ps-7", className)}>
      {/* The string loops from the eyelet out past the tag's notched end. */}
      <svg
        aria-hidden
        viewBox="0 0 40 60"
        className="absolute start-0 top-1/2 h-14 w-9 -translate-y-1/2 text-warning/70 rtl:-scale-x-100"
        fill="none"
      >
        <path
          d="M40 30 C 22 30, 8 16, 2 4 M40 30 C 24 32, 10 46, 4 58"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinecap="round"
        />
      </svg>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3 bg-[color-mix(in_srgb,var(--warning)_12%,var(--surface-solid))] py-4 ps-12 pe-5 text-foreground [clip-path:polygon(22px_0,100%_0,100%_100%,22px_100%,0_calc(100%-22px),0_22px)] rtl:[clip-path:polygon(0_0,calc(100%-22px)_0,100%_22px,100%_calc(100%-22px),calc(100%-22px)_100%,0_100%)]">
        <span
          aria-hidden
          className="absolute start-9 top-1/2 size-3.5 -translate-y-1/2 rounded-full border-2 border-warning/70 bg-background"
        />
        {icon ? <span className="shrink-0 text-warning">{icon}</span> : null}
        <div className="min-w-0 flex-1">
          <p className="font-medium">{title}</p>
          {children ? (
            <div className="mt-0.5 text-sm leading-relaxed text-muted-foreground">{children}</div>
          ) : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
    </div>
  );
}
