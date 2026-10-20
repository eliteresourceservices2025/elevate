import { cn } from "@/lib/utils";
import { typeStyle } from "../type-style";

/** The document type as a coloured badge with its icon, so the category reads at a glance. */
export function TypeBadge({ slug, name, className }: { slug: string; name: string; className?: string }) {
  const s = typeStyle(slug);
  const Icon = s.icon;
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium", s.className, className)}>
      <Icon className="size-3.5" aria-hidden />
      {name}
    </span>
  );
}
