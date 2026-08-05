#!/bin/bash
set -u
set -o pipefail
umask 077

usage() {
  echo "Usage: commons-seed.sh --database NAME --input FILE --sha256 HEX [--config PATH] [--allow-production]" >&2
  exit 64
}

database=""
input=""
expected_sha256=""
config=""
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
case "$expected_sha256" in *[!a-f0-9]*|'') echo "Seed checksum must be 64 lowercase hexadecimal characters" >&2; exit 1 ;; esac
[ "${#expected_sha256}" -eq 64 ] || { echo "Seed checksum must be 64 lowercase hexadecimal characters" >&2; exit 1; }
[ -f "$input" ] && [ ! -L "$input" ] && [ -r "$input" ] && [ -s "$input" ] || {
  echo "Seed input must be a readable, nonempty, regular, non-symlink file" >&2
  exit 1
}
[ -O "$input" ] || { echo "Seed input must be owned by the current operator" >&2; exit 1; }
input_mode=$(stat -f '%Lp' "$input" 2>/dev/null || stat -c '%a' "$input" 2>/dev/null) || {
  echo "Could not verify seed input permissions" >&2
  exit 1
}
case "$input_mode" in ?00|??00|???00) ;; *) echo "Seed input must not be accessible by group or other users" >&2; exit 1 ;; esac

if printf '%s\n' "$database" | grep -Eiq '(^|[-_.])(dev|test|staging|stage|preview|pilot|rehearsal|sandbox)([-_.]|$)'; then
  production_target=no
else
  production_target=yes
fi
if [ "$production_target" = yes ] && [ "$allow_production" != yes ]; then
  echo "Target does not look nonproduction; rerun with --allow-production for the production override" >&2
  exit 1
fi

tmp_dir=$(mktemp -d "${TMPDIR:-/tmp}/commons-seed.XXXXXX") || { echo "Could not create private seed workspace" >&2; exit 1; }
trap 'rm -rf "$tmp_dir"' EXIT HUP INT TERM
chmod 700 "$tmp_dir" || { echo "Could not secure seed workspace" >&2; exit 1; }
verified_input="$tmp_dir/seed.json"
sql_file="$tmp_dir/seed.sql"
cp "$input" "$verified_input" || { echo "Could not stage seed input" >&2; exit 1; }
chmod 600 "$verified_input" || { echo "Could not secure seed input" >&2; exit 1; }
if command -v shasum >/dev/null 2>&1; then
  actual_sha256=$(shasum -a 256 "$verified_input" | cut -d ' ' -f 1)
elif command -v sha256sum >/dev/null 2>&1; then
  actual_sha256=$(sha256sum "$verified_input" | cut -d ' ' -f 1)
else
  echo "Could not verify seed checksum" >&2
  exit 1
fi
[ "$actual_sha256" = "$expected_sha256" ] || { echo "Seed checksum does not match reviewed input" >&2; exit 1; }

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
network_id=$(node "$script_dir/render-seed.mjs" "$verified_input" "$sql_file" 2>/dev/null) || {
  echo "Seed input is invalid" >&2
  exit 1
}
case "$network_id" in ''|*[!A-Za-z0-9._:-]*) echo "Seed input is invalid" >&2; exit 1 ;; esac
expected="SEED $database $network_id"
printf 'Type exactly "%s" to continue: ' "$expected" >&2
IFS= read -r confirmation || { echo "Seed cancelled" >&2; exit 1; }
[ "$confirmation" = "$expected" ] || { echo "Seed cancelled: confirmation did not match" >&2; exit 1; }
if [ "$production_target" = yes ]; then
  second="SEED PRODUCTION $database $network_id"
  printf 'Production override: type exactly "%s": ' "$second" >&2
  IFS= read -r confirmation || { echo "Production seed cancelled" >&2; exit 1; }
  [ "$confirmation" = "$second" ] || { echo "Production seed cancelled: second confirmation did not match" >&2; exit 1; }
fi

npx_bin=${NPX_BIN:-npx}
if [ -n "$config" ]; then
  "$npx_bin" wrangler d1 execute "$database" --remote --file "$sql_file" --config "$config" --yes >/dev/null 2>/dev/null || {
    echo "Seed failed" >&2
    exit 1
  }
else
  "$npx_bin" wrangler d1 execute "$database" --remote --file "$sql_file" --yes >/dev/null 2>/dev/null || {
    echo "Seed failed" >&2
    exit 1
  }
fi
printf 'SEED COMPLETE: %s\n' "$database"
