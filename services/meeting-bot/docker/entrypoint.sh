#!/usr/bin/env bash
# Bring up the virtual display + audio stack, then hand off to the bot.
# Chromium (headful under Xvfb) renders the Meet tab's audio into a PulseAudio
# null sink whose .monitor source ffmpeg captures.
set -euo pipefail

export DISPLAY="${DISPLAY:-:99}"
SCREEN="${XVFB_SCREEN:-1280x800x24}"

# 1. Virtual framebuffer so Chromium can run headful (required for tab audio).
Xvfb "${DISPLAY}" -screen 0 "${SCREEN}" -nolisten tcp &
sleep 1

# 2. PulseAudio in the container, with a null sink as the default output.
pulseaudio --start --exit-idle-time=-1 --disallow-exit >/dev/null 2>&1 || true
sleep 1
pactl load-module module-null-sink sink_name=meet_sink \
  sink_properties=device.description=meet_sink >/dev/null 2>&1 || true
pactl set-default-sink meet_sink >/dev/null 2>&1 || true

echo "meeting-bot: display=${DISPLAY} sink=meet_sink monitor=${PULSE_MONITOR_SOURCE:-meet_sink.monitor}"

exec "$@"
