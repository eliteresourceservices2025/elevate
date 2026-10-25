import { Bug, Check, KeyRound, Lock, Search, Sparkles, Star, Stethoscope, Zap } from "lucide-react";
import { Badge, BACKDROP, Bubble, C, Doc, Dots, Monitor, Person, Phone, Rings, SCENES, Shield, Spark, generic, type Scene } from "./module-art";

// The pictures on the Learn home page: one for each built-in course (by its address) and one for each shortcut, drawn with the same kit as the
// module pictures. They are kept apart from SCENES on purpose: SCENES holds exactly one picture per module, and a test keeps it that way.

const HOME_SCENES: Record<string, Scene> = {
  hipaa: {
    bg: "purple",
    art: (
      <>
        <Rings cx={160} cy={96} />
        <Doc x={66} y={112} s={0.95} r={-8} check />
        <Shield x={160} y={96} s={1.8} fill={C.white}>
          <Check x={-11} y={-14} width={22} height={22} color={C.purple} strokeWidth={3.2} aria-hidden="true" />
        </Shield>
        <Badge x={256} y={50} icon={Stethoscope} bg={C.gold} />
        <Badge x={254} y={140} icon={Lock} bg={C.white} fg={C.purple} />
        <Spark x={40} y={44} s={0.9} fill={C.white} />
      </>
    ),
  },
  cybersecurity: {
    bg: "deep",
    art: (
      <>
        <Dots x={226} y={20} color={C.lav} />
        <Monitor x={156} y={92} s={1.55}>
          <Lock x={-14} y={-20} width={28} height={28} color={C.purple} strokeWidth={2.6} aria-hidden="true" />
        </Monitor>
        <Badge x={262} y={52} icon={Bug} bg={C.coral} fg={C.white} />
        <Badge x={60} y={130} icon={KeyRound} bg={C.gold} />
        <Shield x={262} y={140} s={0.8} fill={C.gold} />
        <Spark x={44} y={44} s={0.9} fill={C.white} />
      </>
    ),
  },
  "customer-service": SCENES["customer-service/excellence"],
  practice: {
    bg: "gold",
    art: (
      <>
        <Rings cx={170} />
        <Person x={120} y={160} s={1.5} skin={C.skin2} shirt={C.purple} />
        <Bubble x={232} y={64} fill={C.white}>
          <Sparkles x={-11} y={-11} width={22} height={22} color={C.gold} aria-hidden="true" />
        </Bubble>
        <Badge x={56} y={52} icon={Zap} bg={C.white} fg={C.purple} />
        <Spark x={276} y={136} s={1.2} fill={C.white} />
      </>
    ),
  },
  record: {
    bg: "sky",
    art: (
      <>
        <Dots x={30} y={22} />
        <Doc x={130} y={98} s={1.7} check lines={5} />
        <Badge x={228} y={70} icon={Star} bg={C.gold} />
        <Badge x={216} y={136} icon={Check} bg={C.white} fg={C.sky} />
      </>
    ),
  },
  cards: {
    bg: "teal",
    art: (
      <>
        <Doc x={112} y={100} s={1.4} accent={C.teal} />
        <Phone x={208} y={100} s={1.3} tint={C.paleTeal} />
        <Badge x={264} y={48} icon={Search} bg={C.gold} />
        <Spark x={46} y={46} s={0.9} fill={C.white} />
      </>
    ),
  },
};

export const hasHomeScene = (name: string): boolean => Object.hasOwn(HOME_SCENES, name);
export const homeSceneKeys = (): string[] => Object.keys(HOME_SCENES);

/** The picture on a home-page card: a built-in course by its address, or a shortcut by name. A client add-on gets the generic picture. */
export function HomeArt({ name }: { name: string }) {
  // eslint-disable-next-line security/detect-object-injection -- guarded by hasOwn
  const scene = Object.hasOwn(HOME_SCENES, name) ? HOME_SCENES[name] : generic(`home/${name}`);
  return (
    <div className="mod-art" style={{ background: BACKDROP[scene.bg] }} aria-hidden="true">
      <svg viewBox="0 0 320 180" preserveAspectRatio="xMidYMid slice" focusable="false">
        {scene.art}
      </svg>
    </div>
  );
}
