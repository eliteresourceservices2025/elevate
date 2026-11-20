import type { Metadata } from "next";
import { Camera } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { FormDialog } from "@/components/form-dialog";
import { PageContainer } from "@/components/page-container";
import { PageHeader } from "@/components/page-header";
import { StatusChip } from "@/components/status-chip";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { orNotFound } from "@/lib/or-not-found";
import { ArchiveCategoryButton, CategoryForm, ThresholdsForm } from "@/modules/activity/components/settings-forms";
import { getActivitySettings, listCategories } from "@/modules/activity/queries";

export const metadata: Metadata = { title: "ELEVATE Tracker settings" };

// HR Admin and Super Admin only: anyone else gets a 404 (the queries check activity.manage). No loading.tsx: this route can call notFound().
export default async function TrackerSettingsPage() {
  const [settings, categories] = await Promise.all([orNotFound(getActivitySettings()), orNotFound(listCategories())]);
  return (
    <PageContainer width="wide">
      <PageHeader
        title="ELEVATE Tracker settings"
        description="Numbers the ELEVATE Tracker App and the nightly notes use, and which apps count as work. Changes apply from now on; days already recorded keep their notes."
        breadcrumbs={[{ label: "Settings", href: "/settings" }, { label: "ELEVATE Tracker" }]}
        actions={
          <FormDialog label="Add a rule" title="Add a work rule" description="Say whether an app counts as work. Only the app name is ever recorded, never window titles or web addresses.">
            <CategoryForm />
          </FormDialog>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Thresholds</CardTitle>
          <CardDescription>These are company-wide. The app reads the idle time each time it checks in.</CardDescription>
        </CardHeader>
        <CardContent>
          <ThresholdsForm settings={settings} />
        </CardContent>
      </Card>

      <section aria-label="Work and non-work apps" className="space-y-3">
        <h2 className="text-lg font-semibold">Work and non-work apps</h2>
        {categories.length === 0 ? (
          <EmptyState icon={Camera} title="No rules yet" description="Until you add rules, every app is counted as neither work nor not work. Totals still show active and idle time." />
        ) : (
          <Table stack>
            <TableHeader>
              <TableRow>
                <TableHead>App name pattern</TableHead>
                <TableHead>Counts as</TableHead>
                <TableHead>Priority</TableHead>
                <TableHead className="text-right">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {categories.map((c) => (
                <TableRow key={c.id}>
                  <TableCell label="App name pattern" className="font-mono text-sm">
                    {c.pattern}
                  </TableCell>
                  <TableCell label="Counts as">
                    <StatusChip tone={c.category === "work" ? "success" : "neutral"}>{c.category === "work" ? "Work" : "Not work"}</StatusChip>
                  </TableCell>
                  <TableCell label="Priority">{c.rank}</TableCell>
                  <TableCell className="text-right">
                    <ArchiveCategoryButton id={c.id} pattern={c.pattern} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>
    </PageContainer>
  );
}
