# Cybersecurity basics for the ERS team

Course code: `cybersecurity`. Generated for review from the course files; the authoring source is `apps/learn/src/content/cybersecurity`.

## Rules

- Pass mark: 80%. Tries: 3, with a wait of 60 minutes after a failed try. No time limit on the exam.
- Exam length by track: full 15 questions, essentials 15 questions, refresher 15 questions (drawn at random from the bank below).
- Certificate valid for 12 months.
- Modules: 10, about 112 minutes in all. Bank: 158 questions.

## Statement the person accepts after passing

> I have completed ERS's cybersecurity basics training. I understand that I must keep my passwords and sign-in codes private, use only approved devices, software and networks for work, keep my devices updated, and report anything suspicious or any lost device to my team lead and HR right away.

Version label: v1-draft

## Module 1: Why security is everyone's job

_What attackers want, why ordinary people are the target, and the four habits that stop most attacks._

About 9 minutes. Included in tracks: full.

Key points:
- Attackers go after people because it is easier than breaking in by force.
- Four habits stop most attacks: spot phishing, use strong passwords, turn on a second sign-in step, install updates.
- Mistakes are normal. Hiding them is what makes them expensive.
- Insiders are a risk too, mostly by accident. Report anything that looks wrong.
- Healthcare organizations are targeted because patient information and disrupted care are valuable to attackers.

### 1.1 What attackers want

Attackers are rarely after you personally. They want what your accounts can reach: money, customer and patient information, access to a company's systems, or simply a way to lock files and demand payment.

- **Money**: payment fraud, fake invoices, ransomware.
- **Information**: records, logins and personal details that can be sold or used for fraud.
- **Access**: your account as a stepping stone to a client or a bigger target.
- **Disruption**: locking or destroying systems so people cannot work.

> **INFO**  
> Size does not protect anyone. Small teams and remote workers are targeted because they are easier to reach.

### 1.2 Why people are the target

It is usually easier to trick a person than to break into a system. Most successful attacks start with a message, a call or a link that someone acted on without a second thought.

Attackers rely on a few feelings: urgency, fear, curiosity, and the wish to be helpful. A well-made message uses them on purpose.

**Check yourself:** Why do attackers so often start with a person rather than a system?

- (correct) Tricking a person is usually easier than breaking in by force  
  _Right. People are the easiest way in._
- Systems have no passwords  
  _Most systems do, which is why attackers want yours._
- People never check what they click  
  _Many do check. A convincing message only needs one person who does not._

### 1.3 Four habits that stop most attacks

National cybersecurity agencies boil advice down to four things everyone can do. This course teaches each one:

1. **Recognize and report phishing**: Learn the warning signs before you click or share anything.
2. **Use strong passwords**: Long, unique, and kept in a password manager.
3. **Turn on a second sign-in step**: Multi-factor authentication, wherever it is offered.
4. **Update your software**: Updates close holes attackers already know about.

### 1.4 How organizations think about it

Security is not one tool. Organizations follow a simple cycle, and every person plays a part in each step:

- **Identify**: know what you have and what matters most.
- **Protect**: passwords, updates, training, locked doors.
- **Detect**: notice when something looks wrong.
- **Respond**: act quickly and tell the right people.
- **Recover**: restore from backups and learn from it.

> **TIP**  
> You are most of "protect" and nearly all of "detect": you are the one who sees the odd message, the strange prompt, the file that behaves badly.

### 1.5 Mistakes and insiders

An **insider threat** is a risk that comes from inside an organization: someone with legitimate access. Almost all of it is accidental: a wrong recipient, a lost laptop, a shared password, a click on the wrong link.

A small number are deliberate: someone copying information they should not, or misusing access. Warning signs include accessing things without a work reason, copying large amounts of information, and trying to get around controls.

> **WARNING**  
> If you see something that looks wrong, report it to your lead. You do not have to be sure. Reporting is not accusing.

### 1.6 Why healthcare is a target

Attackers know that a clinic cannot simply close for a week. Patients need appointments, prescriptions and records, so pressure to pay or to act quickly is high. Patient files also hold names, dates of birth, insurance numbers and addresses, which are useful for fraud and last a long time.

**What makes healthcare attractive**
- **Urgency**: Care cannot wait, so downtime is costly and people feel pressure.
- **Rich records**: One file can hold identity, insurance and medical details.
- **Many connections**: Clinics, labs, billers and vendors all exchange information.
- **Busy people**: Staff handle many messages and calls, and click fast.

### 1.7 Worked case: a small slip, a large week

**Case: How one message disrupted a clinic**

A scheduler at a small clinic received an email that looked like a notice from the billing software. She entered her login on the page it linked to. Two days later the clinic's computers showed a message demanding payment, appointment screens were blank, and staff had to call patients to reschedule.

_Question:_ Where could the chain have been broken, and by whom?

_Answer:_ At several points. The scheduler could have noticed that the link did not go to the real site, or that a login was being requested out of the blue. A second sign-in step would have stopped the stolen password from being enough. A report within minutes of clicking would have let the clinic change the password and watch for damage. Most of those steps are simple habits, which is why this course is about everyone, not only about IT.

### 1.8 Speed matters, blame does not

Everyone makes mistakes. What decides the damage is how fast it is reported. A password changed within the hour is a small event. The same password left for a week can be a disaster.

**Scenario: You think you made a mistake**

You clicked a link in a message and then realized it looked wrong. Nothing seems to have happened.

- Say nothing. If nothing happened there is nothing to report.  
  _Attacks are often silent at first. A report now costs minutes; silence can cost much more._
- (best) Tell your lead straight away, say exactly what you did, and follow their instructions.  
  _Correct. Fast and honest is always right._
- Delete the message so nobody sees it.  
  _Deleting it removes evidence that helps the response._

## Module 2: Passwords and signing in safely

_Strong passphrases, password managers, the second sign-in step, and what to do when a prompt or a code is not yours._

About 12 minutes. Included in tracks: full.

Key points:
- A long passphrase beats a short complicated password.
- Use a different password for every account, and a password manager to keep them.
- Turn on a second sign-in step wherever it is offered. An app or a security key is stronger than a text message.
- Never share a password or a code. No real support person asks for either.
- If a prompt or code is not yours, deny it and report it.
- A sign-in approval you did not start means someone has your password: do not approve it, and report it.

### 2.1 How passwords get stolen

Attackers rarely guess one password by hand. They use lists of leaked passwords from other sites, programs that try thousands of guesses, and fake login pages that capture what you type.

- **Reuse**: the password leaked from one site is tried on every other site.
- **Guessing**: short or predictable passwords fall to automatic guessing.
- **Phishing**: a fake page asks you to type it yourself.
- **Sharing**: a person gives it away, often to someone pretending to help.

### 2.2 Length beats complexity

A **passphrase** of several unrelated words is longer, stronger and easier to remember than a short password full of symbols. The longer, the better.

**Strong**
- Four or more unrelated words, joined together
- Different for every account
- Not about you: no names, dates or pets
- Changed when you think it leaked

**Weak**
- A name, a birthday or a favorite team
- A common word with a number on the end
- The same password on many sites
- Something written on a sticky note

### 2.3 Password managers

No one can remember dozens of long, unique passwords. A **password manager** remembers them for you, fills them in only on the real website, and creates new random ones.

- It needs one strong passphrase of your own, and a second sign-in step on it.
- It will not fill in a password on a fake site, which is a useful warning in itself.
- Use the one your client or ERS provides. If none is provided, ask your lead before using another.

> **TIP**  
> Do not keep passwords in a notes file, a spreadsheet, a chat or an email. Those are the first places an attacker looks.

### 2.4 The second step

**Multi-factor authentication (MFA)** asks for something besides the password: a code from an app, a prompt on your phone, a security key, or a fingerprint. If someone steals your password, they still cannot sign in.

1. **Security key or passkey**: The strongest: cannot be typed into a fake page.
2. **Authenticator app**: A code that changes every half minute.
3. **Text message or call**: Better than nothing, but easier to attack.

> **INFO**  
> Any second step is far better than none. Turn it on for work accounts, email and anything with money or personal details.

### 2.5 Prompts and codes you did not ask for

If someone has your password, they will try to sign in. You then get a sign-in prompt or a code you did not request. Attackers may send many in a row, hoping you approve one to make them stop. This is sometimes called **MFA fatigue**.

**Check yourself:** You get a sign-in approval request while you are not signing in. What do you do?

- (correct) Deny it and report it to your lead  
  _Right. An unexpected prompt means someone may have your password._
- Approve it to make it stop  
  _That would let the attacker in._
- Ignore it  
  _It should be reported so the account can be protected._

> **WARNING**  
> Never read a code to anyone who contacts you, even someone who says they are from IT or from the bank.

### 2.6 If a password may have leaked

If you think a password has been exposed, or you entered it on a page you now doubt:

1. **Change it**: Through the official site or app, not through a link in a message.
2. **Change it anywhere you reused it**: Reuse is how one leak becomes many.
3. **Tell your lead**: So they can check for anything unusual and protect the rest.

### 2.7 Worked case: the approval that would not stop

**Case: Twelve prompts in ten minutes**

A VA's phone keeps showing "Approve sign-in?" notifications. She did not start any of them. After the twelfth one, she gets a text: "This is the IT desk. Approve the next request so we can stop the alerts and secure your account." She is tired and wants the buzzing to stop.

_Question:_ What should she do, and what does this tell her?

_Answer:_ She should deny the requests, not reply, and report it to her lead right away. Someone already has her password and is trying to wear her down so that she approves one. A real IT desk would never ask her to approve a request she did not start. She should also change her password through the official route.

### 2.8 Passkeys and security keys

Some services offer **passkeys** or physical **security keys**. They replace or strengthen the password with a cryptographic proof that stays on your device or key. They are hard to phish because there is no password to type into a fake page.

**Stronger**
- A passkey or security key
- An authenticator app code
- Number-matching prompts

**Weaker**
- A text message code
- A simple "approve" tap
- No second step at all

> **TIP**  
> Use the strongest option your client or ERS offers, and set up a second method in case you lose your device.

### 2.9 Shared accounts, and why they are refused

Sometimes a team shares one login "to keep it simple". It breaks the most basic control: nobody can tell who did what. If something goes wrong, nobody can be sure who was responsible, and nobody can close one person's access when they leave.

- Each person gets their own account, even for a shared mailbox or tool.
- If a tool has only one login, ask your lead how access should be set up.
- Never accept a password in a chat, a note or a spreadsheet.
- Never hand a code to a teammate who asks for it.

### 2.10 Try it: the helpful caller

**Scenario: A call from "IT"**

Someone calls and says he is from IT. "Your account was flagged. I will send a code to your phone: read it back to me so I can fix it."

- Read the code. He knows your name and account.  
  _Knowing a name proves nothing. The code lets him into your account._
- (best) Hang up, do not share anything, and report the call to your lead.  
  _Correct. No real IT person asks you to read a code or a password._
- Ask him to prove it by reading your last login time.  
  _He may well know it. Do not try to test him: hang up._

## Module 3: Phishing and social engineering

_How attackers trick people, the signs to look for, and what to do when something feels off._

About 17 minutes. Included in tracks: full.

Key points:
- Attackers target people, not only computers.
- Urgency, fear and authority are the usual tricks.
- Check the sender and the link before you act. Use a known channel to verify.
- Never give a password or MFA code to anyone who contacts you.
- If you clicked or answered, report it immediately. Speed limits the damage.
- Requests to move money or change payment details are checked by phone on a number you already know.
- Unexpected calls from "tech support" are scams. Hang up and never give remote access.
- Healthcare lures often pose as a payer, a patient, a clinic or a supplier, so verify through a route you already know.

### 3.1 Attackers go after people

It is often easier to trick a person than to break into a system. **Social engineering** is manipulating someone into giving access or information. It works because it feels natural and urgent.

> **INFO**  
> Healthcare is a favorite target because patient information is valuable and clinics are busy. Your care is part of the defense.

### 3.2 The usual forms

- **Phishing**: an email that pretends to be someone you trust.
- **Spear phishing**: the same, but written for you, using real names and details.
- **Smishing**: the same by text message.
- **Vishing**: the same by phone call or voicemail.
- **Pretexting**: a made-up story, such as "I am from IT and need your password".
- **MFA fatigue**: sending many sign-in prompts hoping you approve one.

### 3.3 Signs to look for

Pause when a message does any of these:

- Creates urgency or fear: "your account closes in 15 minutes".
- Asks for a password, code or payment.
- Comes from an address that is slightly off, such as a number in place of a letter.
- Has a link whose real address does not match the text.
- Has an unexpected attachment, or a tone that is not like the sender.

