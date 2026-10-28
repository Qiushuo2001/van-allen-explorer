#!/usr/bin/env python3
"""Download native AE (1 minute) and Dst (1 hour) through NASA CDAWeb HAPI.

Python 3.10+, standard library only. --start is inclusive and --end exclusive,
both UTC-midnight dates. Raw JSON response bytes and full parameter metadata are
preserved, along with source URLs, UTC retrieval times, and SHA-256 hashes.
Requests are bounded to one day per index; completed downloads can be resumed.
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
from urllib.parse import urlencode
from urllib.request import Request, urlopen

UTC = timezone.utc
BASE = "https://cdaweb.gsfc.nasa.gov/hapi"
INDICES = {"ae": ("OMNI_HRO_1MIN", "AE_INDEX"), "dst": ("OMNI2_H0_MRG1HR", "DST1800")}


def day(value: str) -> datetime:
    try:
        return datetime.strptime(value, "%Y-%m-%d").replace(tzinfo=UTC)
    except ValueError as exc:
        raise argparse.ArgumentTypeError("Use a UTC date YYYY-MM-DD") from exc


def iso(value: datetime) -> str:
    return value.isoformat(timespec="seconds").replace("+00:00", "Z")


def fetch(url: str) -> bytes:
    request = Request(url, headers={"Accept": "application/json", "User-Agent": "VanAllenExplorer/1.0 (public NASA HAPI client)"})
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


def atomic_write(path: Path, content: bytes) -> None:
    temporary = path.with_suffix(path.suffix + ".part")
    temporary.write_bytes(content)
    temporary.replace(path)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--start", required=True, type=day, help="First UTC date, inclusive")
    parser.add_argument("--end", required=True, type=day, help="Last UTC date, exclusive")
    parser.add_argument("--indices", default="ae,dst", help="ae,dst (default), ae, or dst")
    parser.add_argument("--output", type=Path, default=Path(__file__).resolve().parents[1] / "data" / "indices")
    parser.add_argument("--refresh", action="store_true", help="Refetch existing chunks and parameter metadata")
    args = parser.parse_args()
    indices = list(dict.fromkeys(part.strip().lower() for part in args.indices.split(",")))
    if not indices or any(key not in INDICES for key in indices):
        parser.error("--indices must contain only ae and/or dst")
    if not datetime(2012, 8, 30, tzinfo=UTC) <= args.start < args.end <= datetime(2019, 10, 19, tzinfo=UTC):
        parser.error("Use an ordered nonempty range from 2012-08-30 through exclusive 2019-10-19")
    args.output.mkdir(parents=True, exist_ok=True)
    manifest_path = args.output / "manifest.json"
    if manifest_path.exists():
        manifest = json.loads(manifest_path.read_text(encoding="utf-8-sig"))
        if manifest.get("format") != "van-allen-indices-manifest-v1":
            raise ValueError("Unsupported existing manifest; select another --output directory")
    else:
        manifest = {"format": "van-allen-indices-manifest-v1", "chunks": [], "metadata": {}}
    for key in indices:
        dataset, parameter = INDICES[key]
        metadata_path = args.output / f"{key}-info.json"
        if not metadata_path.exists() or args.refresh:
            url = BASE + "/info?" + urlencode({"id": dataset, "parameters": f"Time,{parameter}"})
            content = fetch(url)
            if json.loads(content).get("status", {}).get("code") != 1200:
                raise ValueError(f"NASA did not return valid {key} metadata")
            atomic_write(metadata_path, content)
        manifest.setdefault("metadata", {})[key] = metadata_path.name
    cursor = args.start
    while cursor < args.end:
        stop = cursor + timedelta(days=1)
        for key in indices:
            dataset, parameter = INDICES[key]
            filename = f"{key}-{cursor:%Y%m%d}-{stop:%Y%m%d}.json"
            path = args.output / filename
            existing = next((c for c in manifest["chunks"] if c["file"] == filename), None)
            url = BASE + "/data?" + urlencode({"id": dataset, "parameters": f"Time,{parameter}",
                "time.min": iso(cursor), "time.max": iso(stop), "format": "json", "include": "header"})
            cached = path.exists() and existing and not args.refresh
            if cached:
                content = path.read_bytes()
                if existing.get("sha256") and hashlib.sha256(content).hexdigest() != existing["sha256"]:
                    raise ValueError(f"Cached {filename} checksum mismatch; rerun with --refresh")
                print(f"Using cached {filename}")
            else:
                print(f"Downloading {key.upper()} {cursor:%Y-%m-%d} (native cadence)")
                content = fetch(url)
            raw = json.loads(content)
            code = raw.get("status", {}).get("code")
            if code not in (1200, 1201):
                raise ValueError(f"HAPI rejected {key}: {raw.get('status')}")
            if code == 1200:
                meta = next((p for p in raw.get("parameters", []) if p["name"] == parameter), None)
                if not meta or meta.get("units") != "nT" or not isinstance(raw.get("data"), list):
                    raise ValueError(f"Unexpected HAPI parameters or units for {key}")
            else:
                print(f"  No {key} records returned; retained as an explicit no-data response")
            if not cached:
                atomic_write(path, content)
            entry = {"index": key, "file": filename, "dataset": dataset, "parameter": parameter,
                "start": iso(cursor), "end": iso(stop), "url": url,
                "retrievedAt": existing["retrievedAt"] if cached else iso(datetime.now(UTC)),
                "sha256": hashlib.sha256(content).hexdigest()}
            manifest["chunks"] = [c for c in manifest["chunks"] if c["file"] != filename] + [entry]
            atomic_write(manifest_path, (json.dumps(manifest, indent=2) + "\n").encode("utf-8"))
            if not cached:
                time.sleep(0.25)
        cursor = stop
    print(f"Ready: {manifest_path.resolve()}. Reload the browser to discover downloaded index files.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (HTTPError, URLError, TimeoutError, OSError, ValueError) as exc:
        print(f"Download failed: {exc}. Completed chunks are retained; rerun to resume.", file=sys.stderr)
        raise SystemExit(1)
