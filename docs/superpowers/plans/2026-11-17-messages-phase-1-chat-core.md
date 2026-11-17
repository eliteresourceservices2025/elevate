# ELEVATE Messages, Phase 1 (chat core) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Staff can send each other live, encrypted direct messages and private group messages (edit, delete, read state, unread badges) on a new Messages page.

**Architecture:** New `chat` Postgres schema and `src/modules/messages/` module. Text is encrypted with `fieldCrypto`; after each write the server broadcasts an ids-only signal on the private Supabase Realtime channel `user:<userId>` of each member, and the browser re-fetches through server actions that check membership. A polling fallback (20 s) covers a dropped socket.

**Tech Stack:** Next.js 16 App Router, Drizzle + drizzle-kit migrations, Supabase Realtime (existing Pro plan), Zod, Vitest (unit, authz, integration), Playwright.

**Spec:** `docs/superpowers/specs/2026-11-17-messages-design.md` (approved plan: `C:\Users\lorie\.claude\plans\the-executive-and-whole-lucky-hollerith.md`; prototype: https://claude.ai/artifact/SaDLNSUTBLuwHPJBZUEEQn)

All paths are relative to `apps/elevate/` unless they start with `docs/` or `CLAUDE.md` (repo root).

## Global Constraints

- Every exported function in a `"use server"` file starts with `const actor = await requireUser()`, then `authorize(actor, "<action>", ...)` inside `runAction`; helpers taking the user live in `service.ts` (server-only). `tests/authz/server-actions-guard.test.ts` enforces it.
- Validate every input with Zod on the server (`validators.ts`). Return `ActionResult` (`{ok:true,data}|{ok:false,error}`); throw `ActionFailure` inside a transaction to roll back.
- Message text: `fieldCrypto().encrypt(body, "chat_message:<conversationId>:<messageId>")`; edits use `"chat_message_rev:<messageId>:<revisionId>"`. Ids are generated in the app (`crypto.randomUUID()`) so the context is known before insert.
- Message text never appears in Realtime payloads, notifications, email, audit rows, logs or Sentry. Audit rows carry ids and counts only. Individual sends are not audited.
- Body is 1 to 4,000 characters after trimming. A group has 3 to 50 members (including the creator). Rate limit: at most 30 messages per sender per 10 seconds, counted in Postgres (not Upstash).
- Every new table: `.enableRLS()` and no policies. The only policy is on `realtime.messages`. Next migration numbers: 0146 (tables), 0147 (guards).
- Copy: plain, short, sentence case. UI conventions in `src/ui-conventions.test.ts` (PageHeader, PageContainer `canvas`, status tokens, `h-(--control-h)`).
- Never put a real export or real people in tests or seeds: invented names only.
- Commit only after tests and a review pass; do not push.

## Review Focus

- Whitespace-only or 4,001-character body: refused with a plain message, nothing stored.
- Guessing another conversation's id (load, send, mark read, add members): refused as "not found", same as a conversation that does not exist (no existence leak).
- Opening a DM with yourself, an archived person, or a nonexistent user: refused; two people opening each other's DM at the same moment end up in one conversation.
- Editing or deleting someone else's message: refused. A deleted message never returns its text, even to the sender.
- A member who left a group sees only messages created before they left, and cannot send.
- Burst of 31 messages in 10 seconds: the 31st is refused with a "slow down" message.
- The Realtime payload type has no text field (a test fails if one is added).

---

## File structure

| File | Responsibility |
|---|---|
| `src/modules/messages/schema.ts` | `chat` schema tables |
| `src/modules/messages/validators.ts` | Zod schemas and limits |
| `src/modules/messages/permissions.ts` | `messages.use`, `messages.create_group` |
| `src/modules/messages/realtime.ts` | server broadcast of `ChatSignal` (ids only) |
| `src/modules/messages/service.ts` | server-only domain functions taking the acting user |
| `src/modules/messages/queries.ts` | server-only reads (conversation list, messages, people search, unread count) |
| `src/modules/messages/actions.ts` | `"use server"` endpoints |
| `src/modules/messages/components/*` | `ConversationList`, `Thread`, `Composer`, `NewConversationDialog`, `use-chat-live.ts` |
| `src/app/(app)/messages/page.tsx`, `messages/[conversationId]/page.tsx` | routes |
| `drizzle/0146_*.sql`, `drizzle/0147_chat_guards.sql` | tables, then triggers, `chat.can_join`, Realtime policy |
| `tests/authz/messages-actions.test.ts`, `tests/integration/messages.test.ts`, `tests/e2e/messages.spec.ts` | tests |

---

### Task 1: Documentation and rules (Phase 0)

**Files:**
- Create: `docs/modules/messages.md`
- Modify: `CLAUDE.md` (Module notes section, rule 3, the "No patient data" bullet), `docs/policies/COUNSEL-NOTES.md`

**Interfaces:** Produces the written rules every later task cites.

- [ ] **Step 1: Write `docs/modules/messages.md`** with these sections: Purpose; Decisions (the owner decisions from the spec, dated 2026-11-17); Hard rules (text encrypted and never in Realtime/email/notifications/audit/Sentry; membership checked on every read, write and channel join; HR reads only through a two-person access request; recording only by Super Admin-picked people with consent and never in client calls; no patient details, client groups are attendance only); Architecture (copy the diagram from the spec); Tables (the Phase 1 tables from Task 2); Limits (the Global Constraints values); Phases (0 to 7, current phase marked); Testing notes.
- [ ] **Step 2: Edit `CLAUDE.md`:** add a "Messages and calls" entry under Module notes (title, one-line purpose, the 5 hard rules above, pointer to `docs/modules/messages.md`); under rule 3 add the exception "the browser may subscribe to Supabase Realtime private channels that carry ids only; every read still goes through server actions"; in the "No patient data (HIPAA)" bullet add "Messages: client groups are for attendance only under a written never-share-patient-details rule (owner decision 2026-11-17, no vendor BAAs); the guest notice and banners enforce it, nothing can technically block free text."
- [ ] **Step 3: Edit `docs/policies/COUNSEL-NOTES.md`:** append a "Messages and calls" section with the five counsel questions from the plan (access-request rules and whether participants are told; recording consent under the PH Data Privacy Act; retention proposals messages 1 year, call history 3 years, recordings 30 days; whether deleted messages are kept until retention; the written no-patient-details rule for client chats).
- [ ] **Step 4: Verify** `pnpm lint` still passes (markdown is not linted; this checks nothing broke) and `git diff --stat` shows only these three files plus the two new docs.

### Task 2: Schema and migrations

**Files:**
- Create: `src/modules/messages/schema.ts`, `drizzle/0146_*.sql` (generated), `drizzle/0147_chat_guards.sql` (custom), `tests/integration/messages.test.ts`
- Modify: `drizzle.config.ts` (add `"chat"` to `schemaFilter`)

**Interfaces:**
- Produces (all exported from `schema.ts`): `chat` (the `pgSchema("chat")`), `conversations`, `conversationMembers`, `messages`, `messageRevisions`. Columns:
  - `conversations`: `id uuid pk`, `kind text` (`'dm'|'group'`, check constraint), `title text null`, `dmKey text null` (unique, partial where not null; `"<smallerUserId>:<largerUserId>"`), `createdBy uuid -> core.users`, `createdAt`, `archivedAt null`.
  - `conversationMembers`: pk `(conversationId, userId)`, `role text` (`'owner'|'member'`), `joinedAt`, `leftAt null`, `lastReadSeq bigint default 0`, `mutedUntil null`; index on `(userId, leftAt)`.
  - `messages`: `id uuid pk` (app-generated), `seq bigint generated always as identity`, `conversationId`, `senderUserId`, `bodyEnc text`, `kind text` (`'text'|'system'`, default `'text'`), `createdAt`, `editedAt null`, `deletedAt null`; indexes `(conversationId, seq)` and `(senderUserId, createdAt)`.
  - `messageRevisions`: `id uuid pk`, `messageId`, `bodyEnc`, `createdAt`; index `(messageId, createdAt)`.
  - All four tables `.enableRLS()`. Follow `src/modules/payroll/schema.ts` for the `pgSchema` pattern.
- Produces in SQL: `chat.can_join(topic text, uid uuid) returns boolean`.

- [ ] **Step 1: Write the failing integration test** in `tests/integration/messages.test.ts` (follow an existing file in `tests/integration/` for the throwaway-database helpers): test names and assertions —
  - `messages are insert-only: updating bodyEnc throws`; `updating deleted_at once succeeds, a second time throws`; `deleting a message row throws`; `message_revisions rows cannot be updated or deleted`.
  - `dm_key is unique: inserting the same key twice throws`.
  - `can_join: member of conv:<id> is true, a user who left is false, a stranger is false, user:<own id> is true, user:<other id> is false, a malformed topic is false`.
- [ ] **Step 2: Run** `pnpm test:integration -- messages` and confirm FAIL (schema missing).
- [ ] **Step 3: Implement `schema.ts`** as specified above; add `"chat"` to `schemaFilter` in `drizzle.config.ts`.
- [ ] **Step 4: Generate** `pnpm db:generate`, then `pnpm drizzle-kit generate --custom --name=chat_guards` and fill `0147_chat_guards.sql` with: `revoke all on schema chat from public, anon, authenticated;` then `grant usage on schema chat to authenticated;`; triggers `chat.messages_guard()` (BEFORE UPDATE: raise unless `OLD.deleted_at is null` and every column except `deleted_at` is unchanged; BEFORE DELETE: raise) and `chat.revisions_guard()` (raise on UPDATE and DELETE); function `chat.can_join(topic text, uid uuid)` (`language sql stable security definer set search_path = chat, pg_temp`; returns false unless `topic ~ '^(conv|user):[0-9a-f-]{36}$'`; for `user:` compare to `uid`; for `conv:` require a `conversation_members` row with `left_at is null` on a conversation with `archived_at is null`); `grant execute on function chat.can_join(text, uuid) to authenticated;`; and a `do $$` block that, only when table `realtime.messages` exists, creates two policies on it for `authenticated` (select using, insert with check) both `chat.can_join(realtime.topic(), (select auth.uid()))`.
- [ ] **Step 5: Run** `pnpm db:migrate` locally then `pnpm test:integration -- messages`; expect PASS.
- [ ] **Step 6: Commit** `feat(messages): chat schema, guards and realtime channel policy` (after Task 3's tests are green if committing per phase, per the standing rule).

### Task 3: Permissions, validators and authz matrix

**Files:**
- Create: `src/modules/messages/permissions.ts`, `src/modules/messages/validators.ts`, `src/modules/messages/validators.test.ts`
- Modify: `src/lib/authz.ts` (import and spread `messagesPermissions`), `tests/authz/matrix.test.ts` (two rows)

**Interfaces:**
- Produces: `messagesPermissions` with `"messages.use"` and `"messages.create_group"`, both `own` for all six roles. Matrix rows `"messages.use": "O O O O O O"` and `"messages.create_group": "O O O O O O"`.
- Produces (validators): constants `MAX_BODY = 4000`, `MIN_GROUP = 3`, `MAX_GROUP = 50`, `MAX_TITLE = 80`; schemas `sendMessageSchema {conversationId: uuid, body: string}` (body trimmed, 1 to MAX_BODY), `editMessageSchema {messageId: uuid, body}`, `deleteMessageSchema {messageId: uuid}`, `openDirectSchema {userId: uuid}`, `createGroupSchema {title: string 1..MAX_TITLE trimmed, memberUserIds: uuid[] (1 to MAX_GROUP-1, unique)}`, `loadMessagesSchema {conversationId: uuid, beforeSeq?: int, afterSeq?: int, limit: int 1..100 default 50}`, `markReadSchema {conversationId: uuid, seq: int >= 0}`, `addMembersSchema {conversationId: uuid, userIds: uuid[] 1..20}`, `leaveSchema {conversationId: uuid}`, `searchPeopleSchema {q: string trimmed max 60}`.

- [ ] **Step 1: Write failing tests:** `validators.test.ts` — `rejects a whitespace-only body`, `rejects a 4001-character body and accepts exactly 4000`, `trims the body`, `rejects a group with 2 members total (1 other) and accepts 3`, `rejects duplicate member ids`, `limit above 100 is refused`. Add the two matrix rows; run `pnpm test -- matrix validators` and confirm FAIL.
- [ ] **Step 2: Implement** `permissions.ts` (pattern: `src/modules/notifications/permissions.ts`), the validators, and register the permissions in `src/lib/authz.ts`.
- [ ] **Step 3: Run** `pnpm test -- matrix validators`; expect PASS.

### Task 4: Realtime broadcast and the service layer

**Files:**
- Create: `src/modules/messages/realtime.ts`, `src/modules/messages/service.ts`, `src/modules/messages/realtime.test.ts`, `tests/integration/messages-service.test.ts`

**Interfaces:**
- Consumes: Task 2 tables, Task 3 validators, `fieldCrypto()` (`@/lib/crypto`), `writeAudit(entry, executor)` (`@/modules/audit/write`), `ActionFailure` (`@/lib/run-action`), `db` (`@/lib/db`), `createSupabaseAdminClient` pattern in `src/lib/supabase/admin.ts` (env `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SECRET_KEY`).
- Produces (`realtime.ts`): `type ChatSignal = { type: "message" | "edit" | "delete" | "read" | "members"; conversationId: string; messageId?: string }` (no text field, ever); `broadcastChatSignal(userIds: string[], signal: ChatSignal): Promise<void>` — POST `${NEXT_PUBLIC_SUPABASE_URL}/realtime/v1/api/broadcast` with header `apikey: SUPABASE_SECRET_KEY`, body `{messages: [{topic: "user:<id>", event: "chat", payload: signal, private: true}]}`; 2 s timeout; never throws (a failure is swallowed, the client's polling fallback covers it); does nothing when the env vars are missing or `NODE_ENV === "test"`.
- Produces (`service.ts`, `import "server-only"`, all take `actor: { id: string; email: string }` first):
  - `openDirect(actor, otherUserId: string): Promise<{ conversationId: string; created: boolean }>` — refuses self, unknown or archived users; uses sorted `dmKey` with `onConflictDoNothing` then re-selects, so a race yields one conversation; adds both members.
  - `createGroup(actor, input: {title: string; memberUserIds: string[]}): Promise<{ conversationId: string }>` — creator is `owner`; audit `chat.group.create` with ids and member count.
  - `addMembers(actor, conversationId, userIds): Promise<void>` — group only, caller must be a current member, total ≤ MAX_GROUP; a returning member's `leftAt` is cleared; audit `chat.members.add` (count); posts a `system` message "<count> people were added".
  - `leaveConversation(actor, conversationId): Promise<void>` — group only; sets `leftAt`; if the owner leaves, the longest-standing member becomes owner; refuse when it would leave fewer than 1 member; system message "A person left".
  - `sendMessage(actor, {conversationId, body}): Promise<{ id: string; seq: number }>` — membership check (`leftAt is null`, conversation not archived) → rate limit (count of the sender's messages in the last 10 s ≥ 30 throws `ActionFailure("You are sending messages too fast. Wait a few seconds.")`) → encrypt → insert → broadcast `message` to all current members.
  - `editMessage(actor, {messageId, body}): Promise<void>` and `deleteMessage(actor, messageId): Promise<void>` — sender only; deleted messages cannot be edited; edit inserts a `messageRevisions` row and sets `editedAt`; delete sets `deletedAt`; audit `chat.message.delete` (ids only); broadcast `edit` / `delete`.
  - `markRead(actor, {conversationId, seq}): Promise<void>` — `lastReadSeq = greatest(lastReadSeq, seq)`; broadcast `read` to the actor's own channel only.
  - Not-a-member and unknown conversation both throw `ActionFailure("Conversation not found.")`.

- [ ] **Step 1: Write failing tests.** `realtime.test.ts`: `ChatSignal has no text-like keys` (compile-time `satisfies` check plus a runtime scan of the file's source for `body|text|content` property names), `broadcastChatSignal never throws when fetch rejects` (stub `fetch`), `posts one message per user with private:true and topic user:<id>`. `messages-service.test.ts` (integration; pattern from an existing integration test): `sendMessage stores ciphertext, never the plain text` (read the raw row), `a non-member cannot send and gets "Conversation not found."`, `31 sends inside 10 s: the 31st fails`, `two simultaneous openDirect calls from each side give one conversation`, `openDirect with yourself fails`, `edit by another person fails; delete by another person fails`, `a left member's markRead and send fail`, `createGroup writes an audit row with ids and a count and no title or text`.
- [ ] **Step 2: Run both** and confirm FAIL.
- [ ] **Step 3: Implement** `realtime.ts` then `service.ts` as specified. Every multi-write function uses `db.transaction`; `writeAudit` takes the `tx`; broadcasts happen after the transaction commits.
- [ ] **Step 4: Run** `pnpm test -- realtime` and `pnpm test:integration -- messages-service`; expect PASS.

### Task 5: Queries

**Files:**
- Create: `src/modules/messages/queries.ts`, `tests/integration/messages-queries.test.ts`

**Interfaces:**
- Consumes: Task 4 service for nothing (queries are read-only); `employees` from `@/modules/people/schema` (read-only join for display names: `preferredName` else `legalFirstName`, plus `legalLastName`).
- Produces (`import "server-only"`, each starts with `const actor = await requireUser(); await authorize(actor, "messages.use", { ownerUserId: actor.id })`):
  - `type ConversationSummary = { id: string; kind: "dm"|"group"; title: string; memberCount: number; lastSeq: number; lastPreview: string | null; lastAt: string | null; unread: number; photoUserId: string | null }` — for a DM `title` is the other person's name and `photoUserId` their id; `lastPreview` is the latest non-deleted text truncated to 80 characters (decrypted here) or "Message removed" never shown (deleted latest messages fall back to the previous one); ordered by `lastAt` descending; at most 200.
  - `listMyConversations(): Promise<ConversationSummary[]>`
  - `type ChatMessage = { id: string; seq: number; senderUserId: string; senderName: string; kind: "text"|"system"; body: string | null; deleted: boolean; edited: boolean; createdAt: string }` (`body` is null when deleted)
  - `loadMessages(input: unknown): Promise<{ messages: ChatMessage[]; hasMore: boolean; members: {userId: string; name: string}[] }>` — validates with `loadMessagesSchema`; membership required (not a member ⇒ throws `ForbiddenError`-free `Error("Conversation not found.")` mapped by the action); a left member sees only rows with `createdAt <= leftAt`; returns ascending `seq`; latest revision's body wins over the original.
  - `countMyUnread(): Promise<number>` — sum of unread across the actor's conversations (messages from others with `seq > lastReadSeq`, not deleted, not system).
  - `searchChatPeople(input: unknown): Promise<{ userId: string; name: string; position: string | null }[]>` — active people with a `userId`, excluding the actor, name or position contains `q` (case-insensitive, wildcards escaped), 20 results.

- [ ] **Step 1: Write failing integration tests:** `unread counts only others' undeleted text messages after lastReadSeq`, `a deleted message returns body null and deleted true`, `an edited message returns the latest revision body and edited true`, `a stranger loading a conversation gets an error`, `a left member does not see messages created after they left`, `list preview skips a deleted latest message`, `searchChatPeople excludes the actor and archived people and escapes % in q`.
- [ ] **Step 2: Run** and confirm FAIL.
- [ ] **Step 3: Implement** the queries. Use a single query with a lateral subquery per conversation for the preview and unread count; decrypt only the preview rows.
- [ ] **Step 4: Run** `pnpm test:integration -- messages-queries`; expect PASS.

### Task 6: Server actions and authz tests

**Files:**
- Create: `src/modules/messages/actions.ts`, `tests/authz/messages-actions.test.ts`
- Modify: nothing else (the guard test discovers the new `"use server"` file automatically)

**Interfaces:**
- Consumes: Tasks 3 to 5.
- Produces (`"use server"`, each `const actor = await requireUser()` first, then `runAction`, `authorize(actor, "messages.use" | "messages.create_group", { ownerUserId: actor.id })`, then `safeParse` of its schema returning `fail("Check the request and try again.")`): `openDirectMessage(input: unknown): Promise<ActionResult<{conversationId: string}>>`, `createGroupConversation(input) → {conversationId}`, `sendChatMessage(input) → {id, seq}`, `editChatMessage(input)`, `deleteChatMessage(input)`, `markConversationRead(input)`, `addGroupMembers(input)`, `leaveGroupConversation(input)`, `loadChatMessages(input) → {messages, hasMore, members}`, `loadConversationList() → ConversationSummary[]`, `searchPeopleForChat(input) → people[]`. Query errors "Conversation not found." map to `fail("Conversation not found.")`. `createGroupConversation` authorizes `messages.create_group`.

- [ ] **Step 1: Write failing authz test** modeled on `tests/authz/support-actions.test.ts` (database mocked to throw): for each of the six roles, each action gets a valid-shaped input and `expect(result.ok === false && result.error).not.toBe(NO_ACCESS)` (all roles allowed), plus `bad input: every action returns "Check the request and try again." for {}`, and `an unauthenticated call is refused` (requireUser rejects ⇒ action rejects).
- [ ] **Step 2: Run** `pnpm test -- messages-actions server-actions-guard`; confirm FAIL (module missing).
- [ ] **Step 3: Implement** `actions.ts`.
- [ ] **Step 4: Run** `pnpm test`; expect PASS including the guard test.

### Task 7: Live updates hook and chat components

**Files:**
- Create: `src/modules/messages/components/use-chat-live.ts`, `conversation-list.tsx`, `thread.tsx`, `composer.tsx`, `new-conversation-dialog.tsx`, `messages-view.tsx`, `src/modules/messages/components/use-chat-live.test.ts`

**Interfaces:**
- Consumes: Task 6 actions, `createSupabaseBrowserClient()` (`@/lib/supabase/browser`; update its header comment to say it is also used for ids-only Realtime signals), `AvatarImage` (`/api/profile-photo/<userId>?v=`), `FormDialog`, `EmptyState`, `Alert`, shadcn `Button`/`Input`.
- Produces: `useChatLive(userId: string, onSignal: (s: ChatSignal) => void): { live: boolean }` — gets the session (`supabase.auth.getSession()`), calls `supabase.realtime.setAuth(session.access_token)`, subscribes to private channel `user:<userId>` event `chat`; when status is not `SUBSCRIBED` it calls `onSignal({type: "message", conversationId: ""})` every 20 s (a refresh-all signal); unsubscribes on unmount.
- Produces: `<MessagesView userId initialConversations initialConversationId? />` client component holding the list, the open thread, the details-less layout from the prototype's first two panes plus an optional members side panel (details pane arrives in Phase 2).
- Behaviors (each tested by e2e in Task 9, the hook by a unit test): Enter sends, Shift+Enter adds a line; own messages right-aligned in `bg-primary`, others in `bg-card` with border; consecutive messages from one person group under one name; day dividers; "edited" marker; deleted shows "This message was removed" in muted italic; read ticks only in DMs ("Sent"/"Seen"); the list shows unread badges, a "Start a message" button opening the dialog (person search for a DM, or title plus 2 to 49 people for a group); thread loads the latest 50 and "Load earlier messages" pages with `beforeSeq`; opening a thread calls `markConversationRead` with the newest `seq`; new messages scroll into view only when already at the bottom; `aria-live="polite"` region announces new incoming messages; the composer is a labelled input with a visible 4,000-character counter appearing past 3,500.

- [ ] **Step 1: Write failing unit test** `use-chat-live.test.ts` (mock `createSupabaseBrowserClient`): `subscribes to the private channel user:<id> after setAuth`, `calls onSignal when a broadcast arrives`, `polls every 20 s while not subscribed and stops once subscribed`, `removes the channel on unmount`.
- [ ] **Step 2: Run** `pnpm test -- use-chat-live`; confirm FAIL.
- [ ] **Step 3: Implement** the hook, then the components (client components only where interactive; no new dependencies).
- [ ] **Step 4: Run** `pnpm test -- use-chat-live` and `pnpm typecheck`; expect PASS.

### Task 8: Pages, navigation and badges

**Files:**
- Create: `src/app/(app)/messages/page.tsx`, `src/app/(app)/messages/[conversationId]/page.tsx`
- Modify: `src/lib/nav.ts` (Overview group: `{ href: "/messages", label: "Messages", icon: MessageSquare, description: "Chat with your team and groups." }`, import `MessageSquare` from lucide-react), `src/modules/dashboard/nav-work-counts.ts` (add `"/messages"` to `NavWorkCounts` and the result via `countMyUnread()`), `src/components/shell/app-header.tsx` and `src/app/(app)/layout.tsx` (a chat icon button next to the bell linking to `/messages`, with the unread count passed in beside `unread`), `src/lib/route-access.ts` / `src/lib/nav-access.ts` only if they need an entry for a route open to all roles (check how `/announcements` is handled and mirror it), `src/lib/help` guide stub if the help-center test requires every route to have one (check `tests/help`).

**Interfaces:** Consumes `listMyConversations`, `loadMessages`, `<MessagesView>`. Produces routes `/messages` and `/messages/<conversationId>` (the second renders the same view with that thread open; an id the person is not in is a 404 via `orNotFound()`/`notFound()`; **no `loading.tsx`**).

- [ ] **Step 1: Write failing tests:** extend the existing nav/ui-convention tests only as they already require (run `pnpm test` first to see which fail after the nav entry); add `src/modules/dashboard/nav-work-counts.test.ts` case if that file has tests: `"/messages" is the unread count and undefined when zero`.
- [ ] **Step 2: Implement** the pages with `PageHeader` (title "Messages", description "Chat with your team and groups.") inside `PageContainer width="canvas"`, passing `userId`, `initialConversations` and the open thread's data; add the nav entry, the count, and the header chat button.
- [ ] **Step 3: Run** `pnpm lint && pnpm typecheck && pnpm test`; fix any convention test (for example the help-center guide check) the new route triggers; expect PASS.

### Task 9: End-to-end test, build, review, commit

**Files:**
- Create: `tests/e2e/messages.spec.ts`

- [ ] **Step 1: Write the Playwright test** (pattern: an existing spec in `tests/e2e/`, two browser contexts with two throwaway accounts): `A opens a DM with B, sends "Hello", B sees it without reloading and the sidebar badge shows 1`, `B opens the thread and the badge clears`, `B edits a message and A sees "edited"`, `A deletes a message and B sees the removal text`, `a group of three: the third person sees messages sent after joining only through the thread they are a member of`, `a person not in a conversation gets a 404 on /messages/<its id>`, `phone width (390x844): list then thread with a back button`.
- [ ] **Step 2: Run** `pnpm test:e2e` against local Supabase (`supabase start`, `pnpm db:migrate`; if the dev server runs, `E2E_BASE_URL=http://localhost:3000`); expect PASS. If Realtime private channels do not deliver locally, confirm `[realtime] enabled = true` in `supabase/config.toml` and that migration 0147's policy was created (`select * from pg_policies where tablename = 'messages' and schemaname = 'realtime'`).
- [ ] **Step 3: Full checks:** `pnpm lint && pnpm typecheck && pnpm test && pnpm test:integration`, then `pnpm build` and click through the built app (`pnpm start`, two windows, light and dark, phone width). Fix everything found.
- [ ] **Step 4: Review:** run `/code-review high` and `/security-review` on the branch; fix findings (focus: IDOR on conversation and message ids, channel authorization, text in any payload or log).
- [ ] **Step 5: Commit** in two commits — docs (Task 1) and the feature (Tasks 2 to 9) — each ending with the required `Co-Authored-By` line. Do not push.

---

## Self-review

- **Spec coverage:** Phase 1 scope (DMs, groups, live delivery, read state, edit and delete, unread badges, Messages page, docs and rules) maps to Tasks 1 to 9. Phase 2+ items (threads, reactions, files, GIFs, voice, polls, pins, search, team and company channels, guests, calls, recording, HR access, digest email, presence, details pane) are intentionally absent and listed in the spec's phases. The 30-minute job rule and Upstash limit are respected (no jobs, Postgres rate limit).
- **Names:** `ChatSignal`, `broadcastChatSignal`, `ConversationSummary`, `ChatMessage`, `openDirect`/`openDirectMessage`, `createGroup`/`createGroupConversation`, `sendMessage`/`sendChatMessage` are used consistently between service, queries, actions and components.
- **My calls to check:** `seq` identity column instead of uuid v7; edits stored as revisions with the original body immutable; a deleted message keeps its encrypted row until retention; one Realtime channel per person (`user:<id>`) in Phase 1, per-conversation channels arrive with typing indicators in Phase 2.
