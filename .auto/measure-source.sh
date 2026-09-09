#!/bin/bash
set -euo pipefail
out=".kajji-benchmarks/startup-auto/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$out"
app_root="${KAJJI_MEASURE_ROOT:-$PWD}"
for fixture in stress goodmorning; do
    bun "$app_root/scripts/benchmark.ts" run --fixture ".kajji-benchmarks/fixtures/$fixture" --runs 3 --warmups 1 --scenarios diff --steps 20 --passes 1 --output "$out/$fixture.json" >"$out/$fixture.log" 2>&1 || { tail -60 "$out/$fixture.log"; exit 1; }
done
python3 - "$out" <<'PY'
import json, math, statistics, sys
from pathlib import Path
root=Path(sys.argv[1])
reports=[json.loads((root/f'{name}.json').read_text()) for name in ['stress','goodmorning']]
def med(r,key):
    values=[run['startup'][key] for run in r['runs']]
    assert values and all(math.isfinite(v) and v>=0 for v in values), (key,values)
    return statistics.median(values)
startup=[med(r,'contentReadyOutputMs') for r in reports]
metrics={'startup_ms':math.sqrt(startup[0]*startup[1]),'stress_ms':startup[0],'real_ms':startup[1], 'highlighted_ms':statistics.mean(med(r,'highlightedReadyOutputMs') for r in reports), 'first_frame_ms':statistics.mean(med(r,'firstOutputFrameMs') for r in reports), 'recovery_ms':statistics.median(b['metrics']['recoveryMs'] for r in reports for run in r['runs'] for b in run['bursts'])}
print('Reports:',root)
for r in reports: print('Startup samples:', [round(run['startup']['contentReadyOutputMs'],2) for run in r['runs']])
for k,v in metrics.items(): print(f'METRIC {k}={v:.6f}')
PY
