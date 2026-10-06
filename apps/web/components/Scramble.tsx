"use client";

import { useEffect, useRef } from "react";

const CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ0123456789#$%&*+=/<>";

/**
 * Cycles through words, decoding each one out of random characters.
 * Screen readers get the plain list instead.
 */
export function Scramble({ words, hold = 1800 }: { words: string[]; hold?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const longest = Math.max(...words.map((w) => w.length));

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      el.textContent = words[0] ?? "";
      return;
    }

    let index = 0;
    let frame = 0;
    let timer: ReturnType<typeof setInterval> | undefined;
    let pause: ReturnType<typeof setTimeout> | undefined;
    const rand = () => CHARS[Math.floor(Math.random() * CHARS.length)];

    const play = () => {
      const target = words[index % words.length] ?? "";
      const len = Math.max(target.length, 1);
      // Each letter settles at its own frame, left to right with jitter.
      const settle = Array.from({ length: len }, (_, i) => 6 + i * 2 + Math.floor(Math.random() * 6));
      frame = 0;
      timer = setInterval(() => {
        frame++;
        let out = "";
        let done = true;
        for (let i = 0; i < len; i++) {
          if (frame >= (settle[i] ?? 0)) out += target[i];
          else {
            out += rand();
            done = false;
          }
        }
        el.textContent = out;
        if (done) {
          clearInterval(timer);
          index++;
          pause = setTimeout(play, hold);
        }
      }, 45);
    };
    play();
    return () => {
      clearInterval(timer);
      clearTimeout(pause);
    };
  }, [words, hold]);

  return (
    <>
      <span className="sr-only">{words.join(", ")}</span>
      <span ref={ref} className="scramble" aria-hidden="true" style={{ minWidth: `${longest}ch` }}>
        {words[0]}
      </span>
    </>
  );
}
