// The notification sounds for chat (and, later, calls). Plain constants so the server (validation) and the browser (the picker and
// the player) agree on the list. The sounds themselves are made in the browser (components/play-sound.ts): no sound files to license or host.

export const CHAT_SOUNDS = ["chime", "pop", "bell", "ding", "off"] as const;
export type ChatSound = (typeof CHAT_SOUNDS)[number];
export const DEFAULT_CHAT_SOUND: ChatSound = "chime";

export const CHAT_SOUND_LABELS: Record<ChatSound, string> = {
  chime: "Chime",
  pop: "Pop",
  bell: "Bell",
  ding: "Ding",
  off: "Off (no sound)",
};

export const isChatSound = (value: unknown): value is ChatSound => typeof value === "string" && (CHAT_SOUNDS as readonly string[]).includes(value);
