import type { Metadata } from "next";
import { Inter, JetBrains_Mono, Source_Sans_3 } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

const body = Inter({ variable: "--font-body", subsets: ["latin"] });
const head = Source_Sans_3({ variable: "--font-head", subsets: ["latin"] });
const code = JetBrains_Mono({ variable: "--font-code", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "ELEVATE", template: "%s · ELEVATE" },
  description: "ELITE Employee & VA Engagement / Talent Experience — Elite Resource Services",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${body.variable} ${head.variable} ${code.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <TooltipProvider>{children}</TooltipProvider>
        <Toaster richColors />
      </body>
    </html>
  );
}
