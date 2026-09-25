import * as React from "react";

import { cn } from "@/lib/utils";

/** Frosted glass panel — the base surface of the studio. */
function Card({
  className,
  strong = false,
  ...props
}: React.ComponentProps<"div"> & { strong?: boolean }) {
  return (
    <div
      data-slot="card"
      className={cn(
        strong ? "glass-strong" : "glass",
        "specular rounded-(--radius-glass) text-card-foreground",
        className,
      )}
      {...props}
    />
  );
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-header"
      className={cn("flex flex-col gap-1.5 px-5 pt-5 sm:px-6 sm:pt-6", className)}
      {...props}
    />
  );
}

/** Cards sit directly under the page's h1, so the title is an h2 unless the card is nested. */
function CardTitle({
  className,
  as: Heading = "h2",
  ...props
}: React.ComponentProps<"h2"> & { as?: "h2" | "h3" | "h4" }) {
  return (
    <Heading
      data-slot="card-title"
      className={cn("font-display text-xl leading-tight font-semibold tracking-tight", className)}
      {...props}
    />
  );
}

function CardDescription({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="card-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="card-content" className={cn("px-5 py-5 sm:px-6", className)} {...props} />;
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-footer"
      className={cn("flex flex-wrap items-center gap-2 px-5 pb-5 sm:px-6 sm:pb-6", className)}
      {...props}
    />
  );
}

export { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle };
