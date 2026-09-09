#!/bin/bash
set -euo pipefail
mkdir -p .auto/check-output
bun check >.auto/check-output/types.log 2>&1 || { tail -80 .auto/check-output/types.log; exit 1; }
bun test >.auto/check-output/tests.log 2>&1 || { tail -80 .auto/check-output/tests.log; exit 1; }
tail -5 .auto/check-output/tests.log
