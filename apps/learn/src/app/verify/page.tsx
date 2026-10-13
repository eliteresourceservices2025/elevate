import type { Metadata } from "next";
import { VerifyForm } from "@/components/forms";

export const metadata: Metadata = { title: "Check a certificate" };

// Public: no sign-in. A certificate is found only with its reference AND the holder's full name, and the answer shows dates and
// whether it is valid, never anything else about the person.
export default function VerifyPage() {
  return (
    <>
      <h1>Check a certificate</h1>
      <p>Enter the reference printed on the certificate and the full name of the person it was issued to.</p>
      <VerifyForm />
    </>
  );
}
