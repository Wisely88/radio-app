#!/usr/bin/env python3
"""Check radio entry URLs and write a static health report for the web app."""

from __future__ import annotations

import argparse
import concurrent.futures
import datetime as dt
import json
import re
import time
import urllib.error
import urllib.request
from pathlib import Path


STATION_PATTERN = re.compile(
    r'\{\s*cat:\s*"(?P<cat>[^"]+)",\s*region:\s*"(?P<region>[^"]+)",'
    r'\s*name:\s*"(?P<name>[^"]+)",\s*desc:\s*"[^"]*",'
    r'\s*url:\s*"(?P<url>[^"]+)"\s*\}'
)


def station_id(station: dict[str, str]) -> str:
    return "|".join((station["cat"], station["region"], station["name"]))


def check_station(station: dict[str, str], timeout: float) -> tuple[str, dict[str, object]]:
    started = time.monotonic()
    request = urllib.request.Request(
        station["url"],
        headers={
            "User-Agent": "DreamFM-HealthCheck/1.0",
            "Range": "bytes=0-511",
            "Accept": "audio/*,application/vnd.apple.mpegurl,application/x-mpegURL,*/*;q=0.5",
        },
    )
    status = 0
    error = ""
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            status = int(response.status or 200)
            response.read(512)
        ok = 200 <= status < 400
    except urllib.error.HTTPError as exc:
        status = int(exc.code)
        error = f"HTTP {exc.code}"
        ok = False
    except Exception as exc:  # Network and TLS errors are report data, not script failures.
        error = type(exc).__name__
        ok = False

    return station_id(station), {
        "ok": ok,
        "status": status,
        "latencyMs": round((time.monotonic() - started) * 1000),
        "error": error,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("index", type=Path, help="Path to index.html")
    parser.add_argument("output", type=Path, help="Path to station-health.json")
    parser.add_argument("--timeout", type=float, default=8.0)
    parser.add_argument("--workers", type=int, default=8)
    args = parser.parse_args()

    source = args.index.read_text(encoding="utf-8")
    stations = [match.groupdict() for match in STATION_PATTERN.finditer(source)]
    if len(stations) < 1:
        raise SystemExit("No station records found in index.html")

    checks: dict[str, dict[str, object]] = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=max(1, args.workers)) as pool:
        futures = [pool.submit(check_station, station, args.timeout) for station in stations]
        for future in concurrent.futures.as_completed(futures):
            key, result = future.result()
            checks[key] = result

    report = {
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "stationCount": len(stations),
        "availableCount": sum(1 for result in checks.values() if result["ok"]),
        "stations": dict(sorted(checks.items())),
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Checked {report['stationCount']} stations: {report['availableCount']} available")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
