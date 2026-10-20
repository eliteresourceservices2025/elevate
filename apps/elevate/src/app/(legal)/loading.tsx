import { Spinner } from "@/components/ui/spinner";

export default function Loading() {
  return (
    <div className="flex min-h-[50dvh] items-center justify-center text-muted-foreground">
      <Spinner className="size-6" />
    </div>
  );
}
