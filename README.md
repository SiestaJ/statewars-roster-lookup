# State Wars Roster PDF Lookup

Static GitHub Pages app for deterministic roster-vs-PDF lookup.

## What it does

- Logs into the public DigitalShift website API from the browser.
- Loads the current State Wars team/division list from a seed team page.
- Lets the user pick division + team.
- Fetches that team's live roster.
- Matches roster names against `docs/data/pdf_lookup.json`.
- Uses exact normalized-name matching only. No AI. No fuzzy logic.

## Live app

After GitHub Pages is enabled, the app is served from `/docs`.

## PDF lookup refresh

Set a repository variable or secret named `PDF_URL`, then run the workflow:

```text
Refresh parsed PDF lookup
```

The workflow runs `scripts/parse_pdf.py`, writes `docs/data/pdf_lookup.json`, and commits the update.

## Local test

```bash
python3 -m http.server 8099 --directory docs
```

Open:

```text
http://localhost:8099
```

## Notes

GitHub Pages has no runtime secrets. This version only uses the public website API ticket flow in the browser and a pre-generated public PDF lookup JSON.
