"use client";

import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { finalizeChatUpload, requestChatUpload } from "../actions";
import type { FinishedUpload } from "../uploads";

/**
 * Uploads one file, picture or voice note: the server issues a one-time upload ticket, the browser uploads straight to storage,
 * then the server checks the file's real type and activates it. Throws an Error with a plain message when anything fails.
 */
export async function uploadAttachment(conversationId: string, file: Blob & { name?: string }, kind: "image" | "file" | "voice", durationS?: number): Promise<FinishedUpload> {
  const ticket = await requestChatUpload({ conversationId, fileName: file.name ?? "voice-note", size: file.size, mime: file.type || "application/octet-stream", kind, durationS });
  if (!ticket.ok) throw new Error(ticket.error);
  const { error } = await createSupabaseBrowserClient().storage.from(ticket.data.bucket).uploadToSignedUrl(ticket.data.path, ticket.data.token, file, { contentType: ticket.data.contentType });
  if (error) throw new Error("The upload did not go through. Try again.");
  const done = await finalizeChatUpload({ attachmentId: ticket.data.id });
  if (!done.ok) throw new Error(done.error);
  return done.data;
}
