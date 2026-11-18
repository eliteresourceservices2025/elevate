// The emoji people can react with and put in messages. One curated catalog (no dependency), shared by the server (which refuses anything
// else as a reaction, so a reaction is always a plain, known emoji) and the picker. Grouped in categories for the picker; the search box
// also matches the short names in KEYWORDS (a coworker asked for the sweet potato, so it is easy to find: "sweet potato", "kamote").

export type EmojiCategory = { id: string; label: string; icon: string; emojis: string[] };

const s = (text: string): string[] => text.split(/\s+/).filter(Boolean);

export const EMOJI_CATEGORIES: EmojiCategory[] = [
  {
    id: "smileys",
    label: "Smileys",
    icon: "😀",
    emojis: s(
      "😀 😃 😄 😁 😆 😅 😂 🤣 🥲 🙂 🙃 😉 😊 😇 🥰 😍 🤩 😘 😗 😚 😙 😋 😛 😜 🤪 😝 🤑 🤗 🤭 🫢 🤫 🤔 🫡 🤐 🤨 😐 😑 😶 🙄 😏 😒 😬 😌 😔 😪 🤤 😴 😷 🤒 🤕 🤢 🤮 🤧 🥵 🥶 🥴 😵 🤯 🤠 🥳 😎 🤓 🧐 😕 🫤 😟 🙁 😮 😯 😲 😳 🥺 🥹 😦 😧 😨 😰 😥 😢 😭 😱 😖 😣 😞 😓 😩 😫 🥱 😤 😡 😠 🤬 😈 👿 💀 💩 🤡 👻 👽 🤖 🫠 🙈 🙉 🙊",
    ),
  },
  {
    id: "people",
    label: "Hands and people",
    icon: "👍",
    emojis: s("👍 👎 👌 🤌 🤏 ✌️ 🤞 🫰 🤟 🤘 🤙 👈 👉 👆 👇 ☝️ ✋ 🤚 🖐️ 🖖 👋 🤝 🙏 ✍️ 💪 👏 🙌 👐 🤲 🫶 🫂 👀 🧠 🗣️ 👤 👥 🧑‍💻 🤷 🙋 💁 🙇 🤦 🫱 🫲 👊 🤳 💅"),
  },
  {
    id: "hearts",
    label: "Hearts",
    icon: "❤️",
    emojis: s("❤️ 🧡 💛 💚 💙 💜 🖤 🤍 🤎 💔 ❣️ 💕 💞 💓 💗 💖 💘 💝 💯 💢 💥 💫 💦 💤 💬 💭"),
  },
  {
    id: "food",
    label: "Food and drink",
    icon: "🍠",
    emojis: s(
      "🍠 🍎 🍐 🍊 🍋 🍌 🍉 🍇 🍓 🫐 🍒 🍑 🥭 🍍 🥥 🥝 🍅 🥑 🍆 🥔 🥕 🌽 🌶️ 🥒 🥬 🥦 🧄 🧅 🍄 🥜 🍞 🥐 🥖 🧀 🥚 🍳 🥞 🥓 🍔 🍟 🌭 🍕 🥪 🌮 🌯 🥗 🍝 🍜 🍲 🍛 🍣 🍱 🥟 🍤 🍙 🍚 🍘 🍥 🍢 🍡 🍧 🍨 🍦 🥧 🧁 🍰 🎂 🍮 🍭 🍬 🍫 🍿 🍩 🍪 🥛 ☕ 🍵 🧃 🥤 🧋 🍺 🍻 🥂 🍷 🍹",
    ),
  },
  {
    id: "nature",
    label: "Animals and nature",
    icon: "🌴",
    emojis: s(
      "🐶 🐱 🐭 🐹 🐰 🦊 🐻 🐼 🐨 🐯 🦁 🐮 🐷 🐸 🐵 🐔 🐧 🐦 🐤 🦆 🦉 🐝 🦋 🐛 🐢 🐍 🐙 🐠 🐬 🐳 🦄 🐴 🌸 🌹 🌺 🌻 🌼 🌷 🌱 🌴 🌵 🍀 🍁 🍂 🌍 🌙 ☀️ ⭐ 🌟 ⚡ 🔥 🌈 ☁️ ❄️ 💧 🌊 🌧️ ⛈️",
    ),
  },
  {
    id: "activities",
    label: "Activities",
    icon: "🎉",
    emojis: s("🎉 🎊 🎈 🎁 🏆 🥇 🥈 🥉 ⚽ 🏀 🏈 ⚾ 🎾 🏐 🏓 🏸 🥊 🎯 🎮 🎲 🧩 🎨 🎬 🎤 🎧 🎸 🎹 🥁 🎺 🎻 📚 🎵 🎶 🪩 🏖️ ⛱️"),
  },
  {
    id: "travel",
    label: "Travel and places",
    icon: "🚀",
    emojis: s("🚗 🚕 🚌 🚓 🚑 🚒 🚚 🛵 🚲 ✈️ 🚀 🛸 🚢 ⚓ 🏠 🏢 🏥 🏫 🏝️ 🌋 🗻 ⛰️ 🌆 🌃 🗽 🗺️ 🧭"),
  },
  {
    id: "objects",
    label: "Objects",
    icon: "💡",
    emojis: s(
      "💻 🖥️ ⌨️ 🖱️ 📱 ☎️ 📞 📧 📨 📩 📝 📋 📅 📆 📊 📈 📉 📌 📍 📎 🔗 ✂️ 🗂️ 📁 📂 🔒 🔓 🔑 🛠️ 🔧 🔨 ⚙️ 💡 🔋 🔌 📷 🎥 📺 ⏰ ⌛ ⏳ 💰 💳 🧾 📦 🛒 🧹 ☂️ 🔔 🔕 📣",
    ),
  },
  {
    id: "symbols",
    label: "Symbols",
    icon: "✅",
    emojis: s("✅ ❌ ❓ ❗ ✔️ ➕ ➖ ➡️ ⬅️ ⬆️ ⬇️ 🆗 🆕 🔝 🚫 ⚠️ ♻️ ✨ 🔴 🟠 🟡 🟢 🔵 🟣 ⭕ 🔺 🔻"),
  },
];

