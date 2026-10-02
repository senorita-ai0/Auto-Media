#!/bin/sh
set -eu

BACKUP_DIR="${BACKUP_DIR:-/backups}"
VERIFY_INTERVAL_SECONDS="${BACKUP_VERIFY_INTERVAL_SECONDS:-86400}"
PASSWORD="${BACKUP_ENCRYPTION_PASSWORD:-}"

write_report() {
  status="$1"
  file="$2"
  message="$3"
  stamp="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  escaped="$(printf '%s' "$message" | sed 's/\\/\\\\/g; s/"/\\"/g')"
  cat > "${BACKUP_DIR}/restore-verification-latest.json" <<EOF
{"status":"$status","backup":"$file","verifiedAt":"$stamp","message":"$escaped"}
EOF
}

verify_once() {
  latest="$(find "$BACKUP_DIR" -maxdepth 1 -type f \( -name 'automedia-*.sql.gz' -o -name 'automedia-*.sql.gz.enc' \) | sort | tail -n 1 || true)"
  if [ -z "$latest" ]; then
    write_report "waiting" "" "No database backup is available yet."
    return 0
  fi

  work="/tmp/automedia-restore-verify.sql.gz"
  rm -f "$work"
  case "$latest" in
    *.enc)
      if [ -z "$PASSWORD" ]; then
        write_report "failed" "$latest" "Backup is encrypted but BACKUP_ENCRYPTION_PASSWORD is not configured."
        return 1
      fi
      openssl enc -d -aes-256-cbc -pbkdf2 -in "$latest" -out "$work" -pass env:BACKUP_ENCRYPTION_PASSWORD
      ;;
    *)
      cp "$latest" "$work"
      ;;
  esac

  gzip -t "$work"

  db="automedia_restore_verify_$$(date -u +%Y%m%d%H%M%S)"
  createdb -T template0 "$db"
  cleanup() {
    dropdb --if-exists "$db" >/dev/null 2>&1 || true
    rm -f "$work"
  }
  trap cleanup EXIT INT TERM

  gunzip -c "$work" | psql -v ON_ERROR_STOP=1 --dbname="$db" >/dev/null
  table_count="$$(psql -v ON_ERROR_STOP=1 --dbname="$db" -Atqc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('workspaces','profiles','content_types','automations','content_items','publishing_jobs','generation_jobs','credentials','n8n_workflows','audit_logs')")"
  if [ "$table_count" -lt 10 ]; then
    write_report "failed" "$latest" "Restore completed but the expected Auto-Media table set was incomplete."
    return 1
  fi

  workspace_count="$$(psql -v ON_ERROR_STOP=1 --dbname="$db" -Atqc "SELECT count(*) FROM workspaces")"
  write_report "verified" "$latest" "Database restore succeeded; expected tables restored: $table_count; workspace rows: $workspace_count."
  return 0
}

mkdir -p "$BACKUP_DIR"
while true; do
  if ! verify_once; then
    echo "[backup-verify] verification failed" >&2
  else
    echo "[backup-verify] verification cycle completed"
  fi
  sleep "$VERIFY_INTERVAL_SECONDS"
done
