# Signing documents: wording review for HR and counsel

Every ready-made document in ELEVATE Sign, what differs from HR's Word or PDF version, and what needs a yes or a change. Tick a box when approved. The text itself lives in `apps/elevate/src/modules/signing/builtin-templates.ts` and `builtin-contracts.ts`.

## Changes that apply to every document

- [ ] **Signature lines are not in the text.** The "Contractor Name / Signature / Date" and "By / Name / Title / Date" lines are replaced by a **signature page** added when everyone has signed (name, signature, date and time in UTC, Manila and Arizona, IP address, sign-in method) and a **certificate of completion**.
- [ ] **The date.** A sent document cannot change, so the date a contractor signs is not printed in the body. The NDA and the agreement now say they are entered into "on the date of the last electronic signature recorded on the signature page of this document", and "In witness whereof" uses the same wording. (Before: "this ___ day of ____, 20__".)
- [ ] **Electronic signature consent.** Each signee ticks: "I agree to sign this document electronically. I understand my typed or drawn signature has the same effect as a handwritten one, that ELEVATE records the time, my IP address and how I signed in, and that I have read the document." Counsel should confirm it fits RA 8792 (E-Commerce Act). Notarized documents still need wet ink.
- [ ] **Punctuation.** Curly quotes become straight quotes, and long dashes become a hyphen (so "smart—with" prints "smart-with"). The peso sign prints as "PHP". Letters outside English (for example a name with characters beyond Latin-1) cannot be drawn; the editor warns.
- [ ] **Layout.** Letterhead from the NDA: logo centered with room above it, the title centered and bold, a faint logo watermark and a footer ("ELITE RESOURCE SERVICES", page x of y) on every page.
- [ ] **Initials on each page** is optional per send (the signee initials every page before signing; initials are stamped on every page of the signed copy).

## Personal Time Off (PTO) Policy

- [ ] **Source quality.** The PDF's text did not extract cleanly (ligatures and punctuation were lost), so I rebuilt it from context. **Read it once against the original.**
- [ ] The lead-ins "Single-Day PTO Requests", "Multi-Day PTO Requests" and "Failure to Submit Proof" are in bold (a guess).
- [ ] The policy says PTO is unpaid and does not accrue. This is HR's wording; the rest of ELEVATE avoids "PTO" for 1099 contractors until counsel confirms, so counsel should confirm the term here.
- [ ] Length: two pages (the original was one).

## Independent Contractor Handbook (v1.6)

- [ ] Dropped: the "Date: ____" line at the top, the "Welcome Message:" label, and the "Contractor Name / Signature / Date" lines.
- [ ] **Nested bullets are flattened** to one level: under "Use of Company Property" the three sub-points are now bullets of their own, and "Compliance with Policies" is a bullet of its own. In section 10 the three reasons for termination are one sentence separated by semicolons.
- [ ] The five core values are sub-headings ("1. Elevate Integrity" and so on) with their bullets.
- [ ] Section 3 (pay): please confirm the wording, since it states the 22-working-day structure and the training license fee deduction. These are HR's words, unchanged.

## Non-Disclosure Agreement

- [ ] **Company address:** "8 The Green, Suite R, Dover, Delaware 19901" (the registered address in Delaware), as given by HR. Confirm it is the address the NDA should state.
- [ ] The Recipient's **name and address fill in from their record**. A missing address stops the send.
- [ ] **Company signatory.** The Word version names "ALTHEA MARIE S. BULFA, Head of People Operations". It is not in the text now. HR chooses the countersigner when sending (the role "Head of People Operations" is the default); the signature page prints their legal name from their account, with that role. Confirm that is acceptable, or that the name must appear on the first page.
- [ ] The term "1 Year from the date of signing" and the Manila courts clause are unchanged.

## Independent Contractor Agreement (v1.7)

- [ ] Name and address fill from the record. **Service title** is the person's position, and **reporting line** their manager.
- [ ] **Terms HR types when sending:** monthly compensation ("PHP ..."), payment frequency (weekly, bi-weekly or monthly), duties, work schedule and the city of the courts (default Manila). They are the same for everyone in that send, so send the agreement to one person at a time.
- [ ] Section 4 reads "the rate of PHP {amount}" (as in the original, without "per month").
- [ ] **Section 6 and 7 sub-points** are merged into the sentence ("The Contractor agrees to: ...; ...; and ...") instead of nested bullets. The "Compensation Conditions / No Work No Pay" points are bullets of their own.
- [ ] **Bank information is not in the text.** The contractor types the bank name, account number, account name and phone number while signing. They are kept encrypted and printed under the contractor's signature on the signed copy. **Only the contractor, HR and Super Admin can open that copy** (the countersigner cannot). Every read is audited. Confirm this is acceptable, or ask for masking (for example last four digits).
- [ ] The "By / Name / Title / Date" blocks are replaced by the signature page; the Company side is the countersigner chosen when sending (role "ERS representative" by default).

## Questions for counsel

- [ ] Is an electronic signature with these records (time, IP, sign-in method, hash-chained log, certificate) enough for each of these documents under Philippine law?
- [ ] Should the NDA's Company signatory (Head of People Operations) appear by name in the body?
- [ ] Is the independent-contractor wording (no leave, no 13th month, "No Work, No Pay") what the agreement and handbook should say?
- [ ] How long must signed documents be kept? ELEVATE does not delete them automatically.
