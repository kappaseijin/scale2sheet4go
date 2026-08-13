#!/usr/bin/env bash
set -euo pipefail

# Contract test for scripts/run-google-external-acceptance.sh.  This test uses
# a fake binary only to verify the runner's local safety boundary and argument
# construction; it is never evidence of a real Google API acceptance.

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
runner="$repo_root/scripts/run-google-external-acceptance.sh"
root="$(mktemp -d "${TMPDIR:-/tmp}/scale2sheet-google-external-contract.XXXXXX")"
fake_invoked="$root/fake-invoked"
fake_args="$root/fake-args"
cleanup() {
  rm -rf "$root"
}
trap cleanup EXIT

fail() {
  echo "FAIL: $1" >&2
  exit 1
}

expect_rejected() {
  local name="$1"
  local expected="$2"
  shift 2
  local log="$root/${name}.log"
  set +e
  ( "$@" ) >"$log" 2>&1
  local status=$?
  set -e
  [ "$status" -ne 0 ] || fail "$name unexpectedly succeeded"
  grep -Fq "$expected" "$log" || {
    echo "--- $name ---" >&2
    sed -n '1,120p' "$log" >&2
    fail "$name did not report $expected"
  }
}

mkdir -p "$root/home" "$root/input" "$root/credentials"
chmod 700 "$root/home"
printf '%s\n' 'scale2sheet-external-acceptance-v1' >"$root/home/.scale2sheet-external-acceptance"
chmod 600 "$root/home/.scale2sheet-external-acceptance"
printf '%s\n' '{"type":"service_account","private_key":"fixture"}' >"$root/credentials/service-account.json"
chmod 600 "$root/credentials/service-account.json"

cat >"$root/fake-scale2sheet" <<EOF
#!/usr/bin/env bash
printf '%s\n' "\$*" >>"$fake_args"
printf '%s\n' 'fake-secret-that-must-not-escape' >&2
touch "$fake_invoked"
case "\$1" in
  auth)
    mkdir -p "\$HOME/.config/scale2sheet"
    printf '%s\n' '{"access_token":"fixture","refresh_token":"fixture"}' >"\$HOME/.config/scale2sheet/google-fit-token.json"
    chmod 600 "\$HOME/.config/scale2sheet/google-fit-token.json"
    ;;
  serve)
    receipt="\$HOME/.config/scale2sheet/active-run.json"
    mkdir -p "\$(dirname "\$receipt")"
    printf '%s\n' '{"kind":"serve"}' >"\$receipt"
    trap "rm -f \"\$receipt\"; exit 0" TERM INT
    while :; do sleep 1; done
    ;;
esac
exit 0
EOF
chmod 700 "$root/fake-scale2sheet"

common_env=(
  SCALE2SHEET_EXTERNAL_ACCEPTANCE=1
  SCALE2SHEET_EXTERNAL_HOME="$root/home"
  SCALE2SHEET_EXTERNAL_SHEET_ID="1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcd"
  SCALE2SHEET_EXTERNAL_SHEETS_CREDENTIALS="$root/credentials/service-account.json"
  SCALE2SHEET_EXTERNAL_INPUT_DIR="$root/input"
  SCALE2SHEET_EXTERNAL_BINARY="$root/fake-scale2sheet"
  GOOGLE_FIT_CLIENT_ID=fixture-client-id
  GOOGLE_FIT_CLIENT_SECRET=fixture-client-secret
)

expect_rejected "missing-opt-in" "SCALE2SHEET_EXTERNAL_ACCEPTANCE" \
  env -i HOME="$HOME" PATH="$PATH" \
  SCALE2SHEET_EXTERNAL_HOME="$root/home" \
  SCALE2SHEET_EXTERNAL_SHEET_ID="1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcd" \
  SCALE2SHEET_EXTERNAL_SHEETS_CREDENTIALS="$root/credentials/service-account.json" \
  "$runner" at-01

expect_rejected "current-home" "must differ from current HOME" \
  env -i HOME="$HOME" PATH="$PATH" "${common_env[@]}" \
  SCALE2SHEET_EXTERNAL_HOME="$HOME" \
  "$runner" at-01

expect_rejected "placeholder-sheet" "looks like a fixture" \
  env -i HOME="$HOME" PATH="$PATH" "${common_env[@]}" \
  SCALE2SHEET_EXTERNAL_SHEET_ID="acceptance-fixture-not-a-real-spreadsheet" \
  "$runner" at-01

chmod 644 "$root/credentials/service-account.json"
expect_rejected "credential-permissions" "owner-only permissions" \
  env -i HOME="$HOME" PATH="$PATH" "${common_env[@]}" \
  "$runner" at-01
chmod 600 "$root/credentials/service-account.json"

unmarked_home="$root/unmarked-home"
mkdir -m 700 "$unmarked_home"
expect_rejected "missing-marker" "marker is missing or invalid" \
  env -i HOME="$HOME" PATH="$PATH" "${common_env[@]}" \
  SCALE2SHEET_EXTERNAL_HOME="$unmarked_home" \
  "$runner" at-01

missing_credentials="$root/missing-service-account.json"
expect_rejected "missing-credentials" "credentials file is missing" \
  env -i HOME="$HOME" PATH="$PATH" "${common_env[@]}" \
  SCALE2SHEET_EXTERNAL_SHEETS_CREDENTIALS="$missing_credentials" \
  "$runner" at-01

[ ! -e "$fake_invoked" ] || fail "rejected inputs started the selected child binary"

if ! env -i HOME="$HOME" PATH="$PATH" "${common_env[@]}" \
  "$runner" at-01 >"$root/valid.log" 2>&1; then
  sed -n '1,120p' "$root/valid.log" >&2
  fail "valid isolated runner invocation failed"
fi
grep -Fq 'PASS: AT-01 command completed' "$root/valid.log" || fail "valid invocation did not report a command pass"
[ -e "$fake_invoked" ] || fail "valid invocation did not start the selected binary"
! grep -Fq 'fake-secret-that-must-not-escape' "$root/valid.log" || fail "raw child secret escaped runner output"
grep -Fq -- '--period morning --date ' "$fake_args" || fail "AT-01 arguments were not passed to the binary"
[ -f "$root/home/.config/scale2sheet/settings.json" ] || fail "isolated settings were not created"
[ "$(stat -f '%Lp' "$root/home/.config/scale2sheet/settings.json")" = '600' ] || fail "isolated settings are not mode 0600"

if ! env -i HOME="$HOME" PATH="$PATH" "${common_env[@]}" \
  SCALE2SHEET_EXTERNAL_PAST_DATE='2026-08-12' \
  SCALE2SHEET_EXTERNAL_SERVE_CRON='* * * * *' \
  SCALE2SHEET_EXTERNAL_SERVE_SECONDS=1 \
  "$runner" all >"$root/all.log" 2>&1; then
  sed -n '1,120p' "$root/all.log" >&2
  fail "all external runner cases did not complete with fake command boundaries"
fi
for label in AT-06 AT-04 AT-01 AT-02 AT-03 AT-05; do
  grep -Fq "PASS: $label" "$root/all.log" || fail "$label did not complete in all case"
done
[ "$(stat -f '%Lp' "$root/home/.config/scale2sheet/google-fit-token.json")" = '600' ] || fail "fake auth token is not mode 0600"
! grep -Fq 'fake-secret-that-must-not-escape' "$root/all.log" || fail "raw child secret escaped all-case output"

echo 'PASS: Google external acceptance runner safety boundary and argument contract'
