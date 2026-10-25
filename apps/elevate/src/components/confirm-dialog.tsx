"use client";

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export type ConfirmOptions = {
  title: string;
  /** What will happen: who or what is affected, how many, and whether it can be undone. */
  description: ReactNode;
  /** Names the outcome ("Archive 3 documents"), not just "OK". */
  confirmLabel: string;
  /** The safe way out, for example "Keep editing". */
  cancelLabel?: string;
  /** Destructive styling only for an outcome that cannot be undone or removes something. */
  destructive?: boolean;
};

type Ask = (options: ConfirmOptions) => Promise<boolean>;
const Ctx = createContext<Ask | null>(null);

/**
 * One styled confirmation for every consequential action, in place of the browser's own window.confirm. Mount once (the app shell does);
 * `const confirm = useConfirm(); if (!(await confirm({ ... }))) return;`. Outside a provider it falls back to window.confirm so a
 * component is never left unable to ask.
 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((answer: boolean) => void) | null>(null);

  const ask = useCallback<Ask>((next) => {
    resolver.current?.(false); // a second question replaces the first
    setOptions(next);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const answer = (value: boolean) => {
    resolver.current?.(value);
    resolver.current = null;
    setOptions(null);
  };

  return (
    <Ctx.Provider value={ask}>
      {children}
      <AlertDialog open={options !== null} onOpenChange={(open) => !open && answer(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{options?.title}</AlertDialogTitle>
            <AlertDialogDescription>{options?.description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{options?.cancelLabel ?? "Cancel"}</AlertDialogCancel>
            <AlertDialogAction variant={options?.destructive ? "destructive" : "default"} onClick={() => answer(true)}>
              {options?.confirmLabel}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Ctx.Provider>
  );
}

export function useConfirm(): Ask {
  const ask = useContext(Ctx);
  return (
    ask ??
    (async (o) => window.confirm(`${o.title}\n\n${typeof o.description === "string" ? o.description : ""}`.trim()))
  );
}
