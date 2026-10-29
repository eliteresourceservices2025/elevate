"use client";

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { CircleCheck, CircleAlert, CircleX } from "lucide-react";
import { toast } from "@/components/feedback-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export type OperationResult = {
  title: string;
  description: string;
  variant: "success" | "warning" | "error";
  details?: string[];
};
type ShowResult = (result: OperationResult) => void;
const ResultContext = createContext<ShowResult | null>(null);

/** Kept in the shell so refreshing a list cannot erase its completion or partial-failure result. */
export function OperationResultProvider({ children }: { children: ReactNode }) {
  const [result, setResult] = useState<OperationResult | null>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const show = useCallback<ShowResult>((next) => {
    previousFocus.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setResult(next);
  }, []);
  const Icon =
    result?.variant === "warning"
      ? CircleAlert
      : result?.variant === "error"
        ? CircleX
        : CircleCheck;
  const tone =
    result?.variant === "warning"
      ? "bg-warning-surface text-warning"
      : result?.variant === "error"
        ? "bg-destructive/10 text-destructive"
        : "bg-success-surface text-success";
  return (
    <ResultContext.Provider value={show}>
      {children}
      <Dialog open={result !== null} onOpenChange={(open) => !open && setResult(null)}>
        <DialogContent
          finalFocus={() =>
            previousFocus.current?.isConnected
              ? previousFocus.current
              : document.getElementById("main")
          }
          className="max-h-[90dvh] overflow-y-auto sm:max-w-md"
        >
          <div className={`mx-auto flex size-12 items-center justify-center rounded-full ${tone}`}>
            <Icon className="size-6" aria-hidden />
          </div>
          <DialogHeader className="text-center">
            <DialogTitle>{result?.title}</DialogTitle>
            <DialogDescription>{result?.description}</DialogDescription>
          </DialogHeader>
          {result?.details?.length ? (
            <ul
              aria-label="Items that need attention"
              className="max-h-[40dvh] space-y-2 overflow-y-auto rounded-lg border p-3 text-sm [overflow-wrap:anywhere]"
            >
              {result.details.map((detail, i) => (
                <li key={i}>{detail}</li>
              ))}
            </ul>
          ) : null}
          <DialogFooter>
            <Button type="button" onClick={() => setResult(null)}>
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ResultContext.Provider>
  );
}

export function useOperationResult(): ShowResult {
  const show = useContext(ResultContext);
  return (
    show ??
    ((result) => {
      if (result.variant === "success")
        toast.success(result.title, { description: result.description });
      else toast.error(result.title, { description: result.description });
    })
  );
}
