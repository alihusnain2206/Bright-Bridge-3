#!/usr/bin/env bash
# Test plan for injectSalariedCompensations fix.
# Uses app server endpoints throughout (no direct Rollfi creds needed).

set -euo pipefail

BASE="http://localhost:8080"
COMPANY_ID="ORG-SUNSHINE"
PAY_PERIOD_ID="338FA4C5-3178-4AAA-8442-7573C76FAC41"
DIANE_UUID="B11D088D-79BC-4390-8E76-DE0F58BA8E8F"
JOHN_UUID="B7B17DF6-9575-4FF8-B4E5-3B89F01C5B36"
# Valid Rollfi comp description (from /api/rollfi/compensation-types)
COMP_DESC="Bonus"

PASS=0
FAIL=0

assert() {
  local label="$1" actual="$2" expected="$3"
  if [ "$actual" = "$expected" ]; then
    echo "  ✅ $label"
    ((PASS++)) || true
  else
    echo "  ❌ $label — expected '$expected', got '$actual'"
    ((FAIL++)) || true
  fi
}

assert_near() {
  local label="$1" actual="$2" expected="$3"
  local ok
  ok=$(awk -v a="$actual" -v e="$expected" 'BEGIN { d=a-e; if(d<0)d=-d; print (d<0.05)?"yes":"no" }')
  if [ "$ok" = "yes" ]; then
    echo "  ✅ $label ($actual)"
    ((PASS++)) || true
  else
    echo "  ❌ $label — expected ~$expected, got '$actual'"
    ((FAIL++)) || true
  fi
}

# ── Auth ──────────────────────────────────────────────────────────────────────
echo "── Login ──"
COOKIE_JAR=$(mktemp)
LOGIN_RESP=$(curl -s -c "$COOKIE_JAR" -X POST "$BASE/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"manager@sunshine.com","password":"Manager123!"}')
if echo "$LOGIN_RESP" | grep -q '"role"'; then
  echo "  ✅ Logged in as Susan Manager"
else
  echo "  ❌ Login failed: $LOGIN_RESP"
  exit 1
fi
COOKIE_HEADER=$(awk 'NF>7 {printf "%s=%s; ", $6, $7}' "$COOKIE_JAR" | sed 's/; $//')

# ── Read helpers (via app server) ─────────────────────────────────────────────
get_state() {
  curl -s "$BASE/api/rollfi/payperiod/details?companyId=$COMPANY_ID&payPeriodId=$PAY_PERIOD_ID" \
    -H "Cookie: $COOKIE_HEADER" | node -e "
let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{
  try {
    const raw=JSON.parse(d);
    const items=(raw?.payPeriod??[])[0]?.payrollLineItems??[];
    const diane=items.find(i=>(i.userId??'').toUpperCase()==='$DIANE_UUID');
    const john =items.find(i=>(i.userId??'').toUpperCase()==='$JOHN_UUID');
    const dc=(diane?.additionalCompensations??[]).map(c=>c.amount).join(',');
    const dl=(diane?.additionalCompensations??[]).length;
    const jl=(john?.additionalCompensations??[]).length;
    // diane: payHours|baseTotal|grossTotal|compAmounts|compLen
    // john:  payHours|baseTotal|compLen
    process.stdout.write('DIANE:'+(diane?.payHours??'NF')+'|'+(diane?.baseTotal??'NF')+'|'+(diane?.grossTotal??'NF')+'|'+dc+'|'+dl+'\\n');
    process.stdout.write('JOHN:'+(john?.payHours??'NF')+'|'+(john?.baseTotal??'NF')+'|'+jl+'\\n');
  } catch(e){ process.stdout.write('ERR:'+e.message+'\\n'); }
});
"
}

