#!/usr/bin/env bash
# Writes your Gemini API key into .env without it appearing on screen or in
# your shell history.
#
#   ./scripts/set-key.sh
#
set -euo pipefail
cd "$(dirname "$0")/.."

[ -f .env ] || cp .env.example .env

printf 'Paste your Gemini API key (it will not be shown), then press Enter:\n> '
read -rs KEY
printf '\n'

KEY="$(printf '%s' "$KEY" | tr -d '[:space:]' | tr -d '"'"'"'')"

if [ -z "$KEY" ]; then
  echo "Nothing pasted. .env was not changed."
  exit 1
fi
# Google issues two key formats: the older AIza… (39 chars) and the newer
# AQ.… (about 53). Accept both, reject anything else.
if ! printf '%s' "$KEY" | grep -qE '^(AIza|AQ\.)'; then
  echo "That does not look like a Gemini key — they begin with AIza or AQ."
  echo ".env was not changed. Get one at https://aistudio.google.com/apikey"
  exit 1
fi
if [ "${#KEY}" -lt 30 ]; then
  echo "That key looks too short (${#KEY} characters)."
  echo ".env was not changed."
  exit 1
fi

# Replace the line if it exists, append it if it does not.
if grep -q '^GEMINI_API_KEY=' .env; then
  tmp="$(mktemp)"
  grep -v '^GEMINI_API_KEY=' .env > "$tmp"
  printf 'GEMINI_API_KEY=%s\n' "$KEY" >> "$tmp"
  mv "$tmp" .env
else
  printf 'GEMINI_API_KEY=%s\n' "$KEY" >> .env
fi
chmod 600 .env

echo "Saved to .env (${#KEY} characters, begins ${KEY:0:6}…)."
echo "Now restart:  npm start"
