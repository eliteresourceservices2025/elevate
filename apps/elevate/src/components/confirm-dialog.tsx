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

/** Splits a plain question ("Archive this template? Offers already sent are not affected.") into a title and the rest. */
export function splitQuestion(message: string): { title: string; description: string } {
  const m = /^(.+?[?!.])(?:s+([sS]*))?$/.exec(message.trim());
  return m ? { title: m[1], description: m[2] ?? "" } : { title: message.trim(), description: "" };
}

/**
 * The same dialog for a sentence written as a plain question: the first sentence becomes the title, the rest the explanation, and the
 * button names the action ("Archive this template"). Anything that removes, voids, declines or cannot be undone gets the red button.
 * Use useConfirm directly when a button needs its own wording.
 */
export function useAsk(): (message: string, options?: Partial<Pick<ConfirmOptions, "confirmLabel" | "cancelLabel" | "destructive">>) => Promise<boolean> {
  const confirm = useConfirm();
  return (message, options = {}) => {
    const { title, description } = splitQuestion(message);
    const action = title.replace(/[?!.]+$/, "");
    return confirm({
      title,
      description: description || " ",
      confirmLabel: options.confirmLabel ?? (action.length <= 40 ? action : "Yes, continue"),
      cancelLabel: options.cancelLabel ?? "Go back",
      destructive: options.destructive ?? /cannot be (undone|changed)|delete|remove|erase|void|decline|discard|stops the document/i.test(message),
    });
  };
}
