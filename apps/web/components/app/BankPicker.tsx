"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { ApiError } from "@/lib/app/api";
import { useServer } from "./Server";

export type Bank = { code: string; name: string };

/** What people actually type for the banks most Nigerians use. */
const ALIASES: Record<string, string[]> = {
  gtb: ["guaranty trust"],
  gtbank: ["guaranty trust"],
  uba: ["united bank for africa"],
  fcmb: ["first city monument"],
  firstbank: ["first bank"],
  fbn: ["first bank"],
  stanbic: ["stanbic ibtc"],
  ibtc: ["stanbic ibtc"],
  zenith: ["zenith"],
  opay: ["opay", "paycom"],
  palmpay: ["palmpay"],
  moniepoint: ["moniepoint"],
  kuda: ["kuda"],
  wema: ["wema"],
  alat: ["wema"],
  sterling: ["sterling"],
  fidelity: ["fidelity"],
  union: ["union bank"],
  polaris: ["polaris"],
  keystone: ["keystone"],
  ecobank: ["ecobank"],
  access: ["access"],
  diamond: ["access bank (diamond)", "diamond"],
};

export type BankList = {
  banks: Bank[];
  /** "off": withdrawals aren't set up on this server, so there's no bank list either. */
  status: "loading" | "ready" | "error" | "off";
  retry: () => void;
};

/** Nigeria's banks from the API, with a state for every outcome: a failed load says so and can be tried again. */
export function useBanks(enabled = true): BankList {
  const { call } = useServer();
  const [banks, setBanks] = useState<Bank[]>([]);
  const [status, setStatus] = useState<BankList["status"]>("loading");
  const load = useCallback(() => {
    setStatus("loading");
    call<Bank[]>("/v1/banks")
      .then((b) => {
        setBanks(b);
        setStatus(b.length ? "ready" : "error");
      })
      .catch((err) => setStatus(err instanceof ApiError && err.code === "payouts_off" ? "off" : "error"));
  }, [call]);
  useEffect(() => {
    if (enabled) load();
  }, [enabled, load]);
  return { banks, status, retry: load };
}

/** Shown before anything is typed: the banks most people use. */
const POPULAR = ["access bank", "guaranty trust", "first bank", "united bank for africa", "zenith", "opay", "moniepoint", "palmpay", "kuda"];

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

/** Banks matching what was typed: names that start with it first, then any word that does, then anywhere. */
export function matchBanks(banks: Bank[], query: string, limit = 8): Bank[] {
  const q = norm(query);
  if (!q) {
    const popular = POPULAR.map((p) => banks.find((b) => norm(b.name).startsWith(p) || norm(b.name).includes(p))).filter((b): b is Bank => Boolean(b));
    return [...new Map(popular.map((b) => [b.code, b])).values()].slice(0, limit);
  }
  const alias = ALIASES[q.replace(/ /g, "")] ?? [];
  const scored = banks
    .map((b) => {
      const n = norm(b.name);
      let score = -1;
      if (alias.some((a) => n.startsWith(a))) score = 0;
      else if (n.startsWith(q)) score = 1;
      else if (n.split(" ").some((w) => w.startsWith(q))) score = 2;
      else if (alias.some((a) => n.includes(a))) score = 3;
      else if (n.includes(q)) score = 4;
      return { b, score, n };
    })
    .filter((x) => x.score >= 0)
    .sort((a, b) => a.score - b.score || a.n.length - b.n.length || a.n.localeCompare(b.n));
  return scored.slice(0, limit).map((x) => x.b);
}

/**
 * Type a few letters of a bank and pick it from the list that pops up (an ARIA combobox: arrow keys, Enter, Escape).
 * `value` is the chosen bank's code; typing again clears the choice until a bank is picked.
 */
export function BankPicker({
  id,
  list,
  value,
  onChange,
  invalid,
  describedBy,
}: {
  id: string;
  list: BankList;
  value: string;
  onChange: (code: string) => void;
  invalid?: boolean;
  describedBy?: string;
}) {
  const listId = useId();
  const banks = list.banks;
  const chosen = banks.find((b) => b.code === value) ?? null;
  const [text, setText] = useState(chosen?.name ?? "");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const wrap = useRef<HTMLDivElement>(null);
  const matches = useMemo(() => matchBanks(banks, chosen && text === chosen.name ? "" : text), [banks, text, chosen]);

  // Keep the text in step if the choice changes from outside (or the list loads after it).
  useEffect(() => {
    if (chosen) setText(chosen.name);
  }, [chosen]);

  // Close when tapping elsewhere.
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  function pick(b: Bank) {
    onChange(b.code);
    setText(b.name);
    setOpen(false);
  }

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(i + 1, matches.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && open && matches[active]) {
      e.preventDefault();
      pick(matches[active]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  const loading = list.status === "loading";
  if (list.status === "error" || list.status === "off") {
    return (
      <div className="ap-inline-state" role="alert" id={id} tabIndex={-1}>
        <p className="ap-muted">{list.status === "off" ? "Bank accounts can't be added yet." : "We couldn't load the list of banks."}</p>
        {list.status === "error" && (
          <button className="btn btn-ghost btn-sm" type="button" onClick={list.retry}>
            Try again
          </button>
        )}
      </div>
    );
  }
  return (
    <div className="ap-combo" ref={wrap}>
      <input
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && matches[active] ? `${listId}-${active}` : undefined}
        aria-invalid={invalid}
        aria-describedby={describedBy}
        autoComplete="off"
        spellCheck={false}
        placeholder={loading ? "Loading banks…" : "Type your bank, e.g. GTB"}
        disabled={loading}
        value={text}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setText(e.target.value);
          setActive(0);
          setOpen(true);
          if (value) onChange("");
        }}
        onKeyDown={onKey}
      />
      {open && !loading && (
        <ul className="ap-combo-list" id={listId} role="listbox" aria-label="Banks">
          {matches.length ? (
            matches.map((b, i) => (
              <li
                key={b.code}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                data-active={i === active || undefined}
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => pick(b)}
                onMouseEnter={() => setActive(i)}
              >
                {b.name}
              </li>
            ))
          ) : (
            <li className="ap-combo-empty" role="presentation">
              No bank matches “{text}”. Try fewer letters.
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
