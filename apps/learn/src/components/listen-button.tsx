"use client";

import { Volume2 } from "lucide-react";
import { useSyncExternalStore } from "react";

const subscribe = () => () => {};
const supported = () => typeof window !== "undefined" && "speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined";

/**
 * Reads the caller's line aloud with the browser's own speech. Nothing is sent anywhere and no file is played. Where the browser
 * has no speech (or on the server) it renders nothing, and the call works the same from the text.
 */
export function ListenButton({ text }: { text: string }) {
  const can = useSyncExternalStore(subscribe, supported, () => false);
  if (!can) return null;
  return (
    <button
      type="button"
      className="secondary listen"
      onClick={() => {
        window.speechSynthesis.cancel();
        const say = new SpeechSynthesisUtterance(text);
        say.lang = "en-US";
        window.speechSynthesis.speak(say);
      }}
    >
      <Volume2 size={16} aria-hidden="true" /> Listen to the caller
    </button>
  );
}
