#!/usr/bin/env python3
"""Parse a roster/eligibility PDF into docs/data/pdf_lookup.json.

Usage:
  PDF_URL="https://example.com/file.pdf" python scripts/parse_pdf.py

Optional env:
  OUTPUT_PATH=docs/data/pdf_lookup.json

The parser intentionally does exact normalized-name indexing only. It extracts likely
person names from PDF text and stores each source line as detail for inspection.
Tune NAME_LINE_RE if the target PDF has a known table format.
"""
from __future__ import annotations

import json
import os
import re
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import Request, urlopen

try:
    from pypdf import PdfReader
except ImportError:  # pragma: no cover
    print("Missing dependency: pypdf. Install with: python -m pip install -r requirements.txt", file=sys.stderr)
    raise

PDF_URL = os.environ.get("PDF_URL")
OUTPUT_PATH = Path(os.environ.get("OUTPUT_PATH", "docs/data/pdf_lookup.json"))

# Conservative: two capitalized words, optional middle/compound names.
NAME_LINE_RE = re.compile(r"\b([A-Z][A-Za-z'\-]+(?:\s+[A-Z][A-Za-z'\-]+){1,3})\b")
SKIP_WORDS = {
    "State Wars", "Page", "Team", "Division", "Roster", "Player", "Coach", "Birth Date",
    "First Name", "Last Name", "USA Hockey", "Hockey Shift", "Digital Shift",
}


def fetch_pdf(url: str) -> Path:
    req = Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urlopen(req, timeout=45) as response:
        data = response.read()
    if not data.startswith(b"%PDF"):
        raise ValueError("Downloaded file does not look like a PDF.")
    fd, tmp = tempfile.mkstemp(prefix="statewars-lookup-", suffix=".pdf")
    with os.fdopen(fd, "wb") as f:
        f.write(data)
    return Path(tmp)


def extract_rows(pdf_path: Path) -> list[dict]:
    reader = PdfReader(str(pdf_path))
    seen: set[str] = set()
    rows: list[dict] = []
    for page_num, page in enumerate(reader.pages, start=1):
        text = page.extract_text() or ""
        for raw_line in text.splitlines():
            line = " ".join(raw_line.split())
            if not line:
                continue
            for match in NAME_LINE_RE.finditer(line):
                name = match.group(1).strip()
                if name in SKIP_WORDS or any(skip in name for skip in SKIP_WORDS):
                    continue
                key = re.sub(r"[^a-z0-9]+", " ", name.lower()).strip()
                if not key or key in seen:
                    continue
                seen.add(key)
                rows.append({"name": name, "detail": f"PDF page {page_num}: {line}"})
    return rows


def main() -> int:
    if not PDF_URL:
        print("PDF_URL is required.", file=sys.stderr)
        return 2
    pdf_path = fetch_pdf(PDF_URL)
    try:
        players = extract_rows(pdf_path)
    finally:
        pdf_path.unlink(missing_ok=True)
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "meta": {
            "source": PDF_URL,
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "count": len(players),
            "matching": "exact normalized names only",
        },
        "players": players,
    }
    OUTPUT_PATH.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n")
    print(f"Wrote {len(players)} names to {OUTPUT_PATH}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