### 3.4 Spot the phish

Read this invented message:

> **WARNING: From: support@ehr-security-check.example**  
> URGENT. Your account expires in 15 minutes. Verify now at ehr-security-check.example and enter your password and the code we just sent to your phone.

**Check yourself:** What are the warning signs? Select all that apply. (select all that apply)

- (correct) A short deadline that creates panic  
  _Urgency is a classic trick to stop you from thinking._
- (correct) A request for a password and an MFA code  
  _No real service asks for both in an email._
- (correct) A sender and link that are not your client's official domain  
  _Unknown domains are a strong warning sign._
- It was sent during working hours  
  _The time of day is not the problem._

### 3.5 What to do with a suspicious message

1. **Stop**: Do not click, open attachments, reply or call numbers in the message.
2. **Check**: Look at the sender address and hover over links without clicking.
3. **Verify**: Contact the sender through a number or address you already know.
4. **Report**: Tell your lead and use your client's way to report phishing.

### 3.6 Calls and texts

A caller who says they are from IT, the client, a bank or a government office has to prove it. A real organization will not be upset if you hang up and call back on a number you already have.

> **TIP**  
> Never give a password, MFA code, or patient information to someone who contacted you first.

### 3.7 Fake bosses, fake invoices and fake tech support

Some of the most costly scams are not technical at all. They are well-written requests that look like normal business:

- **Business email imposters**: a message from a "manager" or "supplier" asking you to pay, change bank details or buy gift cards.
- **Tech support scams**: a call or pop-up about a problem with your computer, asking for remote access or payment.
- **Delivery and account tricks**: a "missed delivery" or "account locked" message with a link.

> **WARNING: The rule**  
> Never act on a request to move money, change payment details or give access without confirming it by phone, on a number you already know to be right, not the one in the message.

### 3.8 Newer tricks: QR codes, texts and cloned voices

Attackers use whatever people have started to trust:

- **QR codes** on a poster, parking meter or in an email can lead to a fake page. Treat a QR code like a link.
- **Text messages** pretending to be a delivery, a bank or your manager, with a link.
- **Cloned voices and fake video** made by software can sound like someone you know. A voice is not proof.
- **Fake job or support chat** that moves you to a messaging app and asks for details.

> **TIP**  
> If a call or message from someone you know asks for money, codes or secrets in a hurry, hang up and call them back on their usual number.

### 3.9 If you clicked

Anyone can click. What matters is what you do next. Act fast and be honest:

1. **Disconnect if told to**: Follow your client's instructions. If unsure, disconnect from the network.
2. **Report right away**: Tell your lead and HR. Say exactly what you did.
3. **Change the password only through the official path**: Not through any link in the message.
4. **Keep the message**: Do not delete it. It helps the response.

> **INFO**  
> Reporting quickly and honestly is protected. Hiding it is what makes things worse.

### 3.10 Lures that fit healthcare work

Attackers tailor messages to the work you do. In healthcare they often pose as the people you expect to hear from:

**Common healthcare lures**

| The message says it is from | What it asks | What to do |
| --- | --- | --- |
| A payer or insurer | Log in to see a held or denied claim | Go to the payer's site yourself, never through the link |
| A patient | Open an attached form or record request | Do not open it; route it as the client instructs |
| A clinic's manager | Urgent change to bank details or a payment | Call back on a number you already have |
| A supplier or vendor | An invoice or a shared document link | Check with the vendor through a known contact |
| IT or the EHR vendor | Reset your password or install a tool | Report it, and use the official support route |

### 3.11 Worked case: the held claim

**Case: A payer portal that is not the payer**

You manage claims for a clinic. An email arrives: "Action required: 14 claims on hold. Sign in to the Provider Portal to release payment today." The logo looks right and the sender's name matches an insurer you work with. The button leads to a login page.

_Question:_ How do you check it, and what do you do if you already entered your password?

_Answer:_ Do not use the button. Open the insurer's portal by typing its address or using the bookmark you already have, and look for the same notice there. If it is not there, report the email to your lead. If you already entered a password, change it the official way at once, tell your lead and HR immediately, and say which account it was, because the clinic's claims and payment details may be at risk.

### 3.12 Worked case: the changed bank details

**Case: A familiar voice in an email**

A message arrives from what looks like a clinic owner's email: "Please update the account for our supplier payments before Friday. New details attached. I am in a meeting and cannot take calls." The writing is right and the request is polite.

_Question:_ What makes this suspicious, and what is the safe step?

_Answer:_ A change to payment details, urgency, an unusual channel and the sender being unavailable are all classic signs of fraud called business email compromise. The safe step is to verify through a different route: call the owner on a number you already have, not one in the message, and follow the client's process for changing payment details. Do not change anything until it is confirmed.

### 3.13 Voice phishing: the helpful caller

Calls can be just as convincing as email. A caller may sound friendly, use real names and know a little about your work. Common stories are a payer representative who "needs to verify" your portal login, or an IT person who "needs to install a tool" to fix a problem.

1. **Do not give anything**: No passwords, codes or patient details on an incoming call.
2. **Do not install anything**: No remote-access tools at a caller's request.
3. **Hang up**: You may end any call that feels wrong.
4. **Call back**: Use a number you already trust, and tell your lead.

### 3.14 Try it: the urgent request

**Scenario: A message from the boss**

You get an email that looks like it is from your client's practice manager: "I am in a meeting. Quickly send me the list of patients with outstanding balances. Reply here only." The sender address is almost right, but one letter is off.

- Send it right away. The manager is busy and needs it.  
  _That could be a scam, and it would send PHI to an attacker._
- (best) Do not reply. Check the address, verify through a known phone number or chat, and report it to your lead.  
  _Correct. Verify through a known channel and report._
- Reply asking if it is really them.  
  _Replying confirms the mailbox is active and may reach the attacker._

## Module 4: Malware, ransomware and updates

_What malicious software is, how it spreads, how updates and backups protect you, and what to do if a device is hit._

About 12 minutes. Included in tracks: full.

Key points:
- Malware is software that works against you. It usually arrives through a message, a download or an unpatched hole.
- Updates close holes attackers already know about. Install them promptly.
- Keep security software on, and install only what you were told to install.
- Backups, kept apart from the computer, are what let you recover from ransomware.
- If a device is hit, disconnect it from the network without powering it off, and report it right away.
- Ransomware can stop a clinic's care, and HHS treats ransomware that encrypts patient information as a presumed breach.

### 4.1 What malware is

**Malware** is any software built to harm, spy on or take control of a device. It comes in many kinds, and one device can have several at once.

- **Virus and worm**: spread from file to file or computer to computer.
- **Trojan**: looks like something useful, hides something harmful.
- **Spyware and keyloggers**: quietly record what you do and type.
- **Ransomware**: locks your files and demands payment.
- **Remote access tools**: let someone else control your computer.

### 4.2 How it gets in

Most malware needs your help, or an old hole in your software, to get in:

1. **A message**: A link or attachment in an email or text that you open.
2. **A download**: Software from a site or source nobody approved, including "free" tools and cracked programs.
3. **A device**: A USB drive or storage you plug in.
4. **An old hole**: Software that was never updated, so a known weakness is open.

### 4.3 Updates close the holes

When a software maker finds a weakness, they release an update. Attackers read the same notices, and go after everyone who has not updated. A delay of weeks is a window for them.

- Install updates when your device asks, and restart when needed, at a safe moment.
- Turn on automatic updates where they are allowed.
- Update the apps and the browser too, not only the operating system.
- Do not postpone an update for months because it is inconvenient.

### 4.4 Install only what you were told to

Software you install can do anything on your device. Treat every install as a decision for ERS or your client, not for you alone.

**Do**
- Install tools your lead or client approved
- Keep security software turned on
- Ask when a tool would help your work

**Do not**
- Install a "free" tool or extension because a site says to
- Turn off security software to make something faster
- Plug in a USB drive you found or were given

> **WARNING**  
> A pop-up that says your computer is infected and tells you to call a number or install a cleaner is itself the attack.

### 4.5 Ransomware

Ransomware encrypts your files and shows a demand. Most start with a phishing message or a download. Paying does not guarantee the files come back, and marks the organization as a payer.

1. **Disconnect**: Take the device off the network and off Wi-Fi, but do not shut it down: it may hold useful evidence in memory.
2. **Report at once**: Tell your lead and follow the client's instructions. Do not try to fix it yourself.
3. **Do not pay or reply**: Leave any demand to the people responsible.
4. **Recover from backup**: Your organization restores from copies that were kept apart.

### 4.6 A ransomware attack, hour by hour

Ransomware rarely strikes at the moment someone clicks. There is often a quiet period first, which is why a fast report matters:

**How an attack can unfold**
1. **Day 0**: A message is opened, a file runs, and the attacker gets a foothold.
2. **Hours to days**: They look around, find backups and valuable files, and may copy information out.
3. **A quiet hour, often at night**: They lock files and leave a note demanding payment.
4. **Next morning**: Staff cannot open records, schedules are lost, and the clinic reverts to paper.
5. **After**: Recovery from clean backups, assessment of what was taken, and notifications.

### 4.7 What it does to patients and to the law

When a clinic cannot reach its records, care suffers: appointments are cancelled, results are delayed and staff work without history. Information that was copied can also be used for fraud.

HHS has said that when patient information is encrypted by ransomware, a breach is presumed unless the organization can show a low probability of compromise. That means a quick report from the first person who notices matters to the legal clock as well as to care.

> **INFO**  
> You do not decide whether it is a breach. You make sure the people who decide hear about it within minutes.

### 4.8 Worked case: the invoice attachment

**Case: A file that asked to enable macros**

You receive a message with an attachment named like a supplier invoice. When you open it, it says: "This document is protected. Click Enable Content to view." You click it and nothing seems to happen.

_Question:_ What should you do now, even though nothing visible happened?

_Answer:_ Disconnect from the network if you can do so quickly, such as turning off Wi-Fi, and do not restart or delete anything. Report to your lead and HR immediately, and say what you opened and when. "Nothing happened" is not a good sign: malware often works quietly, and the minutes after opening are the most valuable for stopping it.

### 4.9 Backups are the safety net

A **backup** is a copy of your information kept somewhere that an attack on the computer cannot reach. It is what turns ransomware, a crash or a stolen laptop into an inconvenience instead of a disaster.

- Backups should be regular, and separate from the computer (not only a folder on it).
- Work in the approved systems, which are backed up for you, not only on your own device.
- Do not delete or switch off backups, and report when one fails.

**Scenario: Files you cannot open**

You come to work and your files will not open. There is a message on the screen asking for payment to get them back.

- Pay quickly so work is not delayed.  
  _Paying is not a fix and is not your decision. Disconnect and report._
- (best) Disconnect the device from the network without shutting it down, and tell your lead straight away.  
  _Correct. Contain it and report it._
- Restart the computer and hope it goes away.  
  _Restarting can destroy useful evidence, and the problem is still there._

## Module 5: Safe browsing, email and online privacy

_Links, downloads, extensions, social media and AI tools: how to use the internet at work without handing attackers a way in._

About 11 minutes. Included in tracks: full.

Key points:
- Check where a link really goes before you click. A padlock means the connection is private, not that the site is honest.
- Download only from approved sources, and be wary of free tools, extensions and add-ins.
- Keep work and personal accounts apart, and keep work details off social media.
- Do not paste work, client or personal information into public AI tools.
- What you post online can be used to trick you or your colleagues.
- Email, text and fax are common routes for patient information, so use only the channels your client approved.

### 5.1 Look before you click

Many attacks come down to one click on a link that is not what it seems. A few seconds of checking is cheap.

- Hover over a link, or press and hold on a phone, to see the real address.
- Check the spelling of the domain: attackers register names that are one letter off.
- Be careful with shortened links and links in unexpected messages.
- If in doubt, go to the site yourself by typing the address, not by following the link.

> **TIP**  
> The part of the address just before the first single slash is what matters. In "login.mysite.example" the owner is "mysite.example"; "login" is only a label put on the front.

### 5.2 What the padlock does and does not mean

A padlock or "https" means the connection between you and the site is encrypted, so others cannot read it on the way. It does not mean the site is honest. Criminals use https too.

**Check yourself:** A website shows a padlock. What does that tell you?

- (correct) The connection is private; it does not prove the site is genuine  
  _Right. Check the address and whether you expected the site._
- The site is safe and genuine  
  _Fake sites can have a padlock too._
