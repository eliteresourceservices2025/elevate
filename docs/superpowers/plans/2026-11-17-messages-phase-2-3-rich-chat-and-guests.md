# ELEVATE Messages, Phases 2 and 3 (rich chat, channels, files, guests) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline) to implement this plan slice by slice. Steps use checkbox syntax.

**Goal:** Make chat complete for staff (threads, reactions, pins, mentions, emoji, GIFs, files and images, voice notes, polls, search, team/department/company channels, presence, personal settings, daily digest, live badge everywhere) and let clients join client groups as locked-down guests.

**Architecture:** Same as Phase 1 (encrypted text, ids-only Realtime on `user:<id>`, membership checks everywhere). New tables in migrations 0148+. Guests are users with `core.users.is_guest = true`, **no roles at all** (so every `can()` fails closed), who pass `requireUser("guest")` only in the Messages module; every other `requireUser()` call turns a guest into a 404.

**Tech Stack:** as Phase 1; no new npm dependencies (emoji grid, EXIF stripping and audio sniffing are in-repo code).

**Specs:** `docs/superpowers/specs/2026-11-17-messages-design.md`, `docs/modules/messages.md`, approved plan `C:\Users\lorie\.claude\plans\the-executive-and-whole-lucky-hollerith.md`.

## Global constraints (from the owner and the rules)

- Every server action: `requireUser()` first, `authorize()`, Zod, membership check; tests per role; matrix rows (6 role columns; guests are tested in `tests/authz/guest-access.test.ts`).
- Text, GIF links, poll questions and options, file names are encrypted. Never in Realtime, audit, notifications, email, logs. Audit rows: ids and counts.
- Members see only messages from their `joined_at`; removed members and deleted groups: nothing.
- No new dependencies. Free tiers: no Upstash use per message; email is the daily digest at the lowest priority; no job more often than every 30 minutes; jobs added to `functions.ts` AND `health/registry.ts`.
- Files: private bucket `chat-files`, PDF/JPG/PNG/WEBP/DOC/DOCX up to 10 MB by bytes, voice up to 2 minutes and 5 MB, EXIF/GPS removed from images, patient-data warning on the attach dialog.
- Only HR Admin and Super Admin create/manage groups (Phase 1 rule); team, department and company channels are system-managed (nobody renames, deletes or removes people).
- Clients (guests): only in client groups, attendance matters only, notice before first use, two-step sign-in required, no other part of ELEVATE.
- Commit after each slice's tests, lint, typecheck and a review pass; never push.

## Slices

| Slice | Content | Migration |
|---|---|---|
| 2a | Thread replies, reactions, pins, @mentions (notice to the mentioned), emoji grid | 0148 |
| 2b | Team, department and company channels (auto-synced), posting policy (company: HR only) | 0149 |
| 2c | Polls | 0150 |
| 2d | Files, images, voice notes (bucket, upload flow, metadata stripping, authenticated viewer) | 0151 |
| 2e | GIFs (KLIPY proxy), search (blind index), presence, personal settings and mute, daily digest, live badge everywhere | 0152 |
| 3 | Guests: flag, invitation, provisioning, route lock, notice, client groups, guest UI | 0153 |

## Slice 2a: threads, reactions, pins, mentions, emoji

Schema (0148): `chat.messages.thread_root_id uuid null references chat.messages(id)` (index); `chat.message_reactions(message_id, user_id, emoji, created_at; pk(message_id,user_id,emoji))`; `chat.message_pins(id, conversation_id, message_id, pinned_by, pinned_at, unpinned_at null; unique open pin per message)`. All RLS on, no policies. messages guard trigger unchanged (thread_root_id is set on insert).

Service (`service.ts`): `sendMessage` accepts `threadRootId?` (root must be in the same conversation and itself a root); `toggleReaction(actor, {messageId, emoji})` (emoji must be in `EMOJI_SET`; membership + window; broadcast `reaction`); `pinMessage/unpinMessage(actor, {messageId})` (member; where posting is restricted only people who may post); mentions: `extractMentions(body): string[]` (tokens `@[Name](user:<uuid>)`), `sendMessage` notifies each mentioned current member (not the sender) with `notify()` kind `chat.mention`, title "You were mentioned in <conversation title>", link `/messages/<id>`; never the message text.
Queries: `loadMessages` main list excludes replies, adds `replyCount`, `lastReplyAt`, `reactions: {emoji, count, mine}[]`, `pinned: boolean`; `loadThread({conversationId, rootId, limit})`; `listPins(conversationId)`.
Actions: `toggleChatReaction`, `pinChatMessage`, `unpinChatMessage`, `loadChatThread`; `sendChatMessage` gets `threadRootId`.
UI: reaction chips and a picker on each message, thread side panel, pinned bar, mention picker button in the composer (members list), emoji grid popover (curated 120 emoji, no dependency), mention chips rendered from tokens.
Tests: validators; integration (reaction toggle on/off, non-member refused, window respected, thread reply stays out of the main list and counts, pin/unpin, mention notifies only members and never carries text, reply to a reply refused); authz per role; e2e (react, thread reply, pin).

