import { Bento } from "@/components/Bento";
import { BuiltWith } from "@/components/BuiltWith";
import { Compare } from "@/components/Compare";
import { Control } from "@/components/Control";
import { Cta } from "@/components/Cta";
import { Fair } from "@/components/Fair";
import { Faq } from "@/components/Faq";
import { Footer } from "@/components/Footer";
import { Hero } from "@/components/Hero";
import { Nav } from "@/components/Nav";
import { People } from "@/components/People";
import { Reminders } from "@/components/Reminders";
import { Steps } from "@/components/Steps";

export default function Home() {
  return (
    <>
      <Nav />
      <main id="main">
        <Hero />
        <BuiltWith />
        <People />
        <Compare />
        <Bento />
        <Reminders />
        <Steps />
        <Control />
        <Fair />
        <Faq />
        <Cta />
      </main>
      <Footer />
    </>
  );
}
