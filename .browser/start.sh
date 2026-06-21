#!/bin/bash
# Launch Chrome with CDP for browser automation
# Uses persistent profile in .browser/data for session persistence

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
USER_DATA_DIR="$SCRIPT_DIR/data"
CDP_PORT="${CDP_PORT:-9920}"
UI_PORT="${UI_PORT:-6373}"
# CDP ports of externally-managed browsers to reuse (e.g. PortOS on 5556).
# Space-separated; keep in sync with browserConfig.sharedCdpPorts.
SHARED_CDP_PORTS="${SHARED_CDP_PORTS:-5556}"
APP_URL="http://localhost:${UI_PORT}"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

# If a shared CDP browser (e.g. PortOS's) is already running, don't launch our
# own — the SparseTree server auto-connects to it. Just open the app tab in the
# default browser once the UI is up, then exit so this pm2 process stays
# cleanly stopped (autorestart is off for sparsetree-browser).
for port in $SHARED_CDP_PORTS; do
  if curl -sf -o /dev/null --max-time 1 "http://localhost:${port}/json/version"; then
    echo "Shared CDP browser found on port ${port}; skipping own Chrome launch."
    (
      for _ in $(seq 1 60); do
        if curl -sf -o /dev/null "$APP_URL"; then open "$APP_URL"; break; fi
        sleep 1
      done
    ) &
    exit 0
  fi
done

# Create data directory if it doesn't exist
mkdir -p "$USER_DATA_DIR"

echo "Starting Chrome with CDP on port $CDP_PORT..."
echo "Profile directory: $USER_DATA_DIR"

# Once the UI dev server is reachable, open the app in a tab so the user
# doesn't have to hunt for the URL. Runs in the background and reuses the
# Chrome instance launched below (same --user-data-dir = new tab, not a new
# window). Waits up to ~60s for Vite to come up.
(
  for _ in $(seq 1 60); do
    if curl -sf -o /dev/null "$APP_URL"; then
      echo "UI is up — opening $APP_URL"
      "$CHROME" --user-data-dir="$USER_DATA_DIR" "$APP_URL" >/dev/null 2>&1
      exit 0
    fi
    sleep 1
  done
  echo "Timed out waiting for UI at $APP_URL; not opening app tab."
) &

exec "$CHROME" \
  --remote-debugging-port="$CDP_PORT" \
  --user-data-dir="$USER_DATA_DIR" \
  --no-first-run \
  --no-default-browser-check \
  --disable-background-timer-throttling \
  --disable-backgrounding-occluded-windows \
  --disable-renderer-backgrounding \
  "$@"
