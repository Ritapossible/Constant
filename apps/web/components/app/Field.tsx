"use client";

import { useId, type ReactNode } from "react";

/** A labelled input with its hint or error wired up for screen readers. */
export function Field({
  label,
  error,
  hint,
  children,
}: {
  label: string;
  error?: string | null;
  hint?: string;
  children: (a11y: { id: string; "aria-invalid": boolean; "aria-describedby"?: string }) => ReactNode;
}) {
  const id = useId();
  const msgId = `${id}-msg`;
  const described = error || hint ? msgId : undefined;
  return (
    <div className="ap-field">
      <label htmlFor={id}>{label}</label>
      {children({ id, "aria-invalid": Boolean(error), "aria-describedby": described })}
      {error ? (
        <span id={msgId} className="ap-err">
          {error}
        </span>
      ) : hint ? (
        <span id={msgId} className="ap-hint">
          {hint}
        </span>
      ) : null}
    </div>
  );
}
