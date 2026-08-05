#!/bin/bash
set -u
set -o pipefail
umask 077

usage() {
  echo "Usage: commons-backup.sh --database NAME --destination FILE [--config PATH]" >&2
  exit 64
}

database=""
destination=""
config=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --database) [ "$#" -ge 2 ] || usage; database=$2; shift 2 ;;
    --destination) [ "$#" -ge 2 ] || usage; destination=$2; shift 2 ;;
    --config) [ "$#" -ge 2 ] || usage; config=$2; shift 2 ;;
    -h|--help) usage ;;
    *) echo "Unknown argument" >&2; usage ;;
  esac
done
[ -n "$database" ] && [ -n "$destination" ] || usage
case "$database" in -*|*[!A-Za-z0-9_.-]*) echo "Refusing invalid database name" >&2; exit 1 ;; esac
[ ! -e "$destination" ] && [ ! -L "$destination" ] || { echo "Refusing to overwrite backup destination" >&2; exit 1; }
parent=$(dirname -- "$destination")
[ -d "$parent" ] || { echo "Backup destination directory does not exist" >&2; exit 1; }

tmp_dir=$(mktemp -d "$parent/.commons-backup.XXXXXX") || { echo "Could not create private backup directory" >&2; exit 1; }
chmod 700 "$tmp_dir"
tmp="$tmp_dir/export.sql"
(umask 077 && : > "$tmp") || { rmdir "$tmp_dir" 2>/dev/null; echo "Could not create private backup file" >&2; exit 1; }
chmod 600 "$tmp"
file_identity() {
  if [ "$(uname -s)" = Darwin ]; then stat -f '%d:%i:%HT' "$1" 2>/dev/null
  else stat -c '%d:%i:%F' "$1" 2>/dev/null
  fi
}
original_identity=$(file_identity "$tmp") || { rm -f "$tmp"; rmdir "$tmp_dir" 2>/dev/null; echo "Could not verify private backup file" >&2; exit 1; }
cleanup() { rm -f "$tmp"; rmdir "$tmp_dir" 2>/dev/null || true; }
trap cleanup EXIT HUP INT TERM
npx_bin=${NPX_BIN:-npx}
if [ -n "$config" ]; then
  "$npx_bin" wrangler d1 export "$database" --remote --output "$tmp" --config "$config" --skip-confirmation >/dev/null 2>/dev/null || {
    echo "Backup export failed" >&2
    exit 1
  }
else
  "$npx_bin" wrangler d1 export "$database" --remote --output "$tmp" --skip-confirmation >/dev/null 2>/dev/null || {
    echo "Backup export failed" >&2
    exit 1
  }
fi
[ -s "$tmp" ] || { echo "Backup export produced an empty file" >&2; exit 1; }
[ -f "$tmp" ] && [ ! -L "$tmp" ] && [ -O "$tmp" ] || { echo "Backup exporter replaced the private output file" >&2; exit 1; }
final_identity=$(file_identity "$tmp") || { echo "Could not verify exported backup file" >&2; exit 1; }
[ "$final_identity" = "$original_identity" ] || { echo "Backup exporter replaced the private output file" >&2; exit 1; }
chmod 600 "$tmp"
mv -n "$tmp" "$destination"
[ ! -e "$tmp" ] || { echo "Backup destination appeared during export; refusing overwrite" >&2; exit 1; }
[ -f "$destination" ] && [ ! -L "$destination" ] && [ "$(file_identity "$destination")" = "$original_identity" ] || {
  echo "Backup destination could not be verified" >&2
  exit 1
}
trap - EXIT HUP INT TERM
rmdir "$tmp_dir" 2>/dev/null || { echo "Backup temporary directory cleanup failed" >&2; exit 1; }
printf 'BACKUP COMPLETE: %s\n' "$destination"
