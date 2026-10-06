import { ImageResponse } from "next/og";

export const alt = "Constant — Set it once. Never run out.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#0a0a0a",
          color: "#fafafa",
          padding: 72,
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 36, fontWeight: 700 }}>
          <svg width="56" height="56" viewBox="0 0 32 32">
            <rect width="32" height="32" rx="9" fill="#fafafa" />
            <path d="M22.5 10.6A8.5 8.5 0 1 0 22.5 21.4" fill="none" stroke="#0a0a0a" strokeWidth="2.4" strokeLinecap="round" />
              <path d="M13.5 16H25.5" stroke="#0a0a0a" strokeWidth="2.4" strokeLinecap="round" />
          </svg>
          Constant
        </div>
        <div style={{ display: "flex", flexDirection: "column", fontSize: 96, fontWeight: 700, letterSpacing: -4, lineHeight: 1 }}>
          <span>Set it once.</span>
          <span style={{ color: "#a3a3a0" }}>Never run out.</span>
        </div>
        <div style={{ fontSize: 28, color: "#a3a3a0" }}>Data · Light · Cable TV · Subscriptions</div>
      </div>
    ),
    size,
  );
}
