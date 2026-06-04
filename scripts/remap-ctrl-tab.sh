#!/usr/bin/env bash
# Linux (X11): optional xbindkeys mapping Ctrl+Tab -> Ctrl+Q
# Install: sudo apt install xbindkeys xdotool
# Add to ~/.xbindkeysrc:
#
#   "xdotool key ctrl+q"
#       m:0x5 + c:23
#   (control+mod4+Tab — adjust with xev)
#
# Then: xbindkeys -p
#
# Wayland: use your compositor's key remapping (e.g. sway/hyprland binds).

set -euo pipefail
echo "See comments in this script for xbindkeys setup."
echo "Extension default shortcut: Ctrl+Q"