## Slice 2b: channels

Schema (0149): conversations `kind` check adds `team|department|company`; `team_id`, `department_id` (nullable FKs), `posting text not null default 'everyone' check in ('everyone','admins')`; partial unique indexes (one channel per team, per department, one company channel); `dm_key` check unchanged.
Service `channels.ts`: `syncChannels(actor?)` creates missing channels for active teams and departments and the company channel, and sets each channel's members to the active employees with a sign-in (team: `employees.team_id`; department: people in the department's teams; company: everyone), adding people (fresh `joined_at`) and ending removed ones (`left_at`) in one transaction per channel; archived team/department archives its channel. Called by a daily job `chat-channel-sync` (functions.ts + registry) and after `applyReporting` (best effort).
Posting policy: company channel `posting = 'admins'`: only `messages.manage_group` holders send root messages; replies and reactions are open to members. Channels cannot be renamed, deleted, or have people changed through group actions (`requireGroup` already requires `kind = 'group'`).
UI: channel avatar `#`, filter tabs (All, Unread, Chats, Channels), the composer shows "Only HR can post here" when restricted.
Tests: integration (create, membership diff, move team, archive, idempotent, company restricted post refused for an employee and allowed for HR, thread replies allowed), job registry test.

## Slice 2c: polls

Schema (0150): `polls(message_id pk fk, multiple boolean, anonymous boolean)`, `poll_options(id, message_id, position, label_enc)`, `poll_votes(message_id, option_id, user_id, voted_at; pk(option_id,user_id))`; message kind `poll` (body_enc = question). Limits: question 1..200, 2..10 options of 1..100 characters.
Service: `createPoll`, `votePoll` (single choice replaces; multiple toggles; member + window), results with counts and, when not anonymous, voter names. Actions + `PollCard`/builder dialog.
Tests: validators, integration (vote rules, anonymous hides names, non-member refused, counts), authz, e2e.

## Slice 2d: files, images, voice notes

Storage: `BUCKETS.chat = "chat-files"` in `documents/storage.ts`, `scripts/setup-storage.mts` entry. Schema (0151): `message_attachments(id, conversation_id, message_id null, uploader_user_id, kind image|file|voice, bucket, path, mime, size, sha256, duration_s, name_enc, status pending|active|rejected, created_at)`.
Upload (3 steps): `requestChatUpload` (member, rate-limited with `allowRequest("upload")`, limits per kind, path `chat/<conversationId>/<uuid>`), browser uploads to the signed token, `finalizeChatUpload` (uploader only, within 15 min: read bytes, `sniffFileKind` / `sniffAudioKind`, size, `stripImageMetadata` for JPEG/PNG/WEBP, SHA-256, activate; a failing file is deleted). `sendChatMessage` takes `attachmentIds` (active, own, same conversation, unlinked) and links them; the message kind becomes `file`, `image` or `voice`.
Viewer: `/api/messages/attachments/[id]` (membership + window, inline for images/voice, attachment for files, `nosniff`, CSP sandbox), audited for files.
Pure code with unit tests: `stripImageMetadata(bytes, kind)` (JPEG APP1/APP13, PNG eXIf/text chunks, WEBP EXIF/XMP), `sniffAudioKind(bytes)`.
UI: attach dialog with the patient-data warning, image cards, file cards, voice recorder (MediaRecorder, 2 minute cap) and player.
Tests: unit (strip, sniff), integration with `FakeStorage` (request, finalize ok/rejected type/oversize/other user, send links attachment, viewer access rules), authz, e2e (upload image + file, voice via fake mic).

## Slice 2e: GIFs, search, presence, settings, digest, live badge

