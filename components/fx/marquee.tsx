import type * as React from "react";

import { cn } from "@/lib/utils";

/** Endless ticker. The list renders twice so the loop is seamless; the copy is hidden from AT. */
export function Marquee({
  items,
  label,
  className,
  itemClassName,
  separator,
}: {
  items: React.ReactNode[];
  label: string;
  className?: string;
  itemClassName?: string;
  separator?: React.ReactNode;
}) {
  const list = (hidden: boolean) => (
    <ul
      aria-label={hidden ? undefined : label}
      aria-hidden={hidden || undefined}
      className="flex shrink-0 items-center"
    >
      {items.map((item, index) => (
        <li key={index} className={cn("flex items-center", itemClassName)}>
          {item}
          {separator}
        </li>
      ))}
    </ul>
  );
  return (
    <div className={cn("marquee overflow-hidden", className)}>
      <div className="marquee-track">
        {list(false)}
        {list(true)}
      </div>
    </div>
  );
}
