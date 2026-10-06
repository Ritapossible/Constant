"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";

const STEPS = [
  { title: "Add money", text: "Bank transfer in naira, or USDC from abroad. It sits in pots, one for each bill.", tags: ["Bank", "USDC"] },
  { title: "Pick what to keep paid", text: "Data, light, DSTV, ChatGPT. Add the number, meter or decoder once.", tags: ["Data", "Light", "TV", "AI"] },
  { title: "Set your limits", text: "How much, how often, and a cap it can never pass. Change or pause any time.", tags: ["Cap", "Pause"] },
  { title: "Constant watches", text: "It tracks usage and renewal dates, and warns you before anything runs low.", tags: ["Forecast", "Remind"] },
  { title: "Paid, and sent to you", text: "Bundles land on your SIM. Tokens and receipts arrive where you chose.", tags: ["WhatsApp", "Telegram", "SMS", "Email"] },
];

const ANGLE = 11; // degrees between nodes on the arc

/**
 * Scroll-pinned stepper (as on the reference site): the section is tall, the
 * stage sticks, and scroll progress picks the step. The arc turns to follow.
 */
export function Steps() {
  const track = useRef<HTMLDivElement>(null);
  const [step, setStep] = useState(0);

  useEffect(() => {
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const el = track.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        const scrollable = Math.max(1, el.offsetHeight - window.innerHeight);
        const progress = Math.min(1, Math.max(0, -rect.top / scrollable));
        setStep(Math.min(STEPS.length - 1, Math.floor(progress * STEPS.length)));
      });
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      cancelAnimationFrame(raf);
    };
  }, []);

  const s = STEPS[step]!;

  return (
    <section className="steps" id="how" aria-labelledby="how-title">
      <div className="steps-track" ref={track} style={{ height: `${STEPS.length * 70 + 30}vh` }}>
        <div className="steps-sticky">
          <div className="section-head" style={{ marginBottom: 40 }}>
            <span className="eyebrow">How it works</span>
            <h2 id="how-title" className="h2">
              Five minutes. <span className="serif">Then never again.</span>
            </h2>
          </div>
          <div className="steps-stage container">
            <div className="arc" style={{ transform: `rotate(${-step * ANGLE}deg)` }} aria-hidden="true">
              {STEPS.map((_, i) => (
                <span key={i} className="arc-node" style={{ transform: `rotate(${i * ANGLE}deg)` }}>
                  {String(i + 1).padStart(2, "0")}
                </span>
              ))}
            </div>
            <div className="step-pin">
              <span className="step-label">STEP</span>
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.span
                  key={step}
                  className="step-num"
                  initial={{ opacity: 0, y: 12, scale: 0.9 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -12, scale: 0.9 }}
                  transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
                >
                  {String(step + 1).padStart(2, "0")}
                </motion.span>
              </AnimatePresence>
            </div>
            <div className="step-body" aria-live="polite">
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={step}
                  style={{ display: "grid", gap: 14, justifyItems: "center" }}
                  initial={{ opacity: 0, y: 18, filter: "blur(8px)" }}
                  animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                  exit={{ opacity: 0, y: -14, filter: "blur(6px)" }}
                  transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
                >
                  <h3 className="step-title">{s.title}</h3>
                  <p className="step-text">{s.text}</p>
                  <div className="step-tags">
                    {s.tags.map((t) => (
                      <span key={t}>{t}</span>
                    ))}
                  </div>
                </motion.div>
              </AnimatePresence>
            </div>
            <div className="step-dots" aria-hidden="true">
              {STEPS.map((_, i) => (
                <i key={i} data-on={i === step} />
              ))}
            </div>
            <div className="step-count">
              {String(step + 1).padStart(2, "0")} / {String(STEPS.length).padStart(2, "0")}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
