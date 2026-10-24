import { FileText } from "lucide-react";
import type { ContentFileView } from "../content-files";

const sizeText = (bytes: number) => (bytes >= 1_000_000 ? `${(bytes / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1000))} KB`);

/** The video of an announcement, played above its text from our own signed-in route (which redirects to a short-lived link). */
export function ContentVideo({ files }: { files: ContentFileView[] }) {
  const video = files.find((f) => f.kind === "video");
  if (!video) return null;
  return (
    <figure className="mb-4">
      <video controls preload="metadata" playsInline className="aspect-video w-full rounded-lg border bg-black" aria-label={`Video: ${video.fileName}`} src={`/api/content/files/${video.id}`}>
        Your browser cannot play this video.
      </video>
    </figure>
  );
}

/** The documents attached to an announcement or policy version, as downloads. (Pictures show inside the text.) */
export function ContentFileList({ files }: { files: ContentFileView[] }) {
  const documents = files.filter((f) => f.kind === "file");
  if (documents.length === 0) return null;
  return (
    <div className="mt-4 space-y-2 border-t pt-3">
      <h2 className="text-sm font-semibold">Files</h2>
      <ul className="space-y-1">
        {documents.map((f) => (
          <li key={f.id}>
            <a href={`/api/content/files/${f.id}`} className="inline-flex items-center gap-2 text-sm text-primary underline-offset-4 hover:underline" download>
              <FileText className="size-4" aria-hidden />
              {f.fileName}
              <span className="text-xs text-muted-foreground">({sizeText(f.sizeBytes)})</span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