- The site cannot contain malware  
  _A padlock says nothing about what the site contains._

### 5.3 Downloads, extensions and add-ins

A browser extension or an add-in can read what you do and see what is on your screen. A fake one is a common way to capture logins and information.

- Install extensions and add-ins only when ERS or your client approved them.
- Download files only from the official source, and open them only when you expected them.
- Be suspicious of "free" versions of paid software, and of files that ask you to enable macros.
- Remove extensions you no longer use.

### 5.4 Social media and oversharing

Attackers read public profiles to build convincing messages. A post about a client, a role, an upcoming trip or a new system gives them material.

- Keep client names, systems, work details and screenshots of work off social media.
- Do not accept contact from people you do not know, especially if they ask about your work.
- Check your privacy settings, and assume anything public can be copied.
- A job offer, a survey or a quiz that asks for work details is a common trick.

### 5.5 AI tools and online converters

Public AI chatbots, translators and online converters are useful, and they receive whatever you paste into them. Treat anything you type into a public tool as shared with a stranger.

**Fine**
- General questions with no work or personal details
- Tools your organization has approved for work

**Not fine**
- Pasting client, patient or personal information
- Uploading a work document to an online converter
- Entering passwords or codes

### 5.6 Email, text, fax and voicemail

Patient information often travels by the simplest route available. The channel you choose decides who can read it on the way. Follow the client's rules for each:

**Common channels and the usual rule**

| Channel | Main risk | Habit |
| --- | --- | --- |
| Email | Wrong recipient, forwarding, copies in many inboxes | Approved system, check the address, minimum only |
| Text message | Stored on phones, no control over who reads | Only if the client allows it, and with no details |
| Fax | Wrong number, paper left in the tray | Confirm the number, use a cover sheet, check receipt |
| Voicemail | Heard by others, no way to retract | Callback number only, per the client's script |
| Shared inbox or folder | Many people see everything | Only the access your job needs |

### 5.7 Worked case: the unprotected attachment

**Case: A spreadsheet in a personal inbox**

A billing contact at a client emails you a spreadsheet of patient balances and asks you to "send back the updated version when done". You notice it came from her personal email address, not the clinic's.

_Question:_ What is the concern, and how do you handle the reply?

_Answer:_ Patient information is now in a personal mailbox that the clinic does not control, and replying would put it there again. Do not reply with the file. Tell your lead and ask the client for the approved way to return it, such as the portal or the clinic's own system. The contact may also need to be told that the channel is not approved, in the way the client prefers.

### 5.8 Try it: the friendly quiz

**Scenario: A fun post**

A post on social media invites you to share your first job, the name of your first pet and the street you grew up on "for a fun personality quiz".

- Join in. It is only a bit of fun.  
  _Those answers are the same as many security questions. They help attackers reset accounts._
- (best) Skip it, and avoid sharing details that double as security answers.  
  _Correct. Quizzes like this harvest answers to account recovery questions._

## Module 6: AI tools and your data

_Why pasting work into an AI tool is a disclosure, what counts as an AI tool, how to check what comes back, and what to do instead._

About 10 minutes. Included in tracks: full.

Key points:
- Anything you type or upload into an AI tool leaves your control and goes to the company that runs it.
- Client and patient information never goes into a tool that ERS and the client have not approved.
- Removing a name is not enough: details and context can still identify a person.
- AI tools are built into many apps and browsers, so check before you use any assistant on work.
- Treat AI output as a draft that may be wrong, and check it before it goes anywhere.
- When in doubt, ask your lead for the approved way.

### 6.1 What happens to what you type

An AI tool is a service run by a company. When you paste text, upload a file or record audio, the information travels to that company's systems. Depending on the service, it may be stored, reviewed by people, used to improve the product, or exposed if the company is breached.

You cannot take it back. That is why the rule is about what goes in, not about how good the answer is.

> **WARNING**  
> Sending client or patient information to a tool nobody approved is a disclosure to an outside company, even if it takes two seconds and the answer is helpful.

### 6.2 What counts as an AI tool

Many tools use AI without saying so. Treat all of these as AI tools:

- Chatbots and writing assistants, in a browser or inside another app
- Transcription, note-taking and meeting-summary services
- Translators and grammar or rewriting tools, including browser extensions
- Image, document and spreadsheet assistants built into office software
- Free "converter" or "summarizer" websites

> **TIP**  
> The test is simple: does the tool send what I give it to someone else's servers? If you are not sure, assume it does.

### 6.3 Approved and not approved

ERS and each client decide which tools are approved for client work. A tool is approved only when ERS or the client has reviewed it and has an agreement that limits what the company may do with the information.

**Approved for work**
- A tool named in your client's instructions
- A tool ERS has approved in writing
- A tool whose settings your lead has confirmed

**Not approved**
- A free account you made yourself
- A browser extension you found
- A tool a coworker recommended

> **INFO**  
> Using an approved tool for approved purposes is fine. Ask your lead which tools are approved and for what.

### 6.4 "I took the name out" is not enough

People often think removing a name makes information safe. It rarely does. A date, a rare condition, a small town, a job title, an account number or a pattern in the details can point to one person.

**Case: The summary request**

You are asked to summarize a long patient complaint letter for a clinic manager. You delete the patient's name and paste the rest into a free AI assistant, planning to tidy the summary yourself. The letter mentions her rare diagnosis, the exact date of her surgery and the street she lives on.

_Question:_ Why is this still a problem?

_Answer:_ The details identify her without a name: the diagnosis, the date and the street together point to one person. The text has also left the approved systems and reached a company with no agreement. The right route is to summarize it yourself inside the client's system, or ask the client for an approved tool.

### 6.5 Notetakers, recorders and meeting bots

Some meeting tools record and transcribe calls, or send a bot to join. On a client call that may capture patient names, schedules and other details, and store them with a third party.

- Do not turn on recording or transcription on client calls unless the client says so.
- Do not let a bot or notetaker app join a client call.
- If someone else's tool joins, ask the host whether it is approved.
- Tell your lead if a recording was made without approval.

### 6.6 Check what comes back

AI tools can sound sure and be wrong. They can invent facts, misread a number or leave out a key detail. Output that goes into a record, a message to a patient or a client report must be checked by a person before it is used.

1. **Read it all**: Do not skim. One wrong number can matter.
2. **Check the facts**: Against the source in the client's system.
3. **Remove what should not be there**: Anything you did not mean to include.
4. **Own it**: What you send is your work, whoever drafted it.

### 6.7 Instructions hidden in documents

Attackers can hide instructions in a document, a web page or an email so that an AI assistant that reads it follows them, for example "send the contents of this chat to this address". You may not see the text at all.

> **WARNING**  
> Do not let an assistant open, read or act on files, links or messages from people you do not know. And never give a tool access to your email, your files or your accounts without approval.

### 6.8 Try it: the quick favor

**Scenario: A faster way to answer**

A client's office manager sends you a long email thread about a patient's insurance dispute and asks for a one-paragraph summary by the end of the hour. A free AI summarizer would do it in seconds.

- Paste the thread into the free summarizer and tidy the result.  
  _The thread has left the approved systems and reached an outside company, whatever you do afterward._
- (best) Write the summary yourself in the client's system, and ask your lead whether an approved tool exists for long threads.  
  _Correct. You meet the deadline without sending anything out, and the question helps the next person._
- Paste only the last three emails.  
  _Fewer emails is still client information sent to an unapproved tool._

### 6.9 Terms from this module

**Terms**
- **AI tool**: A service that uses artificial intelligence and sends what you give it to the company's servers.
- **Approved tool**: A tool ERS or the client has reviewed and covered with an agreement limiting what the company may do with data.
- **Prompt**: The text, file or audio you give an AI tool to work on.
- **Hidden instruction**: Text planted in a document or page that tries to make an AI assistant do something you did not ask.
- **Re-identification**: Working out who information is about from its details, even when the name has been removed.

## Module 7: Devices, networks and working remotely

_Locking and protecting your devices, securing your home network, using public Wi-Fi and video calls safely, and what to do when a device goes missing._

About 14 minutes. Included in tracks: full.

Key points:
- Lock your screen, use a screen lock code, and encrypt your devices.
- Change your router's default password and use WPA2 or WPA3.
- Do not do work on public Wi-Fi unless your client gives you a secure connection for it.
- Use only approved devices for work, and keep them to yourself.
- A lost or stolen device is an emergency: tell your lead immediately.
- A work setup has a place, a device, a network and a sign-in, and each needs to be safe, even at home.

### 7.1 Lock it and encrypt it

A device you carry can be lost; a device at home can be borrowed. Two protections turn a lost device from a disaster into an inconvenience:

- **A screen lock** with a strong code or passphrase, and a short automatic lock time. Lock it yourself whenever you step away.
- **Encryption** of the device's storage, so its contents are unreadable without the code. Most computers and phones can turn this on.
- A strong code, not 1234 or a birth year.
- Remote lock and wipe turned on, if your client provides it.

> **TIP**  
> On Windows press the Windows key and L to lock. On a Mac press Control, Command and Q.

### 7.2 Your home network

Your router is the front door to everything you do from home. Make it hard to open:

- Change the router's default admin password.
- Use WPA2 or WPA3 security and a strong Wi-Fi password.
- Keep the router's own software updated.
- Use a separate guest network for visitors and smart devices, if the router offers one.

> **INFO**  
> A router with the factory password and an old setting is one of the easiest ways into a home network.

### 7.3 Public places and public Wi-Fi

Public Wi-Fi can be watched or imitated, and a public room puts your screen in view of strangers.

1. **Do not rely on it for work**: Unless your client gives you a secure connection for it and you are in a private place.
2. **Prefer your own connection**: A phone hotspot you control is better than an open network.
3. **Ask when stuck**: If your internet is down, tell your lead rather than improvising.

**Scenario: Internet down at home**

Your home internet is down and you have client work to finish. A cafe nearby has free Wi-Fi.

- Go to the cafe and work there.  
  _A public network and a public room are both risks for client work._
- (best) Tell your lead and use only an option your client allows, in a private space.  
  _Correct. Ask first; a late task can be explained._

### 7.4 VPNs and secure remote access

A **VPN** creates a private tunnel between your device and your organization. It protects the traffic on a network you do not control. It is not a cure for everything: a VPN does not stop you from clicking a bad link.

- Use the VPN or remote access your client or ERS provides, and use it as instructed.
- Do not use free consumer VPN apps for work unless they were approved.
- Sign out of remote sessions when you finish.
- Remote access to sensitive areas should need a second sign-in step.

### 7.5 Video calls and screen sharing

Calls are a place where information leaks quietly: a shared screen with the wrong window open, a call link shared too widely, a recording nobody planned.

- Share one window, not your whole screen, and close anything private first.
- Join with the link or code you were sent and check who is in the call.
- Do not post call links or codes in public places.
- Do not record unless you were told you may.
- Check what is behind you and who can overhear.

### 7.6 Work devices and personal devices

Mixing work and personal use is how risks cross over. Your children's games, a family member's browsing and an unknown app can all end up on the same device as client work.

**Do**
- Use work devices for work and only you
- Use only approved devices for client work
- Keep personal and work accounts separate
- Keep software and security tools current

**Do not**
- Let family or friends use a work device
- Use a shared family computer for client work
- Sign in to personal accounts on a work device
- Connect unknown USB drives

### 7.7 Your remote setup, step by step

Working from home means you are the one responsible for the room, the device and the network. A simple routine keeps all four in order:

1. **Place**: A space where screens and calls are not seen or heard by others.
2. **Device**: An approved, updated, locked and encrypted device that you alone use for work.
3. **Network**: A home network with a strong password and updated router, or an approved secure connection.
4. **Sign-in**: Your own login, with the second step on, signed out when you finish.

### 7.8 Worked case: the shared family computer

**Case: My laptop is broken, but the family laptop works**

Your work laptop stops starting an hour before a client deadline. Your sister's laptop is on the kitchen table and works. She says you can use it, and the client's system is only a login away.

_Question:_ What should you do, and why not use the family laptop?

_Answer:_ Tell your lead at once and ask for an approved fix: a spare device, an extension, or someone to take over the work. A family computer has other people's accounts and apps, is not managed or encrypted for work, and may keep copies of what you open. A login is not the only exposure: browser history, downloads, and cached files remain behind.

### 7.9 Your own phone and the work

Many people use their own phone for sign-in codes or work chat. That can be fine, if ERS or the client approves it, and the phone is itself protected.

