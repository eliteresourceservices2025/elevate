import type { Metadata } from "next";
import Link from "next/link";
import { FileText, FileUp, History, ListChecks, Mail, ShieldCheck } from "lucide-react";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { can } from "@/lib/authz";
import { requireUser } from "@/lib/auth";

export const metadata: Metadata = { title: "Settings" };

const SECTIONS = [
  {
    href: "/settings/roles",
    action: "settings.manage_roles",
    icon: ShieldCheck,
    title: "Roles and access",
    description: "Assign roles, name Safe Voice handlers, reset an authenticator.",
  },
  {
    href: "/settings/invitations",
    action: "invitations.create",
    icon: Mail,
    title: "Invitations",
    description: "Invite people to create an ELEVATE account.",
  },
  {
    href: "/announcements?tab=policies",
    action: "settings.manage_policies",
    icon: FileText,
    title: "Policies",
    description: "Write and publish policies, including the privacy notice and the monitoring policy.",
  },
  {
    href: "/settings/import",
    action: "imports.manage",
    icon: FileUp,
    title: "Import from TalentHR",
    description: "Move people from a TalentHR export: preview, commit and reconcile.",
  },
  {
    href: "/settings/go-live",
    action: "imports.manage",
    icon: ListChecks,
    title: "Go-live checklist",
    description: "What to check before everyone moves over from TalentHR.",
  },
  {
    href: "/settings/audit-log",
    action: "settings.view_audit",
    icon: History,
    title: "Audit log",
    description: "Who did what and when. Cannot be edited or deleted.",
  },
] as const;

export default async function SettingsPage() {
  const user = await requireUser();
  const visible = SECTIONS.filter((s) => can(user, s.action));

  return (
    <div className="w-full space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="mt-1 text-muted-foreground">Access, invitations, policies, the TalentHR move and the audit log. You see only what your role allows.</p>
      </div>
      {visible.length === 0 ? (
        <p className="text-muted-foreground">There is nothing for you to change here.</p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {visible.map(({ href, icon: Icon, title, description }) => (
            <li key={href}>
              <Link href={href} className="block h-full rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <Card className="h-full transition-colors hover:bg-secondary/50">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Icon className="size-4 text-primary" aria-hidden />
                      {title}
                    </CardTitle>
                    <CardDescription>{description}</CardDescription>
                  </CardHeader>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
