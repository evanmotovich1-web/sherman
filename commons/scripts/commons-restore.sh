#!/bin/bash
set -u
set -o pipefail
umask 077

usage() {
  echo "Usage: commons-restore.sh --database NAME --input FILE --sha256 HEX [--config PATH] [--allow-production]" >&2
  exit 64
}

database=""
input=""
config=""
expected_sha256=""
allow_production=no
while [ "$#" -gt 0 ]; do
  case "$1" in
    --database) [ "$#" -ge 2 ] || usage; database=$2; shift 2 ;;
    --input) [ "$#" -ge 2 ] || usage; input=$2; shift 2 ;;
    --sha256) [ "$#" -ge 2 ] || usage; expected_sha256=$2; shift 2 ;;
    --config) [ "$#" -ge 2 ] || usage; config=$2; shift 2 ;;
    --allow-production) allow_production=yes; shift ;;
    -h|--help) usage ;;
    *) echo "Unknown argument" >&2; usage ;;
  esac
done
[ -n "$database" ] && [ -n "$input" ] && [ -n "$expected_sha256" ] || usage
case "$database" in -*|*[!A-Za-z0-9_.-]*) echo "Refusing invalid database name" >&2; exit 1 ;; esac
case "$expected_sha256" in *[!a-f0-9]*|'') echo "Restore checksum must be 64 lowercase hexadecimal characters" >&2; exit 1 ;; esac
[ "${#expected_sha256}" -eq 64 ] || { echo "Restore checksum must be 64 lowercase hexadecimal characters" >&2; exit 1; }
[ -f "$input" ] && [ ! -L "$input" ] && [ -r "$input" ] || { echo "Restore input must be a readable, regular, non-symlink file" >&2; exit 1; }
[ -s "$input" ] || { echo "Restore input is empty" >&2; exit 1; }
[ -O "$input" ] || { echo "Restore input must be owned by the current operator" >&2; exit 1; }
input_mode=$(stat -f '%Lp' "$input" 2>/dev/null || stat -c '%a' "$input" 2>/dev/null) || {
  echo "Could not verify restore input permissions" >&2
  exit 1
}
case "$input_mode" in
  ?00|??00|???00) ;;
  *) echo "Restore input must not be accessible by group or other users" >&2; exit 1 ;;
esac

verified_input=$(mktemp "${TMPDIR:-/tmp}/commons-restore.XXXXXX") || {
  echo "Could not create private restore input" >&2
  exit 1
}
trap 'rm -f "$verified_input"' EXIT HUP INT TERM
chmod 600 "$verified_input" || { echo "Could not secure restore input" >&2; exit 1; }
cp "$input" "$verified_input" || { echo "Could not stage restore input" >&2; exit 1; }
if command -v shasum >/dev/null 2>&1; then
  actual_sha256=$(shasum -a 256 "$verified_input" | cut -d ' ' -f 1)
elif command -v sha256sum >/dev/null 2>&1; then
  actual_sha256=$(sha256sum "$verified_input" | cut -d ' ' -f 1)
else
  echo "Could not verify restore checksum" >&2
  exit 1
fi
[ "$actual_sha256" = "$expected_sha256" ] || { echo "Restore checksum does not match reviewed backup" >&2; exit 1; }

if printf '%s\n' "$database" | grep -Eiq '(^|[-_.])(dev|test|staging|stage|preview|rehearsal|restore|sandbox)([-_.]|$)'; then
  production_target=no
else
  production_target=yes
fi
if [ "$production_target" = yes ] && [ "$allow_production" != yes ]; then
  echo "Target does not look nonproduction; rerun with --allow-production for the second production override" >&2
  exit 1
fi

expected="RESTORE $database"
printf 'Type exactly "%s" to continue: ' "$expected" >&2
IFS= read -r confirmation || { echo "Restore cancelled" >&2; exit 1; }
[ "$confirmation" = "$expected" ] || { echo "Restore cancelled: confirmation did not match" >&2; exit 1; }
if [ "$production_target" = yes ]; then
  second="RESTORE PRODUCTION $database"
  printf 'Production override: type exactly "%s": ' "$second" >&2
  IFS= read -r confirmation || { echo "Production restore cancelled" >&2; exit 1; }
  [ "$confirmation" = "$second" ] || { echo "Production restore cancelled: second confirmation did not match" >&2; exit 1; }
fi

npx_bin=${NPX_BIN:-npx}
if [ -n "$config" ]; then
  "$npx_bin" wrangler d1 execute "$database" --remote --file "$verified_input" --config "$config" --yes >/dev/null 2>/dev/null || {
    echo "Restore failed" >&2
    exit 1
  }
else
  "$npx_bin" wrangler d1 execute "$database" --remote --file "$verified_input" --yes >/dev/null 2>/dev/null || {
    echo "Restore failed" >&2
    exit 1
  }
fi
printf 'RESTORE COMPLETE: %s\n' "$database"