/** Short names the picker's search also matches (lower case). Not every emoji has one. */
export const KEYWORDS: Record<string, string> = {
  "🍠": "sweet potato kamote camote yam roasted",
  "👍": "thumbs up yes ok like good",
  "👎": "thumbs down no dislike",
  "👏": "clap applause well done",
  "🙏": "pray thanks please thank you",
  "🙌": "raised hands celebrate praise",
  "💪": "strong muscle flex",
  "✅": "check done yes complete",
  "❌": "cross no wrong cancel",
  "❤️": "heart love red",
  "🔥": "fire hot lit",
  "🎉": "party popper celebrate congrats",
  "😂": "laugh cry funny lol",
  "🤣": "rofl laugh funny",
  "😍": "heart eyes love",
  "😭": "cry sob sad",
  "😢": "cry sad tear",
  "🤔": "thinking hmm",
  "👀": "eyes look watching",
  "💯": "hundred perfect",
  "🚀": "rocket launch fast",
  "☕": "coffee tea cup",
  "🍕": "pizza",
  "🍔": "burger hamburger",
  "🍟": "fries",
  "🍜": "noodles ramen",
  "🍣": "sushi",
  "🍚": "rice kanin",
  "🍌": "banana saging",
  "🥥": "coconut buko",
  "🍍": "pineapple pinya",
  "🥭": "mango",
  "🍰": "cake slice",
  "🎂": "birthday cake",
  "🍺": "beer",
  "🌴": "palm tree beach",
  "🌈": "rainbow",
  "☀️": "sun sunny",
  "🌙": "moon night",
  "🐶": "dog",
  "🐱": "cat",
  "🐝": "bee",
  "🦄": "unicorn",
  "🏆": "trophy win",
  "🎁": "gift present",
  "💡": "idea light bulb",
  "📌": "pin",
  "📅": "calendar date",
  "⏰": "alarm clock time",
  "💻": "laptop computer work",
  "📞": "phone call",
  "📧": "email mail",
  "📊": "chart report",
  "🔒": "lock secure",
  "🔑": "key",
  "⚠️": "warning caution",
  "❓": "question",
  "❗": "exclamation important",
  "✨": "sparkles shine",
  "⭐": "star",
  "🤝": "handshake deal",
  "👋": "wave hello bye",
  "🫡": "salute",
  "🥳": "party celebrate",
  "😎": "cool sunglasses",
  "😴": "sleep tired",
  "🤯": "mind blown",
  "😱": "scream shock",
  "😡": "angry mad",
  "🥺": "pleading puppy eyes",
  "🙈": "see no evil monkey",
  "💬": "speech chat message",
  "🧠": "brain smart",
};