do_import() {
  local adj="$1"
  local resp
  resp=$(curl -s -X POST "$BASE/api/rollfi/payroll/import" \
    -H "Content-Type: application/json" \
    -H "Cookie: $COOKIE_HEADER" \
    -d "{\"companyId\":\"$COMPANY_ID\",\"payPeriodId\":\"$PAY_PERIOD_ID\",\"adjustments\":$adj}")
  if echo "$resp" | grep -q '"salariedCompWarnings"'; then
    echo "  ⚠ salariedCompWarnings: $(echo "$resp" | node -e \
      "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{console.log(JSON.stringify(JSON.parse(d).salariedCompWarnings))}catch(e){}})")"
  fi
  if ! echo "$resp" | grep -q '"success":true'; then
    echo "  ❌ import failed: $(echo "$resp" | head -c 400)"
    ((FAIL++)) || true
    return
  fi
  echo "  ✔ import OK"
}

read_diane() {
  local state; state=$(get_state)
  local diane; diane=$(echo "$state" | grep '^DIANE:' | sed 's/^DIANE://')
  echo "$diane"
}

read_john() {
  local state; state=$(get_state)
  local john; john=$(echo "$state" | grep '^JOHN:' | sed 's/^JOHN://')
  echo "$john"
}

# ── Baseline ──────────────────────────────────────────────────────────────────
echo ""
echo "── Baseline ──"
STATE=$(get_state)
IFS='|' read -r ph bt gt comp compLen <<< "$(echo "$STATE" | grep '^DIANE:' | sed 's/^DIANE://')"
echo "  Diane: payHours=$ph | baseTotal=$bt | gross=$gt | comp=[$comp] (#$compLen)"
assert "Baseline payHours=48" "$ph" "48"
assert_near "Baseline baseTotal=1338.46" "$bt" "1338.46"
assert "Baseline comp empty" "$compLen" "0"
IFS='|' read -r jph jbt jcl <<< "$(echo "$STATE" | grep '^JOHN:' | sed 's/^JOHN://')"
echo "  John: payHours=$jph | baseTotal=$jbt | compLen=$jcl"

# ── T1: Diane + $200 Bonus ────────────────────────────────────────────────────
echo ""
echo "── T1: Diane + \$200 $COMP_DESC ──"
do_import "[{\"rollfiUserId\":\"$DIANE_UUID\",\"additionalCompensation\":[{\"description\":\"$COMP_DESC\",\"amount\":200}],\"overTime\":[]}]"
IFS='|' read -r ph bt gt comp compLen <<< "$(read_diane)"
echo "  Diane: payHours=$ph | baseTotal=$bt | gross=$gt | comp=[$comp] (#$compLen)"
assert "T1 payHours=48" "$ph" "48"
assert_near "T1 baseTotal=1338.46" "$bt" "1338.46"
assert "T1 compLen=1" "$compLen" "1"
assert_near "T1 comp=200" "$comp" "200"
assert_near "T1 grossTotal=1538.46" "$gt" "1538.46"

# ── T2: Change to $350 ────────────────────────────────────────────────────────
echo ""
echo "── T2: Change to \$350 ──"
do_import "[{\"rollfiUserId\":\"$DIANE_UUID\",\"additionalCompensation\":[{\"description\":\"$COMP_DESC\",\"amount\":350}],\"overTime\":[]}]"
IFS='|' read -r ph bt gt comp compLen <<< "$(read_diane)"
echo "  Diane: payHours=$ph | baseTotal=$bt | gross=$gt | comp=[$comp] (#$compLen)"
assert "T2 payHours=48" "$ph" "48"
assert_near "T2 baseTotal=1338.46" "$bt" "1338.46"
assert "T2 compLen=1 (replaced not stacked)" "$compLen" "1"
assert_near "T2 comp=350" "$comp" "350"
assert_near "T2 grossTotal=1688.46" "$gt" "1688.46"

# ── T3: Remove bonus ──────────────────────────────────────────────────────────
echo ""
echo "── T3: Remove bonus ──"
do_import "[{\"rollfiUserId\":\"$DIANE_UUID\",\"additionalCompensation\":[],\"overTime\":[]}]"
IFS='|' read -r ph bt gt comp compLen <<< "$(read_diane)"
echo "  Diane: payHours=$ph | baseTotal=$bt | gross=$gt | comp=[$comp] (#$compLen)"
assert "T3 payHours=48" "$ph" "48"
assert_near "T3 baseTotal=1338.46" "$bt" "1338.46"
assert "T3 comp empty" "$compLen" "0"
assert_near "T3 grossTotal=1338.46" "$gt" "1338.46"

