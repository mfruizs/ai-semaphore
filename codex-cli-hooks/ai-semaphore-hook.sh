#!/usr/bin/env bash

# Configure the token once here, or export AI_SEMAPHORE_TOKEN before Codex.
STATE="${1:-}"
PORT="${AI_SEMAPHORE_PORT:-47663}"
TOKEN="${AI_SEMAPHORE_TOKEN:-<YOUR_TOKEN>}"
LOG_DIR="${XDG_CACHE_HOME:-$HOME/.cache}/ai-semaphore"
LOG_FILE="$LOG_DIR/codex-hook.log"

# A notification failure must never block Codex or write to its stdout.
exec 2>/dev/null
umask 077
mkdir -p "$LOG_DIR" || true

log_error() {
    printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$1" >> "$LOG_FILE" || true
}

case "$STATE" in
    red|yellow|green) ;;
    *) log_error "Invalid state; expected red, yellow or green"; exit 0 ;;
esac

if [[ ! "$PORT" =~ ^[0-9]{1,5}$ ]] || (( 10#$PORT < 1 || 10#$PORT > 65535 )); then
    log_error "Invalid AI_SEMAPHORE_PORT; expected 1..65535"
    exit 0
fi
PORT=$((10#$PORT))

if [[ -z "$TOKEN" || "$TOKEN" == '<YOUR_TOKEN>' ]]; then
    log_error "AI Semaphore token not configured"
    exit 0
fi
# Tokens are printable ASCII without spaces or header control characters.
if [[ "$TOKEN" == *[!\!-\~]* ]]; then
    log_error "Invalid AI Semaphore token format"
    exit 0
fi

if ! command -v curl >/dev/null; then
    log_error "curl is not installed"
    exit 0
fi

# Ignore curlrc and proxies so this request always goes directly to loopback.
# Discard response bodies and diagnostics to keep tokens out of the log.
HTTP_CODE="$(curl --disable --silent --noproxy '*' \
    --connect-timeout 1 --max-time 2 \
    --output /dev/null --write-out '%{http_code}' \
    --request POST \
    --header 'Content-Type: application/json' \
    --header "Authorization: Bearer ${TOKEN}" \
    --data "{\"state\":\"${STATE}\"}" \
    "http://127.0.0.1:${PORT}/status/codex")"
CURL_EXIT=$?

if (( CURL_EXIT != 0 )); then
    log_error "AI Semaphore request failed: curl exit=$CURL_EXIT state=$STATE port=$PORT"
elif [[ "$HTTP_CODE" != '204' ]]; then
    log_error "AI Semaphore returned HTTP $HTTP_CODE state=$STATE port=$PORT (expected 204)"
fi

# Empty stdout and exit 0 are a successful, non-blocking Codex hook.
exit 0
