#!/usr/bin/env python3
"""Save real NASA CDAWeb plasma data for Van Allen Probes A and B.

Python 3.10+, standard library only. --start is inclusive, --end exclusive,
using UTC dates. Each daily query includes 30 seconds on both sides for bounded
native-sample selection at midnight. The original JSON bytes, parameter metadata,
source query, retrieval UTC, and SHA-256 are preserved. No values are interpolated.
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
FORMAT = "van-allen-plasma-manifest-v1"
PRODUCTS = {
    "density": {
        "dataset": "RBSP-{letter}_DENSITY_EMFISIS-L4",
        "parameters": "Time,bmag,fce,fpe,wpe_over_wce,density",
        "units": {"bmag": "nT", "fce": "Hz", "fpe": "Hz", "density": "cm**-3"},
    },
    "moments": {
        "dataset": "RBSP{letter}_REL04_ECT-HOPE-MOM-L3@1",
        "parameters": "Time,Tpar_e_200,Tperp_e_200,Dens_e_200,e_T_flag,e_Tperp_flag,e_Dens_flag",
        "units": {"Tpar_e_200": "eV", "Tperp_e_200": "eV", "Dens_e_200": "cm!u-3!n"},
    },
    "field": {
        "dataset": "RBSP-{letter}_MAGNETOMETER_4SEC-GSE_EMFISIS-L3",
        "parameters": "Time,Magnitude,calState,magInvalid,magFill",
        "units": {"Magnitude": "nT"},
    },
}
SOURCES = {
    "verifiedAt": "2026-10-28",
    "provider": "NASA SPDF / CDAWeb HAPI",
    "api": BASE,
    "density": {
        "instrument": "EMFISIS", "product": "Level 4 electron density",
        "quantity": "Electron density inferred from wave frequencies; f_pe/f_ce is the original wpe_over_wce value in the same record.",
        "quality": "HAPI exposes no per-record density quality flag. Fill, nonfinite, and nonpositive values remain unavailable.",
        "documentation": "https://cdaweb.gsfc.nasa.gov/misc/NotesR.html#RBSP-A_DENSITY_EMFISIS-L4",
    },
    "moments": {
        "instrument": "ECT / HOPE", "product": "Level 3 release04 electron moments, HAPI @1 electron timebase",
        "population": "Partial electron moments from 200 eV upward, in apogee mode; HOPE upper instrument range is approximately 50 keV.",
        "density": "Dens_e_200 is the matching partial electron density. It is not a replacement for the EMFISIS total electron density.",
        "anisotropy": "Tperp_e_200 / Tpar_e_200, calculated from the same original source record; not ratio minus one.",
        "beta": "Scalar partial electron beta = 2 mu_0 n_HOPE e (Tpar + 2 Tperp) / (3 B^2), with n in m^-3, temperatures in eV, and measured B in tesla.",
        "betaPopulation": "This is HOPE's >=200 eV electron contribution, not total plasma beta or beta of all electrons. EMFISIS total density is never multiplied by the hot HOPE temperatures.",
        "quality": "Require e_T_flag=0 and e_Tperp_flag=0 for anisotropy; additionally e_Dens_flag=0 for beta. Nonzero, fill, and missing flags are rejected.",
        "timestamp": "Nominal cadence 24.35 s; actual cadence varies. Original CDF Epoch_Ele refers to an absent Epoch_Ele_DELTA variable, so no exact integration bounds are asserted.",
        "documentation": "https://cdaweb.gsfc.nasa.gov/misc/NotesR.html#RBSPA_REL04_ECT-HOPE-MOM-L3",
        "metadata": "https://spase-metadata.org/NASA/NumericalData/RBSP/B/ECT/HOPE/L3/Moments/Release04/PT24.35S",
        "partialMomentsReference": "https://pmc.ncbi.nlm.nih.gov/articles/PMC4933096/",
    },
    "field": {
        "instrument": "EMFISIS magnetometer", "product": "Level 3 four-second GSE",
        "quantity": "Magnitude, the source average of |B| over the averaging interval, is used for beta. No dipole or equatorial model field is substituted.",
        "quality": "Require calState=0, magInvalid=0, and magFill=0; nonzero, missing, or fill flags are rejected.",
        "documentation": "https://cdaweb.gsfc.nasa.gov/misc/NotesR.html#RBSP-A_MAGNETOMETER_4SEC-GSE_EMFISIS-L3",
    },
    "selection": {
        "density": "Nearest native record within 3.5 s, only with surrounding source records separated by at most 7.01 s; exact source timestamps remain usable at a boundary.",
        "moments": "Nearest native record within 12.5 s, only with surrounding source records separated by at most 25 s; exact source timestamps remain usable at a boundary.",
        "field": "Nearest four-second field record to the selected HOPE moment epoch, within 2.01 s and surrounding spacing no greater than 4.01 s.",
        "gaps": "Choose among all native rows before quality screening. Never skip a missing or flagged row to find a good substitute; do not interpolate, carry forward, or extrapolate.",
        "sourceTimes": "Show the actual source UTC and offset from selected UTC. These are nearby measurements, not values estimated at the requested instant.",
        "independence": "Each spacecraft and product has independent availability. Missing orbit ephemerides do not invalidate plasma measurements; operations and source coverage still apply.",
    },
    "download": "Each daily HAPI request covers UTC day start minus 30 seconds through next midnight plus 30 seconds (end exclusive). Raw response bytes are retained with SHA-256 hashes in manifest.json.",
}


def day(value: str) -> datetime:
    try:
        return datetime.strptime(value, "%Y-%m-%d").replace(tzinfo=UTC)
    except ValueError as exc:
        raise argparse.ArgumentTypeError("Use a UTC date YYYY-MM-DD") from exc


def iso(value: datetime) -> str:
    return value.isoformat(timespec="seconds").replace("+00:00", "Z")


def sha(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def fetch(url: str) -> bytes:
    request = Request(url, headers={"Accept": "application/json", "User-Agent": "VanAllenExplorer/1.5 (public NASA HAPI client)"})
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


def save_manifest(path: Path, manifest: dict) -> None:
    atomic_write(path, (json.dumps(manifest, indent=2) + "\n").encode("utf-8"))


def validate(raw: dict, product: str, metadata: bool = False) -> None:
    code = raw.get("status", {}).get("code")
    if code == 1201 and not metadata:
        return  # Retain a real source no-data response, not invented empty measurements.
    if code != 1200:
        raise ValueError(f"HAPI rejected {product}: {raw.get('status')}")
    definition = PRODUCTS[product]
    parameters = {p["name"]: p for p in raw.get("parameters", [])}
    if not set(definition["parameters"].split(",")) <= parameters.keys():
        raise ValueError(f"Missing expected {product} parameters")
    for parameter, unit in definition["units"].items():
        if parameters[parameter].get("units") != unit:
            raise ValueError(f"Unexpected units for {product}/{parameter}")
    if not metadata and not isinstance(raw.get("data"), list):
        raise ValueError(f"Missing {product} data array")


def obtain(path: Path, existing: dict | None, url: str, refresh: bool) -> tuple[bytes, str, bool]:
    if path.exists() and existing and not refresh:
        content = path.read_bytes()
        if sha(content) != existing.get("sha256"):
            raise ValueError(f"Cached {path.name} checksum mismatch; rerun with --refresh")
        if existing.get("url") != url:
            raise ValueError(f"Cached {path.name} query differs; rerun with --refresh")
        print("Using cached", path.name)
        return content, existing["retrievedAt"], True
    print("Downloading", path.name)
    return fetch(url), iso(datetime.now(UTC)), False


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--start", required=True, type=day, help="First UTC date, inclusive")
    parser.add_argument("--end", required=True, type=day, help="Last UTC date, exclusive")
    parser.add_argument("--probes", default="a,b", help="a,b (default), a, or b")
    parser.add_argument("--products", default="density,moments,field", help="Comma-separated density, moments, field (default: all)")
    parser.add_argument("--output", type=Path, default=Path(__file__).resolve().parents[1] / "data" / "plasma")
    parser.add_argument("--refresh", action="store_true", help="Refetch existing responses and metadata")
    args = parser.parse_args()
    probes = list(dict.fromkeys(x.strip().lower() for x in args.probes.split(",")))
    products = list(dict.fromkeys(x.strip().lower() for x in args.products.split(",")))
    if not probes or any(p not in ("a", "b") for p in probes):
        parser.error("--probes must contain only a and/or b")
    if not products or any(p not in PRODUCTS for p in products):
        parser.error("--products must contain only density, moments, and/or field")
    if not datetime(2012, 8, 30, tzinfo=UTC) <= args.start < args.end <= datetime(2019, 10, 19, tzinfo=UTC):
        parser.error("Use an ordered nonempty range within the mission, ending no later than exclusive 2019-10-19")
    args.output.mkdir(parents=True, exist_ok=True)
    atomic_write(args.output / "sources.json", (json.dumps(SOURCES, indent=2) + "\n").encode("utf-8"))
    manifest_path = args.output / "manifest.json"
    if manifest_path.exists():
        manifest = json.loads(manifest_path.read_text(encoding="utf-8-sig"))
        if manifest.get("format") != FORMAT:
            raise ValueError("Unsupported existing manifest; select another --output directory")
    else:
        manifest = {"format": FORMAT, "paddingSeconds": 30, "sources": "sources.json", "chunks": [], "metadata": []}
    for probe in probes:
        for product in products:
            definition = PRODUCTS[product]
            dataset = definition["dataset"].format(letter=probe.upper())
            filename = f"rbsp{probe}-{product}-info.json"
            url = BASE + "/info?" + urlencode({"id": dataset, "parameters": definition["parameters"]})
            existing = next((c for c in manifest.get("metadata", []) if c["file"] == filename), None)
            content, retrieved, cached = obtain(args.output / filename, existing, url, args.refresh)
            validate(json.loads(content), product, metadata=True)
            if not cached:
                atomic_write(args.output / filename, content)
            entry = {"probe": "rbsp" + probe, "product": product, "dataset": dataset, "parameters": definition["parameters"],
                     "file": filename, "url": url, "retrievedAt": retrieved, "sha256": sha(content)}
            manifest["metadata"] = [c for c in manifest.get("metadata", []) if c["file"] != filename] + [entry]
            save_manifest(manifest_path, manifest)
    cursor = args.start
    while cursor < args.end:
        stop = cursor + timedelta(days=1)
        start_query, end_query = cursor - timedelta(seconds=30), stop + timedelta(seconds=30)
        for probe in probes:
            for product in products:
                definition = PRODUCTS[product]
                dataset = definition["dataset"].format(letter=probe.upper())
                filename = f"rbsp{probe}-{product}-{cursor:%Y%m%d}.json"
                url = BASE + "/data?" + urlencode({"id": dataset, "parameters": definition["parameters"],
                    "time.min": iso(start_query), "time.max": iso(end_query), "format": "json", "include": "header"})
                existing = next((c for c in manifest["chunks"] if c["file"] == filename), None)
                content, retrieved, cached = obtain(args.output / filename, existing, url, args.refresh)
                raw = json.loads(content)
                validate(raw, product)
                if not cached:
                    atomic_write(args.output / filename, content)
                entry = {"probe": "rbsp" + probe, "product": product, "dataset": dataset, "parameters": definition["parameters"],
                    "day": iso(cursor), "start": iso(start_query), "end": iso(end_query), "file": filename, "url": url,
                    "retrievedAt": retrieved, "sha256": sha(content), "recordCount": len(raw.get("data", []))}
                manifest["chunks"] = [c for c in manifest["chunks"] if c["file"] != filename] + [entry]
                save_manifest(manifest_path, manifest)
                if not cached:
                    time.sleep(0.15)
        cursor = stop
    print(f"Ready: {manifest_path.resolve()}. Reload the browser to discover downloaded plasma files.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (HTTPError, URLError, TimeoutError, OSError, ValueError) as exc:
        print(f"Download failed: {exc}. Completed chunks are retained; rerun to resume.", file=sys.stderr)
        raise SystemExit(1)
