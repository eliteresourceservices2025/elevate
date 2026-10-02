import type { Metadata } from "next";
import { FollowUp } from "@/components/follow-up";

export const metadata: Metadata = { title: "Check a case" };

export default function Page() {
  return (
    <>
      <h1>Check a case</h1>
      <p>Enter the case code and passphrase you were given when you sent your report to read replies or add more.</p>
      <FollowUp />
    </>
  );
}
