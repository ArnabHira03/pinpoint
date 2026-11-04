#!/usr/bin/env bash
# Saves a copy of the hosted database to backend/backups/. Supabase's free plan has no backups.
# Run it from your own computer, about once a week. Needs Podman.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -z "${DB_URL:-}" ]; then
  read -rsp "Paste the Supabase session pooler address (hidden): " DB_URL
  echo
fi
export DB_URL

umask 077 # Backups hold every comment, so only this user may read them.
mkdir -p backups
file="backups/pinpoint-$(date +%Y-%m-%d-%H%M%S).sql"
partial="$(mktemp backups/.partial-XXXXXX)"
trap 'rm -f "$partial"' EXIT # A failed backup never replaces or removes a finished one.

if ! podman run --rm --network host -e DB_URL docker.io/library/postgres:17 \
  sh -c 'pg_dump --no-owner --no-privileges --schema=public "$DB_URL"' >"$partial"; then
  echo "Backup failed. If the project is paused, resume it in the Supabase dashboard and try again." >&2
  exit 1
fi
if ! grep -q "PostgreSQL database dump complete" "$partial"; then
  echo "Backup was incomplete, so it was not kept. Try again." >&2
  exit 1
fi
mv "$partial" "$file"
echo "Saved $file"
