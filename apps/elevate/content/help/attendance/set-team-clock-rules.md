---
title: Set the team clock rules
summary: Choose, for each team, which clock-in places are expected, when the idle prompt shows and how late is late.
category: attendance
audience: super_admin, hr_admin
order: 7
video: set-team-clock-rules
updated: 2026-10-22
---

Clock rules apply **per team**. A team with no rules has no IP restriction and the default idle prompt.

# Open the rules

1. Click **Attendance** in the left menu.
2. Open the **Rules** tab.

Each team has its own block. At the top, the page tells you whether the monitoring policy is published. Selfies, location and the Jibble mirror need it first.

![Rules, per team: allowed IPs, idle prompt, grace and selfie.](help:set-team-clock-rules/01-rules.png)

# The rules, one by one

- **Allowed IP addresses or ranges (one per line).** Type the addresses people should clock in from, for example `203.0.113.0/24`. Leave it empty for no restriction. A clock-in from outside is flagged for the lead and never blocked.
- **Idle prompt after (minutes).** After this many minutes with no activity, the person sees **Are you still working?** It never clocks them out. Empty turns the prompt off.
- **Grace after shift end (minutes).** If someone is still clocked in this long after the shift ends, they and their lead get a missed clock-out notice.
- **Late and early-leave grace (minutes).** Arriving or leaving within this many minutes of the shift is not flagged.
- **Require a selfie at clock-in.** The person takes a photo each time. It is deleted after 30 days. It needs the monitoring policy to be published first.
- **Mirror the clock to Jibble (screenshots).** Sends clock events to Jibble. It also needs the monitoring policy. Jibble is only for screenshots. ELEVATE stays the only source of hours.
- **Expect an end-of-day report.** A missing one is flagged. It never blocks clocking out.

Click **Save rules** for that team.

# Location

Location is not a team rule. Each person chooses it in their own clock settings, and it works only after the monitoring policy is published. See "Set up your own clock".

# Before you turn on monitoring

Selfies, location and screenshots are monitoring. Publish the monitoring policy first, and make sure people acknowledged it. See "Post an announcement or a policy".

# Common mistakes

- **Typing a wrong IP range.** Many people will be flagged. Check it with IT.
- **A grace of zero.** Everyone one minute late is flagged.
- **Turning on selfies without the policy.** It will not work, by design.

# Try it yourself

- Open **Rules** and read one team's block.
