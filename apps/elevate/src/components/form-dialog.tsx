"use client";

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import { useConfirm } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type Ctx = {
  /** Closes the dialog. Pass true after a save so it never asks about the draft. */
  close: (force?: boolean) => void | Promise<void>;
  /** The draft was saved but the dialog stays open (to show a result): closing it later does not ask. */
  markClean: () => void;
};
const FormDialogContext = createContext<Ctx | null>(null);

/** Inside a FormDialog: lets a form close the dialog once it has saved. Null outside one (the form then stays where it is). */
export const useFormDialog = () => useContext(FormDialogContext);

const WIDTH = { md: "sm:max-w-xl", lg: "sm:max-w-2xl", xl: "sm:max-w-3xl" } as const;

/**
 * A button that opens a form in a modal, so a long form no longer sits under a list at the bottom of the page. The title and the
 * description describe the form; the form itself goes inside (it brings its own fields and its own save button). Anything typed
 * counts as a draft: closing asks first, so a long report is not lost to a stray click outside. A form calls useFormDialog().close(true)
 * when it has saved. `defaultOpen` opens it on arrival (for a link that asks for the form).
 */
export function FormDialog({
  label,
  title,
  description,
  children,
  variant = "default",
  size = "md",
  defaultOpen = false,
  icon,
  disabled = false,
  hint,
  open: openProp,
  onOpenChange,
  hideTrigger = false,
}: {
  label: string;
  title: string;
  description?: string;
  children: ReactNode;
  variant?: "default" | "outline" | "secondary";
  size?: keyof typeof WIDTH;
  defaultOpen?: boolean;
  icon?: ReactNode;
  /** The button is greyed out (it says why in `hint`, shown as its tooltip). */
  disabled?: boolean;
  hint?: string;
  /** Controlled mode: the caller decides when it is open (for example a menu item opens it) and usually sets `hideTrigger`. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  hideTrigger?: boolean;
}) {
  const [openState, setOpenState] = useState(defaultOpen);
  const open = openProp ?? openState;
  const setOpen = useCallback(
    (next: boolean) => {
      setOpenState(next);
      onOpenChange?.(next);
    },
    [onOpenChange],
  );
  const dirty = useRef(false);
  const reduce = useReducedMotion();

  const confirm = useConfirm();

  const close = useCallback(async (force = false) => {
    if (!force && dirty.current) {
      const discard = await confirm({ title: "Discard what you wrote?", description: "What you typed in this form is lost if you close it now.", confirmLabel: "Discard changes", cancelLabel: "Keep editing", destructive: true });
      if (!discard) return;
    }
    dirty.current = false;
    setOpen(false);
  }, [setOpen, confirm]);

  const markClean = useCallback(() => {
    dirty.current = false;
  }, []);

  return (
    <>
      {hideTrigger ? null : (
        <Button type="button" variant={variant} disabled={disabled} title={disabled ? hint : undefined} onClick={() => setOpen(true)}>
          {icon}
          {label}
        </Button>
      )}
      <Dialog open={open} onOpenChange={(next) => (next ? setOpen(true) : close())}>
        <DialogContent className={`max-h-[90dvh] overflow-y-auto ${WIDTH[size]}`}>
          <DialogHeader>
            <DialogTitle className="text-lg">{title}</DialogTitle>
            {description ? <DialogDescription>{description}</DialogDescription> : null}
          </DialogHeader>
          <FormDialogContext.Provider value={{ close, markClean }}>
            <motion.div
              initial={reduce ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={reduce ? { duration: 0 } : { duration: 0.18, ease: "easeOut" }}
              onInputCapture={() => (dirty.current = true)}
              onChangeCapture={() => (dirty.current = true)}
            >
              {children}
            </motion.div>
          </FormDialogContext.Provider>
        </DialogContent>
      </Dialog>
    </>
  );
}
