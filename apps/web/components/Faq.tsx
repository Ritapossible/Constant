"use client";

import { AnimatePresence, motion } from "motion/react";
import { useId, useState } from "react";
import { Reveal } from "./Reveal";

const QA = [
  {
    q: "What is Constant?",
    a: "An account that pays the things you keep re-buying (data, airtime, electricity, cable TV and subscriptions) automatically, from money you set aside.",
  },
  {
    q: "Can I use it today?",
    a: "Constant is in early access, starting in Nigeria. Join the list and we'll message you when your spot opens.",
  },
  {
    q: "Do I still type in my electricity token?",
    a: "For most meters, yes. Constant sends the token the moment it's bought, on WhatsApp, Telegram, SMS or email, and can keep a spare one ready.",
  },
  {
    q: "How does it know I'm running low?",
    a: "Data: the Constant app measures what your phone uses and checks your balance with your network. Light: from the units you bought and a quick meter reading when needed. Cable and subscriptions: their renewal dates.",
  },
  {
    q: "Can it spend more than I want?",
    a: "No. You set the amount and a weekly cap for each bill. Change, pause or cancel any time.",
  },
  {
    q: "How do I add money?",
    a: "A bank transfer in naira, or stablecoins from anywhere: USDC or USDT on Base, or USDC on Arc.",
  },
];

export function Faq() {
  const [open, setOpen] = useState<number | null>(0);
  const base = useId();
  return (
    <section className="section" id="faq" aria-labelledby="faq-title">
      <div className="container">
        <Reveal className="section-head">
          <span className="eyebrow">Questions</span>
          <h2 id="faq-title" className="h2">
            Good <span className="serif">questions.</span>
          </h2>
        </Reveal>
        <Reveal className="faq">
          {QA.map((item, i) => {
            const isOpen = open === i;
            const btn = `${base}-q${i}`;
            const panel = `${base}-a${i}`;
            return (
              <div className="faq-item" key={item.q} data-open={isOpen}>
                <h3 style={{ margin: 0 }}>
                  <button
                    id={btn}
                    className="faq-q"
                    aria-expanded={isOpen}
                    aria-controls={panel}
                    onClick={() => setOpen(isOpen ? null : i)}
                  >
                    {item.q}
                    <span className="faq-plus" aria-hidden="true" />
                  </button>
                </h3>
                <AnimatePresence initial={false}>
                  {isOpen && (
                    <motion.div
                      id={panel}
                      role="region"
                      aria-labelledby={btn}
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
                      style={{ overflow: "hidden" }}
                    >
                      <div className="faq-a">
                        <p>{item.a}</p>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </Reveal>
      </div>
    </section>
  );
}
