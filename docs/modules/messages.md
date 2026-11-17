# Messages and calls (chat first, calls second)

Working notes for `apps/elevate/src/modules/messages/`. Design: `docs/superpowers/specs/2026-11-17-messages-design.md`. Plan: `docs/superpowers/plans/2026-11-17-messages-phase-1-chat-core.md`. Prototype: https://claude.ai/artifact/SaDLNSUTBLuwHPJBZUEEQn

## Purpose

One company-controlled place for internal chat (direct messages, private groups, later team and company channels, client groups) and calls, replacing scattered free tools. Chat is the main feature; calls are secondary.

## Decisions (owner, 2026-11-17)

- Free and open-source tools first; new monthly cost expected $0 (ceiling about $20).
- Calls: Cloudflare Realtime SFU and TURN (free up to 1,000 GB a month), no server to run; fallback self-hosted LiveKit behind `calls/transport.ts`.
- Clients (outsiders) join as guests in client groups for attendance matters, under a written "never share patient details in ELEVATE" rule, with no vendor BAAs.
- HR reads a chat only through a logged request an HR Admin makes and a different Super Admin approves (read-only, requested dates only, 72 hours).
- Recording only by people a Super Admin picks, with consent from everyone in the call, never in calls that include a client.
- GIFs come from KLIPY through our server. No phone-number calling.

## Who manages groups (owner decision 2026-11-17)

Only **HR Admins and Super Admins** create, rename, change the people of, and delete group chats (`messages.create_group`, `messages.manage_group`, scope all). Everyone else chats in the groups they were added to and in direct messages, and cannot leave a group on their own (HR removes people). Deleting is the usual ELEVATE soft delete: the group is archived for everyone and its encrypted messages stay until the retention period ends.

- HR manages groups from the **Manage groups** page (`/messages/manage`: names, counts, people; never message text) and from the People panel of a group they are in. Everything is audited with ids and counts only (`chat.group.create|rename|delete`, `chat.members.add|remove`; an add lists the ids of who was added, a remove the id of who was removed).
- **Managing is not reading.** An admin who is not in a group cannot read it and cannot add themself to it (that would be a way around the two-person access request, Phase 6). A group they create includes them as a member until they remove themself.
- The server checks `messages.manage_group` on every action; the buttons are only hidden for convenience.
- **Owner accepted (2026-11-17):** one HR Admin or Super Admin can add any other person to a group without a second approval; that person then reads new messages from that moment. The add is audited (ids of who was added), and everyone in the group sees a system line that people were added.

## Hard rules

1. Message text is encrypted (`fieldCrypto`, context `chat_message:<conversationId>:<messageId>`). It never appears in Realtime payloads, notifications, email, audit rows, logs or Sentry. Audit rows carry ids and counts; individual sends are not audited.
2. Membership is checked on every read, write, channel join and call join. A permission never replaces membership. A person who was removed from a group loses all access at once (no list, no history, no sending, not even what came before), and a person added later (or added back) sees only what is sent from the moment they were added: thread, list preview and unread counts all use that window (tested). A deleted group (archived) cannot be read or written by anyone.
3. Realtime carries ids only (`ChatSignal`, no text field). The browser subscribes to its own private channel `user:<id>`, authorized by one policy on `realtime.messages` calling `chat.can_join(topic, uid)`; every read still goes through server actions.
4. HR access to a conversation is only through an approved two-person request (Phase 6). Nobody else can read a chat.
5. No patient details: warnings above the composer and on file attachments, a banner and guest notice in client groups. Free text cannot be technically blocked.
6. Messages are insert-only (database trigger): a delete sets `deleted_at`, an edit adds a `message_revisions` row. Deleted text is never returned; the encrypted row stays until the retention period (counsel) ends.

## Architecture (Phase 1)

```
Browser ── server actions ──► Postgres chat.* (encrypted text)
   ▲                              │ after commit
   └── Realtime private channel user:<id> ◄── server broadcast of {type, conversationId, messageId}
       (browser then calls loadChatMessages / loadConversationList)
Fallback: poll every 20 s while the socket is not subscribed.
```

## Tables (schema `chat`, RLS on, no policies except `realtime.messages`)

`conversations` (kind `dm`|`group`, `dm_key` unique), `conversation_members` (`left_at`, `last_read_seq`), `messages` (`seq` identity for ordering and read position, `body_enc`, `deleted_at`), `message_revisions`. Later phases add attachments, reactions, pins, polls, search tokens, guests, access requests, calls.

## Limits

Body 1 to 4,000 characters; groups 3 to 200 members (owner decision 2026-11-17; up to 50 people added per step; Realtime signals go out in batches of 100);  30 messages per sender per 10 seconds (counted in Postgres, not Upstash, to protect the free tier); page size 50 (max 100).

## What is built (state at 2026-11-17)