- Use a screen lock, and keep the phone updated.
- Use only approved apps for client communication.
- Do not take screenshots or photos of client information.
- Report a lost or replaced phone immediately, because it may hold sign-in codes.

### 7.10 A device goes missing

If a device you use for work is lost or stolen, or someone else has used it, treat it as an emergency. Seconds count: a lock or a remote wipe is only possible while the device can still be reached.

1. **Tell your lead immediately**: Say what it is, when and where you last had it.
2. **Follow the instructions**: Remote lock, wipe and password changes are done by the right people.
3. **Change what it could reach**: Passwords for accounts that were signed in on it.

> **WARNING**  
> Do not wait to see if it turns up. A day of delay is a day of exposure.

## Module 8: Handling information and physical security

_Knowing what is sensitive, sharing only what is needed, protecting paper and screens, and the in-person tricks attackers use._

About 9 minutes. Included in tracks: full.

Key points:
- Know what you are handling, and treat client and personal information as sensitive by default.
- Share with the people who need it, through the approved way, and no more.
- Paper, screens and conversations leak too. Keep them out of sight and earshot.
- Do not hold a door for someone you do not know, and do not leave anything unattended.
- Dispose of information properly, and ask when you are not sure how.
- Information is not secure just because it is on paper or in a bin: keep it only as long as needed and destroy it properly.

### 8.1 What counts as sensitive

Not everything needs the same care, but a good rule is: if it would hurt someone, or a client, to see it in the wrong hands, treat it as sensitive.

- Client information, contracts and plans
- Personal information: names with ID numbers, contact details, addresses, dates of birth
- Account details, passwords, codes and keys
- Anything marked confidential, or that your client told you to protect

### 8.2 Need to know, and the approved way

Access is meant to match a job. If you can open something you do not need, that is not permission to look. Share information only with people who need it for their work, and only through the channel the client or ERS set up.

1. **Who needs it?**: Is this person part of the task?
2. **How much?**: Only what answers the question.
3. **By which way?**: The approved system, not personal email or chat.

### 8.3 Paper, screens and conversations

Information on paper, on a screen or in a conversation can be seen or heard by people nearby. Keep a clean workspace:

- Keep notes and printouts with sensitive details locked away when you are done.
- Do not leave a screen showing information when you step away.
- Take calls where others cannot hear the details.
- Do not photograph screens or documents with a personal phone.

### 8.4 People in person

Social engineering works face to face too. **Tailgating** is walking in behind someone who opened a door. Attackers pose as delivery staff, repair people or a new colleague with their hands full.

**Scenario: Someone follows you in**

You are entering a shared building and a person in a uniform carrying boxes says "hold the door, please". You do not recognize them.

- Hold the door. They look like they are working.  
  _A uniform proves nothing. Attackers rely on politeness._
- (best) Politely ask them to use their own access, or to ring or check in with the front desk.  
  _Correct. Politeness is fine; letting strangers in is not._

### 8.5 Getting rid of information

Throwing information away is a way to lose it. Anyone can read what goes into a bin, and old devices keep what was on them.

- Shred paper with sensitive details, or return it as instructed.
- Do not sell, give away or recycle a work device. It is cleared the approved way.
- Delete files from approved systems only as your instructions say.
- If you are not sure how to dispose of something, keep it safe and ask.

### 8.6 Keep only what you need, for as long as you need it

Every copy of information is a risk, on screen or on paper. The safest information is the information you no longer hold. Follow your client's instructions on how long something may be kept and where.

1. **Do the task**: Work in the client's system where you can.
2. **Do not copy**: No extra files, notes or printouts unless told to.
3. **Clear up**: Remove downloads and working copies as instructed.
4. **Destroy properly**: Shred or use the approved method, not the bin.

### 8.7 Worked case: the home printer

**Case: Three pages, one tired evening**

You need to read a client's three-page billing summary carefully, and the screen is tiring. You print it on your home printer, read it, and leave it in a drawer to "deal with in the morning". In the morning a visitor is staying and the drawer is open.

_Question:_ What went wrong, and what should happen to the pages?

_Answer:_ Printing created an extra copy outside the client's system, which the client probably did not allow and cannot control, and it was left where others could reach it. The pages should be secured now, and the print reported to your lead so the client can decide what to do. Next time, ask whether printing is permitted and how paper must be destroyed. Throwing it in the bin is not destruction.

### 8.8 Quick check

**Check yourself:** Which of these are good ways to protect sensitive information? Select all that apply. (select all that apply)

- (correct) Lock away printouts when you finish  
  _Right. Paper is easy to forget._
- (correct) Take calls out of earshot  
  _Right. Conversations leak too._
- (correct) Share only with those who need it  
  _Right. Need to know._
- Put old printouts in the normal bin  
  _Anyone can read what goes in the bin. Shred or return it._

## Module 9: When something goes wrong

_How to recognize that something is wrong, what to do in the first minutes, and why speed and honesty matter more than being sure._

About 10 minutes. Included in tracks: full.

Key points:
- Signs of trouble: unexpected prompts, locked files, strange messages sent from your account, odd pop-ups.
- Stop, disconnect if told to, and tell your lead right away. You do not have to be sure.
- Do not try to fix it quietly, delete evidence or reply to the attacker.
- Say exactly what you did and when. Facts help the response.
- Nobody is punished for reporting in good faith.
- In the first hour, stop, tell, describe and preserve: facts matter more than blame.

### 9.1 Signs that something is wrong

Many incidents are noticed first by the person involved. Learn the signs, and treat them as worth reporting even when you are not sure.

- A sign-in prompt, code or password-reset message you did not ask for
- Files that will not open, or that have changed names
- Messages that your contacts say they received from you, which you did not send
- Programs you did not install, or a computer that has suddenly become very slow
- A pop-up or call insisting your computer is infected
- A lost or stolen device, or a message sent to the wrong person

### 9.2 The first minutes

1. **Stop**: Stop what you are doing. Do not click further or reply.
2. **Disconnect if told to**: Take the device off the network if your instructions say so, but do not switch it off unless told to.
3. **Tell your lead**: Right away, by the quickest way. Follow your client's own steps as well.
4. **Write down what happened**: What you saw, what you did, and when.
5. **Follow instructions**: Do what you are asked, and nothing more.

### 9.3 What not to do

**Do**
- Report straight away
- Keep the message or file as it is
- Write down facts
- Cooperate fully

**Do not**
- Try to fix it quietly
- Delete the message or file
- Reply to the attacker or pay
- Warn everyone in a public chat first

> **WARNING**  
> Trying to hide a mistake is far worse than the mistake. Honest and fast is always the right answer.

### 9.4 What the organization does

Once you report, others take over. They check what was reached, contain it, change passwords or keys, restore from backups if needed, and decide whether anyone else has to be told. That is why your fast, accurate report matters: they can only start when they know.

Afterwards the organization learns from it. The question is "what would have prevented this?", not "who is to blame?".

### 9.5 Try it: the message to the wrong person

**Scenario: It went to the wrong address**

You emailed a file with sensitive details to a contact, and a minute later you realize autofill picked a similar address at another company.

- Send a second email asking them to ignore the first.  
  _That does not report the problem, and it creates another message._
- (best) Tell your lead and describe what you sent and where, right away.  
  _Correct. The earlier it is reported, the more can be done._
- Say nothing and fix autofill so it does not happen again.  
  _Fixing autofill is good but the incident still needs to be reported._

### 9.6 The first hour

The first sixty minutes decide how large a problem becomes. Here is what good looks like:

**From the moment you notice**
1. **Minute 0**: You notice something wrong. Stop what you are doing.
2. **Within minutes**: Tell your lead and HR. Do not wait to be sure.
3. **Within the hour**: Write down the facts: what, when, which system. Keep evidence.
4. **As instructed**: Change passwords, sign out sessions or isolate the device, if asked.
5. **Afterward**: Cooperate with questions, and do not discuss it outside the process.

### 9.7 What a good report looks like

**A useful report compared with an unhelpful one**

| Part | Useful | Unhelpful |
| --- | --- | --- |
| What happened | Sent a file with 12 rows to the wrong email address | Something went wrong |
| When | Today at 3:40 pm, noticed at 3:55 pm | Earlier |
| Where | Client billing portal export, sent by email | Somewhere |
| Done so far | Nothing deleted, no reply sent | Fixed it |
| Patient details | None in the report | Names and diagnoses written out |

### 9.8 Worked case: the click you nearly kept to yourself

**Case: Two days of silence**

On Monday you clicked a link in a message and entered your login. The page then said "Session expired", so you assumed nothing had happened and went on. On Wednesday your lead announces that a teammate's mailbox sent odd messages to clients. You realize your login may be connected.

_Question:_ What should you do now, and how does the delay change things?

_Answer:_ Report it today, with the facts: what you clicked, when, and what you entered. The delay has cost two days, but honest late reporting is still far better than silence, and it is protected. Change your password the official way and tell your lead and HR everything you remember. The organization may need to look at your account's activity from Monday on.

### 9.9 Try it: you clicked

**Scenario: A click you regret**

You clicked a link in a message and typed your password on the page that opened. Then you noticed the address looked wrong.

- (best) Change the password through the official site and tell your lead right away.  
  _Correct. Change it the official way and report: both, quickly._
- Hope nothing happens and carry on.  
  _The password is already in the attacker's hands. Act now._
- Close the browser and delete your history.  
  _That does not undo anything and removes useful evidence._

## Module 10: Security and HIPAA together

_How the habits in this course carry out HIPAA's Security Rule, why training is itself a requirement, and a daily check you can use._

About 8 minutes. Included in tracks: full.

Key points:
- The Security Rule asks for administrative, physical and technical safeguards, and your daily habits are part of all three.
- Training is itself a requirement of HIPAA, so completing it is part of the organization's compliance.
- A habit that fails can turn a security slip into a reportable breach.
- Report fast: the deadlines start when anyone in the workforce knows.
- A short daily check keeps the habits in place.

### 10.1 Why the two courses belong together

The HIPAA course explains what the law asks of ERS and its clients. This course explains how people actually do it: with a strong password, a careful click and a locked screen. HIPAA's Security Rule is the point where the two meet.

> **INFO**  
> You do not need to memorize rule numbers. You need to see that each habit has a reason, and that the reason is a legal duty your organization carries.

### 10.2 Each habit, and the safeguard it carries out

**Habits and the Security Rule**

| Habit | What it protects | Kind of safeguard |
| --- | --- | --- |
| Strong, unique passwords and a second sign-in step | Only the right person gets in | Technical |
| Spotting phishing and reporting it | Stops attackers from getting a login | Administrative: training |
| Installing updates, avoiding unapproved software | Closes holes and keeps malware out | Technical and administrative |
| Locking the screen and keeping a tidy desk | Others cannot see or touch information | Physical |
| Using only approved tools and channels | Information stays within agreements | Administrative and technical |
| Reporting a lost device or a mistake at once | Lets the organization act before harm grows | Administrative: incident response |

### 10.3 Training is itself a requirement

HIPAA requires organizations to train their whole workforce on the policies that apply to their jobs, and to document that training. The Security Rule adds specific topics: security reminders, protection from malicious software, log-in monitoring and password management.

When you finish this course, a record is kept. That record is one of the things a client or a regulator can ask ERS to show.

### 10.4 When a habit fails

Most breaches start as a small slip that a habit could have stopped. Here is how a single click can travel:

**From one click to a reportable event**
1. **The slip**: A convincing email gets a click, and a password is typed into a fake page.
2. **A little later**: The attacker signs in as you, and no second step stops them.
3. **Hours or days**: They read, copy or lock information the account can reach.
4. **When it is noticed**: The organization must assess it, and may have to notify the client, patients and HHS.

> **TIP**  
> Each earlier step is a place a habit could have broken the chain: noticing the email, using a second sign-in step, or reporting a strange prompt.

### 10.5 Worked case: the prompt at midnight

**Case: A sign-in approval you did not start**

At 11:40 pm your phone shows a sign-in approval request for your work account. You are not signing in. It repeats four times in ten minutes, and then a message says: "IT here, please approve the request to stop the alerts."

_Question:_ What do you do, and why does it matter beyond you?

_Answer:_ Do not approve it, and do not reply. A request you did not start means someone has your password and is trying to get past the second step. Change your password the official way and report it to your lead and HR right away, even at night. It matters beyond you because the account may reach client systems, and the organization's clock for any needed notification starts when the workforce knows.

### 10.6 Why speed is part of security

A breach is treated as discovered on the first day anyone in the workforce knows of it, or would have known with reasonable care. The organization's own deadlines run from then, and clients' contracts are often much shorter than the legal limit.

