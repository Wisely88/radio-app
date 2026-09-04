#!/usr/bin/env python3
"""Build static audiobook and podcast catalogs for 3/4 Dream FM."""

from __future__ import annotations

import argparse
import concurrent.futures
import datetime as dt
import email.utils
import hashlib
import html
import json
import re
import urllib.request
import xml.etree.ElementTree as ET
from html.parser import HTMLParser
from pathlib import Path


USER_AGENT = "DreamFM-CatalogBuilder/1.0"
LIBRIVOX_BOOK_IDS = [20249, 200, 253, 47, 56, 64, 65, 81, 83, 86, 90, 59]


class TextExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.parts: list[str] = []

    def handle_data(self, data: str) -> None:
        self.parts.append(data)


def clean_text(value: str | None, limit: int = 280) -> str:
    parser = TextExtractor()
    parser.feed(html.unescape(value or ""))
    text = re.sub(r"\s+", " ", " ".join(parser.parts)).strip()
    return text[:limit]


def fetch(url: str) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=25) as response:
        return response.read()


def child_text(element: ET.Element, name: str) -> str:
    for child in element:
        if child.tag.rsplit("}", 1)[-1] == name:
            return (child.text or "").strip()
    return ""


def first_descendant(element: ET.Element, name: str) -> ET.Element | None:
    for child in element.iter():
        if child.tag.rsplit("}", 1)[-1] == name:
            return child
    return None


def parse_duration(value: str | None) -> int:
    value = (value or "").strip()
    if not value:
        return 0
    if value.isdigit():
        return int(value)
    try:
        parts = [int(part) for part in value.split(":")]
    except ValueError:
        return 0
    total = 0
    for part in parts:
        total = total * 60 + part
    return total


def iso_date(value: str) -> str:
    try:
        parsed = email.utils.parsedate_to_datetime(value)
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=dt.timezone.utc)
        return parsed.astimezone(dt.timezone.utc).isoformat(timespec="seconds")
    except (TypeError, ValueError):
        return ""


def build_audiobook(book_id: int) -> dict[str, object] | None:
    url = f"https://librivox.org/api/feed/audiobooks/?id={book_id}&format=json&extended=1&coverart=1"
    payload = json.loads(fetch(url))
    source = payload["books"][0]
    chapters = []
    for section in source.get("sections", []):
        audio_url = section.get("listen_url", "")
        if not audio_url.startswith("https://"):
            continue
        chapters.append({
            "id": f"librivox-{book_id}-{section.get('id')}",
            "number": int(section.get("section_number") or len(chapters) + 1),
            "title": clean_text(section.get("title"), 140) or f"Chapter {len(chapters) + 1}",
            "url": audio_url,
            "duration": int(section.get("playtime") or 0),
        })
    if not chapters:
        return None
    authors = source.get("authors", [])
    author = ", ".join(
        " ".join(filter(None, (item.get("first_name"), item.get("last_name")))) for item in authors
    ).strip()
    return {
        "id": f"librivox-{book_id}",
        "title": source.get("title", "Untitled"),
        "author": author or "LibriVox Volunteers",
        "language": source.get("language", ""),
        "description": clean_text(source.get("description")),
        "cover": source.get("coverart_jpg") or source.get("coverart_thumbnail") or "",
        "duration": int(source.get("totaltimesecs") or 0),
        "source": "LibriVox",
        "sourceUrl": source.get("url_librivox", ""),
        "chapters": chapters,
    }


def build_audiobooks() -> list[dict[str, object]]:
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        books = [book for book in pool.map(build_audiobook, LIBRIVOX_BOOK_IDS) if book]
    if len(books) < 8:
        raise RuntimeError(f"Only {len(books)} valid audiobooks were generated")
    return books


def parse_podcast(feed_config: dict[str, str], episode_limit: int) -> dict[str, object]:
    root = ET.fromstring(fetch(feed_config["feed"]))
    channel = first_descendant(root, "channel")
    if channel is None:
        raise ValueError("RSS channel not found")
    image = first_descendant(channel, "image")
    cover = ""
    if image is not None:
        cover = image.attrib.get("href", "") or child_text(image, "url")
    show_title = child_text(channel, "title") or feed_config["id"]
    episodes = []
    for item in [element for element in channel if element.tag.rsplit("}", 1)[-1] == "item"]:
        enclosure = first_descendant(item, "enclosure")
        audio_url = enclosure.attrib.get("url", "").strip() if enclosure is not None else ""
        if not audio_url.startswith("https://"):
            continue
        guid = child_text(item, "guid") or audio_url
        title = clean_text(child_text(item, "title"), 180)
        if not title:
            continue
        episodes.append({
            "id": f"{feed_config['id']}-{hashlib.sha1(guid.encode()).hexdigest()[:14]}",
            "title": title,
            "description": clean_text(child_text(item, "description")),
            "publishedAt": iso_date(child_text(item, "pubDate")),
            "duration": parse_duration(child_text(item, "duration")),
            "url": audio_url,
        })
        if len(episodes) >= episode_limit:
            break
    if not episodes:
        raise ValueError("No HTTPS podcast episodes found")
    return {
        "id": feed_config["id"],
        "title": show_title,
        "author": child_text(channel, "author") or child_text(channel, "managingEditor"),
        "description": clean_text(child_text(channel, "description")),
        "cover": cover if cover.startswith("https://") else "",
        "source": "Podcast RSS",
        "sourceUrl": child_text(channel, "link") or feed_config["feed"],
        "feedUrl": feed_config["feed"],
        "episodes": episodes,
    }


def build_podcasts(config_path: Path, episode_limit: int) -> tuple[list[dict[str, object]], list[str]]:
    feeds = json.loads(config_path.read_text(encoding="utf-8"))
    shows = []
    warnings = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        futures = [pool.submit(parse_podcast, feed, episode_limit) for feed in feeds]
        for feed, future in zip(feeds, futures):
            try:
                shows.append(future.result())
            except Exception as exc:
                warnings.append(f"{feed['id']}: {type(exc).__name__}: {exc}")
    if len(shows) < 6:
        raise RuntimeError(f"Only {len(shows)} valid podcast feeds were generated")
    return shows, warnings


def write_json(path: Path, payload: dict[str, object]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--feeds", type=Path, default=Path("data/podcast_feeds.json"))
    parser.add_argument("--output-dir", type=Path, default=Path("data"))
    parser.add_argument("--episode-limit", type=int, default=8)
    args = parser.parse_args()

    generated_at = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
    audiobooks = build_audiobooks()
    podcasts, warnings = build_podcasts(args.feeds, max(1, args.episode_limit))
    write_json(args.output_dir / "audiobooks.json", {
        "generatedAt": generated_at,
        "source": "LibriVox API",
        "books": audiobooks,
    })
    write_json(args.output_dir / "podcasts.json", {
        "generatedAt": generated_at,
        "source": "Public podcast RSS feeds",
        "shows": podcasts,
    })
    print(f"Generated {len(audiobooks)} audiobooks and {len(podcasts)} podcast shows")
    for warning in warnings:
        print(f"WARNING {warning}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
