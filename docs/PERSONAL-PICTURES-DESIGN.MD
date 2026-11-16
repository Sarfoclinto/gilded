# My pictures: a private camera for every user (design)

Status: DESIGN ONLY. Nothing is built. Proposed as B65 once approved.

## 1. What it is
A camera button reachable from every screen. Tap it, take a picture of anything (a note, a gold item, a receipt, a price board), and it is saved to **My pictures**, a page only that user can open. No transaction, no customer, no required fields. A user can optionally share a picture with one named colleague. Nobody else sees them, including admins, managers and directors.

This is deliberately separate from the company photo system (transfers, closing, collateral, IDs, purchases), which is shared evidence and can never be deleted. Personal pictures are the opposite: private and really deletable.

## 2. Privacy model (the heart of the design)
**Rule: only the owner, plus people the owner explicitly shares a picture with.**

- Own table `gold.personal_pictures` and own file folder (`tenant/personal/<user>/<id>.jpg`). They are NOT rows in `gold.attachments`, so `photo_library`, `photo_gaps`, the Photos page, ID-view logging, removal tools and every future company report cannot reach them by accident.
- Row-level security on the owner: a query only returns rows where `owner_user = current user`, on top of the tenant check. A second table `personal_picture_shares` grants read on one picture to one user.
- No permission can unlock it. There is no `personal:read-all`, no admin endpoint, no "view as user" path. Roles do not matter here.
- Files are served only by an endpoint that checks owner or active share, with `Cache-Control: private, no-store` so shared devices and proxies do not keep copies.
- Audit records only: a picture was shared with X, a share was revoked. Never "picture taken", never "picture viewed". The share dialog tells the user this in one line, because an admin reading the audit log would see that a share happened (not the picture).

**What this cannot promise (honest limit):** the pictures live on your server. Someone with root access to the Hetzner machine or the database can technically reach the files. Phase 3 adds encryption at rest (a master key kept outside the database and outside backups), which protects against stolen disks and backups, but not against the server operator. The only fully admin-proof option is device-only storage (see decision 1). The in-app promise is "no one using Gilded can see them", and the page says exactly that.

## 3. Entry points
- **Camera button.** Desktop: a camera icon in the header, next to the notification bell. Phone and tablet: a small round camera button stacked just above the existing Tools button (bottom-right), so it never overlaps it or the tab bar. Hidden while a camera or full-screen viewer is open, and in print.
- **Account menu:** "My pictures" item (and the page also reachable from the camera sheet after saving: "Saved. View my pictures").
- Tapping the camera opens the existing camera sheet straight away. Capture, then **Keep** (saves) or **Retake**. Keep can take several in a row. No caption needed; an optional one-line caption can be added from the page later.
- Works offline like company photos: the picture waits in the on-device queue and uploads when the connection returns. It shows a "waiting to upload" badge on the page.
- Unlike company photos: no timestamp/branch stamp burned in, gallery choice allowed even if `photos.cameraOnly` is on (these are personal), same resize and compression.

## 4. The page: My pictures
Route `/my-pictures`, under the account area (not in the main side menu, since it is personal). Same navy banner + icon-tile look as My settings.

- Tabs: **Mine** | **Shared with me** (shows a count dot when something new arrives).
- Mine: grid by day (Today, Yesterday, dates), newest first, thumbnail, caption under it. Search by caption. Tap to open the full-size viewer.
- Select several: Share, Delete. One picture: Add caption, Share, Download, Delete.
- **Delete is real**: file and row removed after a confirm; shares to others disappear with it. (Optional later: 30-day "recently deleted" bin. Not in phase 1.)
- Share: pick one colleague by name (people you can already see in the app), tick the pictures, send. The picture's menu shows "Shared with Ama" with a Stop sharing action. The recipient gets a notification ("Kojo shared a picture with you", link to the tab). Recipient can view and download, not re-share. Revoking removes access immediately; a copy already downloaded by the recipient cannot be recalled (the dialog says so).
- Shared with me: read-only grid with the sender's name and date. Recipient can "Hide" an item from their list.
- Empty state: "Nothing here yet. Tap the camera button to take your first picture." with a note "Only you can see these."

## 5. Limits and company control
- Company setting **Personal pictures** (on/off, default on). Turning it off hides the buttons; it does NOT delete or expose anything, and existing pictures stay owner-accessible if switched back on. This is the only thing the company controls.
- Quota per user: default 300 pictures and about 300 MB, shown on the page ("120 of 300"). The server refuses past the limit with a plain message. Both numbers are company settings. Compression keeps a picture around 300 to 600 KB.
- Leavers: when an account is deactivated, its pictures become unreachable to everyone and are purged after 90 days (the number is a setting). A user who is deactivated cannot be "revived" by an admin into reading them either; reactivating the same account restores access to the owner only.

## 6. Technical plan (summary)
Database (migration 0064): `personal_pictures(id, tenant, owner_user, caption, taken_at, bytes, w, h, sha, created_at)`, `personal_picture_shares(picture, to_user, created_at, revoked_at)`, RLS on owner/share, functions `personal_picture_add` (idempotent by client id, checks quota and setting), `_list`, `_set_caption`, `_delete`, `_share`, `_unshare`, `_open` (owner or active share). Settings `personalPictures.enabled`, `.maxPerUser`, `.maxMb`, `.purgeDays`. Tests: another user, an admin and a director all get nothing, including by guessed id; share then revoke; quota; delete removes shares.
API (C#): `/me/pictures` (POST multipart, GET list, PATCH caption, DELETE), `/me/pictures/{id}/file|thumb`, `/me/pictures/{id}/shares`, `/me/pictures/shared`. A purge job for leavers and deleted files. Files written by the existing FileBlobStore under the personal folder.
Web: `features/personal-pictures` (api, queue kind reusing `gold-photos` IndexedDB with a new kind so company queue logic is untouched, `QuickCameraButton`, `MyPicturesPage`, share dialog), reusing CameraSheet, preparePhoto and PhotoViewer (viewer gets a `personal` flag that hides company wording). Header and UtilityPanel get the button; account menu gets the link.

## 7. Phases
1. **B65 Capture + page**: button, camera, offline queue, My pictures page, caption, real delete, quota, on/off setting, owner-only tests.
2. **B66 Sharing**: share to a colleague, Shared with me tab, revoke, notifications, share audit lines.
3. **B67 Extras (optional)**: attach a personal picture to a purchase/transfer as company evidence (a copy is made; the personal one stays private), encryption at rest, recently-deleted bin.

## 8. Risks worth knowing
- Staff could photograph company things (customers' IDs, cash) in a space management cannot inspect. Mitigation: a one-line notice in the company settings and on first use, "Pictures needed as company evidence belong on the transaction, not here", plus the phase 3 "attach as evidence" action.
- Storage growth on the server volume: bounded by quota x users; worth watching on the Hetzner disk.
- Data-protection: personal content on company servers. Owner-only access and deletion help, but the company should state this in its staff policy.

## 9. Decisions needed
1. Store on the server (backed up, works across devices) or on the device only (truly admin-proof, but lost if the phone is lost or cleared, and sharing becomes impossible)?
2. Button placement (header icon on desktop + stacked button above Tools on phones, or inside the Tools panel only)?
3. Sharing scope: one colleague per share (simple) or several/branch groups; view-only or also download?
4. Company switch and quota defaults as above; and the leaver policy (purge after 90 days).