"use client";

import { useTranslations } from "next-intl";
import { AlertDialog } from "radix-ui";
import * as React from "react";

import { buttonVariants } from "@/components/ui/button";

export type ConfirmOptions = {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
};

type Confirm = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = React.createContext<Confirm | null>(null);

/**
 * A surface alert dialog in place of window.confirm: it follows the locale, the direction and the
 * theme, and it focuses Cancel first so a stray Enter never deletes anything.
 */
export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const t = useTranslations("common");
  const [open, setOpen] = React.useState(false);
  // Kept after closing so the text does not vanish during the exit animation.
  const [options, setOptions] = React.useState<ConfirmOptions | null>(null);
  const resolver = React.useRef<((confirmed: boolean) => void) | null>(null);

  const settle = React.useCallback((confirmed: boolean) => {
    resolver.current?.(confirmed);
    resolver.current = null;
    setOpen(false);
  }, []);

  const confirm = React.useCallback<Confirm>((next) => {
    // A newer question cancels one that was never answered.
    resolver.current?.(false);
    setOptions(next);
    setOpen(true);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <AlertDialog.Root
        open={open}
        onOpenChange={(next) => {
          if (!next) settle(false);
        }}
      >
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="fixed inset-0 z-50 bg-black/55 backdrop-blur-sm data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
          <AlertDialog.Content
            // Without a description Radix expects the attribute to be opted out explicitly.
            {...(options?.description ? {} : { "aria-describedby": undefined })}
            className="fixed top-1/2 left-1/2 z-50 grid w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 gap-4 rounded-(--radius-panel) p-6 text-popover-foreground surface-raised duration-300 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
          >
            <div className="flex flex-col gap-2 text-start">
              <AlertDialog.Title className="font-heading text-2xl leading-snug">
                {options?.title}
              </AlertDialog.Title>
              {options?.description ? (
                <AlertDialog.Description className="text-sm leading-relaxed text-muted-foreground">
                  {options.description}
                </AlertDialog.Description>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <AlertDialog.Cancel className={buttonVariants({ variant: "ghost" })}>
                {options?.cancelLabel ?? t("cancel")}
              </AlertDialog.Cancel>
              <AlertDialog.Action
                className={buttonVariants({
                  variant: options?.destructive ? "destructive" : "default",
                })}
                onClick={() => settle(true)}
              >
                {options?.confirmLabel ?? t("confirm")}
              </AlertDialog.Action>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </ConfirmContext.Provider>
  );
}

/** Resolves to true when the owner confirms, false on Cancel, Escape or a click outside. */
export function useConfirm(): Confirm {
  const confirm = React.useContext(ConfirmContext);
  if (!confirm) throw new Error("useConfirm must be used inside <ConfirmProvider>");
  return confirm;
}
