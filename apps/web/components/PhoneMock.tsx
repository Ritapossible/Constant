"use client";
import type { ReactNode } from "react";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { IconBell, IconBolt, IconCheck, IconData, IconSend, IconSpark, IconTv } from "./icons";

type Toast = { icon: ReactNode; title: string; sub: string };

const TOASTS: Toast[] = [
  { icon: <IconData size={16} />, title: "Data topped up · 1.5 GB", sub: "MTN · from your Data pot" },
  { icon: <IconTv size={16} />, title: "DSTV renewed", sub: "Covered until 15 Dec" },
  { icon: <IconSend size={16} />, title: "Light token sent on Telegram", sub: "Meter •••• 6781 · ₦10,000" },
  { icon: <IconBell size={16} />, title: "Heads-up", sub: "Light likely low by Thursday" },
];

export function PhoneMock() {
  const [i, setI] = useState(-1);

  useEffect(() => {
    const start = setTimeout(() => setI(0), 1400);
    const t = setInterval(() => setI((v) => (v + 1) % TOASTS.length), 3200);
    return () => {
      clearTimeout(start);
      clearInterval(t);
    };
  }, []);

  // The data line drains, then refills when the "topped up" toast shows.
  const dataFull = i === 0 || i === 1 || i === 2;
  const toast = i >= 0 ? TOASTS[i] : null;

  return (
    <div className="phone-stage fade-in" style={{ ["--d" as string]: "350ms" }}>
      <div className="phone-wrap">
      <div className="float-card left">
        <div className="mono muted" style={{ fontSize: 11, letterSpacing: "0.1em" }}>
          YOUR LINE
        </div>
        <div style={{ fontWeight: 650, fontSize: 22, letterSpacing: "-0.03em" }}>300 MB</div>
        <div className="muted" style={{ fontSize: 12 }}>
          data tops up here
        </div>
      </div>
      <div className="float-card right">
        <div className="mono muted" style={{ fontSize: 11, letterSpacing: "0.1em" }}>
          WEEKLY CAP
        </div>
        <div style={{ fontWeight: 650, fontSize: 22, letterSpacing: "-0.03em" }}>₦25,000</div>
        <div className="muted" style={{ fontSize: 12 }}>
          never more than you set
        </div>
      </div>

      <div className="phone" role="img" aria-label="Constant app showing money set aside and what it covers">
        <div className="phone-notch" />
        <div className="toast-stack" aria-hidden="true">
          <AnimatePresence mode="popLayout">
            {toast && (
              <motion.div
                key={i}
                className="toast"
                initial={{ opacity: 0, y: -28, scale: 0.92, filter: "blur(6px)" }}
                animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
                exit={{ opacity: 0, y: -16, scale: 0.96, filter: "blur(4px)" }}
                transition={{ type: "spring", stiffness: 380, damping: 30 }}
              >
                <span className="toast-icon">{toast.icon}</span>
                <span>
                  <b>{toast.title}</b>
                  <small>{toast.sub}</small>
                </span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        <div className="phone-screen" aria-hidden="true">
          <div className="phone-top">
            <span className="mono">9:41</span>
            <span className="avatar">A</span>
          </div>
          <div style={{ marginTop: 18 }}>
            <div className="balance-label">Set aside</div>
            <div className="balance">₦48,200</div>
          </div>
          <span className="chip">
            <span className="dot" /> Everything covered until 12 Nov
          </span>
          <div className="lines">
            <Line icon={<IconData size={14} />} name="Data · MTN" right={dataFull ? "1.8 GB" : "310 MB"} sub={dataFull ? "about 4h of calls" : "topping up at 300 MB"} value={dataFull ? 0.88 : 0.16} />
            <Line icon={<IconBolt size={14} />} name="Light" right="about Thu" sub="spare token ready" value={0.46} />
            <Line icon={<IconTv size={14} />} name="DSTV" right="15 Dec" sub="renews the day before" value={1} />
            <Line icon={<IconSpark size={14} />} name="ChatGPT Plus" right="3 Jan" sub="renews monthly" value={1} />
          </div>
          <div className="line" style={{ marginTop: "auto", gridTemplateColumns: "1fr auto", display: "grid", alignItems: "center" }}>
            <span style={{ fontSize: 12.5 }}>
              Tokens go to <b>Telegram</b>, then SMS
            </span>
            <IconCheck size={16} />
          </div>
        </div>
      </div>
      </div>
    </div>
  );
}

function Line({ icon, name, right, sub, value }: { icon: ReactNode; name: string; right: string; sub: string; value: number }) {
  return (
    <div className="line">
      <div className="line-row">
        <span className="line-name">
          <span className="line-icon">{icon}</span>
          {name}
        </span>
        <span className="mono" style={{ fontSize: 12.5 }}>
          {right}
        </span>
      </div>
      <div className="bar">
        <i style={{ transform: `scaleX(${value})` }} />
      </div>
      <div className="line-sub">{sub}</div>
    </div>
  );
}
