"use client";

import { animate, motion, useMotionValue, useTransform } from "motion/react";
import { useEffect, useState } from "react";
import { Reveal, useInViewOnce } from "./Reveal";
import { IconBell, IconBolt, IconData, IconTv } from "./icons";

const NOTES = [
  { icon: <IconData size={16} />, title: "70% chance your data runs out before tomorrow evening", sub: "Autopilot will top up at 300 MB." },
  { icon: <IconBolt size={16} />, title: "Light likely low by Thursday", sub: "Spare token is ready on Telegram." },
  { icon: <IconTv size={16} />, title: "DSTV renewal on 15 Dec is ₦2,300 short", sub: "Add money any time before then." },
];

export function Reminders() {
  const [ref, inView] = useInViewOnce<HTMLDivElement>(0.3);
  const p = useMotionValue(0);
  const dash = useTransform(p, (v) => `${(v / 100) * 565.5} 565.5`);
  const [num, setNum] = useState(0);

  useEffect(() => p.on("change", (v) => setNum(Math.round(v))), [p]);
  useEffect(() => {
    if (!inView) return;
    const c = animate(p, 70, { duration: 2, ease: [0.22, 1, 0.36, 1], delay: 0.2 });
    return () => c.stop();
  }, [inView, p]);

  return (
    <section className="section band" id="remind" aria-labelledby="remind-title">
      <div className="container remind-grid">
        <Reveal className="remind-copy">
          <span className="eyebrow" style={{ width: "fit-content" }}>
            <span className="eyebrow-dot" /> Running-low reminders
          </span>
          <h2 id="remind-title" className="h2">
            Know <span className="serif">before</span> it runs low.
          </h2>
          <p className="lead">Constant learns how fast you use data and light, and tells you when running out is likely. Not after.</p>
          <ul className="remind-points">
            <li>
              <IconBell size={18} />
              <span>
                <b>Only when it matters.</b> At most once a day, never at night.
              </span>
            </li>
            <li>
              <IconBell size={18} />
              <span>
                <b>Money too.</b> Told days before a renewal would fail.
              </span>
            </li>
          </ul>
        </Reveal>

        <div className="ring-wrap" ref={ref}>
          <div className="prob" aria-label="70 percent chance of running out" role="img">
            <svg viewBox="0 0 200 200" aria-hidden="true">
              <circle cx="100" cy="100" r="90" fill="none" stroke="#262626" strokeWidth="10" />
              <motion.circle
                cx="100"
                cy="100"
                r="90"
                fill="none"
                stroke="#fafafa"
                strokeWidth="10"
                strokeLinecap="round"
                style={{ strokeDasharray: dash }}
              />
            </svg>
            <div className="prob-center">
              <div>
                <div className="prob-num">
                  {num}
                  <sup>%</sup>
                </div>
                <div className="prob-label">chance data runs out in 48h</div>
              </div>
            </div>
          </div>
          <div className="notes" aria-hidden="true">
            {NOTES.map((n, i) => (
              <motion.div
                key={n.title}
                className="note"
                initial={{ opacity: 0, x: 24, filter: "blur(6px)" }}
                animate={inView ? { opacity: 1, x: 0, filter: "blur(0px)" } : {}}
                transition={{ delay: 0.6 + i * 0.25, duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
              >
                <span className="note-icon">{n.icon}</span>
                <span>
                  <b>{n.title}</b>
                  <small>{n.sub}</small>
                </span>
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
