"use client";

import { animate, motion, useMotionValue, useTransform } from "motion/react";
import { useEffect, useState } from "react";
import { Reveal, useInViewOnce } from "./Reveal";
import { IconBank, IconBolt, IconChat, IconData, IconGlobe, IconMail, IconSend, IconSms, IconSpark, IconTv } from "./icons";

export function Bento() {
  return (
    <section className="section" id="pays" aria-labelledby="pays-title">
      <div className="container">
        <Reveal className="section-head">
          <span className="eyebrow">What it pays</span>
          <h2 id="pays-title" className="h2">
            Everything you <span className="serif">keep re‑buying.</span>
          </h2>
        </Reveal>
        <Reveal className="bento">
          <DataCard />
          <LightCard />
          <CableCard />
          <SubsCard />
          <PotsCard />
          <ChannelsCard />
          <FundCard />
        </Reveal>
      </div>
    </section>
  );
}

/* Data: the bar drains to your line, then Constant refills it. */
function DataCard() {
  const [ref, inView] = useInViewOnce<HTMLDivElement>(0.4);
  const level = useMotionValue(0.9);
  const mb = useTransform(level, (v) => Math.round(v * 2000));
  const [label, setLabel] = useState("2.0 GB");
  const [refilled, setRefilled] = useState(false);

  useEffect(() => mb.on("change", (v) => setLabel(v >= 1000 ? `${(v / 1000).toFixed(1)} GB` : `${v} MB`)), [mb]);

  useEffect(() => {
    if (!inView) return;
    let stopped = false;
    const loop = async () => {
      while (!stopped) {
        setRefilled(false);
        await animate(level, 0.15, { duration: 3.2, ease: "linear" });
        if (stopped) return;
        setRefilled(true);
        await animate(level, 0.9, { type: "spring", stiffness: 120, damping: 18 });
        await new Promise((r) => setTimeout(r, 1600));
      }
    };
    loop();
    return () => {
      stopped = true;
      level.stop();
    };
  }, [inView, level]);

  return (
    <article className="card span-4" ref={ref}>
      <div className="card-head">
        <span className="card-tag">
          <IconData size={14} style={{ display: "inline", verticalAlign: -2 }} /> Data & airtime
        </span>
        <h3 className="h3">Tops up before your call drops.</h3>
        <p>The app watches what your phone uses and refills at the line you choose. Lands on your SIM in seconds.</p>
      </div>
      <div className="card-visual meter" aria-hidden="true">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "end", gap: 12 }}>
          <div className="meter-num mono">{label}</div>
          <motion.span
            className="flash"
            animate={{ opacity: refilled ? 1 : 0, y: refilled ? 0 : 6 }}
            transition={{ duration: 0.4 }}
          >
            <span className="dot" /> Topped up · 1.5 GB
          </motion.span>
        </div>
        <div className="meter-track">
          <motion.div className="meter-fill" style={{ scaleX: level }} />
          <div className="meter-line" style={{ left: "15%" }} />
        </div>
        <div className="meter-foot">
          <span>Your line: 300 MB</span>
          <span>about 4h of calls left</span>
        </div>
      </div>
    </article>
  );
}

/* Light: units count down on the keypad; a spare token is waiting. */
function LightCard() {
  const [ref, inView] = useInViewOnce<HTMLDivElement>(0.4);
  const [units, setUnits] = useState(42.6);
  useEffect(() => {
    if (!inView) return;
    const t = setInterval(() => setUnits((u) => (u <= 18.2 ? 42.6 : +(u - 0.3).toFixed(1))), 220);
    return () => clearInterval(t);
  }, [inView]);
  return (
    <article className="card card-dark span-2" ref={ref}>
      <div className="card-head">
        <span className="card-tag">
          <IconBolt size={14} style={{ display: "inline", verticalAlign: -2 }} /> Light
        </span>
        <h3 className="h3">The token is ready before it goes off.</h3>
      </div>
      <div className="card-visual keypad" aria-hidden="true">
        <div className="lcd">
          <span className="lcd-num">{units.toFixed(1).padStart(5, "0")}</span>
          <span className="lcd-unit">kWh</span>
        </div>
        <div className="token-chip">
          <span>Spare token</span>
          <span className="mono">•••• 7890</span>
        </div>
      </div>
    </article>
  );
}

/* Cable: renews the day before expiry. */
function CableCard() {
  const days = [9, 10, 11, 12, 13, 14, 15];
  return (
    <article className="card span-2">
      <div className="card-head">
        <span className="card-tag">
          <IconTv size={14} style={{ display: "inline", verticalAlign: -2 }} /> Cable TV
        </span>
        <h3 className="h3">DSTV, GOtv, StarTimes. Renewed the day before.</h3>
      </div>
      <div className="card-visual" aria-hidden="true">
        <div className="cal">
          {days.map((d) => (
            <div key={d} className={`cal-day ${d === 14 ? "is-renew" : ""}`}>
              {d}
            </div>
          ))}
        </div>
        <div className="meter-foot" style={{ marginTop: 10 }}>
          <span>Renews 14 Dec</span>
          <span>expires 15 Dec</span>
        </div>
      </div>
    </article>
  );
}

