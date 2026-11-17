# Learn Gilded: a video hub and in-app tours (plan)

Status: PLAN ONLY. Nothing is built. Proposed after the current priorities; decisions in section 9.

## 1. The idea in one line
**One script per operation makes three things:** the narrated video, the in-app tour, and the written steps. When a screen changes, the script is run again and everything comes out up to date. Nobody re-records anything by hand.

## 2. Yes, I can make the videos (proved)
A 30-second sample is attached (`sample-walkthrough-value-gold.mp4`, 1.1 MB, 720p). It was made with no human at the controls:
- a script drives the **real app** (with demo data) in a hidden browser that is recorded;
- a **visible cursor** glides to each control, with a gold ring on every click; text is **typed key by key**;
- each step shows a **caption**, and a **voice** says the line; the script waits exactly as long as the line takes;
- the voice lines are placed at the right moments and the result is encoded to MP4.

The sample's voice is the basic one available on this machine (SVOX Pico): clear but robotic. The pipeline does not care where the voice comes from (section 5), so a better voice drops straight in.

## 3. What users get
### The Learn page (menu: Learn, next to Rules and guides, or one "Learn" area with both)
- A navy banner, a search box, and **"Start here" paths by role**: "Your first day as a teller" (6 short videos), "Running a branch" for managers, "Owner's tour" for directors.
- **Topics as rows of cards:** Buying gold, Cash drawer, Opening and closing, Transfers, Debts and held gold, Photos, Workings, Settings. Each card shows a thumbnail, the length (most are 30–90 seconds), and a tick once watched.
- Only the videos for things this person is allowed to do (a teller does not see price approval).

### The video page
- The player, with **chapters** (one per step, click to jump) and **captions** (useful at a noisy or quiet counter, and later in Twi).
- Below it, the **transcript as numbered steps**: a written how-to for people who prefer to read.
- **"Try it now"** opens the screen and starts the matching tour. **"Next"** goes to the next video in the path.

### Help where people are stuck
- A small **?** in the header of each screen: "Watch how" (the video for this screen) and "Show me" (the tour).

### Tours inside the app
- A **welcome tour** at first sign-in for each role (can be skipped, restarted from the ? menu).
- **Screen tours:** popovers pointing at the real controls, one step at a time ("This is where you type the weight on the scale").
- **"Do it" steps** wait for the person to do the action (type the weight, press Save) before going on, so the tour teaches by doing.
- **"What's new" tours** after an update: two or three steps showing what changed (for example the new Tools rail).
- Progress is remembered on the server, so a tour finished on one computer is not shown again on another.

## 4. How it is built
```
walkthroughs/                one file per operation (TypeScript), the single source
  value-gold.ts              { title, roles, permission, topic, route, steps: [{ target, action, value, say, caption }] }
  new-purchase-cash.ts
  ...
tools/recorder/              Playwright + a voice adapter + ffmpeg: script -> video, captions, chapters, thumbnail
  out/value-gold.mp4 .vtt .chapters.json .jpg      and manifest.json (every video, its length, version)
web/src/features/learn/      the Learn page, the player (captions, chapters, transcript), the ? menu, the tours
backend                      learn_progress (who watched / finished what, when), for the ticks and an optional manager view
```
- **Stable targets:** every control a script touches gets a `data-tour="tools-button"` attribute, so a design change does not break the scripts.
- **The scripts are also tests.** The recorder fails when a control has moved or been renamed. Running it before each release tells us which videos and tours need a look, and doubles as an end-to-end check of the main operations.
- **Demo company:** videos are recorded on the demo data (`deploy/demo-data`), never on real customers.
- **Tours** use Ant Design's built-in Tour component (already in the app, no new library) and read the same step files. Video narration and tour text come from the same lines, so they always agree.
- **Hosting:** the videos are files served by the app's own web server (like the desktop installers), not YouTube. They play at a branch without anyone else seeing our screens, and the app can keep chosen videos for offline use. About 1 MB per 30 seconds: a library of 30 videos is roughly 100–150 MB.
- **Phone versions:** the same scripts can be recorded at phone size for the phone layout; we choose which operations need both.

## 5. The voice: the real choice
| Option | Quality | Cost | Notes |
|---|---|---|---|
| Basic offline voice (the sample) | Robotic but clear | Free | Works today with no setup. |
| Neural offline voice (Piper) | Natural, close to a person | Free | Runs on any computer or the server. I could not download the voice files here (blocked), but your machine or the build server can. British and American English voices; no Ghanaian voice. |
| Cloud neural voice (Azure, Google, ElevenLabs) | Very natural | A few dollars for the whole library, then pennies per update | Needs an account and an API key from you. Some offer West African English accents; we would check which before choosing. |
| A real person reads the lines | Best and most local | Your time | The recorder gives each line as a short script. A staff member records them on a phone, and the pipeline fits the video to their timing. Re-record only the lines that change. |

**My suggestion:** start with the neural offline voice (free, no account). Use a real person for the five "first day" videos if you want them to sound like your company.

## 6. Other ways (for comparison)
- **Record by hand** with OBS or Loom: quick for one video, but every screen change means re-recording, and the quality varies from video to video.
- **Ready-made services:** in-app tour products (Userpilot, WalkMe, Whatfix) and auto-documentation tools (Scribe, Guidde). They cost a monthly fee and need our app's screens to go through their service. Most are made for websites with fixed screens, not an offline app like ours.
- The plan above keeps everything in our hands, free to run, offline-friendly and always current.

## 7. Phases
1. **Videos and the Learn page.** The script format, the recorder, the voice adapter, captions and chapters. The first 8 operations: value gold, a cash purchase, open the day, close the day, give a loan, receive a transfer, take a photo, use a sheet. Then the Learn page and video page, served from the server.
2. **Tours and help.** Tours from the same scripts, a welcome tour per role, the ? menu on each screen, watched and finished ticks.
3. **More.** The rest of the operations (about 25 in all), "What's new" tours for each update, offline downloads, a manager view of who watched what, phone versions, Twi captions, human voice for the flagship videos.

## 8. Who does what
**I can do:** all the code (script format, recorder, Learn page, player, tours, progress, the ? menu); write the walkthrough scripts and narration for each operation; record and assemble every video; re-run them on each update; and the checks that tell us when a screen change breaks one.

**You would:**
- choose the voice (and give an API key if it is a cloud one, or name a staff member to read the lines);
- check each script's wording against how the company really works;
- confirm the demo data looks right;
- decide which operations come first and which need phone versions;
- run the final recording where the better voice can be downloaded, or let me do it if your setup allows.

## 9. Decisions needed
1. Voice: basic, neural offline, cloud (which service), or a person?
2. Where it lives: a new "Learn" item, or one area together with Rules and guides?
3. Welcome tour: start by itself at first sign-in, or only when someone asks?
4. Should managers see who has watched which videos (like the Rules read list)?
5. Phone versions of the videos, or computer only to start?