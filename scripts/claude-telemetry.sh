#!/usr/bin/env bash
# Start Claude Code with metrics going to the local sink (npm run telemetry:sink).
# Project settings can't turn telemetry on, so this sets it for one launch only.
# Usage: scripts/claude-telemetry.sh [any claude arguments]
export CLAUDE_CODE_ENABLE_TELEMETRY=1
export OTEL_METRICS_EXPORTER=otlp
export OTEL_LOGS_EXPORTER=none
export OTEL_EXPORTER_OTLP_PROTOCOL=http/json
export OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318
# Send fewer identifiers in the first place; the sink drops the rest (user.email is always sent).
export OTEL_METRICS_INCLUDE_SESSION_ID=false
export OTEL_METRICS_INCLUDE_ACCOUNT_UUID=false
export OTEL_RESOURCE_ATTRIBUTES="team.id=${PILOT_TEAM:-web}"
exec claude "$@"