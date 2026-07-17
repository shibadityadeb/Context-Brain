# Company Brain — Meeting capture bot.
# Linux-only: headless Chromium (via Playwright, run headful under Xvfb),
# PulseAudio virtual sink, ffmpeg and a locally-built whisper.cpp. Captures a
# Google Meet's tab audio and transcribes it on-device — no paid APIs.
FROM mcr.microsoft.com/playwright:v1.49.1-jammy

ENV DEBIAN_FRONTEND=noninteractive \
    WHISPER_MODEL_DIR=/models \
    PULSE_MONITOR_SOURCE=meet_sink.monitor

# System deps: audio stack + build toolchain for whisper.cpp.
RUN apt-get update && apt-get install -y --no-install-recommends \
      xvfb pulseaudio pulseaudio-utils ffmpeg \
      build-essential cmake git ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

# Build whisper.cpp and install the CLI + fetch the base.en model.
ARG WHISPER_MODEL=base.en
RUN git clone --depth 1 https://github.com/ggerganov/whisper.cpp /opt/whisper.cpp \
    && cmake -S /opt/whisper.cpp -B /opt/whisper.cpp/build -DCMAKE_BUILD_TYPE=Release \
    && cmake --build /opt/whisper.cpp/build --config Release -j "$(nproc)" \
    && install -m 0755 /opt/whisper.cpp/build/bin/whisper-cli /usr/local/bin/whisper-cli \
    && mkdir -p ${WHISPER_MODEL_DIR} \
    && /opt/whisper.cpp/models/download-ggml-model.sh ${WHISPER_MODEL} \
    && cp /opt/whisper.cpp/models/ggml-${WHISPER_MODEL}.bin ${WHISPER_MODEL_DIR}/ \
    && rm -rf /opt/whisper.cpp/build

# Install only the bot's runtime dependencies (Chromium ships in the base).
# We use plain npm — not pnpm/corepack — to sidestep the base image's stale
# corepack signing keys, and strip devDependencies (which include a
# workspace-only package npm can't resolve) so the image builds standalone.
WORKDIR /app
COPY package.json ./
RUN node -e "const p=require('./package.json'); delete p.devDependencies; delete p.packageManager; require('fs').writeFileSync('./package.json', JSON.stringify(p, null, 2));" \
    && npm install --omit=dev --no-audit --no-fund

COPY tsconfig.json ./
COPY src ./src
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

EXPOSE 4200
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["npm", "start"]
