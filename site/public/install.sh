#!/usr/bin/env bash
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
MUTED='\033[0;2m'
NC='\033[0m'

usage() {
    cat <<EOF
kajji Installer

Usage: install.sh [options]

Options:
    -h, --help              Display this help message
    -v, --version <version> Install a specific version (e.g., 0.1.1)
        --no-modify-path    Don't modify shell config files

Examples:
    curl -fsSL https://kajji.sh/install.sh | bash
    curl -fsSL https://kajji.sh/install.sh | bash -s -- --version 0.1.1
EOF
}

requested_version=${VERSION:-}
no_modify_path=false

while [[ $# -gt 0 ]]; do
    case "$1" in
        -h|--help)
            usage
            exit 0
            ;;
        -v|--version)
            if [[ -n "${2:-}" ]]; then
                requested_version="$2"
                shift 2
            else
                echo -e "${RED}Error: --version requires a version argument${NC}"
                exit 1
            fi
            ;;
        --no-modify-path)
            no_modify_path=true
            shift
            ;;
        *)
            echo -e "${RED}Unknown option: $1${NC}" >&2
            shift
            ;;
    esac
done

raw_os=$(uname -s)
case "$raw_os" in
    Darwin*) os="darwin" ;;
    Linux*) os="linux" ;;
    *)
        echo -e "${RED}Unsupported OS: $raw_os${NC}"
        exit 1
        ;;
esac

arch=$(uname -m)
case "$arch" in
    aarch64|arm64) arch="arm64" ;;
    x86_64) arch="x64" ;;
    *)
        echo -e "${RED}Unsupported architecture: $arch${NC}"
        exit 1
        ;;
esac

if [ "$os" = "darwin" ] && [ "$arch" = "x64" ]; then
    rosetta_flag=$(sysctl -n sysctl.proc_translated 2>/dev/null || echo 0)
    if [ "$rosetta_flag" = "1" ]; then
        arch="arm64"
    fi
fi

target="$os-$arch"
archive_ext=".zip"
[ "$os" = "linux" ] && archive_ext=".tar.gz"

filename="kajji-${target}${archive_ext}"

if [ "$os" = "linux" ]; then
    if ! command -v tar >/dev/null 2>&1; then
        echo -e "${RED}Error: 'tar' is required but not installed.${NC}"
        exit 1
    fi
else
    if ! command -v unzip >/dev/null 2>&1; then
        echo -e "${RED}Error: 'unzip' is required but not installed.${NC}"
        exit 1
    fi
fi

INSTALL_DIR=$HOME/.kajji/bin
is_upgrade=false
existing_version=""

