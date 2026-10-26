"use client";

import type { ReactNode } from "react";
import { MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/** Keep frequent actions visible; menu items describe the less frequent work for this record. */
export function RowActions({
  label,
  primary,
  children,
  disabled = false,
}: {
  label: string;
  primary: ReactNode;
  children?: ReactNode;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center justify-end gap-1">
      {primary}
      {children ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={disabled}
                aria-label={`More actions for ${label}`}
              />
            }
          >
            <MoreHorizontal aria-hidden /> More
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            {children}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}
