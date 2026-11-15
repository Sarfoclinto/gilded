# Photos in Gilded — design and plan (draft for decision)

Goal: everything staff used to post in WhatsApp groups (the scale showing the gold, the gold itself, the closing weigh-in, IDs, slips) is taken, kept and found **inside Gilded, attached to the record it proves**, and taking a photo is **as smooth as WhatsApp or better**.

## 1. What I think

Yes, build it, and build it as one shared capability, not one-off uploads per screen. Three reasons it is worth the care:

1. **It is what makes the app replace WhatsApp instead of sitting beside it.** If a teller still has to open WhatsApp for the scale photo, the app has not won and the bosses are right to doubt it.
2. **It is stronger than WhatsApp as evidence.** A WhatsApp photo is loose: nobody knows which transfer it belongs to, it can be deleted, reused for another day, or taken from the gallery last week. A Gilded photo is tied to the transfer or the day, stamped with who/when/which branch, cannot be deleted (only marked "removed, with a reason"), and reuse of the same picture on two records is detected.
3. **It sits beside the numbers.** The scaled top/down entered at a transfer (B57) and the photo of the scale proving it are one screen; the closing count and the photo of the accumulated gold are one screen.

Honest limits: "as smooth as WhatsApp" is achievable for *capture* (instant camera, many shots, instant preview, background sending, works offline). WhatsApp's remaining edge is its familiarity and its drawing/forwarding tools; I would not copy those. I cannot test real cameras here (only a simulated one), so smoothness has to be proven on your actual phones and computers early (the spike in section 7).

## 2. What it looks like to use (the bar to meet)

- **One tap opens the camera**, already warmed up (no spinner). Rear camera on phones; webcam on computers.
- **Keep shooting:** the camera stays open after each shot; a strip of thumbnails builds at the bottom (like WhatsApp). Tap a thumbnail to look at it full screen, retake or remove it.
- **Choose from the gallery / files** in the same sheet, **several at once**. On a computer also **drag-and-drop and paste** (Ctrl+V).
- **Torch** toggle and **tap to focus** (gold and scale displays glare).
- **Rotate** (and a light crop later). No drawing tools.
- **Done** returns to the form immediately. Photos compress on the device (about 1600 px, roughly 200–400 KB, well under what a phone shoots) and **upload in the background** with a small progress ring on each thumbnail; a failure retries by itself.
- **Offline:** photos are kept on the device and sent when the connection returns, exactly like purchases are. The record can be saved first; the photo shows "waiting to send" until it arrives.
- **Viewer:** full screen, pinch to zoom, swipe between photos of the record, caption, who/when/branch, download.
- **A stamp burned into the picture** (optional setting, I recommend on): branch, date and time, reference (e.g. TRF-KSI-0007) and the person, on a thin strip. A screenshot or an export proves itself, which is what the WhatsApp groups never could.
- Targets to test against: shutter to thumbnail under 200 ms; compression under 500 ms on a mid-range Android; a 300 KB photo sends in a few seconds on a weak mobile connection, without the teller waiting.

## 3. What photos attach to

| Where | Photo of | Priority |
|---|---|---|
| Transfer, at hand-over | the scale showing the scaled top/down; the sealed bag | first |
| Transfer, at receipt | what arrived on the receiving scale | first |
| Closing the day | the scale with the accumulated gold; optionally the cash count | first |
| Profile | the person's own photo (new; replaceable, history kept) | first |
| Purchase | the gold bought; the customer's ID | second |
| Customer | ID card (front/back), face photo | second |
| Discrepancy / sign-off | evidence for a case | second |
| Cash in / out, expenses | the slip or receipt | later |
| Notes exchange, mobile money | the screenshot of the confirmation | later |

All of these use the same camera sheet, uploader and viewer; each screen only says "photos for this record, purpose X, required or optional".

