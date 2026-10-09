import type { Metadata } from "next";
import { contactEmail } from "@/modules/legal/contact";

export const metadata: Metadata = {
  title: "Terms of use",
  description: "Rules for using ELEVATE, the internal system of Elite Resource Services.",
  robots: { index: true, follow: true },
};

export default function TermsPage() {
  const email = contactEmail();
  return (
    <>
      <h1>Terms of use</h1>
      <p className="text-muted-foreground">ELEVATE, operated by Elite Resource Services (&ldquo;ERS&rdquo;). Last updated October 2026.</p>
      <p>By signing in to ELEVATE you agree to these terms. If you do not agree, do not use it.</p>

      <h2>Who may use it</h2>
      <p>ELEVATE is for people ERS has invited: its staff, team leads and contractors. Accounts are personal. Do not share your sign-in or your two-step codes.</p>

      <h2>Acceptable use</h2>
      <ul>
        <li>Use ELEVATE only for ERS work and for managing your own records.</li>
        <li>Keep what you see confidential. Do not copy, share or misuse other people&apos;s information.</li>
        <li>
          <strong>Never upload client or patient information</strong> (including health records) to ELEVATE.
        </li>
        <li>Enter accurate information, including your working time.</li>
        <li>Do not try to bypass access limits, probe the system for weaknesses or interfere with how it works.</li>
      </ul>

      <h2>Time records and monitoring</h2>
      <p>
        Your clock-in records are the official record of your working time. Where ERS has published a monitoring policy for your team, ELEVATE and related tools may
        record the items that policy lists. Read that policy in ELEVATE.
      </p>

      <h2>Your relationship with ERS</h2>
      <p>These terms cover the use of the system only. They do not create or change any employment or engagement agreement between you and ERS.</p>

      <h2>Availability</h2>
      <p>
        We work to keep ELEVATE available but do not promise uninterrupted service. We may change, suspend or end access, for example when someone stops working with
        ERS or when security requires it.
      </p>

      <h2>Liability</h2>
      <p>To the extent the law allows, ERS is not liable for losses caused by interruptions or by use of ELEVATE contrary to these terms.</p>

      <h2>Privacy</h2>
      <p>
        How we handle personal data is described in our{" "}
        <a className="underline" href="/privacy">
          privacy policy
        </a>
        .
      </p>

      <h2>Changes and law</h2>
      <p>We may update these terms and will show the date above. These terms are governed by the laws of the Philippines.</p>

      <h2>Contact</h2>
      <p>
        {email ? (
          <a className="underline" href={`mailto:${email}`}>
            {email}
          </a>
        ) : (
          "Contact your ERS HR team."
        )}
      </p>
    </>
  );
}
