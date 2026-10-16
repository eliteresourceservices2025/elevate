import type { BuiltinTemplate } from "./builtin-templates";

// The Contractor Handbook and the Non-Disclosure Agreement, from HR's clean text ("ELITE Resource Services - Contractor Documents").
// Differences from the Word versions, on purpose: the "Contractor Name / Signature / Date" and "By / Name / Title / Date" lines are not in
// the body, because ELEVATE Sign adds a signature page and a certificate with each person's name, signature, date and time. The
// agreement date is the signing date, which is only known when the contractor signs, so the NDA's opening says so. Text in [[double
// brackets]], if a document has any, must be replaced by HR before sending (the editor warns and the send is refused while any remain).

const HANDBOOK = `Welcome to ELITE Resource Services!

We are excited to have you join our network of professional contractors. This handbook outlines the expectations, policies, and standards for working with ELITE Resource Services. As an independent contractor, you play an important role in delivering high-quality services to our clients.

# 1. About ELITE Resource Services

## Who We Are

At ELITE Resource Services, we live by our name — E.L.I.T.E. stands for Elevate Integrity, Talent & Excellence. These values guide everything we do; from the way we work with clients to how we support our team of professionals.

We provide highly skilled Virtual Assistants who bring expertise, reliability, and efficiency to businesses across different industries. Our goal is to elevate our clients' success by connecting them with exceptional talent that delivers results with integrity and excellence.

Our virtual assistants specialize in a wide range of services, including:

- **Executive Assistance** – managing calendars, emails, travel arrangements, and day-to-day business needs.
- **Real Estate Virtual Assistance** – CRM management, listings coordination, lead generation, and client support.
- **Healthcare & Medical Virtual Assistance** – appointment scheduling, insurance verification, patient coordination, and admin support for providers.
- **Medical Billing & Collections** – claims processing, denial management, payment posting, and revenue cycle support.
- **Back-Office Support** – data entry, research, documentation, and customer service.

By focusing on Integrity, Talent, and Excellence, ELITE Resource Services ensures that every client receives not just a virtual assistant, but a trusted partner dedicated to their growth.

## Vision

At ELITE Resource Services, we envision a future where businesses of every size can thrive without limitations, empowered by the right people and the right support. We believe that true success comes not just from hard work, but from working smart—with trusted partners who bring integrity, talent, and excellence to every task.

Our vision is to elevate the way businesses operate by connecting them with highly skilled virtual assistants who are more than just support—they are collaborators, problem solvers, and growth partners. By holding ourselves to the highest standards of professionalism and care, we strive to create lasting relationships built on trust, reliability, and results.

In everything we do, we aim to embody what it means to be E.L.I.T.E.—Elevating Integrity, Talent, and Excellence—so that our clients, our contractors, and our communities can rise together toward greater success.

## Mission

Our mission at ELITE Resource Services is to empower businesses and professionals by providing exceptional virtual assistant solutions that create real impact. We are here to lighten the load for our clients, allowing them to focus on growth, innovation, and the work that truly matters, while trusting us to deliver consistent, reliable, and professional support.

We exist to elevate the standard of partnership between businesses and virtual assistants—where every engagement is guided by Integrity, fueled by Talent, and driven by Excellence. By carefully matching the right people to the right roles, we ensure that our clients don't just gain assistance but a dedicated partner committed to their success.

At ELITE, we measure success not only by the tasks completed, but by the confidence, freedom, and opportunities we help create for the people and businesses we serve.

## Our Core Values

At ELITE Resource Services, our values are more than just words — they are the foundation of how we work, how we treat people, and how we deliver results. We live by the spirit of being E.L.I.T.E. every single day:

### 1. Elevate Integrity

- We believe that trust is the cornerstone of every successful relationship.
- We commit to honesty, transparency, and ethical practices in every interaction with our clients, contractors, and community.
- Integrity means doing the right thing even when no one is watching.

### 2. Elevate Talent

- We recognize that people are our greatest strength.
- We carefully select and nurture talented professionals who bring skill, passion, and innovation to their roles.
- We believe in creating opportunities where talent can shine and grow.

### 3. Elevate Excellence

- We strive to go beyond expectations, delivering high-quality work with consistency and dedication.
- Excellence for us is not a one-time achievement—it's a habit, a culture, and a promise we make to our clients.
- We continuously improve, adapt, and innovate to stay at the top of our field.

### 4. Teamwork and Respect

- We value collaboration, kindness, and open communication.
- Every voice matters, and every person deserves respect.
- Together, we achieve more than we ever could alone.

### 5. Accountability

- We take ownership of our commitments and responsibilities.
- We stand by our work and accept responsibility for our actions and decisions.
- Accountability builds reliability, and reliability builds trust.

# 2. Contractor Relationship

- Contractors engaged with ELITE Resource Services are not employees.
- Each contractor operates as an independent service provider, managing their own work methods, tools, and schedules (subject to meeting client requirements).
- Contractors are responsible for their own taxes, government contributions (SSS, PhilHealth, Pag-IBIG if voluntary), and compliance with applicable laws.
- This handbook is not an employment contract, but a guide to professional expectations when working with ELITE Resource Services and its clients.

# 3. Compensation and Taxes Policies

## 3.1 Nature of Compensation

All individuals engaged by ELITE Resource Services are independent contractors compensated under a fixed monthly Compensation arrangement. Compensation is NOT based on hourly or daily wages unless expressly stated in the signed Independent Contractor Agreement. The agreed Monthly Compensation represents full compensation for the role and responsibilities assigned.

## 3.2 Pay Release Schedule and Payroll Cutoffs

Compensations are released on a semi-monthly basis, divided into two equal payroll cutoffs per month, subject to attendance compliance:

- Work rendered from the 1st to the 15th of the month: Compensation is released at the end of the same month.
- Work rendered from the 16th to the last day of the month: Compensation is released on the 15th day of the following month.

This schedule applies to all contractors.

## 3.3 Payroll Basis, 22-Working-Day Structure, and Proration

ELITE uses a 22-working-day monthly structure as the standard basis for compensation calculations. A derived daily rate is calculated as: Monthly Compensation ÷ 22 working days. This derived daily rate is used solely for computing deductions arising from:

- Absences
- Unpaid leave
- Incomplete or unworked required workdays

It is not used to increase compensation beyond the agreed Monthly Compensation. Deductions are applied consistently and proportionately, and final compensation is prorated for any separation or partial cutoff period based on actual days worked.

## 3.4 Treatment of Working Hours

Contractors are not compensated on an hourly basis. Additional hours worked do not entitle contractors to extra pay, and hours are reviewed only to assess compliance with required workdays. Compensation is based on the agreed Monthly Compensation and deliverables as outlined in the signed agreement, except if approved by their clients as overtime, in which case additional computation will be made.

## 3.5 Taxes and Government Contributions

Contractors are solely responsible for filing and paying all applicable taxes, contributions, and statutory obligations. ELITE Resource Services does not provide tax withholding, social security, PhilHealth, Pag-IBIG, or other employee benefits.

## 3.6 Compliance and Consistency

This payroll and compensation policy is applied consistently across all contractors, in accordance with applicable Philippine laws and standards. Compensation shall not fall below statutory minimum requirements where applicable, and all contractors are expected to comply with their tax and statutory obligations.

# 4. Work Standards & Expectations (Code of Conduct)

Contractors engaged with ELITE Resource Services are expected to uphold the highest standards of conduct and performance. The following guidelines outline the professional and ethical expectations required during the course of engagement:

- **Professionalism:** Contractors must conduct themselves with integrity, courtesy, and respect when communicating with clients, colleagues, and company representatives. Disrespectful behavior, harassment, or unprofessional language will not be tolerated.
- **Confidentiality:** All client and company information, including but not limited to trade secrets, processes, documents, and communications, must remain strictly confidential. Unauthorized sharing, use, or distribution of such information is strictly prohibited. Contractors may be required to sign a Non-Disclosure Agreement (NDA).
- **Quality of Work:** Deliverables must meet or exceed the quality standards outlined in the contractor's agreement, scope of work, or project instructions. Repeated failure to meet agreed standards may be grounds for termination.
- **Deadlines & Time Management:** Contractors are expected to manage their schedules effectively and submit all deliverables on or before agreed deadlines. Habitual delays, without valid reasons or notice, are considered a breach of professional responsibility.
- **Conflict of Interest:** Contractors must avoid any activity, engagement, or relationship that may create a conflict of interest with ELITE Resource Services or its clients. Any potential conflict must be disclosed immediately in writing.
- **Use of Company Property:** Contractors are entrusted with access to company property, which may include equipment, systems, accounts, intellectual property, or other resources. These must be used responsibly, solely for authorized business purposes.
- Unauthorized use, tampering, misappropriation, or damage of company property is strictly prohibited.
- Any misuse of property — whether physical, digital, or intellectual — will be treated as a serious offense and may result in immediate termination of the contract.
- Contractors are also prohibited from installing unauthorized software, altering company systems, or using company resources for personal or competing business activities.
- **Compliance with Policies:** Contractors are expected to comply with all company policies, procedures, and applicable laws. Non-compliance may result in disciplinary action, up to and including termination of the contract.

# 5. Work Hours & Availability

- Contractors are expected to work and be fully available during the specific hours agreed upon with the client.
- Adherence to the client's schedule is required, as many tasks involve real-time support and communication.
- Consistent attendance and punctuality are essential. Repeated tardiness, absences, or failure to follow agreed schedules may result in contract termination.
- Contractors must remain accessible through the agreed communication channels (email, chat, or calls) during their assigned work hours.

# 6. Attendance & Call-Out Policy

- Contractors are expected to log in and be ready to work on time for each scheduled shift.
- In the event of an emergency or unavoidable absence, contractors must notify Elite Resource Services and/or the client at least 2 hours prior to the start of their shift.
- Notification should be made through the agreed communication channel (e.g., email, chat, or phone call).
- Failure to notify in a timely manner may result in a warning and, if repeated, termination of the contract.

# 7. Tools & Resources

- Contractors are expected to provide their own tools, equipment, and internet connection necessary for completing their tasks.
- If ELITE Resource Services or its clients provide access to software, email, or systems, these must only be used for work purposes.

# 8. Confidentiality & Data Security

- Contractors must protect sensitive information belonging to ELITE Resource Services and its clients.
- Sharing of client data outside of authorized use is strictly prohibited.
- Breach of confidentiality may result in termination of the contract and possible legal action.

# 9. Communication & Collaboration

- Contractors are expected to maintain regular communication with their project manager or client point of contact.
- Updates on progress, challenges, or delays should be communicated promptly.
- Respectful and professional language is required in all communications.

# 10. Termination of Contract

- Either party may terminate the contract in accordance with the Independent Contractor Agreement, with written notice.
- Reasons for termination may include, but are not limited to: failure to deliver the agreed work; breach of confidentiality or professional standards; misconduct or unprofessional behavior.
- The client may terminate the contract at any time, subject to business needs.
- A minimum of 15 days' written notice is required in the event of contractor resignation.
- **Training License Fees:** The cost of any training license will be shouldered upfront by ELITE Resource Services. However, if the contractor fails to complete at least one (1) year of tenure, whether due to resignation or termination, the all-applicable license fees will be deducted from the contractor's final pay or any remaining compensation. (i.e.: HIPAA, Cyber Security, etc...)
- Final pay will be released after thirty (30) days from the date of termination or resignation.

# 11. Acknowledgment

I, the undersigned, acknowledge that I have received and read the ELITE Resource Services Contractor Handbook. I understand that this is not an employment agreement, but a guide to the professional expectations and standards when working with ELITE Resource Services.`;