**A Photos page** (managers and directors): every photo by day, branch, type, person or reference, with a filter bar and search. This replaces scrolling a WhatsApp group. A **Share** button (the phone's own share sheet) is kept for the bosses who still want a picture in WhatsApp, so the app is not fighting their habits.

## 4. Rules (this is what makes it more than a gallery)

- **Required or optional, per purpose, as a company setting.** Recommended: required for the transfer scale photo and the closing photo; optional elsewhere. Offline, the rule is "a photo must be *declared* before the record is saved"; if the bytes have not arrived after N hours the reviewers are notified.
- **Camera only for evidence** (setting, recommended for scale/closing photos): the gallery is not offered, so an old picture cannot be passed off as today's. Each photo records its source (camera / gallery) and the device's capture time.
- **Same picture used twice is flagged** (fingerprint match across records).
- **Nothing is deleted.** Removing a photo records who, when and why, and hides it; the file stays for audit (profile photos are the exception: replacing one keeps history but only the current one is shown).
- **Who sees what** follows permissions: a photo can be seen by anyone who can see its record; IDs and profile photos need a stricter permission and every view of an ID is logged. This is personal data under Ghana's Data Protection Act (Act 843); I am not a lawyer, so the retention period and the consent wording should be checked with whoever advises the company.
- **No public links.** Photos are only served by the API after a permission check, never as open URLs.

## 5. How it is built

**Storage (needs your decision).** Metadata in Postgres (a new `gold.attachments` table with row-level tenant security, append-only like the ledger). The bytes in one of:
- **A. Files on a Docker volume on the same Hetzner server (my recommendation to start)**: simplest, cheapest, fast, covered by the existing backup if I extend `backup.sh` to include the volume. Named by content fingerprint, so duplicates cost nothing.
- B. Hetzner Object Storage (S3-compatible): better if volume grows large or a second server appears; costs a little and adds credentials.
- C. Inside Postgres: simplest to back up, but bloats the database and every dump.
The code talks to a small `IBlobStore` interface, so A can become B later without touching screens. Rough size: 300 KB × 30 photos a day × 5 branches is about 16 GB a year; fine for A for a long time, and old full-size photos can be shrunk or archived by policy.

**Data.** `attachments(id, tenant, branch, purpose, owner_type, owner_id, sha256, mime, size, width, height, taken_at, source, caption, created_by, created_at, removed_*)`. `owner` is the record it belongs to (transfer, day, user, customer, transaction, discrepancy…). The id is made on the device, so uploads are safe to repeat.

**Device.** Capture with the browser camera (`getUserMedia`) for the in-app camera, plus the file picker; the native camera input is the fallback where a browser refuses. Resize, fix rotation, make a thumbnail and the fingerprint in a worker so the screen never freezes. Blobs are kept in IndexedDB; a separate **upload queue** (alongside the existing command outbox, not inside it) sends them with retry, resume and progress. Records reference photos by id, so a purchase or day-close command stays small and syncs first.

**Server.** `POST /attachments` (multipart, idempotent by id, size and type checks, fingerprint check), `GET /attachments/{id}` and `/thumb` (authenticated, cache-friendly), list by record, remove-with-reason, and the Photos page query. Permissions: take, view, view-sensitive, remove, manage settings.

**Desktop app and the branch hub.** The desktop app uses the same web code (webcam through the same camera API; needs the camera permission wired in Electron). Photos taken on a computer that is offline stay on that computer until it syncs, so another computer at the branch will not see them until then; teaching the branch hub to carry photos too is a later step.

## 6. Risks I can already see

- **iPhone and old Android browsers:** camera behaviour in installed web apps differs; HEIC pictures picked from an iPhone gallery need converting. The spike must run on the real devices you use.
- **Weak connections:** many photos plus a purchase must never block the teller. Hence the separate queue and small files.
- **Disk and backups:** photos make backups large; I would back up files incrementally and keep the 14-day rule for the database only.
- **Cost of mistakes:** a photo mistakenly attached cannot be deleted (by design); the "removed with a reason" path must be easy, or tellers will be afraid to tap.

## 7. Plan, in steps you can approve one at a time

0. **Spike (about one session):** camera sheet + compression + background upload + viewer on a throwaway page. You test it on the real phones and computers against WhatsApp. If it does not feel as good, we fix this before building anything on it. This is also the demo for the bosses.
1. **B60 Foundation + transfers + profile photo:** the table, storage, endpoints, camera sheet, upload queue, viewer; photos on transfer hand-over and receipt (next to the B57 scale reading); profile photo; settings for required/optional.
2. **B61 Closing the day:** the closing photo, working offline, with the required rule. (This touches the offline day-close path, so it gets its own step and tests.)
3. **B62 The Photos page + purchases and customer IDs:** library, search, filters, share, ID permission and view log.
4. **B63 Evidence rules:** burned-in stamp, camera-only, reuse detection, late-photo alerts, retention and archive.
5. Later: slips, mobile-money screenshots, hub carrying photos, light crop/markup.

## 8. Decisions taken (14 Nov) and still open

**Taken:**
1. **Storage:** a volume on the Hetzner server (option A).
2. **No photo is ever required and none blocks work.** At transfer hand-over and closing the day a missing photo is **flagged for the reviewer** ("no photo attached"). This replaces the "required" setting in sections 4 and 7.
3. **Devices:** tellers use their **phones, mostly iPhones with a few Androids**; tablets and computers with built-in or external webcams also have to work. So: the phone's own camera app and the in-app camera are both built and compared on iPhones first (spike B60a), and the camera picker supports several webcams.

**Still open (defaults I will use unless told otherwise):** camera-only for scale/closing photos (default: allowed from library too, but the source is recorded and shown to the reviewer); burned-in stamp (default: on); who sees IDs and profile photos, and how long photos are kept (default: managers and directors see all; IDs need a separate permission and every view is logged; nothing deleted until the company decides); a Share-to-WhatsApp button (default: yes).

## 8b. Original questions (for reference)

1. **Storage:** A (files on the server, my pick), B (Hetzner Object Storage) or C?
2. **Which photos are mandatory** at launch (my suggestion: transfer scale photo and closing photo only), and when one is missing, do we **block** the save or **allow and flag** it (my suggestion: block online; allow and flag offline)?
3. **Camera-only** for the scale/closing photos?
4. **Burned-in stamp** on photos?
5. **Who may see** photos, IDs and profile pictures, and **how long** do we keep them?
6. **What devices** do tellers take photos with at each branch (phones, laptop webcams, a tablet at the scale)? This decides which camera behaviours I must get perfect first.
7. Do the bosses want a **Share to WhatsApp** button kept for the photos they still forward?