if [[ -f "$INSTALL_DIR/kajji" ]]; then
    is_upgrade=true
    if [[ -x "$INSTALL_DIR/kajji" ]]; then
        # Avoid loading a bunfig.toml from the directory where the installer
        # happens to be running, which can break the standalone binary.
        existing_version=$(cd / && "$INSTALL_DIR/kajji" --version 2>/dev/null || true)
        existing_version=${existing_version%%$'\n'*}
        existing_version=${existing_version%$'\r'}
        existing_version=${existing_version#v}
    fi
fi

mkdir -p "$INSTALL_DIR"

if [ -z "$requested_version" ]; then
    url="https://github.com/eliaskc/kajji/releases/latest/download/$filename"
    version=$(curl -sI "https://github.com/eliaskc/kajji/releases/latest" | grep -i "^location:" | sed -n 's/.*\/v\([^[:space:]]*\).*/\1/p' | tr -d '\r')
    if [ -z "$version" ]; then
        version="latest"
    fi
else
    requested_version="${requested_version#v}"
    url="https://github.com/eliaskc/kajji/releases/download/v${requested_version}/$filename"
    version=$requested_version
fi

already_installed=false
if [[ -n "$existing_version" ]] && [[ "$existing_version" == "$version" ]]; then
    already_installed=true
else
    unbuffered_sed() {
        if echo | sed -u -e "" >/dev/null 2>&1; then
            sed -nu "$@"
        elif echo | sed -l -e "" >/dev/null 2>&1; then
            sed -nl "$@"
        else
            local pad
            pad="$(printf "\n%512s" "")"
            sed -ne "s/$/\\${pad}/" "$@"
        fi
    }

    print_progress() {
        local bytes=$1
        local length=$2
        [[ "$length" -gt 0 ]] || return 0

        local width=40
        local percent=$((bytes * 100 / length))
        [[ "$percent" -gt 100 ]] && percent=100
        local filled_width=$((percent * width / 100))
        local empty_width=$((width - filled_width))
        local filled empty
        filled=$(printf "%*s" "$filled_width" "")
        empty=$(printf "%*s" "$empty_width" "")
        filled=${filled// /■}
        empty=${empty// /･}

        printf "\r${GREEN}%s%s %3d%%${NC}" "$filled" "$empty" "$percent" >&4
    }

    download_with_progress() {
        local download_url=$1
        local output=$2
        local tracefile="${TMPDIR:-/tmp}/kajji_install_$$.trace"

        exec 4>&2
        rm -f "$tracefile"
        mkfifo "$tracefile"
        printf "\033[?25l" >&4
        trap 'trap - RETURN; rm -f "$tracefile"; printf "\033[?25h" >&4; exec 4>&-' RETURN

        curl -f --trace-ascii "$tracefile" -sSL -o "$output" "$download_url" &
        local curl_pid=$!

        unbuffered_sed \
            -e 'y/ACDEGHLNORTV/acdeghlnortv/' \
            -e '/^0000: content-length:/p' \
            -e '/^<= recv data/p' \
            "$tracefile" | {
                local length=0
                local bytes=0
                while IFS=" " read -r -a line; do
                    [[ "${#line[@]}" -lt 2 ]] && continue
                    local tag="${line[0]} ${line[1]}"
                    if [[ "$tag" == "0000: content-length:" ]]; then
                        length=${line[2]//$'\r'/}
                        bytes=0
                    elif [[ "$tag" == "<= recv" ]]; then
                        bytes=$((bytes + line[3]))
                        print_progress "$bytes" "$length"
                    fi
                done
            }

        wait "$curl_pid"
        local result=$?
        echo "" >&4
        return "$result"
    }

    echo -e "${MUTED}Downloading kajji v${version} · ${target}${NC}"

    tmp_dir=$(mktemp -d)
    trap 'rm -rf "$tmp_dir"' EXIT

    download_succeeded=false
    if [[ -t 2 ]]; then
        download_with_progress "$url" "$tmp_dir/$filename" && download_succeeded=true
    elif curl -fsSL -o "$tmp_dir/$filename" "$url"; then
        download_succeeded=true
    fi

    if [[ "$download_succeeded" != "true" ]]; then
        echo -e "${RED}Failed to download kajji${NC}"
        echo -e "${MUTED}URL: $url${NC}"
        exit 1
    fi

    if [ "$os" = "linux" ]; then
        tar -xzf "$tmp_dir/$filename" -C "$tmp_dir"
    else
        unzip -q "$tmp_dir/$filename" -d "$tmp_dir"
    fi

    mv "$tmp_dir/kajji" "$INSTALL_DIR/kajji"
    chmod 755 "$INSTALL_DIR/kajji"
fi

path_is_configured=false
path_was_added=false
modified_config_file=""
add_to_path() {
    local config_file=$1
    local command=$2

    if grep -Fxq "$command" "$config_file" 2>/dev/null; then
        path_is_configured=true
        return
    fi

    if [[ -w $config_file ]]; then
        echo "" >> "$config_file"
        echo "# kajji" >> "$config_file"
        echo "$command" >> "$config_file"
        path_is_configured=true
        path_was_added=true
        modified_config_file=$config_file
    fi
}

current_shell=$(basename "${SHELL:-sh}")
path_command="export PATH=$INSTALL_DIR:\$PATH"

if [[ "$is_upgrade" != "true" ]] && [[ ":$PATH:" != *":$INSTALL_DIR:"* ]]; then
    case $current_shell in
        fish)
            path_command="fish_add_path $INSTALL_DIR"
            if [[ "$no_modify_path" != "true" ]]; then
                config_file="${XDG_CONFIG_HOME:-$HOME/.config}/fish/config.fish"
                [[ -f $config_file ]] && add_to_path "$config_file" "$path_command"
            fi
            ;;
        nu|nushell)
            path_command="\$env.PATH = (\$env.PATH | prepend \"$INSTALL_DIR\")"
            if [[ "$no_modify_path" != "true" ]]; then
                config_file="${XDG_CONFIG_HOME:-$HOME/.config}/nushell/env.nu"
                [[ -f $config_file ]] && add_to_path "$config_file" "$path_command"
            fi
            ;;
        zsh)
            if [[ "$no_modify_path" != "true" ]]; then
                for f in "${ZDOTDIR:-$HOME}/.zshrc" "${ZDOTDIR:-$HOME}/.zshenv"; do
                    [[ -f $f ]] && { add_to_path "$f" "$path_command"; break; }
                done
            fi
            ;;
        bash)
            if [[ "$no_modify_path" != "true" ]]; then
                for f in "$HOME/.bashrc" "$HOME/.bash_profile" "$HOME/.profile"; do
                    [[ -f $f ]] && { add_to_path "$f" "$path_command"; break; }
                done
            fi
            ;;
        ash|dash|sh|ksh)
            if [[ "$no_modify_path" != "true" ]]; then
                for f in "$HOME/.profile" "$HOME/.${current_shell}rc"; do
                    [[ -f $f ]] && { add_to_path "$f" "$path_command"; break; }
                done
            fi
            ;;
    esac
