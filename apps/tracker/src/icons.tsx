// Small inline icons (no icon library: the window stays tiny). Decorative: the buttons that use them have their own text label.
type Props = { size?: number };
const base = (size: number) => ({ width: size, height: size, viewBox: "0 0 24 24", fill: "none", "aria-hidden": true, focusable: false }) as const;

export const PlayIcon = ({ size = 24 }: Props) => (
  <svg {...base(size)}>
    <path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z" fill="currentColor" />
  </svg>
);
export const StopIcon = ({ size = 24 }: Props) => (
  <svg {...base(size)}>
    <rect x="6" y="6" width="12" height="12" rx="2.5" fill="currentColor" />
  </svg>
);
export const CoffeeIcon = ({ size = 24 }: Props) => (
  <svg {...base(size)} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M5 9h11v5a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4V9Z" />
    <path d="M16 10h1.5a2.5 2.5 0 0 1 0 5H16" />
    <path d="M8 3.5v2M12 3.5v2" />
  </svg>
);
export const SwitchIcon = ({ size = 24 }: Props) => (
  <svg {...base(size)} stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
    <path d="M5 8h13l-3.5-3.5M19 16H6l3.5 3.5" />
  </svg>
);
export const SearchIcon = ({ size = 16 }: Props) => (
  <svg {...base(size)} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="6.5" />
    <path d="m16 16 4.5 4.5" />
  </svg>
);
