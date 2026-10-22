// An article body is the Markdown the rest of the app uses, plus one extra line: a picture from the help picture folder,
//   ![What the screen shows](help:invite/01-people.png)
// The path is checked here (letters, numbers, - _ / only, a picture extension, no "..") so it can never point outside that folder.

export type HelpSegment = { kind: "markdown"; text: string } | { kind: "image"; path: string; alt: string };

const HELP_IMAGE_LINE = /^!\[([^\]\n]{0,200})\]\(help:([^)\s]+)\)$/;
export const HELP_ASSET_PATH = /^[a-z0-9][a-z0-9_-]*(\/[a-z0-9][a-z0-9_.-]*)*\.(png|jpg|jpeg|webp)$/;

export function isSafeAssetPath(path: string): boolean {
  return HELP_ASSET_PATH.test(path) && !path.includes("..");
}

export function splitBody(body: string): HelpSegment[] {
  const segments: HelpSegment[] = [];
  let pending: string[] = [];
  const flush = () => {
    const text = pending.join("\n").trim();
    if (text) segments.push({ kind: "markdown", text });
    pending = [];
  };
  for (const raw of body.replace(/\r\n?/g, "\n").split("\n")) {
    const match = HELP_IMAGE_LINE.exec(raw.trim());
    if (match && isSafeAssetPath(match[2])) {
      flush();
      segments.push({ kind: "image", path: match[2], alt: match[1].trim() });
    } else {
      pending.push(raw);
    }
  }
  flush();
  return segments;
}

/** Every picture path an article body points at, so a test can check each file exists. */
export function referencedImages(body: string): string[] {
  return splitBody(body).flatMap((s) => (s.kind === "image" ? [s.path] : []));
}
