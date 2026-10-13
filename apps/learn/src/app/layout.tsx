import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "ELEVATE Learn", template: "%s · ELEVATE Learn" },
  description: "Training for the Elite Resource Services team.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="site">
          <div>
            <strong>ELEVATE Learn</strong>
          </div>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
