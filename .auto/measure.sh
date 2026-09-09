#!/bin/bash
set -euo pipefail
# Single bundled-binary run requested by the user. No warmup or repetition.
bun .auto/measure-binary.ts