- **GIFs:** `klipy.ts` adapter (`searchGifs`, env `KLIPY_API_KEY`, G/PG filter, hashed customer id so KLIPY never sees who asked); `/api/gifs/search`; a GIF message stores `{url,title}` (encrypted) and the URL must be an https host ending `.klipy.com`; `/api/messages/gif/[messageId]` streams it after a membership check (host allowlist, content type, 5 MB cap). Without a key the picker says GIFs are not set up. Response mapping is unverified against the live API until a key exists.
- **Search:** `chat.search_tokens(message_id, conversation_id, token)`; token = base64url(HMAC-SHA256(searchKey, word or word prefix of 3..10)); `searchKey` = HKDF of the first `FIELD_ENCRYPTION_KEYS` key (no new secret). Index on send/edit, wiped on delete. `searchChatMessages({q})`: all words must match, only conversations the person is in and from their join time, newest 30, snippets decrypted after the check.
- **Presence:** Realtime Presence on `conv:<id>` of the open chat (the existing policy), shows "online" in the header and People panel; "Appear offline" stops tracking.
- **Settings:** `chat.user_settings(user_id pk, appear_offline, email_digest)`; per conversation mute (`muted_until`: 1 hour, 8 hours, until turned on); muted chats are excluded from unread badges and the digest.
- **Digest:** email kind `chat_unread` (priority 3, lowest; check constraint migration), job `chat-digest` daily 8:00 Phoenix (functions.ts + registry), at most one per person per day, counts and a link only.
- **Live badge:** a `ChatLiveProvider` in the `(app)` layout owns the single Realtime connection; the header badge and `MessagesView` subscribe to it (replaces `useChatLive` in the view).
Tests: unit (tokenize, hash stable, KLIPY parser, host allowlist), integration (search windows and edits/deletes, mute excludes from unread, digest query), job registry, e2e (search, GIF with a stubbed KLIPY).

## Slice 3: guests (clients)

Schema (0153): `core.users.is_guest boolean not null default false`; `core.invitations.guest_client_id uuid null references core.clients(id)`; `chat.guests(user_id pk, client_id, invited_by, created_at, archived_at, notice_accepted_at)`; conversations `kind` adds `client` with `client_id`; `chat.client_groups` uses `conversations.client_id`.
Auth: `CoreUser.isGuest`/`AuthUser.isGuest`; guests get **no** `user_roles` rows (not even Employee), so every permission check fails closed; `PermissionRule.alsoFlag.guest` grants `messages.use` (own) only; `requireUser(allow?: "guest")` turns a guest into a 404 unless `allow === "guest"`; Messages pages, actions and queries pass `"guest"`. `provisionCoreUser` (core/users.ts): an invitation with `guest_client_id` creates the account as a guest (calls `messages/guests.ts provisionGuest`) and skips the base role.
Invites: `messages.invite_guests` (HR Admin, Super Admin: all; Team Lead: team scope, only for a client their team serves, enforced by an assignment check); `inviteGuest({email, clientId})` creates the invitation with `guest_client_id` and queues the invite email (guest wording, `invite` kind); `archiveGuest` (HR, Super Admin) sets `archived_at`, archives the account (existing deactivate path) and ends their memberships.
Guest rules: they can only be members of `client` conversations of their own client; they cannot be added elsewhere (service refuses guests in groups/channels/DMs); no people search; they see a member's name only inside shared conversations; two-step sign-in is already required by `requireUser`.
Notice: Guest notice shown in the `(app)` layout before anything else for a guest who has not accepted (`acceptGuestNotice`, stored in `chat.guests.notice_accepted_at`); text in `src/modules/messages/guest-notice.ts` (never share patient details, attendance only, messages kept per retention, HR reads only through an approved request, calls are never recorded).
Client groups: HR Admin and Super Admin create (`createClientGroup({clientId, title, staffUserIds, guestUserIds})`); banner "Attendance matters only. Never share patient details." on top of every client group; the VAs assigned to the client are suggested in the picker.
Guest UI: `GuestShell` (logo, name, Sign out, Messages only) replaces the sidebar; `(app)/layout.tsx` branches early for guests so none of the staff queries run.
Admin UI: `/messages/guests` (HR Admin, Super Admin, Team Lead): invite, list, archive.
Tests: authz (`guest-access.test.ts`: a guest is refused every registry action except `messages.use`; with `requireUser()` default a guest is refused); integration (provisioning an invited guest gets no roles; non-guest invitation unchanged; guest refused in non-client conversations and DMs; archive ends memberships; invite rules per role); e2e (invite → sign up → notice → client group → cannot open /dashboard).

## Review focus (checked deliberately by the final reviewer)

1. A guest reaching any non-Messages page, action, query or API route.
2. Removed/left/archived members and deleted groups: no reads of files, reactions, polls, search hits, GIF proxy or attachments.
3. Search index and polls/files never expose text or names to non-members; edits and deletes keep the index honest.
4. Upload path: type judged by bytes, other people's pending uploads, size caps, metadata stripped, SSRF in the GIF proxy.
5. Channel sync races and the company-channel posting rule.
