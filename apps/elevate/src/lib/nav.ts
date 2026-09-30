import {
  Bell,
  BarChart3,
  Boxes,
  CalendarClock,
  CalendarDays,
  ClipboardCheck,
  ShieldCheck,
  FileText,
  LayoutDashboard,
  LogOut,
  Network,
  UserRound,
  PenLine,
  Settings,
  ShieldQuestion,
  Star,
  UserPlus,
  Users,
  Clock,
  type LucideIcon,
} from "lucide-react";

export type NavItem = { href: string; label: string; icon: LucideIcon; description: string };
export type NavGroup = { label: string; items: NavItem[] };

// Placeholder links for every module; each becomes real in its build phase.
export const NAV_GROUPS: NavGroup[] = [
  {
    label: "Overview",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, description: "Your day at a glance." },
    ],
  },
  {
    label: "Core HR",
    items: [
      { href: "/people", label: "People", icon: Users, description: "Profiles, employment details and client assignments." },
      { href: "/people/me", label: "My profile", icon: UserRound, description: "Your own details, documents and requests." },
      { href: "/my-data", label: "My data", icon: ShieldCheck, description: "What ELEVATE holds about you, downloads and privacy requests." },
      { href: "/org-chart", label: "Org chart", icon: Network, description: "Departments, teams and reporting lines." },
      { href: "/documents", label: "Documents", icon: FileText, description: "Per-person files and company policies." },
      { href: "/announcements", label: "Announcements", icon: Bell, description: "Company posts and policy acknowledgments." },
    ],
  },
  {
    label: "Time and attendance",
    items: [
      { href: "/time-off", label: "Time off", icon: CalendarDays, description: "Leave balances, requests and approvals." },
      { href: "/attendance", label: "Attendance", icon: Clock, description: "Time clock, lates, absences and hours export." },
      { href: "/schedules", label: "Schedules", icon: CalendarClock, description: "Shifts in the client's time zone and Manila time." },
    ],
  },
  {
    label: "Talent",
    items: [
      { href: "/recruiting", label: "Recruiting", icon: UserPlus, description: "Job openings, pipeline and interviews." },
      { href: "/onboarding", label: "Onboarding", icon: ClipboardCheck, description: "New-hire checklists and tasks." },
      { href: "/offboarding", label: "Offboarding", icon: LogOut, description: "Clearance, asset return and access removal." },
      { href: "/signing", label: "Signing", icon: PenLine, description: "ELEVATE Sign: contracts and policy signatures." },
    ],
  },
  {
    label: "Engagement",
    items: [
      { href: "/reviews", label: "Reviews", icon: Star, description: "Review cycles, probation reviews and goals." },
      { href: "/assets", label: "Assets", icon: Boxes, description: "Equipment inventory and assignments." },
      { href: "/analytics", label: "Analytics", icon: BarChart3, description: "Headcount, turnover, attendance and hiring." },
      { href: "/safe-voice-cases", label: "Safe Voice cases", icon: ShieldQuestion, description: "Anonymous report handling (designated handlers only)." },
    ],
  },
  {
    label: "Admin",
    items: [
      { href: "/settings", label: "Settings", icon: Settings, description: "Roles, policies, templates, time zones and audit log." },
    ],
  },
];

export const ALL_NAV_ITEMS = NAV_GROUPS.flatMap((g) => g.items);
