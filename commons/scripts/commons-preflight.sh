#!/bin/bash
set -u
set -o pipefail

usage() {
  echo "Usage: commons-preflight.sh --config PATH --database NAME --database-id UUID --account-id HEX --approved-route PATTERN" >&2
  exit 64
}

config=""
database=""
approved_route=""
approved_database_id=""
approved_account_id=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --config) [ "$#" -ge 2 ] || usage; config=$2; shift 2 ;;
    --database) [ "$#" -ge 2 ] || usage; database=$2; shift 2 ;;
    --approved-route) [ "$#" -ge 2 ] || usage; approved_route=$2; shift 2 ;;
    --database-id) [ "$#" -ge 2 ] || usage; approved_database_id=$2; shift 2 ;;
    --account-id) [ "$#" -ge 2 ] || usage; approved_account_id=$2; shift 2 ;;
    -h|--help) usage ;;
    *) echo "Unknown argument" >&2; usage ;;
  esac
done
[ -n "$config" ] && [ -n "$database" ] && [ -n "$approved_database_id" ] && [ -n "$approved_account_id" ] || usage
[ -r "$config" ] || { echo "MACHINE BLOCKER: configuration is not readable" >&2; exit 1; }

static_errors=$(node --input-type=module - "$config" "$database" "$approved_route" "$approved_database_id" "$approved_account_id" <<'NODE'
import { readFileSync } from 'node:fs';
const [, , configPath, databaseName, approvedRoute, approvedDatabaseId, approvedAccountId] = process.argv;
function stripJsonc(input) {
  let output = '';
  let inString = false;
  let escaped = false;
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    const next = input[index + 1];
    if (inString) {
      output += character;
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
    } else if (character === '"') {
      inString = true;
      output += character;
    } else if (character === '/' && next === '/') {
      while (index < input.length && input[index] !== '\n') index += 1;
      output += '\n';
    } else if (character === '/' && next === '*') {
      index += 2;
      while (index < input.length && !(input[index] === '*' && input[index + 1] === '/')) {
        if (input[index] === '\n') output += '\n';
        index += 1;
      }
      index += 1;
    } else {
      output += character;
    }
  }
  let normalized = '';
  inString = false;
  escaped = false;
  for (let index = 0; index < output.length; index += 1) {
    const character = output[index];
    if (inString) {
      normalized += character;
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    if (character === ',') {
      let cursor = index + 1;
      while (/\s/.test(output[cursor] ?? '')) cursor += 1;
      if (output[cursor] === '}' || output[cursor] === ']') continue;
    }
    normalized += character;
  }
  return normalized;
}
const errors = [];
let config;
try {
  config = JSON.parse(stripJsonc(readFileSync(configPath, 'utf8')));
  if (!config || typeof config !== 'object' || Array.isArray(config)) errors.push('configuration must be valid JSONC');
} catch {
  errors.push('configuration cannot be parsed');
}
const placeholder = (value) => typeof value !== 'string' || !value.trim() || /replace|placeholder|example\.invalid|localhost/i.test(value);
if (config && typeof config === 'object') {
  if (!/^[0-9a-f]{32}$/i.test(approvedAccountId) || config.account_id !== approvedAccountId) errors.push('configured account_id does not match the separately approved account');
  if (config.workers_dev !== false) errors.push('workers_dev must be explicitly false');
  if (config.preview_urls !== false) errors.push('preview_urls must be explicitly false');
  const vars = config.vars && typeof config.vars === 'object' && !Array.isArray(config.vars) ? config.vars : {};
  for (const name of ['NETWORK_ID', 'API_AUDIENCE', 'CF_ACCESS_AUD', 'CF_ACCESS_TEAM_DOMAIN', 'HUMAN_ORIGIN', 'SCANNER_VERSION', 'SCAN_MAX_AGE_SECONDS']) {
    if (placeholder(vars[name])) errors.push(`${name} is absent or a placeholder`);
  }
  if (typeof vars.SCAN_MAX_AGE_SECONDS === 'string' && (!/^\d+$/.test(vars.SCAN_MAX_AGE_SECONDS) || Number(vars.SCAN_MAX_AGE_SECONDS) < 60)) {
    errors.push('SCAN_MAX_AGE_SECONDS is invalid');
  }
  const routes = Array.isArray(config.routes) ? config.routes : [];
  const route = routes.length === 1 ? routes[0] : null;
  const routeKeys = route && typeof route === 'object' && !Array.isArray(route) ? Object.keys(route) : [];
  const validRouteObject = route && typeof route === 'object' && !Array.isArray(route)
    && route.pattern === approvedRoute && route.custom_domain === false
    && routeKeys.every((key) => ['pattern', 'custom_domain', 'zone_id', 'zone_name'].includes(key));
  if (!approvedRoute) errors.push('operator-approved custom route was not supplied');
  else if (/workers\.dev|pages\.dev/i.test(approvedRoute) || !validRouteObject) errors.push('configuration must contain only the exact approved route object');
  else {
    const routeHost = approvedRoute.replace(/\/\*$/, '').replace(/\/.*$/, '');
    try {
      const audience = new URL(vars.API_AUDIENCE);
      const humanOrigin = new URL(vars.HUMAN_ORIGIN);
      if (audience.protocol !== 'https:' || audience.username || audience.password || audience.pathname !== '/' || audience.search || audience.hash
        || audience.hostname !== routeHost || humanOrigin.origin !== audience.origin || vars.HUMAN_ORIGIN !== humanOrigin.origin) {
        errors.push('API audience, human origin, and approved route are not the same exact HTTPS origin');
      }
    } catch {
      errors.push('API audience or human origin is not a valid URL');
    }
  }
  const databases = Array.isArray(config.d1_databases) ? config.d1_databases : [];
  const db = databases.find((entry) => entry && (entry.database_name === databaseName || entry.binding === databaseName));
  if (!db) errors.push('requested D1 database is not bound in configuration');
  else if (typeof db.database_id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(db.database_id) || /replace|placeholder/i.test(db.database_id)) errors.push('database_id is absent or a placeholder');
  else if (db.database_id !== approvedDatabaseId) errors.push('configured database_id does not match the separately approved D1 UUID');
}
for (const error of errors) console.log(error);
NODE
) || { echo "MACHINE BLOCKER: static configuration inspection failed" >&2; exit 1; }

