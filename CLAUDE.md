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
- **At most 6 links per issue from Fri 13 Nov 2026** (`maxLinks`; 10 before; Lester will say when to return to 10), counting the lead, Lester's Inbox links, pinned links and a primer's "Start here" link. No extra picks (`extraMax` 0) while the cap is 6. **Absolute for Claude (`hardCap`, 9 Nov):** when Lester's links fill the 6, Claude adds nothing, not even the India link or a backup lead, and a new primer's "Start here" debut waits for an issue with room. Only Lester's own links can take an issue past 6; he writes why in that issue's Pilot tab `notes` cell when it is a reason not yet discussed. (Before 13 Nov: Claude always kept at least 1 India link, so a full Inbox could push the total past 10.) World gives way first. Fewer than 6 is normal; empty places are not refilled.
- **Lead: Lester picks it** (Inbox `section=lead`, or `status=lead` in Today) for about two months from 27 Oct 2026. If he hasn't, Claude picks one as a backup and he can replace it from the preview.
- Sections: Notes from the news desk (only if a Desk row exists), recap (every 4th arc issue), lead, Editor's Picks (Lester's Inbox links, usually 4, up to 9), India (Claude, max 2), AI & Society (Claude, max 1, `prompts/ai.md`, from 9 Nov 2026), World (Claude, max 2). Fill order India, AI, World, so World gives way first. Lester's Inbox links tagged `india` or `world` sit at the top of that section on top of Claude's 2 (fixed 2 Nov 2026: before, they used up Claude's places and Issue 3 had only 5 links).
- **India** is general India news ranked by `prompts/india.md` (the former Campus Watch priorities: explainers and movement interviews first), until Lester says to shift. **World** is major geopolitics, leaving out Israel, Gaza, Lebanon, Iran and Hormuz; Lester may swap in his own link there.
- Campus Watch (focus) was ended early on 27 Oct 2026 and its 2 pinned links dropped; its sources AISA, Naman Shrivastava and France 24 moved into the main source list.
- Three Claude Opus 5.5 calls per issue: select, rewrite headlines, fact-check (unsupported rewrites fall back to the original headline). About $0.25 to $0.50 an issue.
- Sources: the Sheet's **Sources** tab is the only master list (from 3 Nov 2026); `config/sources.json` is a copy each build saves, used only if the Sheet is unreadable or the tab is empty. Focus topics: `config/focus.json` and `prompts/focus/*.md`; editorial rules: `prompts/editorial.md`; headline voice: `prompts/voice.md`.
- YouTube is read through the YouTube Data API (`YOUTUBE_API_KEY`); the public channel feeds returned 404 for every channel on 26 Oct 2026 and are only a fallback.

## Lester's Google Sheet (curation)

- **Inbox**: links for the next issue; mandatory. Columns `issue_date, section, url, my_headline, important, for, subscriber, status, thumbnail, arc` (J: optional arc; blank lets Claude tag it, `none` keeps it out). Blank section = Editor's Picks. `section=lead` replaces the lead. `for=<nickname>` shows the link only to that reader. The build writes `used <date>` in status.
- **Desk**: `issue_date, teaser, url, status, note`. The url (any link; a Google Doc from the uploads folder opens as a site page) is optional; without it the teaser shows as plain text. `note` (column E, optional) is a plain explanatory line shown under the teaser. A blank issue_date means the next issue.
- **Today**: one row per published link. Live edits within about a minute: `my_headline`, `status` (`hide`, `lead`, `pin`), `section`, `rank`, `important`, `for`, `thumbnail` (image URL set here shows on any link). `section` accepts a key or a title ("world", "Editor's Picks"); a section that is off or unknown (e.g. "culture & entertainment") goes to Editor's Picks. When Lester's lead replaces Claude's backup lead, the backup leaves the page (give its row a section to keep it). Edits to links no longer in the issue do nothing. A row added here after the build (a link not in the issue) gets a red NEW label until that reader's phone has shown it once (stored in the browser; preview always shows it). Changing the `url` of an existing row does not change the link: hide the old row and add a new one.
- **Sources**: `name, link, role (prefer/neutral/detect/official), language (English/Hindi), tag, status (on/off), notes`; builds and Check sources write `last_checked, items, error`. Read at build time only. Bad rows are skipped and named in the error column and run warnings.
- **Drive uploads** (from 5 Nov 2026): Google Drive folder "TL;DR uploads" (id `16dlAPrON7I_uVI6E3UeFOiegLXbXnfxZ`, in `lib/drive.mjs`), shared with the service account as Viewer; the Google Drive API must be enabled in the Cloud project. A Drive share link of an image in that folder works in any `thumbnail` (Inbox or Today) and is served by `/api/media` (Drive's 1600px copy). A Google Doc link from that folder in `url` (Inbox, Today or Desk) opens as a site page at `/p/<id>` (`api/doc.js`), live within about a minute of edits. Files outside the folder are never served (a Doc outside it redirects to Google Docs). Videos go to YouTube as Unlisted. Inbox has a `thumbnail` column (column I).
- **Arcs** (from 6 Nov 2026, story arcs pilot): `arc, side, status (active/watch/closed), so_far, notes`; builds write `links, clicks, last_link` (F to H); I `primer`, J `primer_headline`. Builds rewrite the Arcs heading row. `so_far` edits show from the next issue (each issue keeps the text it was built with). Inbox column J and Today columns N `arc` and O `note` (Lester's reason for an edit, read as feedback). **Questions** tab: readers' "? Ask" questions. **Pilot** tab: one row per issue, Lester types `minutes`. See README "Story arcs pilot".
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
- Lester's own page `?r=lester` (settings `editorReaders`, from 9 Nov 2026) shows every reader's `for` links, labelled "For <name>"; the preview still shows the next issue before 07:30. His clicks log as reader `lester`.
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

## Open items (as of 9 Nov 2026)

Full background, timeline, reader feedback and the options already offered: `docs/history.md`. Read it before a strategy discussion. Strategy notes (options, mechanics, pilot): Claude Doc "Daily TL;DR: hyper-curation working notes", https://claude.ai/artifact/DbjSWwtZUEcGT8JG6s437a.

**Readers and goal (6 Nov).** Goal: social confidence on 3 to 4 Indian and 3 to 4 global stories, so they can hold their own in person or online; success in 6 months = they book calls with Lester on topics they choose and send him links. Raph 22 (writes on an online novel platform, bakes; the most curious, the one the others ask), Bethia 24 (fashion stylist building a brand), Mariana 19 (psychology student, teaches out-of-school children 3 evenings a week), Giovanni (oldest, film and TV; inactive until his exams end). Shared way in: empathy for peers denied fair education and jobs. Lester's budget: 30 minutes per issue, 10 minutes a day.

**Current setup (live from Fri 13 Nov 2026, issue 6 = the project's new starting point, `arcs.startIssue`).**
- 7 arcs (seeded 9 Nov from `config/arcs-seed.json`; the Sheet is now the master). Blocks of about 2 weeks, primers first, since readers start cold. Block 1, issues 6 to 9 (13 to 23 Nov): US populism: DSA vs MAGA, Gen Z protests and education, Youth fighting back, plus AI and society always. Block 2 from Fri 27 Nov: Youth jobs worldwide, Big business and power, Inequality and your career. Lester sets `active`/`watch` in the Arcs tab (block 2 arcs set to `watch`, Lester confirmed 9 Nov).
- First recap: issue 9, Mon 23 Nov (every 4th issue from issue 6). The recap closes block 1; then review the pilot: Lester's minutes (Pilot tab), clicks on arc links vs primers vs other links, questions (`arcReport` in `reports/last-run.json`).
- Cap 6, absolute for Claude (`hardCap`), no extra picks. Each build feeds Lester's edits of the last 4 issues to the select step (`scripts/lib/feedback.mjs`): hides with notes (including his own links), moves, promotions, re-tags, important marks, hand-added links, his links, clicks. Arcs prompt: prefer a comprehensive piece tying arcs together, else the most potent single-arc story; big off-arc stories by judgement (about 2).
- AI & Society section (Claude, 1 link, `prompts/ai.md`): resolves the old "AI slot" proposal.
- Sources added by Lester 9 Nov, all working: The Deep View, MIT Technology Review, The India Forum (page links), Rest of World, Jacobin, IndiaSpend (feeds).

**Primers (in progress).** Arcs I `primer` (link) and J `primer_headline`: shown as "Start here" at the top of the arc's section in the first issue that has it (counts towards the cap; waits if there is no room), then behind the arc label under "The story so far". First-shown dates: `public/data/primers.json`. Primer clicks are counted apart (`arcReport.clicks.onPrimers`). Process: Claude finds candidates and summarises them in chat; Lester approves, then pastes them into the Arcs tab. Standard (draft, agreed): explains why it matters and what is at stake, still accurate in 3 months, starts from zero, video 20 minutes or less (12 ideal) or a 10-minute read, within the political line, at least one sourced number, names the other side's argument; one primer per arc per block. Reviewed 9 Nov: PBS NewsHour "What to know about India's youth-led Gen Z 'cockroach' protests" (24 Jul 2026; strong for Gen Z protests and education; covers exam leaks, not rural schooling; mentions student suicides) and Down To Earth "Moment or movement?" (11 Jun 2026; opinion, thin; not a primer). Neither shown; Lester rejected PBS (9 Nov). Reviewed 9 Nov (later): Brookings "Democratic socialist candidates show gains but limited reach in 2026" (19 Aug 2026; centrist; pre-midterm, so dated by the 3 Nov results; explains DSA but not MAGA; recommended against, Lester to confirm). **One primer per issue** (Lester, 9 Nov): planned order Gen Z protests (issue 6), DSA vs MAGA (7), Youth fighting back (8); issue 9 is the recap. Fact for Youth fighting back: Education Minister Dharmendra Pradhan resigned on 25 Jul 2026 over the NEET-UG 2026 leak after weeks of CJP protests at Jantar Mantar (confirmed by several outlets, e.g. ThePrint, Open). Still needed: an ASER-based rural education primer, a DSA vs MAGA video explainer, Youth fighting back. Candidates already found (unvetted): KUOW and The Nation and FPRI on populism, AllSides on DSA, PARI "Gen Z at Jantar Mantar", Mooknayak on ASER 2023, Dhruv Rathee "India Needs Jobs!" (block 2). Lester is also looking.

**Cloud environment.** Personal environment "the-daily-tldr" (created 9 Nov) allows pbs.org, www.pbs.org, www.downtoearth.org.in and www.brookings.edu (added 9 Nov) on top of package managers; start new sessions in it. Each new primer site needs its host added (Claude proposes it; Lester approves). YouTube pages and transcripts are not reachable: Lester pastes transcripts ("...more", then "Show transcript").

**Other open items.**
- Inbox headings fix (agreed 8 Nov, not built): have each build write the Inbox heading row as it does for Today and Arcs. Lester typed I1 and J1 by hand.
- Lead videos (idea, 8 Nov, not a plan): 20-second vertical typographic videos for a suitable lead (animated HTML captured with Playwright, ffmpeg); possible ElevenLabs narration in Lester's cloned voice; he won't be on camera.
- Lester's YouTube channel for his own videos (9 Nov): videos Unlisted; profile image = the TL;DR logo (white TL;DR, red bar on #111, as `public/icons/icon-512.png`; JPEGs at 800 and 1600 px were sent to him).
- Access control: no login; `for` links are readable in the public data files. Options offered (per-reader keys recommended); Lester undecided.
- Later layers wait for the pilot review: ways in per reader (Bethia: garment workers, tariffs; Raph: food prices, publishing, AI and authorship; Mariana: out-of-school children, exam leaks, student mental health; Giovanni: film and TV industry, censorship, soft power), planned pairs, hold-your-own cards, "their feed, explained".
- Drive API was being enabled on 5 Nov; confirm with `/api/media?id=1Yk6E9i3gYtCIPSZaaXNxmqV_Lm9l3GOb&debug=1` showing `"served": "yes…"`.
- Desk: one note per issue for now. Peek TV language unchecked. India brief (`prompts/india.md`) stays until Lester shifts it. Masthead name undecided.
- Working mode: Lester used [[EXPLORE]] in the 5 to 9 Nov session; a mode ends with the conversation, so a new session is in rigor mode unless he says otherwise.
