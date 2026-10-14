"use client";

import { Check, ChevronsUpDown } from "lucide-react";
import { useState } from "react";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export function TimeZonePicker({ id, value, onChange, options }: {
  id: string;
  value: string;
  onChange: (zone: string) => void;
  options: readonly string[];
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="min-w-0 space-y-1.5">
      <Label htmlFor={id}>Time zone</Label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          id={id}
          type="button"
          aria-label="Time zone"
          aria-expanded={open}
          className="flex h-8 w-full min-w-0 items-center justify-between gap-2 rounded-lg border border-input bg-transparent px-2.5 text-left text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
        >
          <span className="truncate">{value}</span>
          <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[min(22rem,calc(100vw-2rem))] max-h-[min(22rem,var(--available-height))] p-0">
          <Command>
            <CommandInput autoFocus aria-label="Search time zones" placeholder="Search time zones..." />
            <CommandList>
              <CommandEmpty>No time zones found.</CommandEmpty>
              {options.map((zone) => (
                <CommandItem key={zone} value={zone} onSelect={() => { onChange(zone); setOpen(false); }}>
                  <span className="min-w-0 flex-1 truncate">{zone}</span>
                  {zone === value ? <Check className="size-4 shrink-0" aria-label="Selected" /> : null}
                </CommandItem>
              ))}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
