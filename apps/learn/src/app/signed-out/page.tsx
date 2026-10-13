import { elevateUrl } from "@/lib/origin";

// Signing out redirects here (a page on this site: the content-security policy's form-action rule also covers the redirects of a
// form post, so the post cannot be sent straight to another site). This page then moves the person on to ELEVATE with a new
// navigation, and offers the link in case that does not happen.
export default function SignedOut() {
  const elevate = elevateUrl();
  const destination = elevate ? `${elevate}/dashboard` : null;
  return (
    <>
      {destination ? <meta httpEquiv="refresh" content={`0;url=${destination}`} /> : null}
      <h1>You are signed out of training</h1>
      <p>{destination ? <a href={destination}>Back to ELEVATE</a> : "You can close this tab."}</p>
    </>
  );
}
