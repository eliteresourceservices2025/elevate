import type { Metadata } from "next";
import { contactEmail } from "@/modules/legal/contact";

export const metadata: Metadata = {
  title: "Privacy policy",
  description: "How ELEVATE, the internal system of Elite Resource Services, handles personal data.",
  robots: { index: true, follow: true },
};

export default function PrivacyPage() {
  const email = contactEmail();
  return (
    <>
      <h1>Privacy policy</h1>
      <p className="text-muted-foreground">ELEVATE, operated by Elite Resource Services (&ldquo;ERS&rdquo;). Last updated October 2026.</p>
      <p>
        ELEVATE is ERS&apos;s internal system for managing its team of contractors and staff, and for receiving job applications. This page explains what personal
        data it handles, why, who can see it and what your choices are. It follows the Philippine Data Privacy Act of 2012 (RA 10173).
      </p>

      <h2>Who this covers</h2>
      <ul>
        <li>People who work with ERS and sign in to ELEVATE (staff, team leads and contractors).</li>
        <li>People who apply for a job through the ERS careers page.</li>
        <li>Anyone who signs in with a Google account to reach ELEVATE.</li>
      </ul>

      <h2>What we collect and why</h2>
      <ul>
        <li>
          <strong>Account details:</strong> your name and work or sign-in email address, and your sign-in method. With &ldquo;Sign in with Google&rdquo; we receive
          only your name, email address and profile picture from Google, to identify you. We do not read your Gmail, contacts, Drive or calendar.
        </li>
        <li>
          <strong>Work records:</strong> your role and team, who you report to, your schedule, time off, equipment assigned to you, documents you or HR upload, and
          reviews and goals.
        </li>
        <li>
          <strong>Time clock:</strong> clock-in, break and clock-out times and the network address you clocked in from. Location and photo check-ins are used only if
          ERS has published a monitoring policy that covers your team and, for location, only if you agree.
        </li>
        <li>
          <strong>Sensitive details</strong> such as government ID numbers and payout details are kept encrypted and are visible only to the people who need them
          for payroll and HR.
        </li>
        <li>
          <strong>Job applications:</strong> the information and resume you submit, and notes and scores from our hiring team.
        </li>
        <li>
          <strong>Security records:</strong> a log of important actions (for example sign-ins and who viewed a sensitive record) to protect everyone&apos;s data.
        </li>
      </ul>
      <p>We do not store client or patient information in ELEVATE, and we ask everyone not to upload it.</p>

      <h2>Who can see it</h2>
      <p>
        Access follows your role. You can see your own records. Team leads see what they need to manage their team. HR and administrators see more, and every look at
        a sensitive record is logged. We do not sell personal data and do not use it for advertising.
      </p>

      <h2>Companies that help us run ELEVATE</h2>
      <p>These providers process data for us under their own security and data-protection terms:</p>
      <ul>
        <li>Supabase (database, sign-in and file storage)</li>
        <li>Vercel (hosting)</li>
        <li>Google (sign-in, if you choose it, and interview calendars if HR connects one)</li>
        <li>Resend (sending email)</li>
        <li>Upstash (protecting sign-in and forms from abuse)</li>
        <li>Inngest (running scheduled background tasks)</li>
        <li>Jibble (work screenshots, only for teams covered by a published monitoring policy)</li>
      </ul>
      <p>Some of these providers store data outside the Philippines.</p>

      <h2>Cookies</h2>
      <p>
        ELEVATE uses only the cookies it needs to keep you signed in and to remember display choices such as the menu width. It does not use advertising or tracking
        cookies.
      </p>

      <h2>How long we keep data</h2>
      <p>
        We keep records for as long as you work with ERS or as the law and our legitimate business needs require. Applicant data is removed after a set period once an
        application is closed. Clock-in photos are deleted after 30 days.
      </p>

      <h2>Your rights</h2>
      <p>
        You may ask to see the personal data we hold about you, correct it, object to how it is used, or ask for it to be erased where the law allows. Signed-in
        users can see and export their own data under &ldquo;My data&rdquo; in ELEVATE and send a request from there. You may also complain to the National Privacy
        Commission.
      </p>

      <h2>Security</h2>
      <p>Sign-in requires two steps. Sensitive fields are encrypted, files are private, and access is limited by role and logged.</p>

      <h2>Contact</h2>
      <p>
        Questions or requests about your data:{" "}
        {email ? (
          <a className="underline" href={`mailto:${email}`}>
            {email}
          </a>
        ) : (
          "contact your ERS HR team"
        )}
        .
      </p>
      <p>We will update this page if our practices change and show the date above.</p>
    </>
  );
}
