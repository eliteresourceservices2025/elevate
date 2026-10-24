import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

/** The top of a signed-in page: a way back, an icon, the one h1 and a line about the page, on a soft purple band like the home page. */
export function PageHead({ icon, title, text, extra }: { icon: ReactNode; title: string; text: string; extra?: ReactNode }) {
  return (
    <>
      <p className="back no-print">
        <Link href="/">
          <ArrowLeft size={16} aria-hidden="true" /> Back to my training
        </Link>
      </p>
      <section className="hero page-hero">
        <div className="hero-icon" aria-hidden="true">
          {icon}
        </div>
        <div className="hero-text">
          <h1>{title}</h1>
          <p>{text}</p>
        </div>
        {extra ? <div className="hero-extra no-print">{extra}</div> : null}
      </section>
    </>
  );
}
