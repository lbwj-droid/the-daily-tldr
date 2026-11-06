# The Daily TL;DR: history and open threads (24 Oct to 5 Nov 2026)

Written at the end of the first long build session so a new session can pick up without the chat. `CLAUDE.md` holds the current rules; this file holds how they came about and what is still undecided. Git history (`git log --oneline`) has every change.

## Timeline

- **24 Oct**: version 1 built: daily pipeline (Claude picks, rewrites, fact-checks), Google Sheet curation (Today tab), iPhone page, click log. Focus layer added; Campus Watch brief written with Lester (CEC/SIR protests, education, CJP = Cockroach Janta Party).
- **25 Oct**: version 2: twice weekly (Mon/Fri), 07:30 Dubai go-live with `?preview=1`, Inbox and Desk tabs, 10-link cap, Hindi cap 3, videos over 30 min dropped, Sports/Tech/Internet sections off. Lessons: a deleted `date` heading in Today broke live edits (now falls back); GitHub "Re-run jobs" replays old code.
- **26 Oct**: GitHub's schedule missed Monday, so Vercel Cron now starts the build. All YouTube RSS feeds returned 404, so YouTube is read through the Data API. Issue 1 published by hand at 09:05 Dubai, $0.25. Sheet images and plain-text Desk notes fixed.
- **27 Oct**: version 3 (Lester's spec): Lester picks the lead for about 2 months (Claude as backup); Editor's Picks under the lead (usually 4, up to 9); India 2 (general news ranked by the former Campus Watch priorities, `prompts/india.md`, until Lester shifts it); World 2 (major geopolitics, no Israel/Gaza/Lebanon/Iran/Hormuz); Culture off; Campus Watch ended early, pins dropped.
- **28 Oct**: first reader feedback (see below). Peek TV added (29 Oct).
- **30 Oct**: Issue 2. Looked like two leads: Lester's lead (Today tab) replaced Claude's, which moved into India with caps and a big image. Fixed: a replaced lead now leaves the page. Unknown or switched-off sections typed in the Sheet go to Editor's Picks.
- **31 Oct**: NEW label for links added after the build. Lester typed over a Claude link's url instead of hiding it; explained (the url never changes from the Sheet; rows match by id, then url) and cleaned up, including clearing ai_headline so the Style tab does not learn a false rewrite.
- **2 Nov**: Issue 3 had only 5 links: Lester's India/World-tagged Inbox links used up Claude's places. Fixed: they now sit on top of Claude's 2.
- **3 Nov**: Sources tab in the Sheet became the only master list; builds and Check sources write each source's health into it.
- **5 Nov**: Drive uploads folder: Drive image links work as thumbnails (`/api/media`), Google Docs from the folder open as site pages (`/p/<id>`). First test failed because the Google Drive API was not enabled in Cloud project 130820231305 (the-daily-tldr); Lester was enabling it. `/api/media?id=<id>&debug=1` explains failures.

- **5 to 6 Nov**: curation strategy session (exploration mode). 12 options generated; stack chosen with story arcs as the spine. Lester approved a 4-issue pilot of arcs + recap + questions box (6 Nov) to see how much depends on him before adding layers. Notes in the Claude Doc "Daily TL;DR: hyper-curation working notes".

## Reader feedback so far

- 28 Oct: very positive. Most valued: the one-stop format, "everything they need to know in one place".
- Request: at least one must-know AI item per issue. Lester has been teaching them LLM basics from first principles (what they can and cannot rely on) and wants a series of short primers written with Claude.
- Lester planned to discuss further curation ideas from conversations with the niblings in the week of 2 Nov (the reason for the new session).

## Decisions still open

1. **AI slot**: proposed a one-link "AI: Must Know" slot under Editor's Picks (fits the 10-link cap). Unanswered: slot or Desk note; does Claude fill it when Lester has no primer (needs 3 or 4 AI news sources, preferring stories on what AI gets wrong, work/study change and regulation over launches); primers as site pages (now possible via Drive Docs, `/p/<id>`) or Google Docs.
2. **Access control**: the site has no login; anyone with the link sees everything, including `for=<nickname>` links, which are hidden on the page but present in `/data/editions/*.json` and `/api/overrides`. Options offered: per-reader secret keys checked against a Readers tab (recommended; revoke one key, see whose key leaked; about half a day), a shared password, Vercel password protection (paid, price unchecked), email sign-in (needs OAuth setup or a domain). Cheapest partial fix: keep `for` links out of the public data (about an hour). The real stake named: attribution of a political selection to "Uncle Lester" in Dubai. Lester has not chosen.
3. **Peek TV language**: unchecked; tag Hindi in the Sources tab if it is mostly Hindi in Latin script.
4. **Masthead**: still "THE DAILY TL;DR" though issues are twice weekly; undecided.
5. **India brief**: Lester will say when to move off the student-movement priorities.

## Habits that worked

- Every change on a branch, `npm test`, Playwright screenshot at iPhone width, merge only after Lester says "merge".
- Diagnose from the repository (`reports/last-run.json`, `public/data/editions/*.json`) and Lester's debug links; this container cannot reach the live site, YouTube or Google.
- Lester mixes up the Inbox (read only at build time, Mon/Fri about 05:00 Dubai) and the Today tab (live within a minute). Most "it doesn't show" reports come from that; check which tab first.
