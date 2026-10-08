import type { Kind } from "@/lib/app/catalog";

const D: Record<Kind, string> = {
  data: "M5 18v-3M10 18v-6M15 18V9M20 18V5",
  airtime: "M8 2.5h8A1.5 1.5 0 0 1 17.5 4v16a1.5 1.5 0 0 1-1.5 1.5H8A1.5 1.5 0 0 1 6.5 20V4A1.5 1.5 0 0 1 8 2.5ZM11 18.5h2",
  electricity: "M13 2 4 14h7l-1 8 9-12h-7l1-8Z",
  tv: "M5 6h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Zm3-4 4 4 4-4M8 21h8",
  subscription: "M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6",
};

export function KindIcon({ kind }: { kind: Kind }) {
  return (
    <span className="ap-kind-icon" aria-hidden="true">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <path d={D[kind]} />
      </svg>
    </span>
  );
}
