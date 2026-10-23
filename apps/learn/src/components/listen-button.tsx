"use client";

import { Square, Volume2 } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

const subscribe = () => () => {};
const speechSupported = () => typeof window !== "undefined" && "speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined";

/**
 * Plays something aloud: a list of recorded clips one after the other when there are any (the caller's voice, or an exam question and
 * its choices), otherwise the browser's own speech reading `text`. Where neither is available (or on the server) it renders nothing
 * and everything works the same from the text. Give it a `key` that changes with the line, so a new line never keeps playing the old one. The clips come from this app's own signed-in route; nothing is sent anywhere.
 */
export function ListenButton({ text, clips, label = "Listen to the caller" }: { text: string; clips?: (string | null)[]; label?: string }) {
  const can = useSyncExternalStore(subscribe, speechSupported, () => false);
  const files = (clips ?? []).filter((c): c is string => Boolean(c));
  const [playing, setPlaying] = useState(false);
  const player = useRef<HTMLAudioElement | null>(null);
  const run = useRef(0); // which press is current, so a stopped list never carries on

  const stop = () => {
    run.current += 1;
    player.current?.pause();
    if (speechSupported()) window.speechSynthesis.cancel();
    setPlaying(false);
  };
  // leaving the page (or the next question) stops the sound
  useEffect(() => stop, []);

  if (files.length === 0 && !can) return null;

  const play = async () => {
    if (playing) return stop();
    const mine = ++run.current;
    setPlaying(true);
    if (files.length > 0) {
      for (const src of files) {
        if (run.current !== mine) return;
        const audio = new Audio(src);
        player.current = audio;
        const ended = new Promise<boolean>((resolve) => {
          audio.onended = () => resolve(true);
          audio.onerror = () => resolve(false);
        });
        try {
          await audio.play();
        } catch {
          break;
        }
        if (!(await ended)) break;
      }
      if (run.current === mine) setPlaying(false);
      return;
    }
    window.speechSynthesis.cancel();
    const say = new SpeechSynthesisUtterance(text);
    say.lang = "en-US";
    say.onend = () => {
      if (run.current === mine) setPlaying(false);
    };
    window.speechSynthesis.speak(say);
  };

  return (
    <button type="button" className="secondary listen" onClick={() => void play()} aria-pressed={playing}>
      {playing ? <Square size={16} aria-hidden="true" /> : <Volume2 size={16} aria-hidden="true" />} {playing ? "Stop" : label}
    </button>
  );
}
