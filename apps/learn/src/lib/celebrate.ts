// A short burst of confetti for a finished module or a won round. Private to the person's screen, bundled with the app (no outside
// request), and skipped entirely when the device asks for reduced motion. Loaded only when needed.
export async function celebrate(): Promise<void> {
  if (typeof window === "undefined" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  try {
    const { default: confetti } = await import("canvas-confetti");
    const colors = ["#6c1aba", "#e2be2b", "#b98cee"];
    void confetti({ particleCount: 70, spread: 70, origin: { y: 0.7 }, colors, disableForReducedMotion: true });
    window.setTimeout(() => void confetti({ particleCount: 40, angle: 120, spread: 55, origin: { x: 1, y: 0.8 }, colors, disableForReducedMotion: true }), 180);
  } catch {
    // a decoration only: never let it get in the way of finishing
  }
}
