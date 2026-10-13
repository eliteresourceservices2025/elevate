# 11 Review packet for counsel and the Privacy Officer

**For:** the person who signs off the ELEVATE Learn courses before they are published for everyone at Elite Resource Services (ERS).
**Please return:** the decision table at the end, with your name, role and date.
**Time needed:** about 2 hours for the HIPAA course, 1 hour for Cybersecurity basics.

## 1. What this is

ELEVATE Learn is ERS's own training site. Everyone at ERS, and especially VAs working for healthcare clients, completes:

| Course | For | Length | Exam | Certificate |
| --- | --- | --- | --- | --- |
| **HIPAA Privacy, Security and Awareness** | everyone; healthcare-client VAs take the full course, internal staff a shorter one | 7 modules, about 79 minutes (Essentials track: 4 modules, about 47 minutes) | 15 random questions from a bank of 83, 80% to pass, 3 tries | valid **24 months** |
| **Cybersecurity basics** | everyone | 8 modules, about 71 minutes | 15 random questions from a bank of 83, 80% to pass, 3 tries | valid 12 months |

People read the lessons in order (a minimum time per module is enforced), take the exam, accept a responsibility statement, and
receive a PDF certificate with a transcript page. HR and leads see who has passed; scores are visible only to the person, HR and
the privacy team. No patient information is collected anywhere. Training time is recorded but never turned into pay.

The text was drafted by ERS from public HHS and regulation sources. **It is not legal advice and has not been reviewed by
counsel.** That review is the purpose of this packet.

## 2. What to read

| File | What it is |
| --- | --- |
| `docs/learn/review/hipaa-course.md` | Every lesson screen, check, scenario, the responsibility statement and the full exam bank with answers and reasons |
| `docs/learn/review/cybersecurity-course.md` | The same for Cybersecurity basics |
| `docs/learn/08-source-check.md` | For each factual statement in the HIPAA course: where it comes from (HHS pages, 45 CFR) and who must confirm it |
| `docs/learn/09-cybersecurity-sources.md` | Sources and topic coverage for Cybersecurity basics (general good practice, no legal claims) |
| `docs/learn/samples/` | Sample certificates (invented name) with the transcript page |

The two review files are generated from the course files (`pnpm learn:export`), so they always match what will be published.
They contain the exam answer key: keep them within the privacy and legal team.

## 3. What we ask you to confirm

**A. Accuracy of the HIPAA course (`08-source-check.md` marks each row "Confirmed" or "Counsel")**

1. ERS's legal role under each client contract (business associate or subcontractor) and how HIPAA applies to a Philippine
   workforce. The course only says the same protections follow the information through the contracts ERS signs.
2. **Incident deadlines.** The course states HIPAA's 60-day outer limit and says contracts are often shorter. Please give ERS's
   internal deadline for reporting, or the client-by-client notice periods, so Module 6 can state them.
3. The authorization examples (marketing, sale of PHI, psychotherapy notes) against 45 CFR 164.508.
4. The example about substance use treatment records (42 CFR Part 2): keep, correct or remove.
5. The treatment of the **proposed** Security Rule update (stated as a proposal). If a final rule appears, Modules 4 and 5 need a
   new version.
6. The state-law statement: HIPAA is a floor and a stricter state law can apply. The course teaches the principle only and gives
   no state-by-state detail, because clients span many states.

**B. Wording that carries legal weight**

7. The **responsibility statement** people accept after passing (it is still labelled `v1-draft`), including the plain-words
   sanctions sentence ("can lead to ERS sanctions, including the end of my engagement").
8. The certificate line: "This is ERS training completion, not an official certification issued by any government body."
9. Contractor wording. ERS engages 1099 contractors; the courses say "your engagement" and "team", never "employee" or
   "paid time off".
10. Whether the course should say anything about ERS's own sanctions policy, or leave that to the contract.

**C. Records and privacy of the training system itself**

11. **Retention.** Exam results, attestations and certificates are kept 6 years; per-question answers 12 months. Confirm or change.
12. The certificate's transcript page prints the person's **name, course, date taken, score and the IP address recorded when they
    accepted the statement** (copied from the format of the paid course ERS used before). Confirm that printing the IP address is
    acceptable, or tell us to drop it.
13. **Validity: 24 months for HIPAA** (HR's decision; HIPAA sets no fixed period). Confirm no client agreement says "annual". If
    one does, the certificate must be 12 months for people serving that client.
14. The privacy incident form (`/incidents` in ELEVATE): who should be named Privacy Officer, and the instruction given to
    people ("report to your lead and HR straight away").

**D. Pedagogy (optional, your call)**

15. Any topic you think a healthcare VA must know that is missing, or anything to remove.

## 4. Open items we already know about

| Item | Why it is open |
| --- | --- |
| Client-specific incident notice periods | Needs each client's agreement |
| Whether overdue training should ever stop someone being assigned to a client | Today it only warns |
| A yearly refresher between 24-month renewals | HR decided not to add one |
| Content studio for editing in the app | Today edits are made by the developer and re-published as a new version |

## 5. How your decision is used

When you approve, ERS publishes each course with **your name as reviewer and the date you approved** (these are stored with the
published version and cannot be changed afterwards). If you ask for changes, they are made and the course is published as a new
version; people already on an older version finish it.

```text
pnpm learn:publish --course hipaa --publish --reviewer <reviewer email> --counsel-date YYYY-MM-DD
pnpm learn:publish --course cybersecurity --publish --reviewer <reviewer email> --counsel-date YYYY-MM-DD
```

Please use the real approval date. Approving does not by itself assign anyone: ERS chooses a pilot group first.

## 6. Decision record (please return)

| Course | Decision (approved / approved with changes / not approved) | Changes required (item numbers above) | Reviewer name and role | Date |
| --- | --- | --- | --- | --- |
| HIPAA Privacy, Security and Awareness | | | | |
| Cybersecurity basics | | | | |
