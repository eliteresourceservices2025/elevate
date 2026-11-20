// How many of a chat's people are online, as one pure function so the header count and the green dots in the People list can never disagree.
// "Online" means: has this chat open right now (Supabase Presence on the chat's private channel) and has not chosen to appear offline.
// It counts the viewer too (when they are announcing), exactly like the dot next to their own name; people who are no longer members are not counted.

export function countOnline(members: { userId: string }[], online: ReadonlySet<string>): number {
  return members.reduce((n, m) => n + (online.has(m.userId) ? 1 : 0), 0);
}
