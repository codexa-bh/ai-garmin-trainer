"""FIT subprocess boundary: consume only the app-resolved absolute directory."""
import os
from pathlib import Path


def tokenstore() -> str:
    configured = os.getenv("GARMIN_MCP_TOKEN_DIR", "")
    if not configured or not Path(configured).is_absolute() or any(c in configured for c in "~$\x00\n\r"):
        raise ValueError("Garmin requires an explicit app-resolved token directory; no fallback is supported")
    directory = Path(configured)
    token = directory / "garmin_tokens.json"
    try:
        if directory.is_symlink() or not directory.is_dir() or token.is_symlink() or not token.is_file() or not token.stat().st_size or not os.access(token, os.R_OK):
            raise ValueError()
    except (OSError, ValueError):
        raise ValueError("Configured Garmin token file is missing or inaccessible") from None
    return str(directory)
