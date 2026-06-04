# Ctrl+Tab MRU Switcher

Firefox-style recent-tab switcher for Chrome: hold **Ctrl**, press **Tab** to cycle up to 5 most recently used tabs in the current window, release **Ctrl** to switch. Bottom-half previews with highlighted titles.

## Setup

```bash
npm install
npm run build
```

1. Open `chrome://extensions`, enable **Developer mode**, **Load unpacked** → this repo root.
2. Open `chrome://extensions/shortcuts` and confirm **Open recent-tab switcher** is bound (default **Ctrl+Shift+E**).
3. Optional: remap OS **Ctrl+Tab** → extension shortcut — see [scripts/](scripts/).

## Usage

- Press the switcher shortcut (or remapped **Ctrl+Tab**).
- While holding **Ctrl** / **Cmd**: **Tab** moves right (older), **Shift+Tab** moves left (newer).
- Hover a preview to select it.
- Release **Ctrl** / **Cmd** to activate the highlighted tab.

## Why not native Ctrl+Tab?

Chrome reserves **Ctrl+Tab** for built-in tab order. Use **Ctrl+Shift+E** or OS remap scripts in [`scripts/`](scripts/):

- **Windows**: run [`scripts/remap-ctrl-tab.ahk`](scripts/remap-ctrl-tab.ahk) (AutoHotkey v2).
- **Linux (X11)**: see [`scripts/remap-ctrl-tab.sh`](scripts/remap-ctrl-tab.sh) for xbindkeys + xdotool.

## Restricted pages

On `chrome://`, Web Store, or PDF viewer pages, the switcher opens a short-lived extension tab to capture **Ctrl** release, then closes after you land on a tab.

## License

MIT
