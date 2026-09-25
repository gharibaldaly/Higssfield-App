"use client";

import { CheckIcon } from "lucide-react";
import {
  Checkbox as CheckboxPrimitive,
  Progress as ProgressPrimitive,
  Separator as SeparatorPrimitive,
  Slider as SliderPrimitive,
  Switch as SwitchPrimitive,
} from "radix-ui";
import * as React from "react";

import { cn } from "@/lib/utils";

function Switch({ className, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "peer inline-flex h-6 w-11 shrink-0 items-center rounded-full border border-transparent transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=unchecked]:bg-input",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="pointer-events-none block size-5 rounded-full bg-cream shadow-md ring-0 transition-transform data-[state=checked]:translate-x-5 data-[state=unchecked]:translate-x-0.5 rtl:data-[state=checked]:-translate-x-5 rtl:data-[state=unchecked]:-translate-x-0.5" />
    </SwitchPrimitive.Root>
  );
}

function Checkbox({ className, ...props }: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "peer size-5 shrink-0 rounded-md border border-input bg-transparent outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground",
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator className="flex items-center justify-center">
        <CheckIcon className="size-3.5" />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

function Slider({
  className,
  "aria-label": ariaLabel,
  ...props
}: React.ComponentProps<typeof SliderPrimitive.Root>) {
  return (
    <SliderPrimitive.Root
      data-slot="slider"
      className={cn("relative flex w-full touch-none items-center select-none", className)}
      {...props}
    >
      <SliderPrimitive.Track className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-input">
        <SliderPrimitive.Range className="absolute h-full bg-primary" />
      </SliderPrimitive.Track>
      {/* The thumb carries role="slider", so it is the element that needs the name. */}
      {(props.value ?? props.defaultValue ?? [0]).map((_, index) => (
        <SliderPrimitive.Thumb
          key={index}
          aria-label={ariaLabel}
          className="block size-5 rounded-full border-2 border-primary bg-cream shadow transition-transform outline-none hover:scale-110 focus-visible:ring-2 focus-visible:ring-ring"
        />
      ))}
    </SliderPrimitive.Root>
  );
}

function Progress({
  className,
  value,
  indeterminate = false,
  ...props
}: React.ComponentProps<typeof ProgressPrimitive.Root> & { indeterminate?: boolean }) {
  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      className={cn("relative h-1.5 w-full overflow-hidden rounded-full bg-input", className)}
      value={indeterminate ? null : value}
      {...props}
    >
      {indeterminate ? (
        <div className="absolute inset-0 shimmer bg-[linear-gradient(90deg,transparent,var(--color-champagne),transparent)] bg-[length:50%_100%] bg-no-repeat" />
      ) : (
        <ProgressPrimitive.Indicator
          className="h-full bg-[linear-gradient(90deg,var(--color-wine-600),var(--color-champagne))] transition-[width] duration-500 ease-(--ease-spring) rtl:bg-[linear-gradient(270deg,var(--color-wine-600),var(--color-champagne))]"
          style={{ width: `${Math.max(0, Math.min(100, value ?? 0))}%` }}
        />
      )}
    </ProgressPrimitive.Root>
  );
}

function Separator({
  className,
  orientation = "horizontal",
  ...props
}: React.ComponentProps<typeof SeparatorPrimitive.Root>) {
  return (
    <SeparatorPrimitive.Root
      data-slot="separator"
      orientation={orientation}
      className={cn(
        "shrink-0 bg-border",
        orientation === "horizontal" ? "h-px w-full" : "h-full w-px",
        className,
      )}
      {...props}
    />
  );
}

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div data-slot="skeleton" className={cn("shimmer rounded-xl bg-muted", className)} {...props} />
  );
}

export { Checkbox, Progress, Separator, Skeleton, Slider, Switch };