> **WARNING**  
> Waiting a day to "be sure" is not neutral. It uses time that belongs to the client, and it can turn a contained problem into a reportable one.

### 10.7 A ten-second daily check

Use this at the start of every work session:

1. **Place**: Is this a private place where screens and calls cannot be seen or heard?
2. **Device**: Is it updated, locked when I step away, and one I am allowed to use?
3. **Sign-in**: Is it my own login, with the second step on?
4. **Tools**: Am I using only approved tools and channels?
5. **Report**: If anything looked wrong yesterday, have I reported it?

### 10.8 Try it: the shortcut

**Scenario: Disabling the lock**

Your laptop locks after five minutes of no activity, and it is annoying when you are reading long documents. A teammate shows you a setting that turns the lock off.

- Turn it off while you read, and turn it back on later.  
  _An unlocked, unattended screen is exactly what the automatic lock is for._
- (best) Leave it on, and ask your lead if the time can be changed through the approved settings.  
  _Correct. The control stays, and the right person can adjust it properly._
- Turn it off only at home.  
  _Home is still a place others can walk past, and the rule follows the information._

### 10.9 Terms from this module

**Terms**
- **Safeguard**: A measure, administrative, physical or technical, that protects information.
- **Security Rule**: The HIPAA rule that requires safeguards for electronic protected health information.
- **Workforce training**: The training HIPAA requires every organization to give and document.
- **Discovery**: The first day a breach is known, or would have been known with reasonable care.

## Exam bank

Each entry shows the question, the options, the correct answer(s) and the reason shown after a pass.

### Why security is everyone's job (15 questions)

**Q1. [Attackers]** Why do attackers target small teams and remote workers?

- (correct) A. They are often easier to reach and less protected
- B. They hold the most money
- C. They are the only ones with passwords
- D. They are required to use weak security

_Reason: Size does not protect anyone. Smaller teams and remote workers are often easier to reach._

**Q2. [Attackers]** Which of these might an attacker want? Select all that apply.

- (correct) A. Money
- (correct) B. Information that can be sold or used for fraud
- (correct) C. Access to other systems through your account
- D. Your favorite color

_Reason: Attackers want money, information and access, or to disrupt work. A favorite color is of no use to them._

**Q3. [People]** Which feelings do attackers most often use to rush people?

- (correct) A. Urgency and fear
- B. Boredom
- C. Sleepiness
- D. Curiosity about the weather

_Reason: Urgency, fear, curiosity and the wish to be helpful are the usual levers._

**Q4. [Four habits]** Which of these are among the four core habits? Select all that apply.

- (correct) A. Recognize and report phishing
- (correct) B. Use strong passwords
- (correct) C. Turn on multi-factor authentication
- (correct) D. Install updates

_Reason: Spotting phishing, strong passwords, a second sign-in step and updates are the four core habits._

**Q5. [Four habits]** What does multi-factor authentication add to a password?

- (correct) A. A second proof that you are you
- B. A longer password
- C. A faster login
- D. A backup of your files

_Reason: A second proof means a stolen password alone is not enough._

**Q6. [Cycle]** In the cycle Identify, Protect, Detect, Respond, Recover, which step is most about noticing something odd and speaking up?

- (correct) A. Detect
- B. Identify
- C. Recover
- D. Protect

_Reason: Detect is noticing that something looks wrong, and people are often the first to notice._

**Q7. [Insiders]** Most insider-related incidents are:

- (correct) A. Accidental, such as a wrong recipient or a click on a bad link
- B. Planned by senior managers
- C. Caused by fire
- D. Done by customers

_Reason: Most insider incidents are honest mistakes, which is why fast reporting matters so much._

**Q8. [Insiders]** You notice a coworker copying a large number of files they do not seem to need. What is the best action?

- (correct) A. Report it to your lead without accusing anyone
- B. Confront them in public
- C. Ignore it
- D. Copy the files yourself to compare

_Reason: Reporting is not accusing. The lead can look at it properly._

**Q9. [Reporting]** True or false: If nothing seems to have happened after a mistake, you do not need to report it.

- A. True
- (correct) B. False

_Reason: Attacks are often silent at first. Report anyway._

**Q10. [Reporting]** You realize you shared a password with someone who claimed to be from IT. What should you do first?

- (correct) A. Tell your lead and change the password through the official way
- B. Wait and see
- C. Delete your browser history
- D. Tell no one in case you get in trouble

_Reason: Fast, honest reporting limits the damage._

**Q11. [Healthcare]** Why are healthcare organizations attractive targets for attackers?

- (correct) A. Care cannot wait, so pressure is high, and records hold valuable personal information
- B. Their buildings are large
- C. They have no computers
- D. They never use email

_Reason: Urgency and rich, lasting records make healthcare a common target._

**Q12. [Healthcare]** Which of these make a clinic's information valuable to attackers? Select all that apply.

- (correct) A. It combines identity and insurance details
- (correct) B. It stays useful for a long time
- (correct) C. Downtime puts pressure on the clinic to act fast
- D. It is always stored on paper only

_Reason: Identity plus insurance details last long, and downtime creates pressure to pay or comply._

**Q13. [Chain of events]** A person enters a work password on a page reached from an unexpected email. Which later habit could still limit the damage?

- (correct) A. A second sign-in step, and reporting the click immediately
- B. Waiting to see if anything happens
- C. Deleting the email and saying nothing
- D. Changing nothing

_Reason: A second step can stop a stolen password being enough, and fast reporting lets the organization respond._

**Q14. [Everyone]** Why is security described as everyone's job and not only IT's?

- (correct) A. Most attacks begin with an ordinary person's click, call or reply
- B. IT staff are not available
- C. Only large companies have IT
- D. Security is only about hardware

_Reason: Attackers go after people, so people are part of the defense._

**Q15. [Pressure]** A message says an account will close in one hour unless you click. What is the most useful thing to know?

- (correct) A. Urgency is a common tool of attackers, so slow down and verify another way
- B. Urgent messages are always legitimate
- C. You must click to be safe
- D. Clicking later is not possible

_Reason: Artificial urgency is meant to stop you thinking. Verify through an official route._

### Passwords and signing in safely (17 questions)

**Q16. [Passphrases]** Which is the strongest choice for a password?

- (correct) A. A long passphrase of several unrelated words
- B. Your birth date
- C. The word "Password1!"
- D. Your pet's name

_Reason: Length and unpredictability matter most. A long passphrase of unrelated words is both strong and memorable._

**Q17. [Reuse]** True or false: It is fine to use the same strong password for your work account and your personal accounts.

- A. True
- (correct) B. False

_Reason: If one site leaks the password, every account that shares it is exposed. Use a different one for each._

**Q18. [Reuse]** Why is reusing a password across sites dangerous?

- (correct) A. A leak at one site lets attackers try it everywhere else
- B. It makes the password longer
- C. It slows your computer
- D. It is against copyright law

_Reason: Attackers try leaked passwords on other sites. Reuse turns one leak into many._

**Q19. [Managers]** What does a password manager do well?

- (correct) A. Creates and remembers unique passwords and fills them in only on the real site
- B. Shares your passwords with your team
- C. Removes the need for any sign-in
- D. Stores passwords in a public notes file

_Reason: A password manager keeps unique passwords for you and warns you when a site is not the real one._

**Q20. [Storage]** Where is it safest to keep passwords?

- (correct) A. In a password manager
- B. In a spreadsheet on your desktop
- C. In a chat with yourself
- D. On a sticky note under the keyboard

_Reason: A notes file, chat or note is the first place an attacker or snoop looks._

**Q21. [MFA]** What does multi-factor authentication add?

- (correct) A. A second proof of identity, so a stolen password alone is not enough
- B. A faster way to sign in
- C. A backup copy of your files
- D. A way to share your account safely

_Reason: MFA requires something beyond the password, so a stolen password alone cannot sign in._

**Q22. [MFA]** Which second step is generally the strongest?

- (correct) A. A security key or passkey
- B. A text message code
- C. A security question about your pet
- D. A shorter password

_Reason: Security keys and passkeys cannot be typed into a fake page, so they resist phishing best._

**Q23. [Prompts]** You receive a sign-in approval prompt on your phone that you did not start. What should you do?

- (correct) A. Deny it and report it to your lead right away
- B. Approve it to make the prompts stop
- C. Ignore it and keep working
- D. Approve it, then change your password tomorrow

_Reason: An unexpected prompt may mean someone has your password. Deny it and report it._

**Q24. [Codes]** A person from "IT" calls and asks you to read out a code just sent to your phone. What do you do?

- (correct) A. Refuse, hang up, and report the call
- B. Read it, since they know your name
- C. Read half of it
- D. Ask them to email you first

_Reason: Real IT staff never need your codes or passwords. This is a social engineering attempt._

**Q25. [Leak]** You typed your password on a page you now think was fake. What is the best first step?

- (correct) A. Change it through the official site or app and tell your lead
- B. Wait and see if anything happens
- C. Close the browser and forget it
- D. Change it through the link on the page

_Reason: Change it by the official route, never through the suspicious page, and report it._

**Q26. [Unrequested prompts]** Your phone shows several sign-in approval requests you did not start. What should you do?

- (correct) A. Deny them and report it to your lead
- B. Approve one so they stop
- C. Reply to the message asking why
- D. Turn off the phone and say nothing

_Reason: Prompts you did not start mean someone has your password. Deny, and report._

**Q27. [Unrequested prompts]** True or false: A real IT desk may ask you to approve a sign-in request that you did not start in order to stop alerts.

- A. True
- (correct) B. False

_Reason: A real IT desk would never ask you to approve a request you did not start._

**Q28. [Passkeys]** Why are passkeys and security keys harder to phish than passwords?

- (correct) A. There is no password to type into a fake page, and the proof stays on the device or key
- B. They are longer
- C. They change every minute
- D. They are shared with IT

_Reason: A passkey is bound to the real site and to your device, so a fake page cannot collect it._

**Q29. [Second step]** Which second sign-in option is generally strongest?

- (correct) A. A passkey or a security key
- B. A text message code
- C. A simple tap to approve
- D. No second step

_Reason: Passkeys and security keys resist phishing better than texts or taps._

**Q30. [Shared accounts]** A tool has only one login, and your team wants to share it. What is the best response?

- (correct) A. Ask your lead how to give each person their own access
- B. Share the password in a team chat
- C. Put it on a sticky note
- D. Use it only at night

_Reason: Each person needs their own access so actions can be traced and access can end when work ends._

**Q31. [Shared accounts]** Which problems come from a shared login? Select all that apply.

- (correct) A. Nobody can tell who did what
- (correct) B. One person's access cannot be closed on its own
- (correct) C. A leaked password affects everyone who shares it
- D. It makes the login stronger

_Reason: A shared login removes accountability and makes access hard to control._

**Q32. [Codes]** A caller says they are from IT and asks you to read out the code that just arrived on your phone. What do you do?

- (correct) A. Refuse, end the call, and report it
- B. Read it quickly so they can fix the issue
- C. Read only the first three digits
- D. Text it to them instead

_Reason: A code is a password. No legitimate caller needs you to read it out._

### Phishing and social engineering (20 questions)

**Q33. [Types]** An attacker sends a text message with a link that pretends to be a delivery notice. This is called:

- (correct) A. Smishing
- B. Vishing
- C. Tailgating
- D. Backup

_Reason: Smishing is phishing by SMS or text message._

**Q34. [Types]** A caller says "I am from IT; read me the code on your phone so we can fix your account." This is:

- (correct) A. Vishing and social engineering
- B. A normal security check
- C. Required by HIPAA
- D. A system update

_Reason: Voice phishing uses a made-up story to get codes or passwords. IT would never need your code._

**Q35. [Signs]** Which of these are warning signs of a phishing email? Select all that apply.

- (correct) A. A threat that your account closes in 10 minutes
- (correct) B. A link whose real address does not match the text
- (correct) C. A request for your password
- D. A message from a known colleague about a meeting you expected

_Reason: Urgency, mismatched links and requests for credentials are classic signs._

**Q36. [What to do]** You receive a suspicious email that asks you to log in through a link. What is the best action?

- (correct) A. Do not click, and report it through your client's way and to your lead
- B. Click to see where it goes
- C. Reply to ask if it is real
- D. Forward it to coworkers for their opinion

_Reason: Do not interact with it. Report it so others are protected._

**Q37. [Verify]** An email appears to be from your client's manager and asks for a patient list. What should you do before replying?

