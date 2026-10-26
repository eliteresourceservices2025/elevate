"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useUnsavedChanges } from "@/components/unsaved-changes";
import { motion, useReducedMotion } from "motion/react";
import { useConfirm } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type Ctx = {
  /** Closes the dialog. Pass true after a save so it never asks about the draft. */
  close: (force?: boolean) => void | Promise<void>;
  /** The draft was saved but the dialog stays open (to show a result): closing it later does not ask. */
  markClean: () => void;
  setDirty: (dirty: boolean) => void;
  setBusy: (busy: boolean) => void;
};
const FormDialogContext = createContext<Ctx | null>(null);

/** Inside a FormDialog: lets a form close the dialog once it has saved. Null outside one (the form then stays where it is). */
export const useFormDialog = () => useContext(FormDialogContext);

/** File queues can change through drop events. Track those drafts explicitly and keep in-flight work mounted. */
export function useFormDialogWork({ dirty, busy = false }: { dirty?: boolean; busy?: boolean }) {
  const dialog = useFormDialog();
  const setDirty = dialog?.setDirty;
  const setBusy = dialog?.setBusy;
  useUnsavedChanges(Boolean(dirty || busy));
  useEffect(() => {
    if (dirty === undefined) return;
    setDirty?.(dirty);
    return () => setDirty?.(false);
  }, [dirty, setDirty]);
  useEffect(() => {
    setBusy?.(busy);
    return () => setBusy?.(false);
  }, [busy, setBusy]);
  return dialog;
}

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
  const busy = useRef(false);
  const [working, setWorking] = useState(false);
  const setDirty = useCallback((next: boolean) => { dirty.current = next; }, []);
  const setBusy = useCallback((next: boolean) => { busy.current = next; setWorking(next); }, []);
  const reduce = useReducedMotion();

  const confirm = useConfirm();
  // eslint-disable-next-line security/detect-object-injection -- size is constrained to the three WIDTH keys.
  const dialogWidth = WIDTH[size];

  const close = useCallback(async (force = false) => {
    if (!force && busy.current) return;
    if (!force && dirty.current) {
      const discard = await confirm({ title: "Discard what you wrote?", description: "Your unsaved work, including selected files, is lost if you close this form.", confirmLabel: "Discard changes", cancelLabel: "Keep editing", destructive: true });
      if (!discard) return;
    }
    dirty.current = false;
    setOpen(false);
  }, [setOpen, confirm]);

  const markClean = useCallback(() => {
    dirty.current = false;
  }, []);
  const context = useMemo(() => ({ close, markClean, setDirty, setBusy }), [close, markClean, setDirty, setBusy]);

  return (
    <>
      {hideTrigger ? null : (
        <Button type="button" variant={variant} disabled={disabled} title={disabled ? hint : undefined} onClick={() => setOpen(true)}>
          {icon}
          {label}
        </Button>
      )}
      <Dialog open={open} onOpenChange={(next) => (next ? setOpen(true) : close())}>
        <DialogContent showCloseButton={!working} className={`max-h-[90dvh] overflow-y-auto ${dialogWidth}`}>
          <DialogHeader>
            <DialogTitle className="text-lg">{title}</DialogTitle>
            {description ? <DialogDescription>{description}</DialogDescription> : null}
          </DialogHeader>
          {working ? <p role="status" className="text-xs text-muted-foreground">Please keep this window open while it finishes.</p> : null}
          <FormDialogContext.Provider value={context}>
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
