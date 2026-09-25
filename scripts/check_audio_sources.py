#!/usr/bin/env python3
"""Check audiobook and podcast feed health, including sample enclosure audio URLs."""

from __future__ import annotations

import argparse
import concurrent.futures
import datetime as dt
import json
import time
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

from update_audio_catalogs import LIBRIVOX_BOOKS

USER_AGENT = "DreamFM-AudioHealth/1.0"


def request_url(url: str, timeout: float, limit: int = 1024, retries: int = 1) -> dict[str, object]:
    started = time.monotonic()
    status = 0
    error = ""
    ok = False
    for attempt in range(max(0, retries) + 1):
        req = urllib.request.Request(
            url,
            headers={
                "User-Agent": USER_AGENT,
                "Range": f"bytes=0-{max(0, limit - 1)}",
                "Accept": "audio/*,application/rss+xml,application/xml,text/xml,*/*;q=0.5",
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                status = int(resp.status or 200)
                resp.read(limit)
            ok = 200 <= status < 400
            error = ""
        except urllib.error.HTTPError as exc:
            status = int(exc.code)
            error = f"HTTP {exc.code}"
        except Exception as exc:
            status = 0
            error = f"{type(exc).__name__}: {exc}"
        if ok or not (status == 0 or status == 429 or status >= 500) or attempt >= retries:
            break
        time.sleep(0.5 * (attempt + 1))
    return {
        "ok": ok,
        "status": status,
        "latencyMs": round((time.monotonic() - started) * 1000),
        "error": error,
    }


def fetch_xml(url: str, timeout: float) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read()


def localname(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def enclosure_urls(xml_bytes: bytes, sample_count: int) -> list[str]:
    root = ET.fromstring(xml_bytes)
    urls: list[str] = []
    for elem in root.iter():
        if localname(elem.tag) not in {"enclosure", "enclosureSecure"}:
            continue
        url = (elem.attrib.get("url") or "").strip()
        if url.startswith("https://") and url not in urls:
            urls.append(url)
            if len(urls) >= sample_count:
                break
    return urls


def check_feed(item: dict[str, object], kind: str, timeout: float, sample_count: int) -> tuple[str, dict[str, object]]:
    feed_url = str(item["feed"])
    key = f"{kind}|{item['id']}"
    started = time.monotonic()
    try:
        xml_bytes = fetch_xml(feed_url, timeout)
        feed_ok = True
        feed_error = ""
        feed_status = 200
    except urllib.error.HTTPError as exc:
        return key, {
            "ok": False,
            "feedOk": False,
            "feedStatus": int(exc.code),
            "audioOk": False,
            "audioChecked": 0,
            "audioPassed": 0,
            "latencyMs": round((time.monotonic() - started) * 1000),
            "error": f"HTTP {exc.code}",
        }
    except Exception as exc:
        return key, {
            "ok": False,
            "feedOk": False,
            "feedStatus": 0,
            "audioOk": False,
            "audioChecked": 0,
            "audioPassed": 0,
            "latencyMs": round((time.monotonic() - started) * 1000),
            "error": f"{type(exc).__name__}: {exc}",
        }

    try:
        urls = enclosure_urls(xml_bytes, sample_count)
    except Exception as exc:
        return key, {
            "ok": False,
            "feedOk": feed_ok,
            "feedStatus": feed_status,
            "audioOk": False,
            "audioChecked": 0,
            "audioPassed": 0,
            "latencyMs": round((time.monotonic() - started) * 1000),
            "error": f"XML parse: {type(exc).__name__}: {exc}",
        }

    if not urls:
        return key, {
            "ok": False,
            "feedOk": True,
            "feedStatus": 200,
            "audioOk": False,
            "audioChecked": 0,
            "audioPassed": 0,
            "latencyMs": round((time.monotonic() - started) * 1000),
            "error": "No HTTPS enclosure URLs",
        }

    results = [request_url(url, timeout, 768) for url in urls]
    passed = sum(1 for result in results if result["ok"])
    audio_ok = passed == len(results)
    errors = [str(result["error"]) for result in results if not result["ok"] and result["error"]]
    return key, {
        "ok": feed_ok and audio_ok,
        "feedOk": True,
        "feedStatus": 200,
        "audioOk": audio_ok,
        "audioChecked": len(results),
        "audioPassed": passed,
        "latencyMs": round((time.monotonic() - started) * 1000),
        "error": "; ".join(errors),
    }


def check_librivox_book(
    item: dict[str, object],
    timeout: float,
    sample_count: int,
    previous_books: dict[str, dict[str, object]],
) -> tuple[str, dict[str, object]]:
    book_id = int(item["id"])
    key = f"audiobook|librivox-{book_id}"
    url = f"https://librivox.org/api/feed/audiobooks/?id={book_id}&format=json&extended=1&coverart=1"
    started = time.monotonic()
    try:
        request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        with urllib.request.urlopen(request, timeout=timeout) as response:
            payload = json.loads(response.read())
        sections = payload["books"][0].get("sections", [])
        urls = []
        for section in sections:
            audio_url = str(section.get("listen_url") or "").strip()
            if audio_url.startswith("https://") and audio_url not in urls:
                urls.append(audio_url)
                if len(urls) >= sample_count:
                    break
    except urllib.error.HTTPError as exc:
        return check_librivox_fallback(
            key,
            previous_books.get(f"librivox-{book_id}"),
            feedOk=False,
            feedStatus=int(exc.code),
            metadataError=f"HTTP {exc.code}",
            timeout=timeout,
            sample_count=sample_count,
            started=started,
        )
    except Exception as exc:
        return check_librivox_fallback(
            key,
            previous_books.get(f"librivox-{book_id}"),
            feedOk=False,
            feedStatus=0,
            metadataError=f"{type(exc).__name__}: {exc}",
            timeout=timeout,
            sample_count=sample_count,
            started=started,
        )

    if not urls:
        return key, {
            "ok": False,
            "feedOk": True,
            "feedStatus": 200,
            "audioOk": False,
            "audioChecked": 0,
            "audioPassed": 0,
            "latencyMs": round((time.monotonic() - started) * 1000),
            "error": "No HTTPS LibriVox chapter URLs",
        }

    results = [request_url(audio_url, timeout, 768) for audio_url in urls]
    passed = sum(1 for result in results if result["ok"])
    errors = [str(result["error"]) for result in results if not result["ok"] and result["error"]]
    return key, {
        "ok": passed == len(results),
        "feedOk": True,
        "feedStatus": 200,
        "metadataOk": True,
        "usingCatalogFallback": False,
        "audioOk": passed == len(results),
        "audioChecked": len(results),
        "audioPassed": passed,
        "latencyMs": round((time.monotonic() - started) * 1000),
        "error": "; ".join(errors),
    }


def check_librivox_fallback(
    key: str,
    book: dict[str, object] | None,
    *,
    feedOk: bool,
    feedStatus: int,
    metadataError: str,
    timeout: float,
    sample_count: int,
    started: float,
) -> tuple[str, dict[str, object]]:
    chapters = book.get("chapters", []) if isinstance(book, dict) else []
    urls = [
        str(chapter.get("url") or "").strip()
        for chapter in chapters
        if isinstance(chapter, dict) and str(chapter.get("url") or "").startswith("https://")
    ][:sample_count]
    if not urls:
        return key, {
            "ok": False,
            "feedOk": feedOk,
            "feedStatus": feedStatus,
            "metadataOk": False,
            "usingCatalogFallback": False,
            "audioOk": False,
            "audioChecked": 0,
            "audioPassed": 0,
            "latencyMs": round((time.monotonic() - started) * 1000),
            "error": metadataError,
        }

    results = [request_url(audio_url, timeout, 768) for audio_url in urls]
    passed = sum(1 for result in results if result["ok"])
    errors = [str(result["error"]) for result in results if not result["ok"] and result["error"]]
    return key, {
        "ok": passed == len(results),
        "feedOk": feedOk,
        "feedStatus": feedStatus,
        "metadataOk": False,
        "usingCatalogFallback": True,
        "audioOk": passed == len(results),
        "audioChecked": len(results),
        "audioPassed": passed,
        "latencyMs": round((time.monotonic() - started) * 1000),
        "error": "; ".join([metadataError, *errors]),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--audiobooks", type=Path, default=Path("data/audiobook_feeds.json"))
    parser.add_argument("--catalog", type=Path, default=Path("data/audiobooks.json"))
    parser.add_argument("--podcasts", type=Path, default=Path("data/podcast_feeds.json"))
    parser.add_argument("--output", type=Path, default=Path("audio-source-health.json"))
    parser.add_argument("--timeout", type=float, default=15.0)
    parser.add_argument("--workers", type=int, default=8)
    parser.add_argument("--librivox-workers", type=int, default=2)
    parser.add_argument("--sample-count", type=int, default=2)
    args = parser.parse_args()

    audiobook_feeds = json.loads(args.audiobooks.read_text(encoding="utf-8"))
    podcast_feeds = json.loads(args.podcasts.read_text(encoding="utf-8"))
    catalog = json.loads(args.catalog.read_text(encoding="utf-8"))
    previous_books = {
        str(book["id"]): book
        for book in catalog.get("books", [])
        if isinstance(book, dict) and isinstance(book.get("id"), str)
    }
    jobs: list[tuple[dict[str, object], str]] = [(item, "audiobook") for item in audiobook_feeds]
    jobs += [(item, "podcast") for item in podcast_feeds]

    checks: dict[str, dict[str, object]] = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=max(1, args.workers)) as pool:
        futures = [pool.submit(check_feed, item, kind, args.timeout, max(1, args.sample_count)) for item, kind in jobs]
        for future in concurrent.futures.as_completed(futures):
            key, result = future.result()
            checks[key] = result

    with concurrent.futures.ThreadPoolExecutor(max_workers=max(1, args.librivox_workers)) as pool:
        futures = [
            pool.submit(check_librivox_book, item, args.timeout, max(1, args.sample_count), previous_books)
            for item in LIBRIVOX_BOOKS
        ]
        for future in concurrent.futures.as_completed(futures):
            key, result = future.result()
            checks[key] = result

    report = {
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "sourceCount": len(checks),
        "availableCount": sum(1 for result in checks.values() if result["ok"]),
        "sources": dict(sorted(checks.items())),
    }
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Checked {report['sourceCount']} audio sources: {report['availableCount']} available")
    for key, result in report["sources"].items():
        if not result["ok"]:
            print(f"DOWN\t{key}\tfeed={result['feedStatus']}\taudio={result['audioPassed']}/{result['audioChecked']}\t{result['error']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
