# The Daily TL;DR: project memory

Read this first in every session. The README explains how the code works; this file records who it is for, what was decided and why, and what has gone wrong before.

## What it is

A Drudge-style link board that Lester (the editor, Dubai) runs for his five niblings, aged 19 to 25, in India. It replaces six months of hand-picked WhatsApp links, so it must keep that personal, calibrated feel. Success = they open every issue and bring stories up at family dinner ("talkability").

- Site: https://the-daily-tldr.vercel.app (readers get `?r=<nickname>` links, added to the iPhone home screen)
- Preview before release: https://the-daily-tldr.vercel.app/?preview=1
- Build brief and decision log (Claude Doc): https://claude.ai/artifact/S6g9mcKaNm1dW4cnjCDYJe
- Repository: lbwj-droid/the-daily-tldr (GitHub account lbwj-droid is Lester's)

## How an issue is made (current, version 3 from 27 Oct 2026)

- **Monday and Friday.** Vercel Cron (`api/cron-issue.js`, 01:00 UTC hour) starts the GitHub workflow `daily.yml` (named "Issue") with `if_missing=true`. GitHub's own cron (05:37 and 06:37 Dubai) is only a backup. Automatic starts skip if the issue exists or if it is no longer Mon/Fri in Dubai. A manual "Run workflow" always rebuilds.
- Issues are built early and shown to readers from **07:30 Dubai** (`publish_at`).
- **At most 10 links per issue**, counting the lead, Lester's Inbox links and pinned links. Claude fills the rest, but always keeps at least 1 India link, so a very full Inbox can push the total past 10. World gives way first. Fewer than 10 is normal; empty places are not refilled.
- **Lead: Lester picks it** (Inbox `section=lead`, or `status=lead` in Today) for about two months from 27 Oct 2026. If he hasn't, Claude picks one as a backup and he can replace it from the preview.
- Sections: Notes from the news desk (only if a Desk row exists), recap (every 4th arc issue), lead, Editor's Picks (Lester's Inbox links, usually 4, up to 9), India (Claude, max 2), AI & Society (Claude, max 1, `prompts/ai.md`, from 9 Nov 2026), World (Claude, max 2). Fill order India, AI, World, so World gives way first. Lester's Inbox links tagged `india` or `world` sit at the top of that section on top of Claude's 2 (fixed 2 Nov 2026: before, they used up Claude's places and Issue 3 had only 5 links).
- **India** is general India news ranked by `prompts/india.md` (the former Campus Watch priorities: explainers and movement interviews first), until Lester says to shift. **World** is major geopolitics, leaving out Israel, Gaza, Lebanon, Iran and Hormuz; Lester may swap in his own link there.
- Campus Watch (focus) was ended early on 27 Oct 2026 and its 2 pinned links dropped; its sources AISA, Naman Shrivastava and France 24 moved into the main source list.
- Three Claude Opus 5.5 calls per issue: select, rewrite headlines, fact-check (unsupported rewrites fall back to the original headline). About $0.25 to $0.50 an issue.
- Sources: the Sheet's **Sources** tab is the only master list (from 3 Nov 2026); `config/sources.json` is a copy each build saves, used only if the Sheet is unreadable or the tab is empty. Focus topics: `config/focus.json` and `prompts/focus/*.md`; editorial rules: `prompts/editorial.md`; headline voice: `prompts/voice.md`.
- YouTube is read through the YouTube Data API (`YOUTUBE_API_KEY`); the public channel feeds returned 404 for every channel on 26 Oct 2026 and are only a fallback.

## Lester's Google Sheet (curation)

- **Inbox**: links for the next issue; mandatory. Columns `issue_date, section, url, my_headline, important, for, subscriber, status, thumbnail`. Blank section = Editor's Picks. `section=lead` replaces the lead. `for=<nickname>` shows the link only to that reader. The build writes `used <date>` in status.
- **Desk**: `issue_date, teaser, url, status, note`. The url (any link; a Google Doc from the uploads folder opens as a site page) is optional; without it the teaser shows as plain text. `note` (column E, optional) is a plain explanatory line shown under the teaser. A blank issue_date means the next issue.
- **Today**: one row per published link. Live edits within about a minute: `my_headline`, `status` (`hide`, `lead`, `pin`), `section`, `rank`, `important`, `for`, `thumbnail` (image URL set here shows on any link). `section` accepts a key or a title ("world", "Editor's Picks"); a section that is off or unknown (e.g. "culture & entertainment") goes to Editor's Picks. When Lester's lead replaces Claude's backup lead, the backup leaves the page (give its row a section to keep it). Edits to links no longer in the issue do nothing. A row added here after the build (a link not in the issue) gets a red NEW label until that reader's phone has shown it once (stored in the browser; preview always shows it). Changing the `url` of an existing row does not change the link: hide the old row and add a new one.
- **Sources**: `name, link, role (prefer/neutral/detect/official), language (English/Hindi), tag, status (on/off), notes`; builds and Check sources write `last_checked, items, error`. Read at build time only. Bad rows are skipped and named in the error column and run warnings.
- **Drive uploads** (from 5 Nov 2026): Google Drive folder "TL;DR uploads" (id `16dlAPrON7I_uVI6E3UeFOiegLXbXnfxZ`, in `lib/drive.mjs`), shared with the service account as Viewer; the Google Drive API must be enabled in the Cloud project. A Drive share link of an image in that folder works in any `thumbnail` (Inbox or Today) and is served by `/api/media` (Drive's 1600px copy). A Google Doc link from that folder in `url` (Inbox, Today or Desk) opens as a site page at `/p/<id>` (`api/doc.js`), live within about a minute of edits. Files outside the folder are never served (a Doc outside it redirects to Google Docs). Videos go to YouTube as Unlisted. Inbox has a `thumbnail` column (column I).
- **Arcs** (from 6 Nov 2026, story arcs pilot): `arc, side, status (active/watch/closed), so_far, notes`; builds write `links, clicks, last_link`. Inbox column J and Today column N are `arc`. **Questions** tab: readers' "? Ask" questions. **Pilot** tab: one row per issue, Lester types `minutes`. See README "Story arcs pilot".
- Style tab collects Lester's headline rewrites as examples for Claude; Clicks tab logs reader clicks.

## Editorial decisions (do not change without asking Lester)

- Political line: India favours reporting independent of, and critical of, the BJP establishment; mainstream Indian outlets ("detect" role) are used to spot stories, never linked for politics. Global: anti-establishment.
- Excluded: partisan rage-bait (judged per item, any side), graphic violence, explicit sexual-crime detail (women's-safety justice stories stay), suicide coverage except prevention/solutions (adds the Tele-MANAS 14416 helpline), **all LGBTQ+ stories until Lester sets a narrower rule**.
- At most **3 Hindi items** per issue: Dhruv Rathee and Ravish Kumar are tagged Hindi, plus any Hindi-script title. Lester's own links are exempt.
- YouTube videos over 30 minutes are dropped; prefer 20 minutes or less.
- "CJP" always means the **Cockroach Janta Party** (spokespersons Abhijeet Dipke, Saurav Das, Ashutosh Ranka), never Citizens for Justice and Peace.
- Sports, Tech & Money and Internet & Style sections are off for 6 months from Oct 2026; Culture & Entertainment is off from 27 Oct 2026 until Lester turns it back on. He covers them by hand through the Inbox.
- Israel & Hormuz Watch focus is built but stays **off**; Lester covers it by hand.
- Paywalled newsletter links: Lester uses gift/share links; `subscriber=yes` shows a [subscriber] tag.
- Readers are told clicks are counted (footer). The footer names "Uncle Lester"; he lives in Dubai, so leave political framing to him.

## Secrets and settings

- GitHub Actions secrets: `ANTHROPIC_API_KEY`, `SHEET_ID`, `GOOGLE_SA_KEY`, `YOUTUBE_API_KEY`.
- Vercel environment variables: `SHEET_ID`, `GOOGLE_SA_KEY`, `GH_DISPATCH_TOKEN` (fine-grained GitHub token, Actions read/write on this repo only). Vercel needs a redeploy to pick up a new variable.
- Google Cloud project `the-daily-tldr`: Sheets API (service account `tldr-bot`) and YouTube Data API v3 key.

## Diagnosing problems (lessons already learned)

- **Did the issue publish?** `git log origin/main` shows an "Issue YYYY-MM-DD" commit; `reports/last-run.json` has feeds, picks, fact-check rejections, budget and cost.
- **Feeds**: Actions → Check sources (free, no Claude, publishes nothing) prints a table of every source.
- **Sheet edits not showing**: open `/api/overrides?date=YYYY-MM-DD&debug=1`. `datesSeen` all "(blank)" meant the `date` heading in row 1 of Today had been deleted (26 Oct); blank headings now fall back to the standard column, and every build rewrites the Today heading row.
- **GitHub "Re-run jobs" replays the original run's old code.** For a fresh build use "Run workflow".
- **Two builds on one day replace stories**, orphaning Lester's edits on dropped links.
- **GitHub's schedule ran 4.5 hours late (25 Oct)** and missed Monday 26 Oct entirely; hence the Vercel trigger.
- This Claude Code container cannot reach the live site, YouTube, news sites or GitHub Actions APIs; ask Lester for screenshots or the debug links, and read results from the repository.

## Working with Lester

- Strategist; wants evidence status stated (sourced with link, recall, inference), no fabricated sources, specific caveats, and the disconfirming case. Concise, plain English, no em dashes.
- Not a developer: give click-by-click steps for GitHub, Vercel and Google Cloud, and say when menu names are from memory.
- Workflow: build on a branch, run `npm test` (all tests must pass), check visually with Playwright when the page changes, then merge to `main` once Lester has approved the change. Never commit secrets.
- Ask before anything irreversible or that changes what readers see in a way he hasn't approved.

## Open items (as of 5 Nov 2026)

Full background, timeline, reader feedback and the options already offered: `docs/history.md`. Read it before a strategy discussion.

- Google Drive API was being enabled on 5 Nov (Cloud project 130820231305); confirm with `/api/media?id=1Yk6E9i3gYtCIPSZaaXNxmqV_Lm9l3GOb&debug=1` showing `"served": "yes…"`.
- AI slot and primers: proposal made (one-link slot under Editor's Picks; primers as Drive Docs pages); Lester's three answers pending.
- Access control: no login yet; `for` links are readable in the public data files. Options offered (per-reader keys recommended); Lester undecided.
- **Curation strategy (6 Nov):** goal is social confidence on 3 to 4 Indian and 3 to 4 global stories; success = niblings book calls on topics and send links. Notes: Claude Doc https://claude.ai/artifact/DbjSWwtZUEcGT8JG6s437a. Readers: Raph 22 (writing, baking; the one the others ask), Bethia 24 (fashion brand), Mariana 19 (psychology, teaches out-of-school children), Giovanni (oldest, film; inactive until his exams end). Lester's budget: 30 min per issue, 10 min a day.
- **Pilot approved 6 Nov:** story arcs with the fortnightly recap, plus the questions box, for 4 issues; track Lester's minutes, clicks on arc vs other links, and questions. Merged 6 Nov. Lester's 7 arcs (6 Nov) are in `config/arcs-seed.json`; the first build with an empty Arcs tab (Mon 9 Nov, issue 5) writes them into the Sheet, after which the Sheet is the master. First recap: issue 8 (Fri 20 Nov). The so_far lines are Claude's drafts of Lester's briefs: he checks them in the Sheet. AI and economy sources were suggested to Lester (6 Nov), not yet added. Later layers (ways in per reader, pairs, hold-your-own cards, feed) wait for the pilot review. Note: `for=` links count towards the 10-link cap.
- **6 Nov follow-up (merged 8 Nov, live from Mon 9 Nov):** arcs overlap: prefer a comprehensive piece tying arcs together, else the most potent single-arc story; off-arc big stories by judgement (about 2 an issue); up to 2 extra must-not-miss picks beyond 10 (`extraMax`), marked "Extra pick" in preview; each build feeds Lester's edits of the last 4 issues to the select step (`scripts/lib/feedback.mjs`); Today column O `note` for his reasons.
- Desk: one note per issue for now (5 Nov decision); Lester may want 2 or 3 links in the box later.
- Peek TV language unchecked. India brief stays until Lester shifts it. Masthead name undecided.
- **Inbox headings fix (agreed 8 Nov, not built):** builds rewrite only the Today heading row, so Inbox columns added later (`thumbnail` in I, `arc` in J) never got headings in Lester's Sheet. It still worked, because blank headings fall back to the standard order (`lib/sheets.mjs` normaliseRows). Fix: have each build write the Inbox heading row (`TABS.Inbox`) as it does for Today, and warn if an existing heading differs. Lester was asked on 8 Nov to type I1 `thumbnail` and J1 `arc` by hand. Do this after the video thread.
- **Lead videos (idea, 8 Nov, not a plan yet):** 20-second vertical typographic videos for a lead that suits it, shown on the site above its headline, to support the headline and build curiosity without telling the story. Made as an animated HTML page, captured frame by frame with Playwright, joined with ffmpeg (first test: Paraguay story from 6 Nov). Possible routine: Lester picks the lead in Inbox the evening before (Sun/Thu), storyboard and edits in chat, MP4 into the Drive uploads folder; a Sheet `video` column only if it sticks. Later: his voice cloned with ElevenLabs as narration. He doesn't want to be on camera.