if [ -n "$static_errors" ]; then
  while IFS= read -r message; do
    [ -n "$message" ] && echo "MACHINE BLOCKER: $message" >&2
  done <<EOF
$static_errors
EOF
  exit 1
fi

scanner_required=yes

npx_bin=${NPX_BIN:-npx}
tmp_dir=$(mktemp -d "${TMPDIR:-/tmp}/commons-preflight.XXXXXX") || {
  echo "MACHINE BLOCKER: cannot create private temporary directory" >&2
  exit 1
}
chmod 700 "$tmp_dir"
trap 'rm -rf "$tmp_dir"' EXIT HUP INT TERM

if ! "$npx_bin" wrangler whoami --json >"$tmp_dir/whoami" 2>"$tmp_dir/whoami.err"; then
  echo "MACHINE BLOCKER: Wrangler authentication is required" >&2
  exit 1
fi
if ! node -e 'const fs=require("fs"); try { const v=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); const expected=process.argv[2]; if (!v || typeof v!=="object" || Array.isArray(v) || v.loggedIn!==true || !Array.isArray(v.accounts) || !v.accounts.some(x=>x && typeof x==="object" && !Array.isArray(x) && x.id===expected)) process.exit(1); } catch { process.exit(1); }' "$tmp_dir/whoami" "$approved_account_id"; then
  echo "MACHINE BLOCKER: Wrangler authentication response is invalid" >&2
  exit 1
fi

if ! "$npx_bin" wrangler secret list --config "$config" --format json >"$tmp_dir/secrets" 2>"$tmp_dir/secrets.err"; then
  echo "MACHINE BLOCKER: required Worker secrets could not be verified" >&2
  exit 1
fi
if [ "$scanner_required" = yes ] && ! node -e 'const fs=require("fs"); try { const v=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); if (!Array.isArray(v) || !v.some(x=>x && x.name==="SCANNER_CALLBACK_TOKEN")) process.exit(1); } catch { process.exit(1); }' "$tmp_dir/secrets"; then
  echo "MACHINE BLOCKER: required scanner secret is absent" >&2
  exit 1
fi

if ! "$npx_bin" wrangler d1 migrations list "$database" --remote --config "$config" >"$tmp_dir/migrations" 2>"$tmp_dir/migrations.err"; then
  echo "MACHINE BLOCKER: remote D1 migration state could not be verified" >&2
  exit 1
fi
if grep -Eiq '(^|[[:space:]│|])[^[:space:]│|]*[0-9][^[:space:]│|]*\.sql([[:space:]│|]|$)' "$tmp_dir/migrations"; then
  echo "MACHINE BLOCKER: unapplied D1 migrations exist" >&2
  exit 1
fi

operator_blocked=no
if [ "${COMMONS_ATTEST_ACCESS_JWT:-}" != verified ]; then
  echo "OPERATOR BLOCKER: Cloudflare Access JWT enforcement is not verified end to end" >&2
  operator_blocked=yes
fi
if [ "${COMMONS_ATTEST_WAF:-}" != verified ]; then
  echo "OPERATOR BLOCKER: WAF, edge body-size, and rate-limit controls are not verified" >&2
  operator_blocked=yes
fi
if [ "${COMMONS_ATTEST_LOG_RETENTION:-}" != verified ]; then
  echo "OPERATOR BLOCKER: log retention and request-body exclusion are not verified" >&2
  operator_blocked=yes
fi
if [ "$scanner_required" = yes ] && [ "${COMMONS_ATTEST_SCANNER:-}" != verified ]; then
  echo "OPERATOR BLOCKER: scanner service integration is not verified end to end" >&2
  operator_blocked=yes
fi
[ "$operator_blocked" = no ] || exit 2

echo "PREFLIGHT PASS: machine checks and operator attestations verified"
