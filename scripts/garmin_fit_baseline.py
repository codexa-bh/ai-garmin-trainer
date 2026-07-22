#!/usr/bin/env python3
"""Return a minimized Garmin athlete-baseline FIT snapshot.

The web app launches this as a local subprocess. It reads Garmin auth only via
Garmin's existing out-of-band token store and prints only approved normalized
FIT `zones_target` fields needed by the app; it never prints token contents,
raw FIT bytes, activity IDs, or broad profile/device payloads.
"""

from __future__ import annotations

import gzip
import io
import json
import os
import sys
import zipfile
from typing import Any

from fitparse import FitFile
from garminconnect import Garmin


def extract_fit_bytes(raw: bytes) -> bytes:
    if raw[:2] == b"\x1f\x8b":
        raw = gzip.decompress(raw)
    if raw[:2] == b"PK":
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            for name in archive.namelist():
                if name.lower().endswith(".fit"):
                    return archive.read(name)
    return raw


def field(message: Any, name: str) -> Any:
    try:
        value = message.get_value(name)
    except Exception:
        return None
    return value


def bounded_int(value: Any, minimum: int, maximum: int) -> int | None:
    try:
        parsed = round(float(value))
    except (TypeError, ValueError):
        return None
    return parsed if minimum <= parsed <= maximum else None


def parse_zones_target(raw: bytes) -> dict[str, Any] | None:
    fit = FitFile(io.BytesIO(extract_fit_bytes(raw)))
    for message in fit.get_messages("zones_target"):
        max_heart_rate = bounded_int(field(message, "max_heart_rate"), 80, 240)
        threshold_heart_rate = bounded_int(
            field(message, "threshold_heart_rate"), 80, 230
        )
        if max_heart_rate is not None or threshold_heart_rate is not None:
            return {
                "zones_target": {
                    "max_heart_rate": max_heart_rate,
                    "threshold_heart_rate": threshold_heart_rate,
                    "source": "garmin_fit_zones_target",
                }
            }
    return None


def main() -> int:
    activity_ids = [item for item in sys.argv[1:] if item.strip()]
    if not activity_ids:
        print(json.dumps({"zones_target": None}))
        return 0

    garmin = Garmin(is_cn=os.getenv("GARMIN_IS_CN", "").lower() in {"1", "true", "yes"})
    garmin.login(os.getenv("GARMINTOKENS") or "~/.garminconnect")

    for activity_id in activity_ids[:6]:
        try:
            raw = garmin.download_activity(
                int(activity_id), dl_fmt=Garmin.ActivityDownloadFormat.ORIGINAL
            )
            parsed = parse_zones_target(bytes(raw))
            if parsed:
                print(json.dumps(parsed, separators=(",", ":")))
                return 0
        except Exception:
            continue

    print(json.dumps({"zones_target": None}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