/* Subscriptions, including AI tools. */
function SubsCard() {
  const subs = [
    { n: "ChatGPT Plus", b: "G", d: "3rd" },
    { n: "Claude Pro", b: "C", d: "9th" },
    { n: "Gemini", b: "✦", d: "21st" },
  ];
  return (
    <article className="card span-2">
      <div className="card-head">
        <span className="card-tag">
          <IconSpark size={14} style={{ display: "inline", verticalAlign: -2 }} /> Subscriptions
        </span>
        <h3 className="h3">Your AI tools, paid every month in naira.</h3>
      </div>
      <div className="card-visual subs" aria-hidden="true">
        {subs.map((s) => (
          <div className="sub" key={s.n}>
            <span className="sub-name">
              <span className="sub-badge">{s.b}</span>
              {s.n}
            </span>
            <span className="sub-meta">renews {s.d}</span>
          </div>
        ))}
      </div>
    </article>
  );
}

/* Money set aside: one pot per bill. */
function PotsCard() {
  const [ref, inView] = useInViewOnce<HTMLDivElement>(0.4);
  const pots = [
    { n: "Light", v: 0.72, a: "₦20,000" },
    { n: "DSTV", v: 0.55, a: "₦15,700" },
    { n: "Data", v: 0.38, a: "₦9,000" },
    { n: "ChatGPT", v: 0.2, a: "$20 / mo" },
  ];
  return (
    <article className="card card-dark span-2" ref={ref}>
      <div className="card-head">
        <span className="card-tag">Set aside</span>
        <h3 className="h3">One pot per bill. It can't be spent on anything else.</h3>
      </div>
      <div className="card-visual pots" aria-hidden="true">
        {pots.map((p, i) => (
          <div className="pot" key={p.n}>
            <span>{p.n}</span>
            <div className="bar">
              <i style={{ transform: `scaleX(${inView ? p.v : 0})`, transitionDelay: `${i * 90}ms` }} />
            </div>
            <span className="mono" style={{ fontSize: 12.5 }}>
              {p.a}
            </span>
          </div>
        ))}
      </div>
    </article>
  );
}

/* Delivery channels orbit. */
function ChannelsCard() {
  const nodes = [
    { icon: <IconChat size={20} />, label: "WhatsApp", a: 0 },
    { icon: <IconSend size={20} />, label: "Telegram", a: 90 },
    { icon: <IconSms size={20} />, label: "SMS", a: 180 },
    { icon: <IconMail size={20} />, label: "Email", a: 270 },
  ];
  return (
    <article className="card span-3">
      <div className="card-head">
        <span className="card-tag">Delivery</span>
        <h3 className="h3">Tokens and receipts where you already are.</h3>
        <p>WhatsApp, Telegram, SMS or email. Your choice. SMS is always the backup.</p>
      </div>
      <div className="card-visual" aria-hidden="true">
        <div className="orbit">
          <div className="orbit-ring" />
          <div className="orbit-ring inner" />
          <div className="orbit-spin">
            {nodes.map((n) => {
              const r = 110;
              const rad = (n.a * Math.PI) / 180;
              return (
                <div
                  key={n.label}
                  className="orbit-node"
                  title={n.label}
                  style={{ left: 110 + r * Math.cos(rad), top: 110 + r * Math.sin(rad) }}
                >
                  <span style={{ display: "grid" }}>{n.icon}</span>
                </div>
              );
            })}
          </div>
          <div className="orbit-core">
            <svg width="28" height="28" viewBox="0 0 32 32" aria-hidden="true">
              <path d="M22.5 10.6A8.5 8.5 0 1 0 22.5 21.4" fill="none" stroke="#fafafa" strokeWidth="2.4" strokeLinecap="round" />
              <path d="M13.5 16H25.5" stroke="#fafafa" strokeWidth="2.4" strokeLinecap="round" />
            </svg>
          </div>
        </div>
      </div>
    </article>
  );
}

/* Funding: naira or dollars. */
function FundCard() {
  return (
    <article className="card span-3">
      <div className="card-head">
        <span className="card-tag">Add money</span>
        <h3 className="h3">Naira at home. Stables from anywhere.</h3>
        <p>Send a bank transfer, or USDC and USDT on Base, or USDC on Arc. Family abroad can keep home covered.</p>
      </div>
      <div className="card-visual subs" aria-hidden="true">
        <div className="sub">
          <span className="sub-name">
            <span className="sub-badge">
              <IconBank size={14} />
            </span>
            Bank transfer
          </span>
          <span className="sub-meta">₦ · instant</span>
        </div>
        <div className="sub">
          <span className="sub-name">
            <span className="sub-badge">
              <IconGlobe size={14} />
            </span>
            Stablecoins
          </span>
          <span className="sub-meta">USDC · USDT</span>
        </div>
      </div>
    </article>
  );
}
