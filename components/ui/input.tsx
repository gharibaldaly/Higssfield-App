import * as React from "react";

import { cn } from "@/lib/utils";

const fieldBase =
  "w-full min-w-0 rounded-xl border border-input bg-[color-mix(in_srgb,var(--glass-bg)_80%,transparent)] px-3.5 text-sm text-foreground shadow-[inset_0_1px_2px_rgba(0,0,0,0.06)] transition-[border-color,box-shadow] outline-none placeholder:text-muted-foreground/80 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(fieldBase, "h-10 py-2", className)}
      {...props}
    />
  );
}

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(fieldBase, "min-h-24 resize-y py-2.5 leading-relaxed", className)}
      {...props}
    />
  );
}

export { fieldBase, Input, Textarea };
