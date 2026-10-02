import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Safe Voice", template: "%s · Safe Voice" },
  description: "Report a concern anonymously. No account, no cookies, no tracking.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="site">
          <div>
            <strong>Safe Voice</strong>
            <nav aria-label="Main">
              <Link href="/">Send a report</Link>
              <Link href="/follow-up">Check a case</Link>
            </nav>
          </div>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
