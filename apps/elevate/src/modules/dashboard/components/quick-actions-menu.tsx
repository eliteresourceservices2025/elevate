"use client";

import Link from "next/link";
import { ChevronDown, Plus } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

/** The "More" menu of the quick actions. Only plain links come in: icons are components and cannot cross from the server. */
export function QuickActionsMenu({ items }: { items: { id: string; label: string; href: string }[] }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className={cn(buttonVariants({ variant: "outline" }), "outline-none")}>
        <Plus aria-hidden />
        More
        <ChevronDown aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        {items.map((item) => (
          <DropdownMenuItem key={item.id} render={<Link href={item.href} className="flex w-full items-center" />}>
            {item.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
