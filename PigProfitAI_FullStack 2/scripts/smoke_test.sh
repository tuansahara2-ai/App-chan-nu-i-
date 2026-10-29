#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
python -m py_compile server.py scripts/backup_sqlite.py
node --check app.js
python -m pytest -q tests
printf '\nSmoke checks passed.\n'
