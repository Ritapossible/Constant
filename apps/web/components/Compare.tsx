"use client";

import { useEffect, useState } from "react";
import { useInViewOnce } from "./Reveal";
import { IconCheck, IconX } from "./icons";

const ROWS: [string, string][] = [
  ["Data dies in the middle of a call", "Tops up before it runs out"],
  ["Light goes off at night", "A spare token is already on your phone"],
  ["DSTV cuts on match day", "Renewed the day before"],
  ["The money got spent on something else", "Set aside, one pot per bill"],
  ["You find out when it's too late", "Warned days before it runs low"],
];

export function Compare() {
  const [ref, inView] = useInViewOnce<HTMLDivElement>(0.35);
  const [on, setOn] = useState(false);
  const [touched, setTouched] = useState(false);

  // Flip the switch once by itself, so the change is visible without a tap.
  useEffect(() => {
    if (!inView || touched) return;
    const t = setTimeout(() => setOn(true), 700);
    return () => clearTimeout(t);
  }, [inView, touched]);

  return (
    <section className="section" aria-labelledby="compare-title">
      <div className="container" ref={ref}>
        <h2 id="compare-title" className="compare-intro">
          Running out is normal here. <br />
          <span className="dim">Switch on Constant</span>
          <button
            type="button"
            role="switch"
            aria-checked={on}
            aria-label="Show life with Constant"
            className="switch"
            onClick={() => {
              setTouched(true);
              setOn((v) => !v);
            }}
          >
            <span className="switch-knob" />
          </button>
          <span className="dim">and it isn&apos;t.</span>
        </h2>
        <div className="compare" data-on={on}>
          <div className="compare-col them">
            <h3>Without Constant</h3>
            <ul>
              {ROWS.map(([a], i) => (
                <li key={i}>
                  <IconX size={16} />
                  <span>{a}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="compare-col us">
            <h3>
              With Constant
              <span className="mono" style={{ fontSize: 12, opacity: 0.7 }}>
                {on ? "ON" : "OFF"}
              </span>
            </h3>
            <ul>
              {ROWS.map(([, b], i) => (
                <li key={i} style={{ ["--i" as string]: i }}>
                  <IconCheck size={16} />
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
