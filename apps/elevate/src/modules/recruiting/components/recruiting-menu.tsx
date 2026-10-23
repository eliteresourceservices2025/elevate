"use client";

import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { FormDialog } from "@/components/form-dialog";
import { buttonVariants } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { RetentionForm } from "./opening-forms";

/**
 * The Recruiting page's secondary actions in one "More" menu: the links this person may use, and (for HR) the applicant data retention
 * settings, which open in a dialog. The page only passes what this person may use; each page checks access again.
 */
export function RecruitingMenu({ links, retention }: { links: { href: string; label: string }[]; retention: { enabled: boolean; rejectedMonths: number; withdrawnMonths: number } | null }) {
  const [retentionOpen, setRetentionOpen] = useState(false);
  if (links.length === 0 && !retention) return null;
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger className={cn(buttonVariants({ variant: "outline" }), "outline-none")}>
          More
          <ChevronDown aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          {links.map((item) => (
            <DropdownMenuItem key={item.href} render={<Link href={item.href} className="flex w-full items-center" />}>
              {item.label}
            </DropdownMenuItem>
          ))}
          {retention ? (
            <>
              {links.length > 0 ? <DropdownMenuSeparator /> : null}
              <DropdownMenuItem onClick={() => setRetentionOpen(true)}>Applicant data retention</DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      {retention ? (
        <FormDialog open={retentionOpen} onOpenChange={setRetentionOpen} hideTrigger label="Applicant data retention" title="Applicant data retention" size="lg">
          <RetentionForm initial={retention} />
        </FormDialog>
      ) : null}
    </>
  );
}