# ── T4: No Diane in adjustments at all ────────────────────────────────────────
echo ""
echo "── T4: Import with empty adjustments (Diane entirely absent) ──"
do_import "[]"
IFS='|' read -r ph bt gt comp compLen <<< "$(read_diane)"
echo "  Diane: payHours=$ph | baseTotal=$bt | gross=$gt | comp=[$comp] (#$compLen)"
assert "T4 payHours=48" "$ph" "48"
assert_near "T4 baseTotal=1338.46" "$bt" "1338.46"
assert "T4 comp empty" "$compLen" "0"

# ── T5: Import twice — no accumulation ───────────────────────────────────────
echo ""
echo "── T5: Import twice with \$200 Bonus — no accumulation ──"
ADJ="[{\"rollfiUserId\":\"$DIANE_UUID\",\"additionalCompensation\":[{\"description\":\"$COMP_DESC\",\"amount\":200}],\"overTime\":[]}]"
do_import "$ADJ"
echo "  (first import done)"
do_import "$ADJ"
echo "  (second import done)"
IFS='|' read -r ph bt gt comp compLen <<< "$(read_diane)"
echo "  Diane: payHours=$ph | baseTotal=$bt | gross=$gt | comp=[$comp] (#$compLen)"
assert "T5 payHours=48" "$ph" "48"
assert_near "T5 baseTotal=1338.46" "$bt" "1338.46"
assert "T5 compLen=1 (no stacking)" "$compLen" "1"
assert_near "T5 comp=200" "$comp" "200"
assert_near "T5 grossTotal=1538.46" "$gt" "1538.46"

# ── T6: Hourly employees unaffected ───────────────────────────────────────────
echo ""
echo "── T6: John Smith (hourly) unaffected by any import ──"
# Run another import with Diane + $300 — John should be untouched
do_import "[{\"rollfiUserId\":\"$DIANE_UUID\",\"additionalCompensation\":[{\"description\":\"$COMP_DESC\",\"amount\":300}],\"overTime\":[]}]"
STATE=$(get_state)
IFS='|' read -r jph jbt jcl <<< "$(echo "$STATE" | grep '^JOHN:' | sed 's/^JOHN://')"
echo "  John: payHours=$jph | baseTotal=$jbt | compLen=$jcl"
assert "T6 John payHours>0" "$(awk -v h="$jph" 'BEGIN{print (h+0>0)?"yes":"no"}')" "yes"
assert "T6 John comp empty" "$jcl" "0"
IFS='|' read -r ph bt gt comp compLen <<< "$(echo "$STATE" | grep '^DIANE:' | sed 's/^DIANE://')"
echo "  Diane: payHours=$ph | baseTotal=$bt | gross=$gt | comp=[$comp] (#$compLen)"
assert "T6 Diane payHours=48" "$ph" "48"
assert_near "T6 Diane baseTotal=1338.46" "$bt" "1338.46"
assert_near "T6 Diane comp=300" "$comp" "300"

# ── Cleanup: leave Diane clean ───────────────────────────────────────────────
echo ""
echo "── Cleanup: remove all comp ──"
do_import "[{\"rollfiUserId\":\"$DIANE_UUID\",\"additionalCompensation\":[],\"overTime\":[]}]"
IFS='|' read -r ph bt gt comp compLen <<< "$(read_diane)"
echo "  Diane: payHours=$ph | baseTotal=$bt | gross=$gt | comp=[$comp] (#$compLen)"
assert "Cleanup payHours=48" "$ph" "48"
assert_near "Cleanup baseTotal=1338.46" "$bt" "1338.46"
assert "Cleanup comp empty" "$compLen" "0"

rm -f "$COOKIE_JAR"

echo ""
echo "Results: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ] && echo "✅ All tests passed." || echo "❌ Some tests failed."
exit $FAIL
