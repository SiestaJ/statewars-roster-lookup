#!/usr/bin/env python3
"""Parse the current RHA member-list PDF into docs/data/pdf_lookup.json.

Usage:
  python scripts/parse_pdf.py

Optional env:
  PDF_URL=https://example.com/current.pdf
  RHA_PAGE_URL=https://www.rollerhockeyalliance.com/player-member-list
  OUTPUT_PATH=docs/data/pdf_lookup.json

The RHA PDF is formatted as Last / First / State rows. The static app indexes
`First Last` for exact roster matching and keeps last-name candidates for review.
"""
from __future__ import annotations

import json
import os
import re
import sys
import tempfile
from datetime import datetime, timezone
from html import unescape
from pathlib import Path
from urllib.request import Request, urlopen

try:
    from pypdf import PdfReader
except ImportError:  # pragma: no cover
    print("Missing dependency: pypdf. Install with: python -m pip install -r requirements.txt", file=sys.stderr)
    raise

DEFAULT_RHA_PAGE_URL = "https://www.rollerhockeyalliance.com/player-member-list"
PDF_URL = os.environ.get("PDF_URL")
RHA_PAGE_URL = os.environ.get("RHA_PAGE_URL", DEFAULT_RHA_PAGE_URL)
OUTPUT_PATH = Path(os.environ.get("OUTPUT_PATH", "docs/data/pdf_lookup.json"))

STATE_NAMES = {
    "Alabama", "Alaska", "Arizona", "Arkansas", "California", "Colorado", "Connecticut", "Delaware",
    "Florida", "Georgia", "Hawaii", "Idaho", "Illinois", "Indiana", "Iowa", "Kansas", "Kentucky",
    "Louisiana", "Maine", "Maryland", "Massachusetts", "Michigan", "Minnesota", "Mississippi", "Missouri",
    "Montana", "Nebraska", "Nevada", "New Hampshire", "New Jersey", "New Mexico", "New York",
    "North Carolina", "North Dakota", "Ohio", "Oklahoma", "Oregon", "Pennsylvania", "Rhode Island",
    "South Carolina", "South Dakota", "Tennessee", "Texas", "Utah", "Vermont", "Virginia", "Washington",
    "West Virginia", "Wisconsin", "Wyoming", "Other",
}


def fetch_text(url: str) -> str:
    req = Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urlopen(req, timeout=45) as response:
        return response.read().decode("utf-8", errors="ignore")


def discover_pdf_url(page_url: str) -> str:
    page = fetch_text(page_url)
    recent = re.search(r'<a[^>]+href="([^"]+\.pdf[^"]*)"[^>]*>\s*Click Here for Recent List\s*</a>', page, re.I)
    if recent:
        return unescape(recent.group(1))
    pdfs = re.findall(r'https?://[^"\']+\.pdf[^"\']*', page, re.I)
    if not pdfs:
        raise ValueError(f"No PDF link found on {page_url}")
    return unescape(pdfs[0])


def fetch_pdf(url: str) -> Path:
    req = Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urlopen(req, timeout=60) as response:
        data = response.read()
    if not data.startswith(b"%PDF"):
        raise ValueError("Downloaded file does not look like a PDF.")
    fd, tmp = tempfile.mkstemp(prefix="rha-member-list-", suffix=".pdf")
    with os.fdopen(fd, "wb") as f:
        f.write(data)
    return Path(tmp)


def split_rha_row(line: str) -> tuple[str, str, str] | None:
    # pdftotext/pypdf extraction preserves the table mostly as repeated whitespace:
    # Horowitz     Ajay           Pennsylvania
    parts = re.split(r"\s{2,}", line.strip())
    if len(parts) >= 3:
        last = parts[0].strip()
        first = parts[1].strip()
        state = " ".join(parts[2:]).strip()
        if is_person_name(first) and is_person_name(last):
            return last, first, state
    return None


def is_person_name(value: str) -> bool:
    if not re.search(r"[A-Za-z]", value):
        return False
    if value.lower() in {"first", "last", "player", "coach", "state"}:
        return False
    return True


def extract_rows(pdf_path: Path) -> list[dict]:
    reader = PdfReader(str(pdf_path))
    seen: set[tuple[str, str, str]] = set()
    rows: list[dict] = []
    for page_num, page in enumerate(reader.pages, start=1):
        text = page.extract_text(extraction_mode="layout") or page.extract_text() or ""
        for raw_line in text.splitlines():
            line = " ".join(raw_line.rstrip().split()) if "  " not in raw_line else raw_line.strip()
            parsed = split_rha_row(line)
            if not parsed:
                continue
            last, first, state = parsed
            key = (re.sub(r"[^a-z0-9]", "", first.lower()), re.sub(r"[^a-z0-9]", "", last.lower()), state.lower())
            if key in seen:
                continue
            seen.add(key)
            rows.append({
                "name": f"{first} {last}",
                "first": first,
                "last": last,
                "state": state,
                "detail": f"PDF page {page_num}: {last}, {first} — {state}",
                "raw": raw_line.strip(),
            })
    return rows


def main() -> int:
    pdf_url = PDF_URL or discover_pdf_url(RHA_PAGE_URL)
    pdf_path = fetch_pdf(pdf_url)
    try:
        players = extract_rows(pdf_path)
    finally:
        pdf_path.unlink(missing_ok=True)
    if len(players) < 1000:
        raise RuntimeError(f"Parsed only {len(players)} rows; PDF format may have changed.")
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "meta": {
            "source": pdf_url,
            "rha_page_url": RHA_PAGE_URL,
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "count": len(players),
            "matching": "exact normalized first+last; same-last/first-initial review in app",
        },
        "players": players,
    }
    OUTPUT_PATH.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n")
    print(f"Wrote {len(players)} RHA rows to {OUTPUT_PATH}")
    print(f"Source PDF: {pdf_url}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
