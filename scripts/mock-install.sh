#!/usr/bin/env bash
# Runs site/public/install.sh scenarios against mocked downloads and a
# temporary HOME, so no network access or real shell config is touched.
# Useful for previewing installer output while iterating on it.
#
# Usage:
#   scripts/mock-install.sh              # run all scenarios
#   scripts/mock-install.sh upgrade      # run specific scenario(s)
#
# Scenarios: fresh, fresh-config, on-path, no-modify, upgrade, up-to-date
set -euo pipefail

repo_root=$(cd "$(dirname "$0")/.." && pwd)
installer="$repo_root/site/public/install.sh"

sandbox=$(mktemp -d)
trap 'rm -rf "$sandbox"' EXIT
mockbin="$sandbox/mockbin"
mkdir -p "$mockbin"

# Pin the platform so scenarios behave the same everywhere.
cat > "$mockbin/uname" <<'EOF'
#!/bin/sh
[ "${1:-}" = "-m" ] && echo arm64 || echo Darwin
EOF

# Fake download. Supports the installer's three curl uses: latest-version
# lookup (-sI), progress download (--trace-ascii), and plain download (-o).
cat > "$mockbin/curl" <<'EOF'
#!/bin/bash
trace="" output="" head=false
while [[ $# -gt 0 ]]; do
    case "$1" in
        --trace-ascii) shift; trace=$1 ;;
        -o) shift; output=$1 ;;
        -sI) head=true ;;
    esac
    shift
done
if [[ "$head" == "true" ]]; then
    printf 'location: https://github.com/eliaskc/kajji/releases/tag/v%s\r\n' "${MOCK_LATEST_VERSION:-0.17.0}"
    exit 0
fi
if [[ -n "$trace" ]]; then
    exec 7>"$trace"
    printf '0000: content-length: 1000\r\n' >&7
    for _ in $(seq 100); do
        printf '<= Recv data, 10 bytes (0xa)\n' >&7
        sleep 0.04
    done
fi
[[ -n "$output" ]] && : > "$output"
exit 0
EOF

# Fake archive extraction: produce a kajji binary that reports the version
# the installer just "downloaded".
cat > "$mockbin/unzip" <<'EOF'
#!/bin/sh
while [ "$#" -gt 0 ]; do
    [ "$1" = "-d" ] && { shift; dest=$1; }
    shift
done
printf '#!/bin/sh\necho %s\n' "$MOCK_VERSION" > "$dest/kajji"
chmod +x "$dest/kajji"
EOF

chmod +x "$mockbin"/*

run_installer() {
    local home=$1 version=$2 shell=$3
    shift 3
    env HOME="$home" SHELL="$shell" PATH="$mockbin:/usr/bin:/bin" \
        MOCK_VERSION="$version" \
        bash "$installer" --version "$version" "$@"
}

scenario_index=0
heading() {
    scenario_index=$((scenario_index + 1))
    local cols
    cols=$(tput cols 2>/dev/null || echo 80)
    local label
    label=$(printf ' %d/%d  %s ' "$scenario_index" "${#scenarios[@]}" "$1")
    printf '\n\n\033[1;30;43m%-*s\033[0m\n\n' "$cols" "$label"
}

scenario_fresh() {
    heading "fresh install, no shell config to modify"
    local home
    home=$(mktemp -d "$sandbox/home.XXXXXX")
    run_installer "$home" 0.17.0 /bin/fish
}

scenario_fresh_config() {
    heading "fresh install, fish config gets modified"
    local home
    home=$(mktemp -d "$sandbox/home.XXXXXX")
    mkdir -p "$home/.config/fish"
    touch "$home/.config/fish/config.fish"
    run_installer "$home" 0.17.0 /bin/fish
    printf '\n\033[1mconfig.fish tail:\033[0m\n'
    tail -n 3 "$home/.config/fish/config.fish"
}

scenario_on_path() {
    heading "fresh install, install dir already on PATH"
    local home
    home=$(mktemp -d "$sandbox/home.XXXXXX")
    env HOME="$home" SHELL=/bin/fish PATH="$home/.kajji/bin:$mockbin:/usr/bin:/bin" \
        MOCK_VERSION=0.17.0 \
        bash "$installer" --version 0.17.0
}

scenario_no_modify() {
    heading "fresh install with --no-modify-path"
    local home
    home=$(mktemp -d "$sandbox/home.XXXXXX")
    mkdir -p "$home/.config/fish"
    touch "$home/.config/fish/config.fish"
    run_installer "$home" 0.17.0 /bin/fish --no-modify-path
}

scenario_upgrade() {
    heading "upgrade from 0.16.0 to 0.17.0"
    local home
    home=$(mktemp -d "$sandbox/home.XXXXXX")
    run_installer "$home" 0.16.0 /bin/fish --no-modify-path > /dev/null
    run_installer "$home" 0.17.0 /bin/fish --no-modify-path
}

scenario_up_to_date() {
    heading "already up to date (second install of same version)"
    local home
    home=$(mktemp -d "$sandbox/home.XXXXXX")
    run_installer "$home" 0.17.0 /bin/fish --no-modify-path > /dev/null
    run_installer "$home" 0.17.0 /bin/fish --no-modify-path
}

all_scenarios=(fresh fresh-config on-path no-modify upgrade up-to-date)
if [[ $# -gt 0 ]]; then
    scenarios=("$@")
else
    scenarios=("${all_scenarios[@]}")
fi

for scenario in "${scenarios[@]}"; do
    case "$scenario" in
        fresh) scenario_fresh ;;
        fresh-config) scenario_fresh_config ;;
        on-path) scenario_on_path ;;
        no-modify) scenario_no_modify ;;
        upgrade) scenario_upgrade ;;
        up-to-date) scenario_up_to_date ;;
        *)
            echo "Unknown scenario: $scenario" >&2
            echo "Available: ${all_scenarios[*]}" >&2
            exit 1
            ;;
    esac
done
