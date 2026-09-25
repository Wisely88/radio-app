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
if "live/4915/64k.mp3" in index or "live/4936/64k.mp3" not in index:
    raise SystemExit("Jiangsu music station source is not pinned to the verified PlayFM897 stream")

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
required_horror_feeds = {"minjian-ghost-stories", "yeelok-spirit-special"}
if not required_horror_feeds.issubset({item.get("id") for item in feeds}):
    raise SystemExit("Chinese horror podcast feeds are incomplete")

books = json.loads((ROOT / "data" / "audiobooks.json").read_text(encoding="utf-8")).get("books", [])
if not any(item.get("id") == "librivox-1952" and item.get("category") == "恐怖惊悚" for item in books):
    raise SystemExit("Chinese horror audiobook entry is missing")

local_refs = set(re.findall(r'(?:src|href)="((?:scripts|styles|assets)/[^"?]+)', index))
missing_refs = sorted(ref for ref in local_refs if not (ROOT / ref).is_file())
if missing_refs:
    raise SystemExit(f"missing local index assets: {missing_refs}")

book_count = len(books)
print(f"PASS static Pages gate: {len(feeds)} podcast feeds, {book_count} books")
