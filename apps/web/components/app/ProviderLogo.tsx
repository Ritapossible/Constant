import { findProvider, logoOf, type Kind } from "@/lib/app/catalog";
import { KindIcon } from "./KindIcon";

/**
 * A provider's logo on a neutral tile (logos from the vend partner's catalogue, unaltered). Providers without one
 * get a monogram; unknown ones the kind's icon.
 */
export function ProviderLogo({ kind, id, size = 40 }: { kind: Kind; id: string; size?: number }) {
  const p = findProvider(kind, id);
  const src = logoOf(p);
  if (src) {
    return (
      <span className="ap-logo" style={{ width: size, height: size }} aria-hidden="true">
        <img src={src} alt="" width={size} height={size} loading="lazy" decoding="async" />
      </span>
    );
  }
  if (p) {
    return (
      <span className="ap-logo ap-logo-mono" style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }} aria-hidden="true">
        {p.name.slice(0, 1)}
      </span>
    );
  }
  return <KindIcon kind={kind} />;
}