- **Phase 1 chat core, group management (200 cap, HR/Super Admin only).**
- **Phase 2 rich chat:** threads (one level), reactions (fixed emoji set), pins, @mentions (a notice saying where, never what), automatic team, department and company channels (daily sync; the company channel is HR-post-only), polls, pictures/files/voice notes (3-step upload, bytes-based type check, location data removed from pictures, served only through the authenticated route `/api/messages/attachments/[id]`), message search (a blind index of HMAC word tokens, never plain text), muting a chat, personal settings (appear offline, daily email), a daily unread email (`chat_unread`, lowest priority, count and link only; job `chat-digest`, 8:00 AM Phoenix).
- **Phase 3 client guests** (below).
- **Presence (online dot):** Supabase Presence on the private `conv:<id>` channel (already authorized by `chat.can_join`): only the person's id is shared, nothing is stored, shown as "N online" in the chat header and a green dot in the People list of the open chat. "Appear offline" (chat settings) watches without announcing (takes effect on reload). It says nothing about activity or time and is never a monitoring tool.
- **GIFs (built, UNVERIFIED against the real service):** `KLIPY_API_KEY` (server env only) turns them on; without it the picker says GIFs aren't set up. Search and previews go through our server (`searchChatGifs`, `/api/messages/gif-preview`), a sent GIF stores only an https KLIPY address (encrypted like any message body, kind `gif`) and is shown through `/api/messages/gif/[messageId]` (current members only), so KLIPY never sees who is looking. Only https `klipy.com`/`klipy.co` hosts are ever fetched (`gif-rules.ts`: no redirects, 5 MB cap, gif/webp only). KLIPY's per-GIF response fields could not be read when this was built, so `parseGifResults` is tolerant and fails closed: **check it against a real response when the key exists** and confirm the allowed hosts.
- **Not built yet:** a live unread badge outside the Messages page, calls (Phase 4), town hall and recording (5), HR access requests (6), rollout (7).

## Client guests (Phase 3, owner decision 2026-11-17)

- A guest is `core.users.is_guest = true` with **no roles at all** (not even Employee). A database trigger (`core.guest_roles_guard`) refuses to give a guest a role, and `is_guest` cannot change once set.
- **Default deny everywhere:** `requireUser()` sends a guest to `/messages` unless the caller passes `{ allowGuest: true }`. Only Messages (actions, queries, the attachment route, the `(app)` layout) opts in. The permission registry grants guests `messages.use` alone, through `alsoFlag.guest`; `tests/authz/guest-access.test.ts` checks every registered action.
- **Invite:** HR Admin or Super Admin (`messages.invite_guests`) on `/messages/guests`. The invitation carries `guest_client_id`; first sign-in set-up (`provisionCoreUser`) then makes the account a guest and a `chat.guests` row (no Employee role, no Super Admin bootstrap, no people record). An expired guest invitation still never produces staff. An email already invited as staff, or already holding an account, is refused, and staff invitations refuse an email that has a guest invitation.
- **Notice first:** nothing opens until the guest accepts the short guest notice (`GUEST_NOTICE_BODY` in `guests.ts`; counsel to finalize). Enforced on the server (`assertGuestReady` in `run()` and `actorWithAccess`), not only by the screen.
- **What a guest can do:** read and write in the client groups they were added to, vote, react, upload, search their own chats, mute. They cannot start chats, create groups, look people up, or be added to a plain group or a direct message (`activeUserIds` excludes guests). A client group (`kind = 'client'`, `client_id`) takes staff and only guests of **that** client (`membersFit`). HR/Super Admin create and manage them from Manage groups ("New client group").
- **Every client chat shows** "Attendance matters only. Never share patient details."
- **Ending access:** HR archives the guest (`archiveGuest`): the account is archived (requireUser signs them out), they leave every chat, nothing is deleted.
- **Known limit (key rotation):** the search index (`chat.search_tokens`) is keyed from the FIRST key in `FIELD_ENCRYPTION_KEYS`. Rotating keys makes older messages stop matching in search until the index is rebuilt; there is no rebuild job yet. Do not rotate until one exists (or accept search gaps).
- **Not yet:** adding a guest to an existing client group later from the Manage screen (create a new client group, or add through the action), Team Lead invites (HR and Super Admin only for now), guest sign-up wording in the invitation email (the generic ELEVATE invitation is reused).

## Phases

0 docs and prototype, 1 chat core, 2 rich chat (done; GIFs await a KLIPY key to verify), 3 guests (done), 4 calls, 5 all-hands and recording, 6 HR access requests, 7 rollout and pilot.

## Free-tier guardrails

Upstash free is 500K commands a month (no per-message use); Brevo is 300 emails a day (chat email is lowest priority, Phase 2); Inngest jobs no more often than every 30 minutes; Supabase Realtime Pro quota 500 concurrent connections and 5M messages a month (one connection per signed-in person).

## Testing

Unit and authz (no database), integration (`pnpm test:integration`: triggers, `chat.can_join`, encryption, rate limit, unread counts), e2e with two browser contexts (`pnpm test:e2e`). Run `pnpm build` and check the built app before committing.
