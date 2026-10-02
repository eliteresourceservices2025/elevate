import type { Metadata } from "next";
import { ReportForm } from "@/components/report-form";

export const metadata: Metadata = { title: "Send a report" };

export default function Page() {
  return (
    <>
      <h1>Report a concern</h1>
      <p>
        Use this page to tell the people at Elite Resource Services who handle these reports about something that worries you. You do not
        need an account and you do not give your name.
      </p>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>How your privacy is protected</h2>
        <ul>
          <li>This site does not use cookies, does not ask who you are and does not keep your device, browser or network address with your report.</li>
          <li>Times are kept only as a calendar day.</li>
          <li>Files you attach have their hidden details (such as camera, place and author) removed before they are saved.</li>
          <li>Only a few people named as Safe Voice handlers can read reports.</li>
        </ul>
        <p className="muted">
          What you write can still identify you if it mentions details only you would know. You choose what to include. For the most privacy,
          use a device and network that are not tied to your work.
        </p>
      </div>
      <div className="card warn" role="note">
        <strong>Do not include client or patient information.</strong> Do not write names, records, or any health or personal details of
        a client&apos;s patients or customers, and do not attach their documents or screenshots. Describe what happened without them.
      </div>
      <ReportForm />
    </>
  );
}
