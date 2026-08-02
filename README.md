# State Wars Roster PDF Lookup

Static GitHub Pages app for deterministic StateWars roster vs. RHA member-PDF lookup.

## What it does

- Logs into the public DigitalShift/HockeyShift website API from the browser.
- Loads State Wars tournaments/divisions from deterministic HockeyShift/DigitalShift API filters.
- Matches State Wars events from `https://www.statewarshockey.com/events` via the public Events API when names line up.
- Lets the user pick tournament + division + team from dropdowns.
- Accepts pasted State Wars/HockeyShift stats URLs, e.g. `/stats#/584/team/685597/roster` or `?tournament_id=3620`.
- Fetches the selected team's live roster.
- Matches roster names against `docs/data/pdf_lookup.json` generated from the current RHA member-list PDF.
- Uses exact normalized first+last matching for `matched`.
- Flags same-last + same-first-initial rows as `review` for nickname/legal-name drift.
- Uses no AI/fuzzy model in the browser.

## Default demo

The app defaults to Pennsylvania — 2026 | State Wars 22 | 2009 AAA/AA:

```text
https://www.statewarshockey.com/stats#/584/team/685597/roster
```

## Tournament selection

The default is still 2026 State Wars 22, but the app is no longer locked to one seeded team page. It loads tournament/division metadata through deterministic DigitalShift filters, annotates matching State Wars event dates when the Events API name matches, and can resolve a pasted stats URL such as:

```text
https://www.statewarshockey.com/stats#/584/team/685597/roster
https://www.statewarshockey.com/stats#/584/schedule?tournament_id=3620
```

## Local test

```bash
python3 -m http.server 8099 --directory docs
```

Open:

```text
http://localhost:8099
```

## PDF lookup refresh

Manual refresh:

```bash
python -m pip install -r requirements.txt
python scripts/parse_pdf.py
```

By default, `scripts/parse_pdf.py` discovers the current PDF linked from:

```text
https://www.rollerhockeyalliance.com/player-member-list
```

Optional overrides:

```bash
PDF_URL="https://example.com/RHA-current.pdf" python scripts/parse_pdf.py
RHA_PAGE_URL="https://www.rollerhockeyalliance.com/player-member-list" python scripts/parse_pdf.py
OUTPUT_PATH="docs/data/pdf_lookup.json" python scripts/parse_pdf.py
```

The GitHub Actions workflow runs daily and commits the refreshed `docs/data/pdf_lookup.json`.

## Notes

GitHub Pages has no backend runtime. The browser can call HockeyShift because that API allows CORS. The RHA PDF does not reliably allow browser CORS, so PDF parsing happens ahead of time via workflow/manual script and the app reads the generated JSON.
