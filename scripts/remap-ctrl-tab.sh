#!/usr/bin/env bash
# Linux (X11): example xbindkeys mapping Ctrl+Tab -> Ctrl+Shift+E
# Install: sudo apt install xbindkeys xdotool
# Add to ~/.xbindkeysrc:
#
#   "xdotool key ctrl+shift+e"
#       m:0x5 + c:23
#   (control+mod4+Tab — adjust with xev)
#
# Then: xbindkeys -p
#
# Wayland: use your compositor's key remapping (e.g. sway/hyprland binds).

set -euo pipefail
echo "See comments in this script for xbindkeys setup."
echo "Extension default shortcut: Ctrl+Shift+E"
