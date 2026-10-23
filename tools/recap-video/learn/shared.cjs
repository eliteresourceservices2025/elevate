// Shared pieces of the HIPAA and Cybersecurity storyboards (the animated videos). See storyboards-hipaa-a.cjs for the scene kinds.
const HIPAA_OUTRO = [
  { icon: "hand", word: "Stop", say: "Stop." },
  { icon: "lock", word: "Do not share", say: "Do not share." },
  { icon: "message-circle", word: "Ask your lead", say: "Ask your lead." },
  { icon: "book-open", word: "Read the module", say: "Now read the module." },
];
const CYBER_OUTRO = [
  { icon: "hand", word: "Pause", say: "Pause." },
  { icon: "search", word: "Verify", say: "Verify." },
  { icon: "siren", word: "Report fast", say: "Report fast." },
  { icon: "book-open", word: "Read the module", say: "Now read the module." },
];
module.exports = { HIPAA_OUTRO, CYBER_OUTRO };
