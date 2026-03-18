#!/usr/bin/env bash
#
# Ruflo Uninstaller
# Removes Ruflo (formerly Claude Flow), optional Claude Code MCP config,
# and optionally Claude Code CLI.
#
# Usage:
#   bash uninstall-ruflo.sh
#   bash uninstall-ruflo.sh --global
#   bash uninstall-ruflo.sh --global --remove-mcp
#   bash uninstall-ruflo.sh --global --remove-claude
#   bash uninstall-ruflo.sh --full
#
# Options:
#   --global          Uninstall global npm package
#   --remove-mcp      Remove Ruflo MCP server from Claude Code
#   --remove-claude   Also uninstall Claude Code CLI
#   --full            Global uninstall + remove MCP + remove Claude Code CLI
#   --help, -h        Show help
#

set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

GLOBAL="${CLAUDE_FLOW_GLOBAL:-0}"
REMOVE_MCP="${CLAUDE_FLOW_REMOVE_MCP:-0}"
REMOVE_CLAUDE="${CLAUDE_FLOW_REMOVE_CLAUDE:-0}"

while [[ $# -gt 0 ]]; do
    case "$1" in
        --global|-g)
            GLOBAL="1"
            shift
            ;;
        --remove-mcp|--mcp)
            REMOVE_MCP="1"
            shift
            ;;
        --remove-claude)
            REMOVE_CLAUDE="1"
            shift
            ;;
        --full|-f)
            GLOBAL="1"
            REMOVE_MCP="1"
            REMOVE_CLAUDE="1"
            shift
            ;;
        --help|-h)
            echo "Ruflo Uninstaller"
            echo ""
            echo "Usage: bash uninstall-ruflo.sh [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --global, -g      Uninstall global npm package"
            echo "  --remove-mcp      Remove Ruflo MCP server from Claude Code"
            echo "  --remove-claude   Also uninstall Claude Code CLI"
            echo "  --full, -f        Global uninstall + remove MCP + remove Claude Code CLI"
            echo "  --help, -h        Show this help"
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

print_banner() {
    echo ""
    echo -e "${CYAN}╔═══════════════════════════════════════════════════════════╗${NC}"
    echo -e "${CYAN}║${NC}  ${BOLD}Ruflo Uninstaller${NC}                                      ${CYAN}║${NC}"
    echo -e "${CYAN}╚═══════════════════════════════════════════════════════════╝${NC}"
    echo ""
}

print_step() {
    echo -e "${GREEN}▸${NC} $1"
}

print_substep() {
    echo -e "  ${DIM}├─${NC} $1"
}

print_success() {
    echo -e "${GREEN}✓${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}⚠${NC} $1"
}

print_error() {
    echo -e "${RED}✗${NC} $1"
}

remove_global_package() {
    if [ "$GLOBAL" != "1" ]; then
        print_step "Skipping global package removal"
        print_substep "Run with ${BOLD}--global${NC} if Ruflo was installed via npm install -g"
        echo ""
        return 0
    fi

    print_step "Removing global npm packages..."

    if ! command -v npm >/dev/null 2>&1; then
        print_warning "npm not found, cannot uninstall global packages automatically"
        echo ""
        return 0
    fi

    local removed_any=0

    if npm list -g --depth=0 2>/dev/null | grep -q 'ruflo@'; then
        npm uninstall -g ruflo >/dev/null 2>&1 || true
        print_substep "Removed global package: ruflo"
        removed_any=1
    fi

    if npm list -g --depth=0 2>/dev/null | grep -q 'claude-flow@'; then
        npm uninstall -g claude-flow >/dev/null 2>&1 || true
        print_substep "Removed legacy global package: claude-flow"
        removed_any=1
    fi

    if [ "$removed_any" -eq 0 ]; then
        print_substep "No global Ruflo/Claude Flow package found"
    fi

    echo ""
}

remove_mcp_config() {
    if [ "$REMOVE_MCP" != "1" ]; then
        return 0
    fi

    print_step "Removing Claude Code MCP configuration..."

    if ! command -v claude >/dev/null 2>&1; then
        print_warning "Claude CLI not found, skipping MCP removal"
        echo ""
        return 0
    fi

    local removed=0

    if claude mcp list 2>/dev/null | grep -q 'ruflo'; then
        claude mcp remove ruflo >/dev/null 2>&1 || true
        print_substep "Removed MCP server: ruflo"
        removed=1
    fi

    if claude mcp list 2>/dev/null | grep -q 'claude-flow'; then
        claude mcp remove claude-flow >/dev/null 2>&1 || true
        print_substep "Removed legacy MCP server: claude-flow"
        removed=1
    fi

    if [ "$removed" -eq 0 ]; then
        print_substep "No Ruflo/Claude Flow MCP server found"
    fi

    echo ""
}

remove_claude_cli() {
    if [ "$REMOVE_CLAUDE" != "1" ]; then
        return 0
    fi

    print_step "Removing Claude Code CLI..."

    if ! command -v npm >/dev/null 2>&1; then
        print_warning "npm not found, cannot uninstall Claude Code CLI automatically"
        echo ""
        return 0
    fi

    if npm list -g --depth=0 2>/dev/null | grep -q '@anthropic-ai/claude-code@'; then
        npm uninstall -g @anthropic-ai/claude-code >/dev/null 2>&1 || true
        print_substep "Removed global package: @anthropic-ai/claude-code"
    else
        print_substep "Claude Code CLI not installed globally"
    fi

    echo ""
}

show_cleanup_note() {
    print_step "Notes"
    print_substep "npx does not install a persistent global package unless you used npm install -g"
    print_substep "You may still have npm cache entries from prior npx runs"
    print_substep "To clear cache manually: ${BOLD}npm cache clean --force${NC}"
    echo ""
}

main() {
    print_banner
    remove_global_package
    remove_mcp_config
    remove_claude_cli
    show_cleanup_note
    print_success "${BOLD}Uninstallation complete.${NC}"
    echo ""
}

main "$@"
