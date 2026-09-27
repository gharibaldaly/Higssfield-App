import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import * as React from "react";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "relative inline-flex shrink-0 items-center justify-center gap-2 rounded-full text-sm font-medium whitespace-nowrap transition-[background-color,border-color,color,box-shadow,transform,opacity] duration-300 ease-(--ease-spring) outline-none select-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        // The primary action is a sewn-on label: a stitched inner edge and a satin sheen on hover.
        default:
          "sheen stitched bg-primary text-primary-foreground shadow-[0_10px_28px_-14px_color-mix(in_srgb,var(--primary)_80%,transparent)] hover:shadow-[0_14px_34px_-12px_color-mix(in_srgb,var(--primary)_90%,transparent)]",
        surface:
          "border border-(--surface-edge) bg-(--surface) text-foreground hover:border-border-strong hover:bg-[color-mix(in_srgb,var(--surface-solid)_80%,var(--foreground)_8%)]",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-[color-mix(in_srgb,var(--secondary)_70%,var(--foreground)_10%)]",
        outline:
          "border border-border-strong bg-transparent text-foreground hover:border-foreground/50 hover:bg-muted",
        ghost: "text-foreground hover:bg-muted",
        destructive: "sheen bg-destructive text-destructive-foreground",
        link: "rounded-none px-0 text-accent-ink underline decoration-dashed decoration-1 underline-offset-[6px] hover:decoration-solid",
      },
      size: {
        sm: "h-8 px-3.5 text-xs",
        default: "h-10 px-5",
        lg: "h-12 px-7 text-[15px]",
        icon: "size-10",
        "icon-sm": "size-8",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

type ButtonProps = React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  };

function Button({ className, variant, size, asChild = false, type, ...props }: ButtonProps) {
  const Comp = asChild ? Slot.Root : "button";
  return (
    <Comp
      data-slot="button"
      type={asChild ? undefined : (type ?? "button")}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}

export { Button, buttonVariants, type ButtonProps };
