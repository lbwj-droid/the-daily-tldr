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
- Sections: Notes from the news desk (only if a Desk row exists), lead, Editor's Picks (Lester's Inbox links, usually 4, up to 9), India (Claude, max 2), World (Claude, max 2).
- **India** is general India news ranked by `prompts/india.md` (the former Campus Watch priorities: explainers and movement interviews first), until Lester says to shift. **World** is major geopolitics, leaving out Israel, Gaza, Lebanon, Iran and Hormuz; Lester may swap in his own link there.
- Campus Watch (focus) was ended early on 27 Oct 2026 and its 2 pinned links dropped; its sources AISA, Naman Shrivastava and France 24 moved into `config/sources.json`.
- Three Claude Opus 5.5 calls per issue: select, rewrite headlines, fact-check (unsupported rewrites fall back to the original headline). About $0.25 to $0.50 an issue.
- Sources: `config/sources.json`; focus topics: `config/focus.json` and `prompts/focus/*.md`; editorial rules: `prompts/editorial.md`; headline voice: `prompts/voice.md`.
- YouTube is read through the YouTube Data API (`YOUTUBE_API_KEY`); the public channel feeds returned 404 for every channel on 26 Oct 2026 and are only a fallback.

## Lester's Google Sheet (curation)

- **Inbox**: links for the next issue; mandatory. Columns `issue_date, section, url, my_headline, important, for, subscriber, status`. Blank section = Editor's Picks. `section=lead` replaces the lead. `for=<nickname>` shows the link only to that reader. The build writes `used <date>` in status.
- **Desk**: `issue_date, teaser, url, status`. The url (a Google Doc shared "anyone with the link") is optional; without it the teaser shows as plain text. A blank issue_date means the next issue.
- **Today**: one row per published link. Live edits within about a minute: `my_headline`, `status` (`hide`, `lead`, `pin`), `section`, `rank`, `important`, `for`, `thumbnail` (image URL; shows on the lead and the first link of each section). Edits to links no longer in the issue do nothing.
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

## Open items (as of 26 Oct 2026)

- Reminder scheduled for Wed 28 Oct, 9am Dubai: review Monday's issue (run report, Campus Watch coverage, Hindi count, cost) and ask for the niblings' feedback.
- Lester will say when the India section should shift away from the student-movement priorities (`prompts/india.md`).
- Masthead still says "THE DAILY TL;DR" although issues are twice weekly; Lester has not decided whether to rename it.