- (correct) A. Verify through a phone number or channel you already know
- B. Reply and ask if it is really them
- C. Send only half the list
- D. Call the number in the email signature

_Reason: Use a known channel. Details inside the message could be controlled by the attacker._

**Q38. [MFA fatigue]** You receive repeated MFA approval requests you did not start. What do you do?

- (correct) A. Deny them and report it immediately
- B. Approve one so they stop
- C. Turn off MFA for the day
- D. Ask a coworker to approve it

_Reason: Repeated prompts mean someone has your password. Deny and report._

**Q39. [Clicked]** You realize you entered your password on a fake page. What is the best response?

- (correct) A. Report it immediately to your lead and HR, and change the password through the official path
- B. Say nothing in case nothing happens
- C. Delete the email and move on
- D. Wait until the end of the day to report

_Reason: Speed limits damage. Report right away and use the official path to reset._

**Q40. [Clicked]** True or false: After clicking a bad link, you should delete the email so nobody finds out.

- A. True
- (correct) B. False

_Reason: Do not delete it. The message helps the response, and hiding the event makes harm worse._

**Q41. [Attachments]** An unexpected attachment named "Invoice.zip" arrives from an unknown sender. What do you do?

- (correct) A. Do not open it and report it
- B. Open it in a safe-looking window
- C. Forward it to your personal email to check
- D. Save it and open it later

_Reason: Unexpected attachments are a common way to deliver malware. Do not open them._

**Q42. [Imposters]** An email that looks like it is from your manager asks you to buy gift cards urgently and send the codes. What should you do?

- (correct) A. Confirm by phone on a number you already know, and report the message
- B. Buy them quickly, since it is your manager
- C. Reply to ask if it is really them
- D. Ask a coworker to buy them instead

_Reason: Urgent payment requests that appear to come from a boss are a classic scam. Confirm independently._

**Q43. [Tech support]** A pop-up says your computer is infected and tells you to call a number and allow remote access. What do you do?

- (correct) A. Close it, do not call, and report it to your lead
- B. Call and follow the instructions
- C. Allow remote access to be safe
- D. Give them your password to check

_Reason: Unexpected tech support messages are scams. Never give remote access or passwords to someone who contacted you._

**Q44. [QR codes]** You find a QR code on a poster that promises a prize and asks you to sign in. What is the safest approach?

- (correct) A. Do not scan it, or treat the destination like any untrusted link
- B. Scan it and sign in with your work password
- C. Scan it and share it with colleagues
- D. Scan it with a work phone only

_Reason: A QR code is just a link. Never enter work passwords on a page you reached from one._

**Q45. [Calls]** A caller claims to be from a government office and demands payment now or you face penalties. What is the right response?

- (correct) A. Hang up and contact the organization through an official number you find yourself
- B. Pay to avoid the penalties
- C. Give your bank details to confirm
- D. Read back your patient list

_Reason: Pressure and payment demands are signs of fraud. Verify independently._

**Q46. [Healthcare lures]** An email says claims are on hold and asks you to sign in to a payer portal through a button. What is the safest first step?

- (correct) A. Open the payer's portal yourself using a bookmark or an address you know
- B. Click the button, since the logo looks right
- C. Forward it to a friend to check
- D. Reply asking if it is real

_Reason: Go to the site yourself through a route you trust, never through the message._

**Q47. [Healthcare lures]** A patient emails an attached 'records request form' you were not expecting. What should you do?

- (correct) A. Not open it, and route it the way the client instructs
- B. Open it to see what it is
- C. Forward it to the whole team
- D. Print it

_Reason: Attachments from unexpected senders can carry malware, and records requests are handled by the client._

**Q48. [Business email compromise]** A message from what looks like a clinic owner asks you to change a supplier's bank details urgently and says they cannot take calls. What is the safe step?

- (correct) A. Verify by calling a number you already have and follow the client's process
- B. Make the change quickly to meet the deadline
- C. Reply to confirm the new details
- D. Ask the sender to send a scan of the new bank letter

_Reason: Payment changes with urgency and no call are classic fraud. Verify through another route._

**Q49. [Business email compromise]** Which of these are signs of business email compromise? Select all that apply.

- (correct) A. A request to change payment details
- (correct) B. Strong urgency
- (correct) C. The sender says they cannot be reached by phone
- D. A message with a friendly greeting only

_Reason: A payment change, pressure and avoiding a call are common signs._

**Q50. [Voice phishing]** A caller says he is from IT and asks you to install a remote tool to fix a problem. What is the best response?

- (correct) A. Decline, hang up and report it to your lead
- B. Install it quickly
- C. Install it on your personal device
- D. Give him your password so he can do it

_Reason: Remote-access tools give full control. Legitimate IT will use approved routes._

**Q51. [Voice phishing]** True or false: It is rude to hang up on a caller who is asking for a password, so you should stay on the line.

- A. True
- (correct) B. False

_Reason: You may end any call that feels wrong, and a legitimate caller will understand._

**Q52. [Clicked]** You entered your password on a page you now think was fake. What is the most important next step?

- (correct) A. Change the password the official way and report it immediately
- B. Close the browser and hope for the best
- C. Wait to see if anything happens
- D. Clear your history only

_Reason: The password is exposed. Change it and report it right away so the account can be watched._

### Malware, ransomware and updates (16 questions)

**Q53. [What it is]** What is malware?

- (correct) A. Software built to harm, spy on or take control of a device
- B. A kind of hardware
- C. A way to speed up a computer
- D. A password manager

_Reason: Malware is any software designed to harm, spy on or take control of a device._

**Q54. [Types]** A program that locks your files and asks for payment is called:

- (correct) A. Ransomware
- B. A browser
- C. A backup
- D. An update

_Reason: Ransomware encrypts files and demands payment to unlock them._

**Q55. [Types]** A program that looks useful but hides something harmful is a:

- (correct) A. Trojan
- B. Firewall
- C. Router
- D. Passphrase

_Reason: A trojan disguises itself as something useful._

**Q56. [Spread]** Which of these are common ways malware gets in? Select all that apply.

- (correct) A. A link or attachment in a message
- (correct) B. Software from an unapproved source
- (correct) C. An unknown USB drive
- D. A software update from the real maker

_Reason: Messages, unapproved downloads and unknown devices are common routes. A real update from the maker is protection._

**Q57. [Updates]** Why should you install updates promptly?

- (correct) A. They close weaknesses attackers already know about
- B. They make files bigger
- C. They are required by your computer's color
- D. They remove the need for passwords

_Reason: Attackers go after known weaknesses, and updates close them._

**Q58. [Updates]** Your computer asks to install a security update. What is the best response?

- (correct) A. Install it at the next safe moment and restart when asked
- B. Postpone it for months
- C. Turn off updates so you are not interrupted
- D. Ask a coworker to ignore it for you

_Reason: Updates close holes attackers already know about._

**Q59. [Software]** A website offers a free tool that would make your work faster. What should you do?

- (correct) A. Do not install it; ask your lead if it is approved
- B. Install it, since it is free
- C. Install it on your personal phone and copy files across
- D. Install it and tell nobody

_Reason: Install only software you were told to use. Unknown tools can hide malware or capture information._

**Q60. [Pop-ups]** A pop-up says your computer is infected and tells you to call a number. What is this most likely?

- (correct) A. A scam
- B. A message from the operating system
- C. A required update
- D. A message from your lead

_Reason: A pop-up that demands you call or install something to clean your computer is itself the attack._

**Q61. [Ransomware]** Your computer shows a message that your files are locked and a payment is demanded. What is the best first step?

- (correct) A. Disconnect it from the network without shutting it down, and report it right away
- B. Pay to get the files back quickly
- C. Restart it and see if it goes away
- D. Tell no one until you have tried to fix it

_Reason: Contain the problem by disconnecting, keep the device on for evidence, and report immediately._

**Q62. [Backups]** Which backup best protects you from ransomware?

- (correct) A. A copy kept separate from the computer and the network
- B. A folder on the same computer
- C. A copy on the same shared drive
- D. No backup, because you can pay

_Reason: A backup the attack cannot reach is what lets an organization recover without paying._

**Q63. [Ransomware]** Why can ransomware be discovered hours after someone first opened a bad file?

- (correct) A. Attackers often look around quietly before they lock files
- B. The file takes a day to download
- C. It waits for a holiday
- D. Antivirus slows it down

_Reason: There is often a quiet period while the attacker finds valuable files and backups._

**Q64. [Ransomware]** You open an attachment that asks you to enable content and nothing visible happens. What should you do?

- (correct) A. Disconnect if you can, do not restart or delete anything, and report immediately
- B. Close it and carry on
- C. Delete the file and say nothing
- D. Restart the computer to be safe

_Reason: Malware can work quietly. Isolate and report right away, and leave evidence in place._

**Q65. [Ransomware]** True or false: If a suspicious file seems to do nothing, it is safe to ignore it.

- A. True
- (correct) B. False

_Reason: Malware often runs silently, so you should report it anyway._

**Q66. [Impact]** What is a common effect of ransomware on a clinic?

- (correct) A. Staff cannot open records, and appointments and results are delayed
- B. Nothing changes
- C. The internet becomes faster
- D. Patients receive free care

_Reason: Loss of access to records disrupts scheduling, care and billing._

**Q67. [Presumed breach]** According to HHS, what is presumed when ransomware encrypts patient information?

- (correct) A. That a breach has occurred, unless a low probability of compromise can be shown
- B. That nothing happened
- C. That only the attacker is responsible
- D. That no report is needed

_Reason: The presumption leans toward a breach, so speed and facts matter._

**Q68. [Backups]** Why should a clinic keep a backup that attackers cannot reach?

- (correct) A. So it can recover clean data without paying
- B. So files load faster
- C. So IT has less to do
- D. So staff can work from any computer

_Reason: A protected backup lets an organization restore after an attack._

### Safe browsing, email and online privacy (16 questions)

**Q69. [Links]** How can you see where a link really goes?

- (correct) A. Hover over it, or press and hold on a phone, and read the address
- B. Click it and see
- C. Ask the sender to confirm by replying to the same message
- D. It always matches the text

_Reason: The visible text of a link can differ from the real address. Hovering shows where it leads._

**Q70. [Links]** Which web address belongs to the company that owns "shop.example"?

- (correct) A. www.shop.example/login
- B. shop.example.secure-login.test/signin
- C. shop-example.login.test
- D. shopp.example/login

_Reason: The part just before the first single slash decides who owns an address. Only the first belongs to shop.example: the others are owned by other names, or are one letter off._

**Q71. [Padlock]** A site shows a padlock. What does that tell you?

- (correct) A. The connection is encrypted, but the site may still be fake
- B. The site is genuine
- C. The site has no malware
- D. The owner has been verified by the government

_Reason: A padlock means a private connection, not an honest site._

**Q72. [Downloads]** A document asks you to "enable macros" to view it. What is the safest response?

- (correct) A. Do not enable them, and report the file if it was unexpected
- B. Enable them, since the document is needed
- C. Enable them for this one time
- D. Forward it to a colleague to open

_Reason: Macros are a common way to run malware. Be wary of any file that asks you to turn them on._

**Q73. [Extensions]** Why can a browser extension be risky?

- (correct) A. It can read what you do and see what is on your screen
- B. It makes the page load slower only
- C. It changes the color of the page
- D. It stops updates from working

_Reason: Extensions can see and change what you do in the browser, which is why only approved ones should be installed._

**Q74. [Social media]** Which of these should stay off public social media? Select all that apply.

- (correct) A. Client names and work systems
- (correct) B. Screenshots of your work screen
- (correct) C. Details of your role that explain who you report to
- D. A photo of your lunch

_Reason: Work details help attackers build convincing messages. A lunch photo does not._

**Q75. [Social media]** A quiz online asks for your first pet's name and the street you grew up on. Why avoid answering?

- (correct) A. They are common answers to account recovery questions
- B. They take too long to type
- C. They are not interesting
- D. They will slow your device

_Reason: Quizzes like this harvest answers that help attackers reset accounts._

**Q76. [AI tools]** Which is appropriate to paste into a public AI chatbot?

- (correct) A. A general question with no work, client or personal details
- B. A client's contact list
- C. A password
- D. A screenshot of a work record

_Reason: Anything typed into a public tool is shared with a stranger. Only paste what you would be happy to publish._

**Q77. [AI tools]** You want to translate a paragraph that contains client details. What is the right choice?

- (correct) A. Do not paste it into an online tool; ask your lead for an approved way
- B. Paste it into a free online translator
- C. Paste it into a public AI chatbot
- D. Email it to yourself and translate it later

