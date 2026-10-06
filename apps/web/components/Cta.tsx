"use client";

import { useState, type FormEvent } from "react";
import { Reveal } from "./Reveal";
import { Scramble } from "./Scramble";
import { IconArrow } from "./icons";

const WORDS = ["data", "light", "DSTV", "airtime", "ChatGPT"];

type State = { tone: "idle" | "ok" | "error"; text: string };

export function Cta() {
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<State>({ tone: "idle", text: "" });

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    setBusy(true);
    setState({ tone: "idle", text: "" });
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ contact: data.get("contact"), company: data.get("company") }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (res.ok) {
        form.reset();
        setState({ tone: "ok", text: "You're on the list. We'll message you when your spot opens." });
      } else if (body.error === "invalid") {
        setState({ tone: "error", text: "Enter a phone number or an email address." });
      } else {
        setState({ tone: "error", text: "We couldn't save that just now. Please try again shortly." });
      }
    } catch {
      setState({ tone: "error", text: "No connection. Please try again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="section" id="early" aria-labelledby="early-title">
      <div className="container">
        <Reveal className="cta">
          <div className="cta-orbit" aria-hidden="true">
            <div className="cta-orbit-spin" />
          </div>
          <span className="status">
            <span className="eyebrow-dot" /> Early access · Nigeria
          </span>
          <h2 id="early-title" className="cta-title">
            Never run out of <Scramble words={WORDS} /> again.
          </h2>
          <p className="cta-sub">Join the early access list. We&apos;ll message you when your spot opens.</p>
          <form className="signup" onSubmit={onSubmit} noValidate>
            <label htmlFor="contact" className="sr-only">
              Phone number or email
            </label>
            <div className="signup-row">
              <input
                id="contact"
                name="contact"
                type="text"
                inputMode="email"
                autoComplete="email"
                placeholder="Phone number or email"
                required
                maxLength={120}
              />
              <button className="btn btn-inverse" type="submit" disabled={busy}>
                {busy ? "Saving…" : "Get early access"} <IconArrow />
              </button>
            </div>
            <input className="hp" name="company" tabIndex={-1} autoComplete="off" aria-hidden="true" />
            <p className="signup-msg" role="status" aria-live="polite" data-tone={state.tone}>
              {state.text}
            </p>
          </form>
        </Reveal>
      </div>
    </section>
  );
}
