import {
  Bell,
  BellRing,
  Bug,
  Check,
  Ear,
  Eye,
  EyeOff,
  Flag,
  Gavel,
  Globe,
  Handshake,
  Heart,
  HeartPulse,
  KeyRound,
  Landmark,
  Lock,
  Mail,
  MailWarning,
  Megaphone,
  MessageCircle,
  Scale,
  Search,
  Server,
  ShieldCheck,
  Siren,
  Sparkles,
  Star,
  Stethoscope,
  TriangleAlert,
  Wifi,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";

/**
 * The picture on a module card: a small drawn scene (320 x 180) made from a few shapes (people, phones, screens, documents, shields) and
 * the lucide icons the app already uses, in the ELEVATE purple and gold. Nothing is downloaded and every scene is plain SVG, so it looks
 * the same in light and dark. The picture is decoration: the card's text says what the module is, so the SVG is hidden from screen readers.
 * A module with no scene of its own (a client add-on) gets a generic one with a colour taken from its name.
 */

export const C = {
  purple: "#6C1ABA",
  deep: "#34115F",
  lav: "#B98CEE",
  pale: "#EDE3F8",
  gold: "#E2BE2B",
  paleGold: "#F7E9A8",
  white: "#FFFFFF",
  ink: "#1F1535",
  teal: "#1FA595",
  paleTeal: "#A8EBE1",
  coral: "#F0705A",
  paleCoral: "#FFD0C6",
  sky: "#4C8DF6",
  paleSky: "#C6DAFF",
  rose: "#E4577E",
  skin1: "#F2C9A5",
  skin2: "#C98F66",
  skin3: "#8D5A3B",
};

export type Backdrop = "purple" | "deep" | "teal" | "coral" | "sky" | "gold" | "rose";
export const BACKDROP: Record<Backdrop, string> = {
  purple: "linear-gradient(135deg, #6C1ABA 0%, #A862EA 100%)",
  deep: "linear-gradient(135deg, #2A0F4A 0%, #5B2AA0 100%)",
  teal: "linear-gradient(135deg, #0E7A6F 0%, #35C4B2 100%)",
  coral: "linear-gradient(135deg, #D8503C 0%, #F59A86 100%)",
  sky: "linear-gradient(135deg, #2A5FCB 0%, #6EA8FF 100%)",
  gold: "linear-gradient(135deg, #B88A00 0%, #F2D45C 100%)",
  rose: "linear-gradient(135deg, #B8335B 0%, #F07FA2 100%)",
};

type At = { x: number; y: number; s?: number; r?: number };
const at = ({ x, y, s = 1, r = 0 }: At) => `translate(${x} ${y}) rotate(${r}) scale(${s})`;

// ---- shapes ------------------------------------------------------------------------------------------------------------------------

export function Person({ x, y, s, r, skin = C.skin1, hair = C.ink, shirt = C.purple, headset = false }: At & { skin?: string; hair?: string; shirt?: string; headset?: boolean }) {
  return (
    <g transform={at({ x, y, s, r })}>
      <path d="M-32 0 C-32 -22 -17 -28 0 -28 C17 -28 32 -22 32 0 Z" fill={shirt} />
      <rect x="-5" y="-34" width="10" height="9" rx="3" fill={skin} />
      <circle cx="0" cy="-46" r="15" fill={skin} />
      <path d="M-16 -48 C-16 -64 16 -64 16 -48 C10 -55 -8 -55 -16 -48 Z" fill={hair} />
      {headset ? (
        <g fill="none" stroke={C.ink} strokeWidth="3" strokeLinecap="round">
          <path d="M-17 -48 A17 17 0 0 1 17 -48" />
          <path d="M-17 -46 L-17 -40" strokeWidth="6" />
          <path d="M17 -46 L17 -40" strokeWidth="6" />
          <path d="M-17 -40 C-17 -30 -8 -29 -2 -29" strokeWidth="2" />
        </g>
      ) : null}
    </g>
  );
}

export function Phone({ x, y, s, r, tint = C.pale }: At & { tint?: string }) {
  return (
    <g transform={at({ x, y, s, r })}>
      <rect x="-19" y="-34" width="38" height="68" rx="8" fill={C.ink} />
      <rect x="-15" y="-29" width="30" height="55" rx="4" fill={tint} />
      <rect x="-5" y="-32" width="10" height="2" rx="1" fill={C.lav} />
      {[-9, -3, 3, 9].map((bx, i) => (
        <rect key={bx} x={bx - 1.5} y={-8 - [4, 9, 6, 11][i]} width="3" height={[8, 18, 12, 22][i]} rx="1.5" fill={C.purple} />
      ))}
      <circle cx="0" cy="30" r="2" fill={C.lav} />
    </g>
  );
}

export function Monitor({ x, y, s, r, children }: At & { children?: ReactNode }) {
  return (
    <g transform={at({ x, y, s, r })}>
      <rect x="-46" y="-32" width="92" height="58" rx="6" fill={C.ink} />
      <rect x="-42" y="-28" width="84" height="50" rx="3" fill={C.white} />
      {children ?? (
        <g fill={C.pale}>
          <rect x="-36" y="-22" width="40" height="6" rx="3" />
          <rect x="-36" y="-11" width="70" height="5" rx="2.5" />
          <rect x="-36" y="-2" width="56" height="5" rx="2.5" />
          <rect x="-36" y="8" width="30" height="8" rx="4" fill={C.lav} />
        </g>
      )}
      <rect x="-7" y="26" width="14" height="9" fill={C.ink} />
      <rect x="-22" y="35" width="44" height="5" rx="2.5" fill={C.ink} />
    </g>
  );
}

export function Doc({ x, y, s, r, check = false, lines = 4, accent = C.purple }: At & { check?: boolean; lines?: number; accent?: string }) {
  return (
    <g transform={at({ x, y, s, r })}>
      <path d="M-26 -34 H12 L26 -20 V34 a4 4 0 0 1 -4 4 H-22 a4 4 0 0 1 -4 -4 Z" fill={C.white} />
      <path d="M12 -34 V-24 a4 4 0 0 0 4 4 H26 Z" fill={C.pale} />
      {Array.from({ length: lines }, (_, i) => (
        <g key={i}>
          {check ? <circle cx="-16" cy={-10 + i * 11} r="3.4" fill={accent} /> : null}
          <rect x={check ? -9 : -17} y={-12 + i * 11} width={check ? 24 : 34 - (i % 2) * 9} height="4" rx="2" fill={C.pale} />
        </g>
      ))}
    </g>
  );
}

export function Shield({ x, y, s, r, fill = C.white, children }: At & { fill?: string; children?: ReactNode }) {
  return (
    <g transform={at({ x, y, s, r })}>
      <path d="M0 -38 L30 -27 V4 C30 24 15 35 0 42 C-15 35 -30 24 -30 4 V-27 Z" fill={fill} />
      <path d="M0 -30 L22 -22 V3 C22 18 11 27 0 33 Z" fill={C.pale} opacity="0.55" />
      {children}
    </g>
  );
}

export function Bubble({ x, y, s, r, flip = false, fill = C.white, children }: At & { flip?: boolean; fill?: string; children?: ReactNode }) {
  return (
    <g transform={at({ x, y, s, r })}>
      <g transform={flip ? "scale(-1 1)" : undefined}>
        <rect x="-36" y="-22" width="72" height="44" rx="14" fill={fill} />
        <path d="M-18 20 L-26 34 L-4 21 Z" fill={fill} />
      </g>
      {children}
    </g>
  );
}

export function Lines({ x, y, color = C.pale, widths = [44, 32] }: { x: number; y: number; color?: string; widths?: number[] }) {
  return (
    <g fill={color}>
      {widths.map((w, i) => (
        <rect key={i} x={x} y={y + i * 11} width={w} height="5" rx="2.5" />
      ))}
    </g>
  );
}

/** A round badge with one of the app's icons in it. */
export function Badge({ x, y, s = 1, icon: Icon, bg = C.gold, fg = C.ink, r = 18 }: At & { icon: LucideIcon; bg?: string; fg?: string; r?: number }) {
  const size = r * 1.15;
  return (
    <g transform={at({ x, y, s })}>
      <circle r={r} fill={bg} />
      <Icon x={-size / 2} y={-size / 2} width={size} height={size} color={fg} strokeWidth={2.2} aria-hidden="true" />
    </g>
  );
}

export function Spark({ x, y, s = 1, fill = C.gold }: At & { fill?: string }) {
  return <path transform={at({ x, y, s })} d="M0 -10 C1 -3 3 -1 10 0 C3 1 1 3 0 10 C-1 3 -3 1 -10 0 C-3 -1 -1 -3 0 -10 Z" fill={fill} />;
}

export function Dots({ x, y, color = C.white, rows = 3, cols = 5, gap = 12 }: { x: number; y: number; color?: string; rows?: number; cols?: number; gap?: number }) {
  return (
    <g fill={color} opacity="0.35">
      {Array.from({ length: rows * cols }, (_, i) => (
        <circle key={i} cx={x + (i % cols) * gap} cy={y + Math.floor(i / cols) * gap} r="2" />
      ))}
    </g>
  );
}

export function Hills({ a = C.deep, b = C.purple }: { a?: string; b?: string }) {
  return (
    <g>
      <path d="M0 150 C60 120 110 140 170 128 C230 116 280 130 320 118 V180 H0 Z" fill={b} opacity="0.55" />
      <path d="M0 165 C70 145 130 160 200 148 C250 140 290 150 320 144 V180 H0 Z" fill={a} opacity="0.8" />
    </g>
  );
}

export function Rings({ cx = 160, cy = 92, color = C.white }: { cx?: number; cy?: number; color?: string }) {
  return (
    <g fill="none" stroke={color} opacity="0.22">
      <circle cx={cx} cy={cy} r="78" strokeWidth="1.5" />
      <circle cx={cx} cy={cy} r="54" strokeWidth="1.5" />
      <circle cx={cx} cy={cy} r="102" strokeWidth="1" />
    </g>
  );
}

// ---- scenes ------------------------------------------------------------------------------------------------------------------------

export type Scene = { bg: Backdrop; art: ReactNode };

export const SCENES: Record<string, Scene> = {
  // Customer Service
  "customer-service/excellence": {
    bg: "purple",
    art: (
      <>
        <Rings cx={150} />
        <Person x={140} y={160} s={1.5} headset skin={C.skin2} shirt={C.gold} hair={C.ink} />
        <Bubble x={236} y={64} fill={C.white}>
          <Heart x={-12} y={-12} width={24} height={24} color={C.rose} fill={C.rose} aria-hidden="true" />
        </Bubble>
        <Badge x={64} y={54} icon={Star} bg={C.gold} />
        <Spark x={268} y={132} s={1.3} />
        <Spark x={40} y={120} s={0.8} fill={C.white} />
      </>
    ),
  },
  "customer-service/communication": {
    bg: "sky",
    art: (
      <>
        <Dots x={226} y={24} />
        <Bubble x={112} y={70} fill={C.white}>
          <Lines x={-24} y={-8} widths={[46, 30]} />
        </Bubble>
        <Bubble x={206} y={106} flip fill={C.gold}>
          <Lines x={-22} y={-8} color={C.paleGold} widths={[44, 28]} />
        </Bubble>
        <Badge x={266} y={44} icon={MessageCircle} bg={C.white} fg={C.sky} />
        <Spark x={40} y={140} s={0.9} fill={C.white} />
      </>
    ),
  },
  "customer-service/channels": {
    bg: "deep",
    art: (
      <>
        <Dots x={20} y={18} rows={2} cols={4} />
        <Monitor x={170} y={92} s={1.05}>
          <g fill={C.pale}>
            <rect x="-36" y="-22" width="40" height="9" rx="4.5" fill={C.lav} />
            <rect x="-6" y="-8" width="40" height="9" rx="4.5" />
            <rect x="-36" y="6" width="34" height="9" rx="4.5" fill={C.lav} />
          </g>
        </Monitor>
        <Phone x={78} y={104} r={-8} />
        <Badge x={262} y={64} icon={Mail} bg={C.gold} />
        <Spark x={278} y={136} s={1} />
      </>
    ),
  },
  "customer-service/listening": {
    bg: "teal",
    art: (
      <>
        <Rings cx={160} cy={96} />
        <Person x={150} y={160} s={1.5} skin={C.skin3} shirt={C.white} hair={C.ink} />
        <Badge x={232} y={60} icon={Ear} bg={C.white} fg={C.teal} r={20} />
        <g fill="none" stroke={C.white} strokeWidth="3" strokeLinecap="round" opacity="0.85">
          <path d="M254 92 a14 14 0 0 1 0 24" />
          <path d="M264 84 a24 24 0 0 1 0 40" opacity="0.6" />
        </g>
        <Spark x={66} y={52} fill={C.paleGold} />
      </>
    ),
  },
  "customer-service/confidentiality": {
    bg: "deep",
    art: (
      <>
        <Rings cx={160} cy={96} />
        <Doc x={92} y={104} s={0.9} r={-10} />
        <Shield x={170} y={98} s={1.35}>
          <Lock x={-11} y={-14} width={22} height={22} color={C.purple} strokeWidth={2.4} aria-hidden="true" />
        </Shield>
        <Badge x={256} y={56} icon={KeyRound} bg={C.gold} />
        <Spark x={270} y={140} s={0.9} fill={C.white} />
      </>
    ),
  },
  "customer-service/healthcare": {
    bg: "teal",
    art: (
      <>
        <Dots x={236} y={18} rows={3} cols={4} />
        <Person x={116} y={160} s={1.45} skin={C.skin1} shirt={C.paleTeal} hair={C.deep} />
        <Doc x={224} y={104} s={0.95} r={6} check accent={C.teal} lines={3} />
        <Badge x={64} y={52} icon={HeartPulse} bg={C.white} fg={C.coral} r={20} />
        <Badge x={266} y={44} icon={Stethoscope} bg={C.gold} />
      </>
    ),
  },
  "customer-service/difficult": {
    bg: "coral",
    art: (
      <>
        <Rings cx={160} cy={96} />
        <Person x={116} y={160} s={1.45} skin={C.skin2} shirt={C.white} hair={C.ink} />
        <Bubble x={226} y={64} fill={C.white}>
          <Zap x={-12} y={-14} width={24} height={24} color={C.coral} fill={C.paleCoral} aria-hidden="true" />
        </Bubble>
        <Badge x={262} y={134} icon={Handshake} bg={C.gold} />
        <Spark x={50} y={56} fill={C.paleGold} />
      </>
    ),
  },
  "customer-service/personalities": {
    bg: "rose",
    art: (
      <>
        <Dots x={20} y={20} rows={2} cols={5} />
        <Person x={86} y={162} s={1.2} skin={C.skin1} shirt={C.gold} hair={C.deep} />
        <Person x={160} y={166} s={1.5} skin={C.skin3} shirt={C.white} hair={C.ink} />
        <Person x={236} y={162} s={1.2} skin={C.skin2} shirt={C.purple} hair={C.ink} />
        <Badge x={86} y={46} s={0.8} icon={Heart} bg={C.white} fg={C.rose} />
        <Badge x={236} y={46} s={0.8} icon={Zap} bg={C.white} fg={C.coral} />
        <Badge x={160} y={36} s={0.9} icon={Sparkles} bg={C.gold} />
      </>
    ),
  },
  "customer-service/bad_news": {
    bg: "deep",
    art: (
      <>
        <Rings cx={150} />
        <Bubble x={130} y={78} fill={C.white}>
          <X x={-13} y={-14} width={26} height={26} color={C.coral} strokeWidth={3} aria-hidden="true" />
        </Bubble>
        <Bubble x={214} y={110} flip fill={C.gold}>
          <Heart x={-12} y={-12} width={24} height={24} color={C.deep} fill={C.deep} aria-hidden="true" />
        </Bubble>
        <Badge x={270} y={48} icon={Handshake} bg={C.white} fg={C.purple} />
      </>
    ),
  },
  "customer-service/resolution": {
    bg: "teal",
    art: (
      <>
        <Dots x={236} y={20} />
        <Doc x={112} y={96} s={1.15} check accent={C.teal} lines={4} />
        <path d="M156 96 H214" stroke={C.white} strokeWidth="3" strokeDasharray="2 8" strokeLinecap="round" />
        <Badge x={236} y={96} icon={Check} bg={C.gold} r={22} />
        <Badge x={64} y={40} icon={Flag} bg={C.white} fg={C.teal} s={0.8} />
        <Spark x={268} y={46} s={0.9} fill={C.paleGold} />
      </>
    ),
  },
  "customer-service/resilience": {
    bg: "purple",
    art: (
      <>
        <circle cx="244" cy="52" r="20" fill={C.gold} />
        <path d="M0 150 L70 74 L110 118 L170 48 L250 150 Z" fill={C.deep} opacity="0.85" />
        <path d="M70 74 L84 90 L74 88 L66 96 L56 88 Z" fill={C.white} opacity="0.9" />
        <path d="M170 48 L190 74 L178 70 L170 80 L160 70 L150 74 Z" fill={C.white} opacity="0.9" />
        <Hills a={C.deep} b={C.lav} />
        <Badge x={170} y={30} s={0.7} icon={Flag} bg={C.gold} />
        <Spark x={52} y={38} fill={C.white} />
      </>
    ),
  },

  // HIPAA
  "hipaa/foundations": {
    bg: "purple",
    art: (
      <>
        <Rings />
        <Shield x={160} y={98} s={1.45}>
          <path d="M-6 -18 H6 V-6 H18 V6 H6 V18 H-6 V6 H-18 V-6 H-6 Z" fill={C.purple} />
        </Shield>
        <Doc x={70} y={110} s={0.8} r={-12} />
        <Badge x={262} y={54} icon={ShieldCheck} bg={C.gold} />
      </>
    ),
  },
  "hipaa/phi": {
    bg: "deep",
    art: (
      <>
        <Dots x={236} y={20} />
        <Doc x={120} y={100} s={1.15} lines={3} />
        <rect x="100" y="76" width="22" height="22" rx="4" fill={C.lav} />
        <Badge x={214} y={78} icon={Search} bg={C.gold} r={22} />
        <Badge x={262} y={132} icon={Lock} bg={C.white} fg={C.purple} s={0.8} />
      </>
    ),
  },
  "hipaa/privacy": {
    bg: "sky",
    art: (
      <>
        <Rings cx={160} />
        <Doc x={112} y={100} s={1.1} r={-6} />
        <Badge x={206} y={82} icon={EyeOff} bg={C.white} fg={C.sky} r={24} />
        <Shield x={268} y={60} s={0.6} fill={C.gold} />
        <Spark x={52} y={44} fill={C.white} />
      </>
    ),
  },
  "hipaa/rights": {
    bg: "rose",
    art: (
      <>
        <Dots x={20} y={20} />
        <Person x={108} y={162} s={1.45} skin={C.skin2} shirt={C.white} hair={C.ink} />
        <Doc x={216} y={98} s={1} r={5} check accent={C.rose} lines={3} />
        <Badge x={262} y={42} icon={Scale} bg={C.gold} />
        <Badge x={60} y={46} icon={Heart} bg={C.white} fg={C.rose} s={0.8} />
      </>
    ),
  },
  "hipaa/associates": {
    bg: "teal",
    art: (
      <>
        <Rings cx={160} />
        <Doc x={102} y={100} s={1} r={-8} />
        <Doc x={218} y={100} s={1} r={8} />
        <Badge x={160} y={96} icon={Handshake} bg={C.gold} r={26} />
        <Spark x={160} y={34} fill={C.white} />
      </>
    ),
  },
  "hipaa/security": {
    bg: "deep",
    art: (
      <>
        <Dots x={20} y={20} rows={2} cols={5} />
        <Monitor x={150} y={92} s={1.1}>
          <Lock x={-14} y={-18} width={28} height={28} color={C.purple} strokeWidth={2.2} aria-hidden="true" />
        </Monitor>
        <Badge x={252} y={56} icon={Server} bg={C.gold} />
        <Shield x={270} y={134} s={0.6} fill={C.white} />
      </>
    ),
  },
  "hipaa/incidents": {
    bg: "coral",
    art: (
      <>
        <Rings cx={150} />
        <Doc x={120} y={102} s={1.1} r={-6} />
        <Badge x={214} y={74} icon={TriangleAlert} bg={C.gold} r={26} />
        <Badge x={266} y={134} icon={BellRing} bg={C.white} fg={C.coral} s={0.8} />
      </>
    ),
  },
  "hipaa/enforcement": {
    bg: "purple",
    art: (
      <>
        <Dots x={236} y={20} />
        <Badge x={116} y={88} icon={Gavel} bg={C.gold} r={30} />
        <Badge x={214} y={70} icon={Scale} bg={C.white} fg={C.purple} r={22} />
        <Doc x={228} y={128} s={0.7} r={8} lines={2} />
        <Spark x={50} y={40} fill={C.white} />
      </>
    ),
  },
  "hipaa/lab_public": {
    bg: "sky",
    art: (
      <>
        <Dots x={20} y={20} />
        <Monitor x={170} y={96} s={1.05} />
        <Phone x={76} y={108} r={-8} />
        <Badge x={268} y={46} icon={Megaphone} bg={C.gold} />
      </>
    ),
  },
  "hipaa/lab_records": {
    bg: "teal",
    art: (
      <>
        <Rings cx={160} />
        <Doc x={96} y={108} s={0.95} r={-12} lines={3} />
        <Doc x={150} y={100} s={1.1} lines={4} />
        <Doc x={208} y={108} s={0.95} r={12} lines={3} />
        <Badge x={266} y={50} icon={Search} bg={C.gold} />
      </>
    ),
  },
  "hipaa/state_laws": {
    bg: "deep",
    art: (
      <>
        <Dots x={20} y={20} />
        <Badge x={150} y={86} icon={Landmark} bg={C.gold} r={32} />
        <Doc x={238} y={110} s={0.9} r={8} lines={3} />
        <path d="M54 130 L82 112 L110 130 L82 150 Z" fill={C.lav} opacity="0.7" />
        <Badge x={82} y={112} s={0.6} icon={Flag} bg={C.white} fg={C.purple} />
      </>
    ),
  },

  // Cybersecurity
  "cybersecurity/why": {
    bg: "purple",
    art: (
      <>
        <Rings cx={160} />
        <Person x={96} y={166} s={1.15} skin={C.skin2} shirt={C.gold} hair={C.ink} />
        <Person x={224} y={166} s={1.15} skin={C.skin1} shirt={C.white} hair={C.deep} />
        <Shield x={160} y={92} s={1.25}>
          <Check x={-13} y={-14} width={26} height={26} color={C.purple} strokeWidth={3} aria-hidden="true" />
        </Shield>
      </>
    ),
  },
  "cybersecurity/passwords": {
    bg: "deep",
    art: (
      <>
        <Dots x={236} y={20} />
        <rect x="60" y="68" width="170" height="40" rx="20" fill={C.white} />
        {[88, 112, 136, 160, 184].map((cx) => (
          <circle key={cx} cx={cx} cy="88" r="6" fill={C.purple} />
        ))}
        <Badge x={252} y={88} icon={KeyRound} bg={C.gold} r={26} />
        <Badge x={80} y={140} icon={Lock} bg={C.lav} fg={C.deep} s={0.8} />
      </>
    ),
  },
  "cybersecurity/phishing": {
    bg: "coral",
    art: (
      <>
        <Rings cx={150} />
        <rect x="86" y="62" width="100" height="68" rx="8" fill={C.white} />
        <path d="M90 68 L136 104 L182 68" fill="none" stroke={C.coral} strokeWidth="4" strokeLinejoin="round" />
        <path d="M222 38 V78 a14 14 0 1 1 -14 -14" fill="none" stroke={C.white} strokeWidth="4" strokeLinecap="round" />
        <Badge x={210} y={120} icon={MailWarning} bg={C.gold} r={24} />
      </>
    ),
  },
  "cybersecurity/malware": {
    bg: "deep",
    art: (
      <>
        <Dots x={20} y={20} />
        <Monitor x={148} y={94} s={1.1}>
          <TriangleAlert x={-14} y={-18} width={28} height={28} color={C.coral} strokeWidth={2.4} aria-hidden="true" />
        </Monitor>
        <Badge x={248} y={58} icon={Bug} bg={C.gold} r={24} />
        <Spark x={272} y={130} s={0.8} fill={C.white} />
      </>
    ),
  },
  "cybersecurity/browsing": {
    bg: "sky",
    art: (
      <>
        <Dots x={236} y={20} />
        <rect x="52" y="40" width="190" height="112" rx="10" fill={C.white} />
        <path d="M52 50 a10 10 0 0 1 10 -10 H232 a10 10 0 0 1 10 10 V62 H52 Z" fill={C.pale} />
        <circle cx="68" cy="51" r="3.5" fill={C.coral} />
        <circle cx="80" cy="51" r="3.5" fill={C.gold} />
        <circle cx="92" cy="51" r="3.5" fill={C.teal} />
        <rect x="108" y="45" width="100" height="12" rx="6" fill={C.white} />
        <Lock x={113} y={46} width={10} height={10} color={C.teal} strokeWidth={3} aria-hidden="true" />
        <Lines x={70} y={80} widths={[110, 84, 96]} />
        <Badge x={248} y={118} icon={Globe} bg={C.gold} r={26} />
      </>
    ),
  },
  "cybersecurity/ai_tools": {
    bg: "purple",
    art: (
      <>
        <Rings cx={160} />
        <Bubble x={120} y={84} fill={C.white}>
          <Lines x={-24} y={-8} widths={[46, 30]} />
        </Bubble>
        <Badge x={216} y={70} icon={Sparkles} bg={C.gold} r={28} />
        <Shield x={262} y={128} s={0.55} fill={C.white} />
        <Spark x={48} y={46} fill={C.white} />
      </>
    ),
  },
  "cybersecurity/devices": {
    bg: "teal",
    art: (
      <>
        <Dots x={236} y={20} />
        <path d="M70 128 H210 L222 142 H58 Z" fill={C.ink} />
        <rect x="82" y="56" width="116" height="72" rx="6" fill={C.ink} />
        <rect x="87" y="61" width="106" height="62" rx="3" fill={C.white} />
        <Lines x={98} y={74} widths={[70, 50, 60]} />
        <Phone x={252} y={104} s={0.9} r={8} />
        <Badge x={146} y={32} icon={Wifi} bg={C.gold} s={0.9} />
      </>
    ),
  },
  "cybersecurity/physical": {
    bg: "deep",
    art: (
      <>
        <Dots x={20} y={20} />
        <rect x="100" y="34" width="80" height="120" rx="6" fill={C.lav} />
        <rect x="108" y="42" width="64" height="104" rx="3" fill={C.purple} />
        <circle cx="160" cy="96" r="5" fill={C.gold} />
        <Badge x={214} y={78} icon={Lock} bg={C.gold} r={26} />
        <Doc x={256} y={124} s={0.7} r={8} lines={2} />
      </>
    ),
  },
  "cybersecurity/response": {
    bg: "coral",
    art: (
      <>
        <Rings cx={150} />
        <Badge x={130} y={80} icon={Siren} bg={C.gold} r={32} />
        <Doc x={226} y={104} s={1} r={6} check accent={C.coral} lines={3} />
        <Badge x={62} y={132} icon={Bell} bg={C.white} fg={C.coral} s={0.8} />
      </>
    ),
  },
  "cybersecurity/security_hipaa": {
    bg: "purple",
    art: (
      <>
        <Rings cx={160} />
        <Shield x={160} y={98} s={1.4}>
          <path d="M-6 -18 H6 V-6 H18 V6 H6 V18 H-6 V6 H-18 V-6 H-6 Z" fill={C.purple} />
        </Shield>
        <Badge x={72} y={64} icon={Lock} bg={C.gold} />
        <Badge x={252} y={60} icon={Eye} bg={C.white} fg={C.purple} />
      </>
    ),
  },
};

/** A colour and a few shapes for a module with no scene of its own (a client add-on): the same module always gets the same picture. */
export function generic(key: string): Scene {
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const order: Backdrop[] = ["purple", "deep", "teal", "sky", "coral", "rose"];
  return {
    bg: order[h % order.length],
    art: (
      <>
        <Rings />
        <Shield x={160} y={98} s={1.3}>
          <Check x={-13} y={-14} width={26} height={26} color={C.purple} strokeWidth={3} aria-hidden="true" />
        </Shield>
        <Doc x={80} y={112} s={0.8} r={-10} />
        <Badge x={256} y={54} icon={Sparkles} bg={C.gold} />
      </>
    ),
  };
}

export const hasScene = (course: string, moduleKey: string): boolean => Object.hasOwn(SCENES, `${course}/${moduleKey}`);
export const sceneKeys = (): string[] => Object.keys(SCENES);

export function ModuleArt({ course, moduleKey }: { course: string; moduleKey: string }) {
  const key = `${course}/${moduleKey}`;
  const scene = Object.hasOwn(SCENES, key) ? SCENES[key] : generic(key);
  return (
    <div className="mod-art" style={{ background: BACKDROP[scene.bg] }} aria-hidden="true">
      <svg viewBox="0 0 320 180" preserveAspectRatio="xMidYMid slice" focusable="false">
        {scene.art}
      </svg>
    </div>
  );
}
