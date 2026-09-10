#!/bin/bash
set -euo pipefail
# Always rebuild so a source edit cannot be measured against a stale executable.
# Compilation and fixture preparation are outside the parsed startup metric.
bun .auto/build-binary.ts
bun .auto/measure-bundled-suite.ts
