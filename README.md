# Ctrl+Q MRU Switcher

Firefox-style recent-tab switcher for Chrome: press **Ctrl+Q** to open the menu, hold **Ctrl** and press **Tab** to cycle up to 5 most recently used tabs in the current window, then release **Ctrl** to switch. Bottom-half previews with highlighted titles.

## Setup

```bash
npm install
npm run build
```

1. Open `chrome://extensions`, enable **Developer mode**, **Load unpacked** → this repo root.
2. Open `chrome://extensions/shortcuts` and confirm **Open recent-tab switcher** is bound to **Ctrl+Q** (set it manually if needed).
3. Reload the extension after rebuilding.

## Usage

- Press **Ctrl+Q** to open the switcher (keep **Ctrl** held).
- While holding **Ctrl** / **Cmd**: **Tab** moves right (older), **Shift+Tab** moves left (newer).
- Hover a preview to select it.
- Release **Ctrl** / **Cmd** to activate the highlighted tab.

## Optional: remap Ctrl+Tab → Ctrl+Q

Chrome reserves **Ctrl+Tab** for built-in tab order. If you prefer that chord, use the scripts in [`scripts/`](scripts/) to send **Ctrl+Q** instead:

- **Windows**: [`scripts/remap-ctrl-tab.ahk`](scripts/remap-ctrl-tab.ahk) (AutoHotkey v2).
- **Linux (X11)**: [`scripts/remap-ctrl-tab.sh`](scripts/remap-ctrl-tab.sh) (xbindkeys + xdotool).

## Note on Ctrl+Q

On some Linux desktops, **Ctrl+Q** quits the active application. If that conflicts, pick another shortcut at `chrome://extensions/shortcuts`.

## Restricted pages

On `chrome://`, Web Store, or PDF viewer pages, the switcher opens a short-lived extension tab to capture **Ctrl** release, then closes after you land on a tab.

## License

MIT
