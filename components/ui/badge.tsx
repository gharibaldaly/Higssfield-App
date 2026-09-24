import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap [&_svg]:size-3",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground",
        outline: "border-border text-foreground",
        muted: "border-transparent bg-muted text-muted-foreground",
        success:
          "border-transparent bg-[color-mix(in_srgb,var(--success)_16%,transparent)] text-success",
        warning:
          "border-transparent bg-[color-mix(in_srgb,var(--warning)_18%,transparent)] text-warning",
        danger:
          "border-transparent bg-[color-mix(in_srgb,var(--destructive)_16%,transparent)] text-destructive",
        champagne:
          "border-transparent bg-[color-mix(in_srgb,var(--color-champagne)_20%,transparent)] text-champagne-ink",
        rose: "border-transparent bg-[color-mix(in_srgb,var(--color-rose)_24%,transparent)] text-foreground",
      },
    },
    defaultVariants: { variant: "outline" },
  },
);

function Badge({
  className,
  variant,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return (
    <span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
