#!/usr/bin/env python3
"""Static Pages quality gate; no network or build toolchain required."""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
index = (ROOT / "index.html").read_text(encoding="utf-8")

required = [
    'rel="manifest"',
    'id="playToggleBtn"',
    'id="dockPlayBtn"',
    'id="liveBadge" aria-live="polite"',
]
missing = [item for item in required if item not in index]
if missing:
    raise SystemExit(f"missing index contracts: {missing}")
if "navigator.serviceWorker.register" not in (ROOT / "scripts" / "on-demand.js").read_text(encoding="utf-8"):
    raise SystemExit("missing service worker registration")

for relative in ["manifest.webmanifest", "sw.js", "assets/three-quarter-mark.svg"]:
    if not (ROOT / relative).is_file():
        raise SystemExit(f"missing Pages asset: {relative}")

manifest = json.loads((ROOT / "manifest.webmanifest").read_text(encoding="utf-8"))
if manifest.get("display") != "standalone" or not manifest.get("icons"):
    raise SystemExit("manifest is not installable")

for name, key, minimum in (("audiobooks.json", "books", 20), ("podcasts.json", "shows", 20)):
    payload = json.loads((ROOT / "data" / name).read_text(encoding="utf-8"))
    entries = payload.get(key) if isinstance(payload, dict) else None
    if not isinstance(entries, list) or len(entries) < minimum:
        raise SystemExit(f"{name} catalog unexpectedly small: {len(entries) if isinstance(entries, list) else 'not-list'}")

feeds = json.loads((ROOT / "data" / "podcast_feeds.json").read_text(encoding="utf-8"))
if any(item.get("id") == "bowuzhi" for item in feeds):
    raise SystemExit("removed broken bowuzhi feed is still present")

local_refs = set(re.findall(r'(?:src|href)="((?:scripts|styles|assets)/[^"?]+)', index))
missing_refs = sorted(ref for ref in local_refs if not (ROOT / ref).is_file())
if missing_refs:
    raise SystemExit(f"missing local index assets: {missing_refs}")

book_count = len(json.loads((ROOT / "data" / "audiobooks.json").read_text(encoding="utf-8")).get("books", []))
print(f"PASS static Pages gate: {len(feeds)} podcast feeds, {book_count} books")
