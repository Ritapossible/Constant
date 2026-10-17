"use client";

import { feeForKind } from "@constant/rules";
import { AnimatePresence, motion } from "motion/react";
import { CONTACT_EMAIL } from "@/lib/site";
import { useId, useState } from "react";
import { Reveal } from "./Reveal";

const n = (minor: bigint) => (minor / 100n).toLocaleString("en-NG");

const QA = [
  {
    q: "What is ConstantUnits?",
    a: "An account that pays the things you keep re-buying (data, airtime, electricity, cable TV and subscriptions) automatically, from money you set aside.",
  },
  {
    q: "Can I use it today?",
    a: "Yes. Launch the app, sign in with Google, email or a passkey, and set up your bills and reminders. Stablecoin top-ups work now; paying bills switches on, starting in Nigeria, once our licensed partner is live.",
  },
  {
    q: "Do I still type in my electricity token?",
    a: "For most meters, yes. ConstantUnits sends the token the moment it's bought, on WhatsApp, Telegram, SMS or email, and can keep a spare one ready.",
  },
  {
    q: "How does it know I'm running low?",
    a: "Data: the ConstantUnits app measures what your phone uses and checks your balance with your network. Light: from the units you bought and a quick meter reading when needed. Cable and subscriptions: their renewal dates.",
  },
  {
    q: "Can it spend more than I want?",
    a: "No. You set the amount and a weekly cap for each bill. Change, pause or cancel any time.",
  },
  {
    q: "What does it cost?",
    a: `One small fee per delivered bill, on top of what the provider charges: data ₦${n(feeForKind("data"))}, airtime ₦${n(feeForKind("airtime"))}, cable TV ₦${n(feeForKind("tv"))}, electricity ₦${n(feeForKind("electricity"))}. Your first delivered payment is free, and a failed or reversed payment costs nothing. No subscription.`,
  },
  {
    q: "How do I add money?",
    a: "By bank transfer, free: you get your own ConstantUnits account number, and send money to it from any Nigerian bank or mobile money app. A card, USSD or QR payment also works, with the card fee at cost. Family abroad can send stablecoins: USDC or USDT on Base, or USDC on Arc.",
  },
  {
    q: "How do I reach you?",
    a: `Email ${CONTACT_EMAIL}. A person reads every message.`,
  },
  {
    q: "What happens to money I don't use?",
    a: "It stays in its pot until that bill needs it, or until you move it. It doesn't expire.",
  },
];

export function Faq() {
  const [open, setOpen] = useState<number | null>(null);
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
