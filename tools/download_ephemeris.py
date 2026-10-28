#!/usr/bin/env python3
"""Download unmodified historical NASA SSCWeb JSON in bounded UTC-day requests.

Python 3.10+; standard library only. The default output is the application's data/
directory. Existing manifest entries are retained. --bundle writes a portable JSON
file that can also be loaded with the application's Import button.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timedelta, timezone
import hashlib
import json
from pathlib import Path
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

BASE = "https://sscweb.gsfc.nasa.gov/WS/sscr/2"
UTC = timezone.utc
FIRST = datetime(2012, 8, 30, tzinfo=UTC)
LAST = datetime(2019, 10, 18, 23, 59, 59, tzinfo=UTC)


def parse_time(value: str) -> datetime:
    try:
        result = datetime.fromisoformat(value.replace("Z", "+00:00"))
        # A bare date is documented as UTC; a time without an offset is also UTC.
        return result.replace(tzinfo=result.tzinfo or UTC).astimezone(UTC)
    except ValueError as exc:
        raise argparse.ArgumentTypeError("Use YYYY-MM-DD or an ISO UTC timestamp.") from exc


def unwrap(value):
    if isinstance(value, list):
        if len(value) == 2 and isinstance(value[0], str) and value[0].startswith(("gov.nasa.", "java.", "javax.", "[L", "[D", "[F")):
            return unwrap(value[1])
        return [unwrap(item) for item in value]
    if isinstance(value, dict):
        return {key: unwrap(item) for key, item in value.items()}
    return value


def fetch(url: str) -> bytes:
    request = Request(url, headers={"Accept": "application/json", "User-Agent": "VanAllenExplorer/1.0 (public SSCWeb ephemeris client)"})
    for attempt in range(3):
        try:
            with urlopen(request, timeout=60) as response:
                return response.read()
        except HTTPError as exc:
            if exc.code not in (429, 503) or attempt == 2:
                raise
            try:
                delay = min(30, max(1, int(exc.headers.get("Retry-After", "5"))))
            except ValueError:
                delay = 5
            print(f"NASA returned {exc.code}; retrying in {delay} seconds.", file=sys.stderr)
            time.sleep(delay)
    raise RuntimeError("Request failed")


def iso(value: datetime) -> str:
    return value.isoformat(timespec="seconds").replace("+00:00", "Z")


def write_json(path: Path, value) -> None:
    temporary = path.with_suffix(path.suffix + ".part")
    temporary.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--start", required=True, type=parse_time, help="First UTC date/time, e.g. 2015-03-17")
    parser.add_argument("--end", required=True, type=parse_time, help="Inclusive last UTC time, e.g. 2015-03-18")
    parser.add_argument("--frames", default="gse,gsm,geo", help="Comma-separated gse,gsm,geo (default: all three)")
    parser.add_argument("--output", type=Path, default=Path(__file__).resolve().parents[1] / "data", help="Data directory containing raw files and manifest.json")
    parser.add_argument("--bundle", type=Path, help="Optional portable JSON for browser Import")
    parser.add_argument("--refresh", action="store_true", help="Refetch already downloaded chunks")
    args = parser.parse_args()
    frames = list(dict.fromkeys(f.strip().lower() for f in args.frames.split(",")))
    if not frames or any(f not in ("gse", "gsm", "geo") for f in frames):
        parser.error("--frames must contain only gse, gsm, and/or geo")
    if not FIRST <= args.start <= args.end <= LAST:
        parser.error("The interval must be ordered and within 2012-08-30 through 2019-10-18T23:59:59Z")
    args.output.mkdir(parents=True, exist_ok=True)
    manifest_path = args.output / "manifest.json"
    if manifest_path.exists():
        manifest = json.loads(manifest_path.read_text(encoding="utf-8-sig"))
        if manifest.get("format") != "van-allen-ssc-manifest-v1":
            raise ValueError("Existing manifest has an unsupported format; choose another --output directory")
    else:
        manifest = {"format": "van-allen-ssc-manifest-v1", "metadata": "observatories.json", "chunks": []}
    metadata_path = args.output / "observatories.json"
    if not metadata_path.exists() or args.refresh:
        metadata_path.write_bytes(fetch(BASE + "/observatories"))
    bundle = {"format": "van-allen-ssc-bundle-v1", "source": "NASA SPDF SSCWeb", "chunks": []}
    cursor = args.start
    while cursor <= args.end:
        stop = min(cursor + timedelta(days=1), args.end)
        compact_start, compact_stop = (d.strftime("%Y%m%dT%H%M%SZ") for d in (cursor, stop))
        url = f"{BASE}/locations/rbspa,rbspb/{compact_start},{compact_stop}/{','.join(frames)}/?resolutionFactor=1"
        filename = f"ssc-{compact_start}-{compact_stop}-{'-'.join(frames)}.json"
        destination = args.output / filename
        existing = next((c for c in manifest["chunks"] if c["file"] == filename), None)
        if destination.exists() and existing and not args.refresh:
            content = destination.read_bytes()
            if existing.get("sha256") and hashlib.sha256(content).hexdigest() != existing["sha256"]:
                raise ValueError(f"Checksum mismatch in cached {filename}; use --refresh to retrieve it again")
            print(f"Using cached {filename}")
        else:
            print(f"Downloading {iso(cursor)} through {iso(stop)} ({','.join(frames).upper()})")
            content = fetch(url)
        raw = json.loads(content)
        result = unwrap(raw)
        result = result.get("Result", result)
        status = result.get("StatusCode", "")
        subcode = result.get("StatusSubCode", "")
        no_data = "NO_DATA" in subcode or "NO_SATELLITE" in subcode
        if status not in ("SUCCESS", "CONDITIONAL_SUCCESS") and not no_data:
            raise ValueError(f"SSC rejected the request: {status}: {subcode}")
        if "Data" not in result and not no_data:
            raise ValueError("SSC response has no location records")
        if no_data or status == "CONDITIONAL_SUCCESS":
            print(f"  SSC reports {status}: {subcode}; unavailable samples remain unavailable.")
        if not destination.exists() or args.refresh or not existing:
            temporary = destination.with_suffix(".json.part")
            temporary.write_bytes(content)
            temporary.replace(destination)
        entry = {"file": filename, "start": iso(cursor), "end": iso(stop), "frames": [f.upper() for f in frames],
                 "url": url, "retrievedAt": existing["retrievedAt"] if existing and not args.refresh else iso(datetime.now(UTC)),
                 "sha256": hashlib.sha256(content).hexdigest()}
        manifest["chunks"] = [c for c in manifest["chunks"] if c["file"] != filename] + [entry]
        write_json(manifest_path, manifest)
        if args.bundle:
            bundle["chunks"].append({"request": entry, "raw": raw})
        if stop == args.end:
            break
        cursor = stop
        time.sleep(0.25)  # Sequential requests, native resolution; avoid bursts.
    if args.bundle:
        args.bundle.parent.mkdir(parents=True, exist_ok=True)
        write_json(args.bundle, bundle)
        print(f"Portable import bundle: {args.bundle.resolve()}")
    print(f"Ready: {manifest_path.resolve()}. Reload the browser to discover downloaded files.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (HTTPError, URLError, TimeoutError, OSError, ValueError) as exc:
        print(f"Download failed: {exc}. Completed chunks are retained; rerun to resume.", file=sys.stderr)
        raise SystemExit(1)
