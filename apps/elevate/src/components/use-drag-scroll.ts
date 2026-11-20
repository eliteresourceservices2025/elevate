"use client";

import { useEffect, useRef } from "react";

// Lets a mouse user grab a wide scrolling box and drag it sideways, so a wide table can be read where the rows are instead of with the
// scroll bar at the bottom. Mouse only: touch already scrolls by dragging, and the keyboard scrolls a focused box with the arrow keys.
// A press on a button, link, field or menu item never starts a drag, and the click that ends a real drag is swallowed so nothing opens by
// accident. Nothing happens when the box is not wider than its content, and then it also shows no grab cursor and takes no keyboard focus:
// the box carries `data-scrollable` (for the cursor) and tabindex 0 only while it really overflows.

/** Elements that keep their own click, focus and text entry. A press on one of them (or inside one) is not a drag. */
const OWN_INPUT = "a,button,input,select,textarea,label,summary,[role='button'],[role='menuitem'],[role='link'],[contenteditable='true'],[data-no-drag]";
/** How far the pointer must move before a press counts as a drag (a plain click or a slight wobble stays a click). */
const DRAG_THRESHOLD_PX = 4;

export function useDragScroll<T extends HTMLElement>(enabled: boolean) {
  const ref = useRef<T>(null);

  useEffect(() => {
    const box = ref.current;
    if (!enabled || !box) return;

    const sync = () => {
      const overflowing = box.scrollWidth > box.clientWidth;
      box.toggleAttribute("data-scrollable", overflowing);
      box.tabIndex = overflowing ? 0 : -1;
    };
    sync();
    const watcher = new ResizeObserver(sync);
    watcher.observe(box);
    if (box.firstElementChild) watcher.observe(box.firstElementChild);

    let pressed = false;
    let dragging = false;
    let startX = 0;
    let startLeft = 0;
    let pointerId = -1;

    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== "mouse" || e.button !== 0) return;
      if (box.scrollWidth <= box.clientWidth) return;
      if (e.target instanceof Element && e.target.closest(OWN_INPUT)) return;
      pressed = true;
      dragging = false;
      startX = e.clientX;
      startLeft = box.scrollLeft;
      pointerId = e.pointerId;
    };

    const onMove = (e: PointerEvent) => {
      if (!pressed) return;
      const moved = e.clientX - startX;
      if (!dragging) {
        if (Math.abs(moved) < DRAG_THRESHOLD_PX) return;
        dragging = true;
        box.setPointerCapture(pointerId);
        box.dataset.dragging = "";
        window.getSelection()?.removeAllRanges(); // a drag must not leave a stripe of selected text behind
      }
      box.scrollLeft = startLeft - moved;
      e.preventDefault();
    };

    const onEnd = () => {
      if (!pressed) return;
      pressed = false;
      if (!dragging) return;
      dragging = false;
      delete box.dataset.dragging;
      try {
        box.releasePointerCapture(pointerId);
      } catch {
        // the pointer was already released (for example the window lost focus)
      }
      const swallow = (event: Event) => {
        event.stopPropagation();
        event.preventDefault();
      };
      box.addEventListener("click", swallow, { capture: true, once: true });
      window.setTimeout(() => box.removeEventListener("click", swallow, { capture: true }), 0);
    };

    box.addEventListener("pointerdown", onDown);
    box.addEventListener("pointermove", onMove);
    box.addEventListener("pointerup", onEnd);
    box.addEventListener("pointercancel", onEnd);
    return () => {
      box.removeEventListener("pointerdown", onDown);
      box.removeEventListener("pointermove", onMove);
      box.removeEventListener("pointerup", onEnd);
      box.removeEventListener("pointercancel", onEnd);
      watcher.disconnect();
      box.removeAttribute("data-scrollable");
      box.removeAttribute("tabindex");
      delete box.dataset.dragging;
    };
  }, [enabled]);

  return ref;
}
