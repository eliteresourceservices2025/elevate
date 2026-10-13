import { FileText } from "lucide-react";
import type { ContentFileView } from "../content-files";

const sizeText = (bytes: number) => (bytes >= 1_000_000 ? `${(bytes / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1000))} KB`);

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
