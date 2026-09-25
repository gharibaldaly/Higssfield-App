"use client";

import { MotionConfig } from "motion/react";
import { Direction } from "radix-ui";
import * as React from "react";
import { Toaster } from "sonner";

import { ConfirmProvider } from "@/components/common/confirm-dialog";
import { TooltipProvider } from "@/components/ui/overlays";

export function Providers({
  children,
  dir,
  theme,
}: {
  children: React.ReactNode;
  dir: "rtl" | "ltr";
  theme: "dark" | "light";
}) {
  return (
    <Direction.Provider dir={dir}>
      <MotionConfig
        reducedMotion="user"
        transition={{ type: "spring", stiffness: 260, damping: 30 }}
      >
        <TooltipProvider>
          <ConfirmProvider>{children}</ConfirmProvider>
          <Toaster
            dir={dir}
            theme={theme}
            position={dir === "rtl" ? "bottom-left" : "bottom-right"}
            toastOptions={{
              classNames: {
                toast: "!glass-strong !rounded-2xl !text-foreground !font-sans",
                description: "!text-muted-foreground",
              },
            }}
          />
        </TooltipProvider>
      </MotionConfig>
    </Direction.Provider>
  );
}