fi

if [ -n "${GITHUB_ACTIONS:-}" ]; then
    echo "$INSTALL_DIR" >> "$GITHUB_PATH"
fi

echo ""
if [[ "$already_installed" == "true" ]]; then
    echo -e "${GREEN}✓${NC} kajji v${version} is already up to date ${MUTED}· ${target}${NC}"
elif [[ "$is_upgrade" == "true" ]]; then
    if [[ -n "$existing_version" ]]; then
        echo -e "${GREEN}✓${NC} Updated kajji v${existing_version} → v${version} ${MUTED}· ${target}${NC}"
    else
        echo -e "${GREEN}✓${NC} Updated kajji to v${version} ${MUTED}· ${target}${NC}"
    fi
else
    echo -ne "${GREEN}"
    cat << 'EOF'
██╗  ██╗ █████╗      ██╗     ██╗██╗
██║ ██╔╝██╔══██╗     ██║     ██║██║
█████╔╝ ███████║     ██║     ██║██║
██╔═██╗ ██╔══██║██   ██║██   ██║██║
██║  ██╗██║  ██║╚█████╔╝╚█████╔╝██║
╚═╝  ╚═╝╚═╝  ╚═╝ ╚════╝  ╚════╝ ╚═╝
EOF
    echo -e "${NC}"
    echo -e "${GREEN}✓${NC} Installed kajji v${version} ${MUTED}· ${target}${NC}"
fi
if [[ "$path_was_added" == "true" ]]; then
    echo -e "${MUTED}Added kajji to PATH in $modified_config_file${NC}"
fi
if [[ "$is_upgrade" != "true" ]]; then
    echo ""
    if [[ ":$PATH:" != *":$INSTALL_DIR:"* ]]; then
        if [[ "$path_is_configured" == "true" ]]; then
            echo "Restart your shell or run:"
        else
            echo "Add kajji to your PATH:"
        fi
        echo "  \$ $path_command"
        echo ""
        echo "Once you've done that, give kajji a go with:"
    else
        echo "You're all set. To give kajji a go, run:"
    fi
    echo "  \$ cd <jj-or-git-repo>"
    echo "  \$ kajji"
fi
