// A short burst of confetti for a finished module or a won round. Private to the person's screen, bundled with the app (no outside
// request), and skipped entirely when the device asks for reduced motion. Loaded only when needed. It is drawn on a canvas of our
// own without a worker, because the strict content security policy does not allow the blob worker the library would otherwise make.
export async function celebrate(): Promise<void> {
  if (typeof window === "undefined" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  try {
    const { default: confetti } = await import("canvas-confetti");
    const canvas = document.createElement("canvas");
    canvas.setAttribute("aria-hidden", "true");
    canvas.style.cssText = "position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:1000";
    document.body.appendChild(canvas);
    const fire = confetti.create(canvas, { resize: true, useWorker: false });
    const colors = ["#6c1aba", "#e2be2b", "#b98cee"];
    void fire({ particleCount: 70, spread: 70, origin: { y: 0.7 }, colors, disableForReducedMotion: true });
    window.setTimeout(() => void fire({ particleCount: 40, angle: 120, spread: 55, origin: { x: 1, y: 0.8 }, colors, disableForReducedMotion: true }), 180);
    window.setTimeout(() => {
      fire.reset();
      canvas.remove();
    }, 5000);
  } catch {
    // a decoration only: never let it get in the way of finishing
  }
}
