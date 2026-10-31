import Image from "next/image";
import { Reveal } from "./Reveal";

/**
 * Who ConstantUnits is for. Photos taken in Lagos, Lekki and Ota, free under the Unsplash License (credits in
 * DECISIONS D-074). The captions describe what the product does; they are not quotes from these people.
 */
const PEOPLE = [
  {
    src: "/people/woman-phone.jpg",
    alt: "A smiling woman on a sofa, reading her phone",
    title: "Data that never runs out mid-chat",
    text: "Your line is topped up before it hits zero.",
    wide: true,
  },
  {
    src: "/people/man-laptop.jpg",
    alt: "A smiling man at his desk with a laptop",
    title: "Work doesn't stop for a recharge",
    text: "Airtime and data, handled in the background.",
  },
  {
    src: "/people/woman-macbook.jpg",
    alt: "A smiling woman lying on the grass beside her laptop and phone",
    title: "Subscriptions, never a surprise",
    text: "ChatGPT, Claude, Spotify, Netflix: every renewal date in one place, with a reminder before each.",
  },
  {
    src: "/people/hand-phone.jpg",
    alt: "A hand holding a smartphone above a laptop",
    title: "One app for every bill, yours or theirs",
    text: "Data, airtime, light, TV and subscriptions, for you, a friend or family, within limits you set.",
    wide: true,
  },
];

export function People() {
  return (
    <section className="section" aria-labelledby="people-title">
      <div className="container">
        <Reveal className="section-head">
          <span className="eyebrow">Who it&apos;s for</span>
          <h2 id="people-title" className="h2">
            Bills for your home <span className="serif">and the people you look after</span>
          </h2>
        </Reveal>
        <Reveal className="people">
          {PEOPLE.map((p) => (
            <figure className="people-card" data-wide={p.wide || undefined} key={p.src}>
              <div className="people-photo">
                <Image src={p.src} alt={p.alt} fill sizes="(max-width: 760px) 100vw, (max-width: 1160px) 66vw, 760px" />
              </div>
              <figcaption>
                <b>{p.title}</b>
                <span>{p.text}</span>
              </figcaption>
            </figure>
          ))}
        </Reveal>
      </div>
    </section>
  );
}
