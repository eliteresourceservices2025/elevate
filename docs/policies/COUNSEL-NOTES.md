# Points for counsel and for ERS to confirm (not part of the policies)

Drafts: `privacy-notice.md` and `monitoring-policy.md` in this folder. Each is pasted into ELEVATE (Policies page) as a new version. Publishing is permanent and makes everyone accept it at their next sign-in. Neither file contains the words DRAFT PLACEHOLDER (publishing refuses those), and each is under ELEVATE's 10,000 character limit.

## ERS must make these true before publishing
1. **Jibble settings: screenshots only.** Activity levels, app and URL tracking, and any webcam or location features must be OFF in Jibble. The screenshot interval is set by ERS. Screenshot retention in Jibble must match the policy (the policy says 2 months, which is what Jibble applies on the Free plan with no org override; confirm in Jibble > Time Tracking Settings > Screenshots, and if the plan changes, change the policy and the setting together).
2. **Who can see screenshots in Jibble:** limit it to HR and team leads, as the policy says.
3. **Data Protection Officer:** the draft names the ERS HR team. The Data Privacy Act expects a designated DPO and, where it applies, registration with the National Privacy Commission (counsel to confirm for a company of this size). The contact email on `/privacy` comes from `EMAIL_REPLY_TO` in Vercel.
4. **Clients** are told name, role and working hours. Confirm that matches the client contracts.

## Training records (ELEVATE Learn)
- The privacy notice now lists training records. Draft periods: results and certificates 5 years from completion, then 1 year in a restricted HR-only archive (6 years in total, the same as the HIPAA documentation period); per-question exam answers 12 months. HR asked for 5 + 1 to match people records; the clock here starts at completion, not at the end of the engagement. Counsel to confirm.
- **Not built yet:** Learn keeps results and certificates for the full 6 years with no separate archive stage (only per-question answers are purged, by `learn-purge`). Until an archive step exists the "restricted archive" wording is a promise handled by hand.

## For counsel
- Contractor (1099) wording and the retention periods (draft: people records engagement + 5 years, then 1 year in a restricted HR-only archive (HR's request; confirm the extra year is justified under the Data Privacy Act's "no longer than necessary" rule; nothing in ELEVATE enforces this yet, it is done by hand until a retention job exists); time records engagement + 3 years; applications 12 and 6 months; security log 3 years). These are common defaults, not legal advice.
- Basis for monitoring: legitimate interest plus acknowledgment. Is separate express consent needed for screenshots?
- Cross-border transfers (US clients; hosting in Singapore and the US): any notice or contract terms needed.
- US healthcare clients: screenshots may capture patient data. Whether a business associate agreement or client notice is needed is for counsel and the client contracts. The draft only commits to confidentiality, limited access and prompt deletion.
- Safe Voice has its own page; confirm it needs no mention here.
- The optional location setting stays available in ELEVATE once a monitoring policy is published. The draft describes it as optional and rounded (about 1 km). If ERS does not want it at all, say so and the option can be switched off in the app.
