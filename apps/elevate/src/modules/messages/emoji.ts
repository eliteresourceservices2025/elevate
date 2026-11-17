// The emoji people can react with and put in messages. One curated list (no dependency), shared by the server (which refuses anything
// else as a reaction, so a reaction is always a plain, known emoji) and the picker.

export const EMOJI_SET = [
  "👍", "👎", "👏", "🙏", "🙌", "💪", "👌", "🤝", "✅", "❌", "❤️", "💜", "🧡", "💛", "💚", "💙",
  "😀", "😃", "😄", "😁", "😆", "😅", "😂", "🤣", "🙂", "😊", "😇", "😉", "😍", "🥰", "😘", "😋",
  "😎", "🤩", "🥳", "😏", "😌", "😴", "🤔", "🤨", "😐", "😶", "🙄", "😬", "😮", "😲", "😳", "🥺",
  "😢", "😭", "😤", "😠", "😡", "🤯", "😱", "😰", "😓", "🤗", "🤭", "🤫", "🫡", "🫶", "👀", "💯",
  "🎉", "🎊", "🔥", "✨", "⭐", "🌟", "💡", "📌", "📍", "📎", "📝", "📅", "⏰", "⌛", "☕", "🍕",
  "🍰", "🎂", "🎁", "🏆", "🥇", "🚀", "🌈", "☀️", "🌙", "🌴", "🌸", "🍀", "🐶", "🐱", "🦄", "🐝",
  "👋", "🤞", "✌️", "🤟", "👊", "✍️", "🙈", "🙉", "🙊", "💬", "📣", "🔔", "🔒", "🔑", "🛠️", "💻",
  "📞", "📧", "📊", "📈", "✔️", "❓", "❗", "💤", "🎯", "🧠", "🫠", "😵", "🤝", "🤲", "🫂", "🌍",
] as const;

const ALLOWED = new Set<string>(EMOJI_SET);

export function isAllowedEmoji(value: string): boolean {
  return ALLOWED.has(value);
}
