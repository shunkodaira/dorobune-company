#!/bin/sh
cd "$(dirname "$0")"
set -a; . ./.env; set +a
export LLM_PROVIDER=openai
exec node server.js
