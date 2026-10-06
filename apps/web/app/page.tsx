import { Bento } from "@/components/Bento";
import { Compare } from "@/components/Compare";
import { Control } from "@/components/Control";
import { Cta } from "@/components/Cta";
import { Faq } from "@/components/Faq";
import { Footer } from "@/components/Footer";
import { Hero } from "@/components/Hero";
import { Nav } from "@/components/Nav";
import { Reminders } from "@/components/Reminders";
import { Steps } from "@/components/Steps";

export default function Home() {
  return (
    <>
      <Nav />
      <main id="main">
        <Hero />
        <Compare />
        <Bento />
        <Reminders />
        <Steps />
        <Control />
        <Faq />
        <Cta />
      </main>
      <Footer />
    </>
  );
}
