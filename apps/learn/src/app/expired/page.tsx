import { elevateUrl } from "@/lib/origin";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Link expired" };

export default function Expired() {
  const elevate = elevateUrl();
  return (
    <>
      <h1>Your sign-in link expired</h1>
      <p>For your security, the link that opens training works only once and only for a minute.</p>
      <p>{elevate ? <a href={`${elevate}/learn`}>Open training from ELEVATE again</a> : "Please open training from ELEVATE again."}</p>
    </>
  );
}
