# Wifitel Security Specification

## Data Invariants
1. A user can only modify their own profile.
2. Messages can only be read/written by the two participants involved in the chat (linked to the chatId format).
3. Friend requests (notifications) can only be read/written by the recipient.
4. Calls can only be accessed by the caller or receiver.
5. `friendId` must be unique and match the regex `^[A-Z0-9_\-]+$`.

## The "Dirty Dozen" Payloads

1. **Identity Spoofing**: `PUT /users/victim-uid { name: "Hacker", friendId: "H-123" }` by `attacker-uid`.
2. **State Shortcutting**: `UPDATE /users/my-uid { unreadCount: -100 }` to break UI counters.
3. **Ghost Field Injection**: `UPDATE /users/my-uid { isAdmin: true }`.
4. **Message Interception**: `GET /chats/userA_userB/messages/msg1` by `userC`.
5. **Call Hijacking**: `UPDATE /calls/active-call { answer: { sdp: "hacker-sdp" } }` by `observer-uid`.
6. **Notification Spam**: `POST /users/target-uid/notifications { fromId: "spoofed-uid" }`.
7. **Resource Poisoning**: `POST /chats/chat1/messages { text: "A" * 1000000 }` (Denial of Wallet).
8. **Invalid ID**: `GET /users/..%2f..%2fadmin` (Path Traversal attempt).
9. **Timestamp Manipulation**: `POST /chats/chat1/messages { timestamp: "2020-01-01T00:00:00Z" }`.
10. **Unauthenticated Read**: `GET /users/any` without auth token.
11. **Chat Privacy Breach**: `LIST /chats` (Should be restricted).
12. **Notification Status Bypass**: `UPDATE /users/my-uid/notifications/req1 { status: "accepted" }` where `fromId` is spoofed in local memory to gain access.

## Test Runner
Writing `firestore.rules.test.ts` to verify denials.
