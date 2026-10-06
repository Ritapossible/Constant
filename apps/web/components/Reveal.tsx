"use client";

import { useEffect, useRef, useState, type ElementType, type ReactNode } from "react";

/** True once the element has scrolled into view (fires once). */
export function useInViewOnce<T extends Element>(threshold = 0.15, rootMargin = "0px 0px -10% 0px") {
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setInView(true);
          io.disconnect();
        }
      },
      { threshold, rootMargin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [threshold, rootMargin]);
  return [ref, inView] as const;
}

/** Blurs in, then lifts each child with a stagger, the first time it is seen. */
export function Reveal({
  as: Tag = "div",
  className = "",
  children,
  id,
}: {
  as?: ElementType;
  className?: string;
  children: ReactNode;
  id?: string;
}) {
  const [ref, inView] = useInViewOnce<HTMLElement>();
  return (
    <Tag ref={ref} id={id} className={`reveal ${inView ? "is-in" : ""} ${className}`}>
      {children}
    </Tag>
  );
}
