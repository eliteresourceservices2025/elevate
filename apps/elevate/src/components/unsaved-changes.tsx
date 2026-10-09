"use client";

import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
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

/**
 * "You have changes that are not saved." A form tells this provider whether it holds unsaved work (useUnsavedChanges). While any does:
 * closing or reloading the tab asks the browser's own question, and clicking any link inside ELEVATE (the menu, a breadcrumb, a button
 * that is a link) stops and asks first, with "Keep editing" and "Leave page". Going back with the browser's Back button cannot be
 * stopped by a web page that uses client-side navigation, so that one leaves without asking.
 */
type Register = (id: string, dirty: boolean) => void;
const Ctx = createContext<Register | null>(null);

/** True for a link that would open another page of this site in this tab. Pure so it can be tested. */
export function leavesThePage(a: { href: string; target: string; download: boolean }, current: { origin: string; pathname: string; search: string }, mods: { meta: boolean; ctrl: boolean; shift: boolean; alt: boolean; button: number }): string | null {
  if (mods.meta || mods.ctrl || mods.shift || mods.alt || mods.button !== 0 || a.download) return null;
  if (a.target && a.target !== "_self") return null;
  let url: URL;
  try {
    url = new URL(a.href, current.origin);
  } catch {
    return null;
  }
  if (url.origin !== current.origin) return null;
  if (url.pathname === current.pathname && url.search === current.search) return null; // same page (an anchor, a re-click)
  return `${url.pathname}${url.search}${url.hash}`;
}

export function UnsavedChangesProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const dirtyIds = useRef(new Set<string>());
  const [target, setTarget] = useState<string | null>(null);

  const register = useCallback<Register>((id, dirty) => {
    if (dirty) dirtyIds.current.add(id);
    else dirtyIds.current.delete(id);
  }, []);

  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (dirtyIds.current.size === 0) return;
      e.preventDefault();
      e.returnValue = "";
    };
    const onClick = (e: MouseEvent) => {
      if (dirtyIds.current.size === 0 || e.defaultPrevented) return;
      const anchor = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!anchor) return;
      const next = leavesThePage(
        { href: anchor.href, target: anchor.target, download: anchor.hasAttribute("download") },
        { origin: window.location.origin, pathname: window.location.pathname, search: window.location.search },
        { meta: e.metaKey, ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey, button: e.button },
      );
      if (!next) return;
      // Stop the click before the site's own link handling sees it, and ask.
      e.preventDefault();
      e.stopPropagation();
      setTarget(next);
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, []);

  const value = useMemo(() => register, [register]);

  return (
    <Ctx.Provider value={value}>
      {children}
      <AlertDialog open={target !== null} onOpenChange={(open) => !open && setTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Leave without saving?</AlertDialogTitle>
            <AlertDialogDescription>You have changes that are not saved. If you leave this page now, they are lost.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const go = target;
                dirtyIds.current.clear();
                setTarget(null);
                if (go) router.push(go);
              }}
            >
              Leave page
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Ctx.Provider>
  );
}

/**
 * Call with `true` while the form holds changes that are not saved, `false` when it is clean or was just saved. Safe to call where no
 * provider exists (it then does nothing), and it clears itself when the form leaves the page.
 */
export function useUnsavedChanges(dirty: boolean): void {
  const register = useContext(Ctx);
  const id = useId();
  useEffect(() => {
    register?.(id, dirty);
    return () => register?.(id, false);
  }, [register, id, dirty]);
}

/**
 * For a form kept in plain state: pass everything the person can edit. It is "edited" while that differs from what it was when the
 * form first appeared (or when markSaved was last called, for a form that stays on screen after saving, like a draft, or when
 * resetKey changes, for a form that loads a different item).
 */
export function useWarnWhenEdited(values: unknown, resetKey?: string): { edited: boolean; markSaved: () => void } {
  const now = JSON.stringify(values);
  const latest = useRef(now);
  useEffect(() => {
    latest.current = now;
  });
  const [saved, setSaved] = useState(now);
  // A different item loaded into the same form (resetKey changed) starts clean, whatever it holds.
  useEffect(() => setSaved(latest.current), [resetKey]);
  const edited = now !== saved;
  useUnsavedChanges(edited);
  return { edited, markSaved: () => setSaved(latest.current) };
}
