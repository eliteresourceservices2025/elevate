"use client";

import { useEffect, useRef, type ReactNode } from "react";

const FOCUSABLE = 'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * A dialog that behaves like one for the keyboard and a screen reader: focus moves into it when it opens (to the first control, or to
 * the one marked data-autofocus), Tab and Shift+Tab stay inside, Escape closes it (`onClose`), and focus goes back to where it was
 * when it closes. Without this the page behind kept the keyboard and a screen reader user could not find the buttons.
 */
export function Modal({ labelledBy, onClose, children }: { labelledBy: string; onClose?: () => void; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const node = box.current;
    const controls = () => (node ? [...node.querySelectorAll<HTMLElement>(FOCUSABLE)] : []);
    (node?.querySelector<HTMLElement>("[data-autofocus]") ?? controls()[0] ?? node)?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && close.current) {
        e.preventDefault();
        e.stopPropagation();
        close.current();
        return;
      }
      if (e.key !== "Tab") return;
      const list = controls();
      if (list.length === 0) {
        e.preventDefault();
        return;
      }
      const first = list[0];
      const last = list[list.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !node?.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !node?.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      if (before && document.contains(before)) before.focus();
    };
  }, []);

  return (
    <div className="modal-back">
      <div ref={box} role="dialog" aria-modal="true" aria-labelledby={labelledBy} className="modal" tabIndex={-1}>
        {children}
      </div>
    </div>
  );
}