// Reactions people already made with the first picker stay valid.
const LEGACY = s("👍 👎 👏 🙏 🙌 💪 👌 🤝 ✅ ❌ ❤️ 💜 🧡 💛 💚 💙 😀 😃 😄 😁 😆 😅 😂 🤣 🙂 😊 😇 😉 😍 🥰 😘 😋 😎 🤩 🥳 😏 😌 😴 🤔 🤨 😐 😶 🙄 😬 😮 😲 😳 🥺 😢 😭 😤 😠 😡 🤯 😱 😰 😓 🤗 🤭 🤫 🫡 🫶 👀 💯 🎉 🎊 🔥 ✨ ⭐ 🌟 💡 📌 📍 📎 📝 📅 ⏰ ⌛ ☕ 🍕 🍰 🎂 🎁 🏆 🥇 🚀 🌈 ☀️ 🌙 🌴 🌸 🍀 🐶 🐱 🦄 🐝 👋 🤞 ✌️ 🤟 👊 ✍️ 🙈 🙉 🙊 💬 📣 🔔 🔒 🔑 🛠️ 💻 📞 📧 📊 📈 ✔️ ❓ ❗ 💤 🎯 🧠 🫠 😵 🤲 🫂 🌍");

/** Every emoji in the catalog once, in picker order. */
export const EMOJI_SET: string[] = [...new Set([...EMOJI_CATEGORIES.flatMap((c) => c.emojis), ...LEGACY])];

const ALLOWED = new Set<string>(EMOJI_SET);

export function isAllowedEmoji(value: string): boolean {
  return ALLOWED.has(value);
}

/** Emoji whose category name or short name contains every word typed (for the picker's search box). */
export function searchEmoji(query: string): string[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const labels = new Map<string, string>();
  for (const c of EMOJI_CATEGORIES) for (const e of c.emojis) labels.set(e, `${labels.get(e) ?? ""} ${c.label.toLowerCase()}`);
  return EMOJI_SET.filter((e) => {
    const text = `${KEYWORDS[e] ?? ""} ${labels.get(e) ?? ""}`;
    return words.every((w) => text.includes(w));
  });
}

const RECENT_KEY = "elevate-chat-recent-emoji";
const RECENT_MAX = 16;

/** The emoji this browser used most recently, newest first. Only known emoji come back; storage trouble just means an empty list. */
export function readRecentEmoji(storage: Pick<Storage, "getItem"> | undefined = typeof localStorage === "undefined" ? undefined : localStorage): string[] {
  try {
    const parsed: unknown = JSON.parse(storage?.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((e): e is string => typeof e === "string" && ALLOWED.has(e)).slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

/** Remembers an emoji as the most recent one and returns the new list. */
export function rememberEmoji(emoji: string, storage: Pick<Storage, "getItem" | "setItem"> | undefined = typeof localStorage === "undefined" ? undefined : localStorage): string[] {
  const next = [emoji, ...readRecentEmoji(storage).filter((e) => e !== emoji)].slice(0, RECENT_MAX);
  try {
    storage?.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // The list just will not be remembered.
  }
  return next;
}
