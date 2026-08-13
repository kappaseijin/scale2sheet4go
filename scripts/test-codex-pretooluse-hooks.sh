#!/usr/bin/env bash
set -euo pipefail

# Contract test for the global Codex PreToolUse hooks.  Codex treats
# permissionDecision=allow as an input-rewrite decision, so an allow-only
# response is invalid.  A hook that has nothing to block must exit 0 without
# stdout; an informational hook must return additionalContext only.

auto_allow="/Users/kappa/.agents/bin/auto-allow-agent-cmds.sh"
reminder="/Users/kappa/.codex/hooks/retrospective-reminder.sh"

fail() {
  echo "FAIL: $1" >&2
  exit 1
}

[ -x "$auto_allow" ] || fail "auto-allow hook is not executable: $auto_allow"
[ -x "$reminder" ] || fail "retrospective hook is not executable: $reminder"
command -v jq >/dev/null 2>&1 || fail "jq is required"

run_hook() {
  local hook="$1"
  local input="$2"
  local output_file="$3"
  local status

  set +e
  printf '%s\n' "$input" | bash "$hook" >"$output_file"
  status=$?
  set -e
  [ "$status" -eq 0 ] || fail "hook failed: $hook (status=$status)"
}

root="$(mktemp -d "${TMPDIR:-/tmp}/scale2sheet-pretooluse-contract.XXXXXX")"
trap 'rm -rf "$root"' EXIT

allowed_input="$(jq -cn '{hook_event_name:"PreToolUse",tool_name:"Bash",tool_input:{command:"~/.agents/skills/agmsg/scripts/team.sh scale2sheet"}}')"
run_hook "$auto_allow" "$allowed_input" "$root/auto-allow.out"
[ ! -s "$root/auto-allow.out" ] || fail "auto-allow returned output for an allowed command"

close_input="$(jq -cn '{hook_event_name:"PreToolUse",tool_name:"Bash",tool_input:{command:"herdr workspace close w4A"}}')"
run_hook "$reminder" "$close_input" "$root/reminder.out"
[ -s "$root/reminder.out" ] || fail "retrospective hook did not return context"

permission_decision="$(jq -r '.hookSpecificOutput.permissionDecision // empty' "$root/reminder.out")"
[ -z "$permission_decision" ] || fail "retrospective hook returned permissionDecision=$permission_decision"

additional_context="$(jq -r '.hookSpecificOutput.additionalContext // empty' "$root/reminder.out")"
[ -n "$additional_context" ] || fail "retrospective hook did not return additionalContext"

ordinary_input="$(jq -cn '{hook_event_name:"PreToolUse",tool_name:"Bash",tool_input:{command:"printf hello"}}')"
run_hook "$reminder" "$ordinary_input" "$root/ordinary.out"
[ ! -s "$root/ordinary.out" ] || fail "retrospective hook returned output for an ordinary command"

echo 'PASS: Codex PreToolUse hook output contract'