const NDA = `This Non-Disclosure Agreement ("Agreement") is entered into on the date of the last electronic signature recorded on the signature page of this document, by and between:

ELITE Resource Services ("Company"), with principal business address at 8 The Green, Suite R, Dover, Delaware 19901,

and

{{contractor_name}} ("Recipient"), with address at {{contractor_address}}.

Together referred to as the "Parties."

# 1. Purpose

The Parties agree that during discussions, evaluations, or potential engagement, the Recipient may have access to confidential and proprietary information belonging to ELITE Resource Services and/or its Clients. This Agreement ensures that such information remains protected.

# 2. Definition of Confidential Information

For the purpose of this Agreement, "Confidential Information" shall include, but is not limited to:

- Client lists, contact details, and project information
- Business operations, strategies, and processes
- Financial data, pricing, and contracts
- Intellectual property, trade secrets, and know-how
- Personal and sensitive information of Clients, employees, or contractors
- Any information disclosed orally, electronically, or in writing that is not publicly available

# 3. Obligations of the Recipient

The Recipient agrees to:

- Maintain the confidentiality of all Confidential Information received.
- Use the Confidential Information solely for the purpose of evaluating or performing work with the Company.
- Not disclose, share, or transfer Confidential Information to any third party without the Company's prior written consent.
- Protect Confidential Information with the same degree of care used to protect their own confidential information, but not less than reasonable care.
- Immediately return or destroy all Confidential Information upon request or if engagement does not proceed.

# 4. Exclusions

Confidential Information shall not include information that:

- Is or becomes publicly available through no fault of the Recipient;
- Is rightfully obtained by the Recipient from a third party without restriction;
- Is independently developed by the Recipient without reference to the Company's Confidential Information.

# 5. Data Privacy Compliance

The Recipient acknowledges that Confidential Information may include personal and sensitive data protected under the Philippines Data Privacy Act of 2012 (RA 10173). The Recipient agrees to process such data only as authorized, and to take all reasonable measures to prevent unauthorized access, disclosure, or misuse.

# 6. Term

This Agreement shall remain in effect for 1 Year from the date of signing, regardless of whether a formal Independent Contractor Agreement is executed.

# 7. Remedies

Any breach of this Agreement may result in irreparable harm to the Company and its Clients.

The Company shall be entitled to seek injunctive relief, damages, and/or termination of any engagement, in addition to any remedies available at law or equity.

# 8. Governing Law & Jurisdiction

This Agreement shall be governed by the laws of the Republic of the Philippines. Any disputes shall be brought exclusively before the proper courts of Manila, Philippines.

IN WITNESS WHEREOF, the Parties hereto have executed this Non-Disclosure Agreement as of the date of the last electronic signature recorded on the signature page of this document.`;

