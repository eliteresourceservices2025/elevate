// The quick tour: what it says and where its tooltip goes. Pure (no browser), so the rules can be tested.

export type TourStep = {
  id: string;
  /** Selectors of the thing to point at, tried in order; the first one that is on screen wins. Null = a centered message. */
  targets: string[] | null;
  title: string;
  body: string;
};

export const TOUR_STEPS: TourStep[] = [
  {
    id: "welcome",
    targets: null,
    title: "Welcome to ELEVATE",
    body: "This is where you clock in, ask for time off, see your schedule and keep your records. A one-minute tour shows you where things are.",
  },
  {
    id: "menu",
    targets: ['[data-tour="menu"]', '[data-tour="menu-button"]'],
    title: "The menu",
    body: "Everything lives here: your time clock and attendance, time off, schedule, documents and more. On a phone, tap the menu button at the top left.",
  },
  {
    id: "search",
    targets: ['[data-tour="search"]'],
    title: "Search",
    body: "Find a person, a page or an announcement. From anywhere, press Ctrl K (Cmd K on a Mac).",
  },
  {
    id: "clock",
    targets: ['[data-tour="clock"]'],
    title: "Your time clock",
    body: "Clock in when you start, take a break from here, and clock out when you finish. ELEVATE is the only record of your hours. If it says your profile is not set up, tell HR.",
  },
  {
    id: "bell",
    targets: ['[data-tour="bell"]'],
    title: "Notifications",
    body: "Approvals, reminders and news show up here, with a number when something is waiting for you.",
  },
  {
    id: "account",
    targets: ['[data-tour="account"]'],
    title: "Your account",
    body: "Open your profile, see what ELEVATE holds about you, or sign out. You can replay this tour from here or from Settings whenever you like.",
  },
  {
    id: "speak-up",
    targets: ['[data-tour="speak-up"]'],
    title: "Report a concern",
    body: "If something is wrong at work, this opens a separate, anonymous site. Nothing you send there is linked to your account.",
  },
  {
    id: "done",
    targets: null,
    title: "You are all set",
    body: "Start from the dashboard. Replay this tour from the account menu or from Settings any time.",
  },
];

export type ResolvedStep = TourStep & { selector: string | null };

/** The steps worth showing: those with no target, and those whose target is on screen right now (a step is skipped, never shown pointing at nothing). */
export function usableSteps(steps: readonly TourStep[], isOnScreen: (selector: string) => boolean): ResolvedStep[] {
  const out: ResolvedStep[] = [];
  for (const step of steps) {
    if (step.targets === null) {
      out.push({ ...step, selector: null });
      continue;
    }
    const selector = step.targets.find(isOnScreen);
    if (selector) out.push({ ...step, selector });
  }
  return out;
}

export type Rect = { top: number; left: number; width: number; height: number };
export type CardPlace = { docked: true } | { docked: false; top: number; left: number };

const MARGIN = 12;
const GAP = 14;

/**
 * Where the tooltip goes. On a narrow screen it docks to the bottom edge (the thing it points at is in the header). Otherwise it sits
 * below the target, or above when there is no room below, or beside it, and is always kept fully on screen. No target = centered.
 */
export function placeCard(target: Rect | null, viewport: { width: number; height: number }, card: { width: number; height: number }): CardPlace {
  if (viewport.width < 640) return { docked: true };
  const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(n, max));
  if (!target) return { docked: false, top: Math.round((viewport.height - card.height) / 2), left: Math.round((viewport.width - card.width) / 2) };
  const fitsBelow = target.top + target.height + GAP + card.height <= viewport.height - MARGIN;
  const fitsAbove = target.top - GAP - card.height >= MARGIN;
  const centeredLeft = target.left + target.width / 2 - card.width / 2;
  const maxLeft = viewport.width - card.width - MARGIN;
  if (fitsBelow) return { docked: false, top: Math.round(target.top + target.height + GAP), left: Math.round(clamp(centeredLeft, MARGIN, maxLeft)) };
  if (fitsAbove) return { docked: false, top: Math.round(target.top - GAP - card.height), left: Math.round(clamp(centeredLeft, MARGIN, maxLeft)) };
  // A tall target such as the menu: beside it, on the side with more room.
  const roomRight = viewport.width - (target.left + target.width);
  const left = roomRight >= card.width + GAP + MARGIN ? target.left + target.width + GAP : target.left - GAP - card.width;
  return {
    docked: false,
    top: Math.round(clamp(target.top + 16, MARGIN, viewport.height - card.height - MARGIN)),
    left: Math.round(clamp(left, MARGIN, maxLeft)),
  };
}