_Reason: Pasting work or client information into a public tool discloses it to an unapproved party._

**Q78. [Contacts]** A stranger on a networking site asks detailed questions about your work systems. What do you do?

- (correct) A. Do not answer, and tell your lead if it seems targeted
- B. Answer politely
- C. Share only what is not secret
- D. Send them a screenshot to be helpful

_Reason: Detailed questions about your work from a stranger are a common way to prepare an attack._

**Q79. [Channels]** A client contact emails patient information from a personal email address and asks you to reply with the updated file. What is the best response?

- (correct) A. Do not reply with the file, tell your lead, and ask for the approved way
- B. Reply, since they asked
- C. Reply with the names removed
- D. Forward it to your own email first

_Reason: A personal mailbox is outside the client's control. Use the approved channel._

**Q80. [Channels]** A patient asks you to text her appointment details. What is the right approach?

- (correct) A. Follow the client's messaging policy and the patient's recorded preferences
- B. Text from your personal phone
- C. Tell her HIPAA forbids texting
- D. Send everything including the diagnosis

_Reason: Allowed channels and content are set by the client's policy and the patient's recorded preferences._

**Q81. [Fax]** Which habit reduces the risk of faxing patient information to the wrong place?

- (correct) A. Confirming the number from a reliable source and checking receipt
- B. Sending to every number you think might be right
- C. Leaving it in the tray until later
- D. Faxing it twice

_Reason: A wrong number sends information to a stranger. Confirm the destination before sending._

**Q82. [Voicemail]** What is the best content for a voicemail reminder?

- (correct) A. A callback number and the clinic's name, as the client's script allows
- B. The reason for the visit
- C. The test result
- D. The patient's full date of birth

_Reason: Voicemail can be heard by others. Share as little as possible._

**Q83. [Shared inbox]** True or false: A shared inbox that everyone on the team can open is a good place to keep patient lists.

- A. True
- (correct) B. False

_Reason: Access should be limited to what each person's job needs._

**Q84. [Forwarding]** You are about to forward a message thread that includes patient details to someone new. What should you check first?

- (correct) A. That they are authorized and need it, and that the thread holds only the minimum
- B. That the subject is short
- C. That it is a weekday
- D. That it has an attachment

_Reason: A forward carries everything below it. Check the recipient and the content._

### AI tools and your data (14 questions)

**Q85. [What happens]** You paste text into a public AI chatbot. What is true about that text?

- (correct) A. It travels to the company that runs the tool, and you cannot take it back
- B. It stays on your computer only
- C. It is deleted the moment you close the tab
- D. It is only seen by you

_Reason: Information you give an AI service goes to the company's systems, where it may be stored or reviewed._

**Q86. [What counts]** Which of these should be treated as AI tools for the purposes of this rule? Select all that apply.

- (correct) A. A writing assistant in a browser
- (correct) B. A meeting transcription service
- (correct) C. A free online document summarizer
- D. A paper dictionary

_Reason: Assistants, transcribers and summarizers send what you give them to a company. A paper dictionary does not._

**Q87. [What counts]** How can you tell whether a feature in an app uses an outside AI service?

- (correct) A. You cannot always tell, so assume it does and ask your lead before using it on client work
- B. It always says so in large letters
- C. Only paid tools do
- D. Only tools with a robot icon do

_Reason: Many tools use AI without saying so. The safe assumption is that they send your input elsewhere._

**Q88. [Approved]** Which tool is approved for client work?

- (correct) A. One ERS or the client named or approved in writing
- B. One you found and signed up for yourself
- C. One a coworker said was fine
- D. One that has a free plan

_Reason: A tool is approved only when ERS or the client has reviewed it and covered it with an agreement._

**Q89. [Approved]** True or false: A tool being free or popular makes it approved for client work.

- A. True
- (correct) B. False

_Reason: Approval comes from ERS or the client, not from price or popularity._

**Q90. [Anonymizing]** You remove a patient's name from a letter before pasting it into an unapproved AI tool. Why is that still a problem?

- (correct) A. The remaining details can identify the person, and the tool is unapproved
- B. Names are not important
- C. AI tools cannot read letters without names
- D. It is only a problem if the letter is long

_Reason: Dates, conditions, places and other details can identify someone, and the text has still left the approved systems._

**Q91. [Anonymizing]** Which approach is correct when you need a long document summarized for a client?

- (correct) A. Summarize it yourself in the client's system, or ask for an approved tool
- B. Paste it into any free tool and delete the result
- C. Paste only the first half
- D. Replace names with initials and paste it

_Reason: Use the approved system, or ask for an approved tool. Partial pasting and initials do not solve the disclosure._

**Q92. [Meetings]** On a client call, a meeting app offers to record and transcribe automatically. What should you do?

- (correct) A. Leave it off unless the client has approved recording
- B. Turn it on to save time
- C. Turn it on and delete the file later
- D. Let any participant's bot join

_Reason: Recording and transcription send client information to a third party, so they need approval first._

**Q93. [Meetings]** A bot from someone's note-taking app joins a client call. What is the best response?

- (correct) A. Ask the host whether it is approved, and report it to your lead if not
- B. Ignore it
- C. Talk faster
- D. Share your screen so it sees more

_Reason: Unapproved notetakers can capture client information. Ask, and report._

**Q94. [Accuracy]** An AI assistant drafts a message to a patient. What must happen before it is sent?

- (correct) A. A person checks the facts and wording, and owns the final message
- B. Nothing, since the tool is smart
- C. It is sent and corrected later
- D. It is posted for others to review afterward

_Reason: AI output can be wrong. The sender is responsible for what goes out._

**Q95. [Accuracy]** True or false: If an AI tool sounds confident, its answer can be trusted without checking.

- A. True
- (correct) B. False

_Reason: Tools can invent facts and sound sure. Output must be checked._

**Q96. [Hidden instructions]** Why should you be careful about letting an AI assistant open files or links from unknown senders?

- (correct) A. Hidden text can instruct it to do things you did not ask
- B. The files are too large
- C. Assistants do not read files
- D. It uses too much battery

_Reason: Instructions planted in a document or page can steer an assistant, and you may not see them._

**Q97. [Access]** A tool asks for access to your work email and files to 'help you work faster'. What should you do?

- (correct) A. Decline, and ask your lead whether it is approved
- B. Allow it, since it saves time
- C. Allow it on your phone only
- D. Allow it for one day

_Reason: Giving a tool access to mail and files exposes everything in them. It needs approval first._

**Q98. [Doubt]** You are unsure whether an AI feature in your office software is approved for client work. What do you do?

- (correct) A. Do not use it on client information, and ask your lead
- B. Use it and see
- C. Use it only for short texts
- D. Use it at night when nobody is watching

_Reason: When unsure, hold back and ask. A question costs minutes, a disclosure cannot be undone._

### Devices, networks and working remotely (17 questions)

**Q99. [Lock]** You need to leave your desk at home for two minutes with work open. What should you do?

- (correct) A. Lock your screen first
- B. Leave it, since you are at home
- C. Turn the brightness down
- D. Minimize the window

_Reason: A locked screen keeps others from seeing or using your session, even at home._

**Q100. [Encryption]** Why does encrypting a laptop's storage matter if it is stolen?

- (correct) A. Its contents cannot be read without the code
- B. It makes the laptop faster
- C. It stops the thief from using the laptop at all
- D. It deletes the files

_Reason: Encryption makes the data unreadable without the code, which turns a stolen device into a much smaller problem._

**Q101. [Home network]** Which of these makes your home Wi-Fi safer?

- (correct) A. Changing the router's default password and using WPA2 or WPA3
- B. Keeping the default router password
- C. Leaving the network open
- D. Turning off all updates

_Reason: A strong router password and modern Wi-Fi security reduce the chance of break-ins._

**Q102. [Home network]** Why use a separate guest network for visitors and smart devices?

- (correct) A. To keep them away from the devices you use for work
- B. To make the internet faster
- C. To save electricity
- D. Because guests need a different password every day

_Reason: A guest network keeps less-trusted devices apart from your work devices._

**Q103. [Public Wi-Fi]** Your home internet is down and you have client work to do. What is the best choice?

- (correct) A. Tell your lead and use only a secure option your client allows
- B. Use free public Wi-Fi at a cafe
- C. Use a neighbor's open network
- D. Use a free VPN app you found

_Reason: Public and open networks are not safe for client work. Ask for help and use only allowed secure options._

**Q104. [VPN]** What does a VPN do?

- (correct) A. Creates a private tunnel for your traffic on a network you do not control
- B. Makes you immune to phishing
- C. Updates your software
- D. Backs up your files

_Reason: A VPN protects traffic on an untrusted network, but it does not stop you from clicking a bad link._

**Q105. [Video calls]** You are about to share your screen on a call. What is the best practice?

- (correct) A. Share only the window you need, and close anything private first
- B. Share the whole desktop
- C. Share nothing and read it aloud
- D. Share and record without telling anyone

_Reason: Sharing one window avoids exposing other information by accident._

**Q106. [Personal devices]** A family member offers their shared computer when your work laptop breaks. What should you do?

- (correct) A. Do not use it and ask your lead for an approved option
- B. Use it and log out afterward
- C. Use it only for non-urgent tasks
- D. Use it in a private browser window

_Reason: Only approved devices should be used for client work. A shared family computer is not approved._

**Q107. [Lost device]** You notice your work laptop is missing after a trip. What is the right action?

- (correct) A. Tell your lead immediately
- B. Wait a few days in case it turns up
- C. Buy a new one and say nothing
- D. Post on social media asking for help

_Reason: Immediate reporting lets the right people lock or wipe it and limits harm._

**Q108. [Lost device]** After a device is lost, which of these should be done? Select all that apply.

- (correct) A. Tell your lead immediately
- (correct) B. Change passwords for accounts signed in on it
- (correct) C. Follow instructions to lock or wipe it
- D. Wait to see if it is returned

_Reason: Fast reporting, changing passwords and a remote lock or wipe limit the harm. Waiting only adds exposure._

**Q109. [Setup]** Which parts of a safe remote setup should you check? Select all that apply.

- (correct) A. The place where you work
- (correct) B. The device and its updates
- (correct) C. The network
- D. The color of the walls

_Reason: Place, device, network and sign-in are the checks. Wall color is not._

**Q110. [Shared computers]** Your work laptop fails before a deadline. A relative's laptop is available. What should you do?

- (correct) A. Tell your lead and ask for an approved solution
- B. Use the relative's laptop, since it has internet
- C. Email the files to yourself and use it
- D. Use it in a private browser window

_Reason: A shared device is not managed or encrypted for work and may keep copies. Ask for an approved fix._

**Q111. [Shared computers]** True or false: A private browsing window makes it safe to use someone else's computer for client work.

- A. True
- (correct) B. False

_Reason: Private windows hide history but do not make the device safe or approved, and files can still be saved._

**Q112. [Phones]** Which is a good habit for a personal phone that receives work sign-in codes?

- (correct) A. Use a screen lock and report it at once if it is lost
- B. Share the phone with the family
- C. Turn off updates
- D. Store passwords in the notes app

_Reason: A phone that receives sign-in codes is part of your security and must be protected._

**Q113. [Phones]** May you take a photo of a client's screen on your personal phone to help remember a step?

- (correct) A. No, because that creates an unapproved copy of client information
- B. Yes, if it is a small photo
- C. Yes, if you delete it later
- D. Yes, if it has no names

_Reason: Photos create copies outside approved systems._

**Q114. [Network]** Your home router has never been updated and still uses its default password. What should you do?

- (correct) A. Change the password and update it, or ask for help
- B. Leave it, since it works
- C. Move to a neighbor's Wi-Fi
- D. Turn off the firewall

_Reason: Default passwords and old software leave a home network open._

**Q115. [Place]** Which is the best place to take a client call at home?

- (correct) A. A room with a door, away from others
- B. The kitchen with the family nearby
- C. The balcony
- D. The living room with the television on

_Reason: Choose a private space where the call cannot be overheard._

### Handling information and physical security (15 questions)

**Q116. [Sensitive]** Which of these should be treated as sensitive? Select all that apply.

- (correct) A. Client contracts and plans
- (correct) B. A list of names with ID numbers
- (correct) C. Account passwords and codes
- D. A public holiday calendar

_Reason: Anything that would hurt a person or client in the wrong hands is sensitive. A public calendar is not._

**Q117. [Need to know]** Your login can open a folder that is not part of your task. What is the right response?

- (correct) A. Do not open it and tell your lead so access can be corrected
- B. Open it once to look around
- C. Use it if a friend asks
- D. Say nothing so nobody removes your access

