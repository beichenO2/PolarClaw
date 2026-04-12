#!/bin/bash
# MyClaw Full Test Suite Runner (Phase 4: REQ-C04)
# Runs all tests, generates report, exits with proper code

set -o pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
REPORT_DIR="$ROOT_DIR/.planning/reports/tests"
REPORT_FILE="$REPORT_DIR/latest.md"
mkdir -p "$REPORT_DIR"

PASSED=0
FAILED=0
ERRORS=()
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')

echo "═══════════════════════════════════════"
echo "  MyClaw Test Suite — $TIMESTAMP"
echo "═══════════════════════════════════════"
echo ""

run_test() {
  local name="$1"
  local file="$2"
  echo -n "  [$name] "

  if [ ! -f "$file" ]; then
    echo "SKIP (file not found)"
    return
  fi

  OUTPUT=$(node --test "$file" 2>&1)
  EXIT=$?

  if [ $EXIT -eq 0 ]; then
    echo "PASS"
    PASSED=$((PASSED + 1))
  else
    echo "FAIL (exit: $EXIT)"
    FAILED=$((FAILED + 1))
    ERRORS+=("### $name\n\`\`\`\n$(echo "$OUTPUT" | tail -30)\n\`\`\`\n")
  fi
}

echo "Running tests..."
echo ""

run_test "Security"       "$ROOT_DIR/tests/security.test.mjs"
run_test "LLM Router"    "$ROOT_DIR/tests/llm-router.test.mjs"
run_test "Plan Engine"   "$ROOT_DIR/tests/planner.test.mjs"
run_test "Integrations"  "$ROOT_DIR/tests/integrations.test.mjs"
run_test "MemPalace"     "$ROOT_DIR/tests/mempalace.test.mjs"
run_test "Research"      "$ROOT_DIR/tests/research.test.mjs"
run_test "E2E Integration" "$ROOT_DIR/tests/e2e-integration.test.mjs"

echo ""
echo "═══════════════════════════════════════"
echo "  Results: $PASSED passed, $FAILED failed"
echo "═══════════════════════════════════════"

# Generate report
{
  echo "# Test Report — $TIMESTAMP"
  echo ""
  echo "| Metric | Value |"
  echo "|--------|-------|"
  echo "| Passed | $PASSED |"
  echo "| Failed | $FAILED |"
  echo "| Total  | $((PASSED + FAILED)) |"
  echo ""
  if [ $FAILED -gt 0 ]; then
    echo "## Failures"
    echo ""
    for err in "${ERRORS[@]}"; do
      echo -e "$err"
    done
  else
    echo "All tests passed."
  fi
} > "$REPORT_FILE"

cp "$REPORT_FILE" "$REPORT_DIR/report-$(date '+%Y%m%d-%H%M%S').md"

if [ $FAILED -gt 0 ]; then
  exit 1
fi
exit 0
