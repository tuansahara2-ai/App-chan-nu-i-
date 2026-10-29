#!/usr/bin/env python3
"""Create a consistent online SQLite backup of PigProfit AI's database."""
from __future__ import annotations
import argparse
import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path


def main() -> int:
    default_dir = Path(os.environ.get("PIGPROFIT_DATA_DIR", Path(__file__).resolve().parents[1] / "data"))
    default_db = Path(os.environ.get("PIGPROFIT_DB_PATH", default_dir / "pigprofit.sqlite3"))
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=default_db, help="Đường dẫn database SQLite đang chạy")
    parser.add_argument("--output-dir", type=Path, default=default_dir / "backups", help="Thư mục lưu backup")
    args = parser.parse_args()
    if not args.source.exists():
        parser.error(f"Không tìm thấy database: {args.source}")
    args.output_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    output = args.output_dir / f"pigprofit-{stamp}.sqlite3"
    with sqlite3.connect(f"file:{args.source.resolve()}?mode=ro", uri=True) as source:
        with sqlite3.connect(output) as target:
            source.backup(target)
            result = target.execute("PRAGMA integrity_check").fetchone()[0]
            if result != "ok":
                output.unlink(missing_ok=True)
                raise RuntimeError(f"Backup integrity check failed: {result}")
    print(f"Backup OK: {output} ({output.stat().st_size:,} bytes)")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