_Reason: Being able to open something is not permission. Report extra access so it can be fixed._

**Q118. [Sharing]** Which is the best way to send a document with sensitive details to a colleague who needs it?

- (correct) A. Through the approved system your client or ERS set up
- B. Through a personal chat app
- C. By personal email
- D. By posting it in a public channel

_Reason: Use the approved system, to the person who needs it, with no more than is needed._

**Q119. [Paper]** You have finished with a printout that contains sensitive details. What should you do?

- (correct) A. Shred it or return it as instructed
- B. Put it in the normal bin
- C. Leave it on the desk
- D. Take a photo and throw it away

_Reason: Anything in a normal bin can be read by anyone. Shred or return sensitive paper._

**Q120. [Screens]** You get a phone call about a client at home and family members are nearby. What is the best practice?

- (correct) A. Move to a private space or use a headset
- B. Put the call on speaker
- C. Repeat the details aloud to confirm
- D. Continue in a shared kitchen

_Reason: Conversations leak too. Take calls where others cannot overhear._

**Q121. [Tailgating]** A stranger in a uniform asks you to hold the door of a secure area. What should you do?

- (correct) A. Politely ask them to use their own access or check in at the front desk
- B. Hold the door
- C. Let them in if they are carrying something heavy
- D. Ask them to promise they work here

_Reason: Tailgating relies on politeness. A uniform proves nothing._

**Q122. [Social engineering]** Someone you do not know calls and says they are from a vendor and asks for details of your work setup. What do you do?

- (correct) A. Share nothing and report the call
- B. Answer to be polite
- C. Give only some details
- D. Ask them to email you the question

_Reason: Detailed questions about your setup from someone you do not know are a common first step of an attack._

**Q123. [Disposal]** A work laptop is being retired. What should happen to it?

- (correct) A. It is cleared the approved way by ERS or the client
- B. You give it to a relative
- C. You sell it online after deleting files
- D. You keep it as is

_Reason: Devices keep what was on them. Clearing is done the approved way, not by individuals._

**Q124. [Photos]** True or false: It is fine to photograph a work document with your personal phone to save time.

- A. True
- (correct) B. False

_Reason: A photo on a personal phone is an unapproved copy outside the systems that protect the information._

**Q125. [Clean desk]** Which habit best protects information at your desk?

- (correct) A. Locking away notes and printouts, and locking your screen when you leave
- B. Leaving notes in plain view for convenience
- C. Writing passwords under the keyboard
- D. Leaving your screen open all day

_Reason: A clean, locked workspace stops casual and opportunistic exposure._

**Q126. [Retention]** Why should you avoid keeping extra copies of client information?

- (correct) A. Every copy is another place it can leak, and the client cannot control it
- B. Copies take up space on the desk
- C. Copies cost money
- D. Clients dislike paper

_Reason: Extra copies multiply risk and sit outside the client's control._

**Q127. [Printing]** May you print a client's document at home to read it?

- (correct) A. Only if the client allows it and tells you how to destroy the pages
- B. Yes, if you keep it in a drawer
- C. Yes, if you throw it in the bin afterward
- D. Yes, if it is short

_Reason: Printing creates a copy outside the approved system and needs permission and a destruction method._

**Q128. [Destruction]** Which is an acceptable way to dispose of printed client information?

- (correct) A. Shredding it or using the method the client approved
- B. Throwing it in the household bin
- C. Tearing it once
- D. Leaving it for the cleaner

_Reason: Only proper destruction protects the information from being reassembled._

**Q129. [Destruction]** True or false: Deleting a file from your desktop and emptying the recycle bin permanently destroys it in every case.

- A. True
- (correct) B. False

_Reason: Deleted files can remain on a device or in backups, so media must be cleared the approved way._

**Q130. [Clean desk]** Which of these belong to a clean-desk habit? Select all that apply.

- (correct) A. Putting papers away when you leave
- (correct) B. Locking your screen
- (correct) C. Keeping passwords off sticky notes
- D. Leaving a list of patient names beside the keyboard

_Reason: A clean desk limits what anyone passing can see or take._

### When something goes wrong (16 questions)

**Q131. [Signs]** Which of these could be a sign that something is wrong? Select all that apply.

- (correct) A. A sign-in prompt you did not ask for
- (correct) B. Files that suddenly will not open
- (correct) C. Contacts saying they got a message from you that you did not send
- D. A calendar reminder you set yourself

_Reason: Unexpected prompts, locked files and messages you did not send are warning signs. Your own reminder is not._

**Q132. [First steps]** You suspect your account was used by someone else. What is the best first step?

- (correct) A. Tell your lead right away
- B. Wait a few days to see
- C. Change nothing and keep working
- D. Reply to the strange messages to ask who sent them

_Reason: Fast reporting limits the damage, and you do not have to be sure._

**Q133. [First steps]** Your device may be infected. What should you do?

- (correct) A. Disconnect it from the network if told to, and report it
- B. Keep working on it
- C. Plug in a USB drive to copy your files first
- D. Restart it repeatedly

_Reason: Contain the problem and report it. Copying files or restarting can spread or destroy evidence._

**Q134. [Evidence]** You received a suspicious email and clicked a link. What should you do with the email?

- (correct) A. Keep it and report it
- B. Delete it immediately
- C. Forward it to everyone
- D. Print it and throw it away

_Reason: Do not delete evidence. The message helps responders understand what happened._

**Q135. [Evidence]** True or false: After a mistake, you should delete anything that shows what happened so nobody finds out.

- A. True
- (correct) B. False

_Reason: Hiding or deleting evidence makes the response harder and the outcome worse. Report and preserve it._

**Q136. [Honesty]** Why does it matter to say exactly what you did and when?

- (correct) A. Facts let the response start in the right place quickly
- B. So you can be blamed
- C. So it can be forgotten
- D. It does not matter

_Reason: An accurate account helps responders find out what was reached and what to fix._

**Q137. [Blame]** True or false: People are punished for reporting a possible incident in good faith, even if it turns out to be nothing.

- A. True
- (correct) B. False

_Reason: Good-faith reporting is encouraged. Fast reporting is how problems are kept small._

**Q138. [Attackers]** A message after an attack says to pay and reply to get your files back. What should you do?

- (correct) A. Do not reply or pay, and leave it to the people responsible
- B. Pay to be safe
- C. Reply to negotiate
- D. Forward it to a friend

_Reason: Paying is not a fix and is not your decision. Replying can make things worse._

**Q139. [Wrong recipient]** You notice you sent information to the wrong person a minute ago. What do you do?

- (correct) A. Report it to your lead right away and say what you sent and where
- B. Send another email asking them to ignore it, and say nothing
- C. Hope they do not open it
- D. Wait until the end of the day

_Reason: The incident must be reported, and the sooner the better._

**Q140. [After clicking]** You typed your password into a page you now think was fake. What should you do?

- (correct) A. Change it by the official route and tell your lead right away
- B. Wait and see
- C. Delete your history
- D. Clear your cookies and carry on

_Reason: The password is already exposed. Change it the official way and report it, both quickly._

**Q141. [First hour]** What is the first thing to do when you notice something may be wrong?

- (correct) A. Stop, and tell your lead and HR without waiting to be sure
- B. Investigate for a few hours first
- C. Fix it quietly
- D. Wait for it to happen again

_Reason: Speed matters, and you do not need to be certain._

**Q142. [First hour]** Which of these belong in a good first-hour response? Select all that apply.

- (correct) A. Tell your lead and HR quickly
- (correct) B. Write down what happened, when and where
- (correct) C. Keep the evidence as it is
- D. Discuss it with friends to get advice

_Reason: Report, record the facts and preserve evidence. Discussing outside the process spreads the problem._

**Q143. [Reports]** Which report is most useful?

- (correct) A. "Sent a 12-row file to the wrong address at 3:40 pm and noticed at 3:55 pm; nothing deleted."
- B. "Something went wrong earlier."
- C. "I think it was someone else's fault."
- D. "Everything is fine now."

_Reason: A useful report is specific about what, when, where and what has been done._

**Q144. [Reports]** True or false: An incident report should include the patient names so the team knows exactly who is affected.

- A. True
- (correct) B. False

_Reason: Keep patient details out of the report. The facts about the event are what is needed._

**Q145. [Late reporting]** You realize two days later that a click may have been a problem. What should you do?

- (correct) A. Report it today with the facts, and change your password the official way
- B. Say nothing, since it is too late
- C. Wait a week to see
- D. Delete your messages

_Reason: Late reporting is far better than none, and honest reports are protected._

**Q146. [Evidence]** Why should you not delete a suspicious message after reporting it?

- (correct) A. It is evidence that helps responders understand what happened
- B. It uses memory
- C. It is a legal requirement for the sender
- D. It will come back anyway

_Reason: Responders use the message to understand and contain the problem._

### Security and HIPAA together (12 questions)

**Q147. [Connection]** Which statement best describes how this course relates to the HIPAA Security Rule?

- (correct) A. Its habits carry out the safeguards the Security Rule asks organizations to put in place
- B. It replaces the Security Rule
- C. It has nothing to do with HIPAA
- D. It applies only to paper records

_Reason: Everyday security habits are how administrative, physical and technical safeguards work in practice._

**Q148. [Safeguards]** Locking your screen when you step away is best described as which kind of safeguard?

- (correct) A. Physical
- B. Administrative
- C. Legal
- D. Financial

_Reason: Controlling who can see or reach a workstation is a physical safeguard._

**Q149. [Safeguards]** Using a second sign-in step is best described as which kind of safeguard?

- (correct) A. Technical
- B. Physical
- C. Administrative
- D. Marketing

_Reason: Authentication measures are technical safeguards._

**Q150. [Training]** Why does ERS keep a record that you completed this training?

- (correct) A. HIPAA requires organizations to train and document it, and clients may ask to see it
- B. To rank staff
- C. To set pay
- D. To track personal time

_Reason: Workforce training and its documentation are part of HIPAA compliance._

**Q151. [Training]** Which topics does the Security Rule name for security awareness training? Select all that apply.

- (correct) A. Security reminders
- (correct) B. Protection from malicious software
- (correct) C. Log-in monitoring
- D. Choosing a company logo

_Reason: The rule names reminders, protection from malicious software, log-in monitoring and password management._

**Q152. [When a habit fails]** An attacker signs in with a stolen password because no second step was set up. What does this show?

- (correct) A. A missing technical safeguard let a small slip become a bigger event
- B. That passwords are unnecessary
- C. That the attacker was unlucky
- D. That nobody can be responsible

_Reason: A second step would have stopped the stolen password from being enough._

**Q153. [Sign-in prompt]** You get repeated sign-in approval requests you did not start. What do you do?

- (correct) A. Do not approve, change your password the official way, and report it
- B. Approve one to make them stop
- C. Reply to the message asking for the approval
- D. Ignore it until morning

_Reason: Unrequested prompts mean someone has your password. Do not approve, and report._

**Q154. [Speed]** Why does the timing of a report matter for HIPAA?

- (correct) A. Deadlines for notification run from when anyone in the workforce knows
- B. Reports are only read on Mondays
- C. Nobody reads them
- D. It matters only to the person who reports

_Reason: A breach is considered discovered when anyone in the workforce knows, so a delay uses the organization's time._

**Q155. [Controls]** A control that locks your screen after a few minutes gets in your way. What is the right response?

- (correct) A. Keep it on and ask your lead about changing the time through the approved settings
- B. Turn it off while you read
- C. Turn it off at home
- D. Ask a coworker how to bypass it

_Reason: The control is a safeguard. Changes go through the approved route._

**Q156. [Daily check]** Which of these belong in a quick check at the start of a work session? Select all that apply.

- (correct) A. Is my place private?
- (correct) B. Am I signed in with my own login and second step?
- (correct) C. Am I using only approved tools?
- D. Is my desktop wallpaper nice?

_Reason: Place, sign-in and tools are checks. Wallpaper is not._

**Q157. [Reporting]** True or false: If something looked wrong yesterday and you did not report it, it is too late and not worth mentioning.

- A. True
- (correct) B. False

_Reason: Report it now. Late reports are better than none, and honest ones are protected._

**Q158. [Habits]** Which habit most directly helps stop an attacker from getting a login in the first place?

- (correct) A. Spotting and reporting phishing messages
- B. Choosing a bright wallpaper
- C. Sharing your password with a trusted teammate
- D. Turning off updates

_Reason: Phishing is how most logins are stolen. Spotting it breaks the chain at the first step._
