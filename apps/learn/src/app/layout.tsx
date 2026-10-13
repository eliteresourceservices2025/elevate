import type { Metadata } from "next";
import { Inter, JetBrains_Mono, Source_Sans_3 } from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
import { ThemeToggle } from "@/components/theme-toggle";
import "./globals.css";

// The same three fonts as ELEVATE (Inter for text, Source Sans 3 for headings, JetBrains Mono for code). next/font downloads them
// at build time and serves them from this site, so the browser makes no request to a font service.
const body = Inter({ variable: "--font-body", subsets: ["latin"] });
const head = Source_Sans_3({ variable: "--font-head", subsets: ["latin"] });
const code = JetBrains_Mono({ variable: "--font-code", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "ELEVATE Learn", template: "%s · ELEVATE Learn" },
  description: "Training for the Elite Resource Services team.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${body.variable} ${head.variable} ${code.variable}`}>
      <body>
        <ThemeProvider>
          <header className="site">
            <div>
              <strong>ELEVATE Learn</strong>
              <ThemeToggle />
            </div>
          </header>
          <main>{children}</main>
        </ThemeProvider>
      </body>
    </html>
  );
}