// The Independent Contractor Agreement. HR types the pay terms, duties and schedule when sending ({{monthly_rate}} and the like); the
// rest comes from the person's record. The Contractor Bank Information block is not in the text: the contractor types it in while
// signing, it is kept encrypted, and it is printed under their signature on the signed copy.
const ICA = `This Independent Contractor Agreement ("Agreement") is entered into on the date of the last electronic signature recorded on the signature page of this document, by and between:

ELITE Resource Services ("Company"), and {{contractor_name}} ("Contractor"), with address at {{contractor_address}}.

Together referred to as the "Parties."

# 1. Engagement of Services

The Company hereby engages the Contractor, and the Contractor agrees, to perform the services described in Exhibit A (Scope of Work) attached to this Agreement.

# 2. Independent Contractor Relationship

- The Contractor is engaged as an independent contractor and not as an employee of the Company.
- Nothing in this Agreement shall be construed to create an employer–employee relationship, partnership, or joint venture.
- The Contractor shall not be entitled to employee benefits, including but not limited to paid leave, 13th month pay, overtime pay, or government-mandated contributions.

# 3. Term & Termination

- This Agreement shall begin on {{start_date}} and shall continue until terminated by either party.
- The Company may terminate immediately for cause, including but not limited to: breach of confidentiality, non-performance, repeated tardiness/absences, misconduct, or violation of this Agreement.

# 4. Compensation

- The Contractor shall be paid at the rate of PHP {{monthly_rate}}
- Compensation shall be made on a {{payment_frequency}} basis, upon submission of an invoice or timesheet.
- Payout dates fall on the 15th and the last day of the month. (28th, 30th, 31st)
- No taxes will be withheld by the Company. The Contractor is solely responsible for paying all applicable taxes and government contributions.
- **Compensation Conditions / No Work No Pay**
- The parties acknowledge that although compensation may be expressed as a fixed monthly amount, such compensation is contingent upon the Contractor's availability to perform services and the existence of billable work from the Client.
- As an Independent Contractor, compensation is earned only for services actually rendered. Accordingly, the principle of "No Work, No Pay" shall apply. Compensation is not guaranteed for periods during which no services are performed or no billable work is available.

Deductions or reductions in compensation may apply in circumstances including, but not limited to:

- Unapproved absences;
- Personal leave or time off not covered by an approved paid arrangement;
- Periods of non-performance or unavailability;
- Client-declared holidays, office closures, or shutdowns for which the Client does not provide payment;
- Temporary work suspensions or other non-billable periods; and
- Any other period in which no work is performed and no corresponding client compensation is received.

The stated monthly compensation represents the agreed compensation for services rendered during the applicable period and shall not be construed as a guaranteed payment regardless of attendance, availability, client requirements, workload, or client billing status.

# 5. Work Hours & Attendance

- Contractor is expected to work the agreed client schedule as set forth in Exhibit A.
- Consistent attendance and punctuality are required.
- Contractor must notify the Company and/or Client at least 2 hours prior to the start of shift if unable to report for work.
- Repeated tardiness or unexcused absences may result in termination of this Agreement.

Failure to report for scheduled work hours, unless otherwise approved, may result in compensation adjustments in accordance with Section 4 (Compensation Conditions / No Work, No Pay).

# 6. Confidentiality & Non-Disclosure

- The Contractor acknowledges that during the course of engagement, they may have access to confidential information belonging to the Company or its Clients, including but not limited to: business strategies, client lists, financial data, intellectual property, trade secrets, processes, and personal information ("Confidential Information").
- The Contractor agrees to: maintain strict confidentiality of all Confidential Information; use Confidential Information only for the purposes of fulfilling their contractual duties; and not disclose, share, or transfer Confidential Information to any third party without prior written consent from the Company.
- Confidentiality obligations will survive the termination of this Agreement.
- Any breach of this confidentiality clause may result in immediate termination and possible legal action.

# 7. Data Privacy & Protection

- The Contractor acknowledges that in the course of performing services, they may have access to personal, sensitive, or confidential data belonging to the Company, its clients, or third parties.
- The Contractor agrees to comply with the Philippines Data Privacy Act of 2012 (RA 10173) and all applicable data protection laws.
- The Contractor shall: collect, process, use, and store personal data only as necessary for the fulfillment of their contractual duties; take reasonable measures to safeguard and protect data from unauthorized access, disclosure, alteration, or destruction; and immediately report to the Company any actual or suspected data breach or unauthorized disclosure of personal data.
- The Contractor shall not, under any circumstances, use personal data obtained through this Agreement for personal gain, outside work, or any purpose not authorized by the Company or its Clients.
- Data protection obligations shall survive termination of this Agreement.

# 8. Tools & Equipment

- Contractor shall provide their own tools, equipment, and internet connection necessary to perform the services.
- If the Company or Client provides access to software, platforms, or accounts, such access must only be used for work-related purposes.

# 9. Non-Solicitation

During the term of this Agreement and for twelve (12) months thereafter, the Contractor shall not directly solicit or accept work from any Client of ELITE Resource Services introduced to them through this Agreement, unless otherwise approved in writing by the Company.

# 10. Dispute Resolution

- Any disputes arising under this Agreement shall first be resolved amicably between the Parties.
- If unresolved, disputes shall be submitted to mediation.
- As a last resort, disputes may be settled in the proper courts of {{courts_location}}, Philippines.

# 11. Entire Agreement

This Agreement contains the entire understanding between the Parties and supersedes all prior agreements or understandings, whether written or oral.

IN WITNESS WHEREOF, the Parties hereto have executed this Independent Contractor Agreement as of the date of the last electronic signature recorded on the signature page of this document.

# Exhibit A – Scope of Work

- **Service Title:** {{role_title}}
- **Description of Duties:** {{duties}}
- **Work Schedule:** {{work_schedule}}
- **Reporting Line:** {{reporting_line}}
- **Monthly Compensation:** PHP {{monthly_rate}}`;

export const CONTRACT_TEMPLATES: readonly BuiltinTemplate[] = [
  {
    id: "independent-contractor-agreement",
    name: "Independent Contractor Agreement",
    description: "The contractor agreement. HR types the pay terms, duties and schedule; the contractor adds bank details when signing; the Company countersigns.",
    title: "Independent Contractor Agreement",
    roles: ["Contractor"],
    countersignerRole: "ERS representative",
    signeeDetails: ["bank_name", "account_number", "account_name", "phone_number"],
    body: ICA,
  },
  {
    id: "contractor-handbook",
    name: "Independent Contractor Handbook",
    description: "The contractor handbook with an acknowledgment. Sent to each person for their own signature.",
    title: "Independent Contractor Handbook",
    roles: ["Contractor"],
    body: HANDBOOK,
  },
  {
    id: "nda",
    name: "Non-Disclosure Agreement (NDA)",
    description: "Mutual confidentiality for a contractor or applicant. Fills in their name and address; countersigned by the Company.",
    title: "Non-Disclosure Agreement (NDA)",
    roles: ["Contractor"],
    countersignerRole: "Head of People Operations",
    body: NDA,
  },
];
