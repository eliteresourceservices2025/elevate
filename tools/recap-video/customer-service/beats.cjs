// What the voice says in a scene, in the order things appear on screen. Used by BOTH narrate-cs.cjs (to speak each piece) and the
// renderer (src/Cs.jsx, to show each thing exactly when its words start), so the two can never drift apart.
//   beat = { say, voice }   voice: "narrator" | "rep" | "family"
function beatsOf(s) {
  const out = [];
  const add = (say, voice = "narrator") => {
    if (!say || !String(say).trim()) throw new Error(`Empty narration in a ${s.kind} scene (${s.heading || s.title || s.lead || ""})`);
    out.push({ say: String(say), voice });
  };
  if (s.lead) add(s.lead);
  switch (s.kind) {
    case "hero":
      if (!s.lead) throw new Error("A hero scene needs a lead (the words the voice says)");
      break;
    case "icons":
    case "flow":
    case "checklist":
    case "stat":
    case "chain":
    case "timeline":
    case "stack":
      s.items.forEach((i) => add(i.say));
      break;
    case "formula":
      s.items.forEach((i) => add(i.say));
      add(s.result.say);
      break;
    case "swap":
      s.items.forEach((i) => {
        add(i.badSay);
        add(i.goodSay);
      });
      break;
    case "dialogue":
      s.lines.forEach((l) => add(l.say || l.text, l.who === "rep" ? "rep" : "family"));
      if (s.after) add(s.after);
      break;
    case "compare":
      s.left.items.forEach((i) => add(i.say));
      s.right.items.forEach((i) => add(i.say));
      break;
    default:
      throw new Error("Unknown scene kind: " + s.kind);
  }
  return out;
}

/** Index of the first non-lead beat (0 or 1). */
const bodyStart = (s) => (s.lead ? 1 : 0);

module.exports = { beatsOf, bodyStart };
