#!/usr/bin/env bash
# InstructionsLoaded: log which instruction file loaded, why, and which file triggered it
jq -r '[(now | todate), .load_reason, (.file_path | sub(".*/\\.claude/"; ".claude/")), (.trigger_file_path // "-")] | @tsv' \
  >> "${CLAUDE_PROJECT_DIR:-.}/.claude/instructions.log"