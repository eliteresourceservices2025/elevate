// What a live signal says: WHAT happened and WHERE, never what was written. The payload type has no text field on purpose
// (a test scans this file for one). Shared by the server broadcast and the browser listener, so it has no server-only import.

export type ChatSignal = {
  type: "message" | "edit" | "delete" | "read" | "members";
  conversationId: string;
  messageId?: string;
};
