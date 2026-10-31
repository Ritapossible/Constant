"use client";

import Lenis from "lenis";
import { useEffect } from "react";

/** Lenis smooth scrolling, as on the reference site. Anchor links glide; reduced motion is respected. */
export function SmoothScroll() {
  useEffect(() => {
    const lenis = new Lenis({
      duration: 1.15,
      autoRaf: true,
      anchors: { offset: -88 },
      respectReducedMotion: true,
    });
    // Lenis keeps its own position: start it at the top too, unless the address points at a section.
    if (!window.location.hash) lenis.scrollTo(0, { immediate: true, force: true });
    return () => lenis.destroy();
  }, []);
  return null;
}
