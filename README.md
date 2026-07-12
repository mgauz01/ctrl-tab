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

## Testing

```bash
npm test              # Unit and mocked Chrome integration tests
npm run test:coverage # Unit/integration coverage report
npm run test:e2e      # Build and exercise the overlay in Chromium
npm run check         # Typecheck, unit/integration, build, and browser tests
```

The integration tests use a deterministic Chrome API mock to exercise service
worker lifecycle and tab/window events. Playwright loads the built overlay in
Chromium to verify rendering, keyboard cycling, and commit messaging, then loads
the unpacked extension to verify its manifest, service worker, and fallback page.

## Usage

- Hold **Ctrl** and press **Q** to open the switcher; keep **Ctrl** held and tap **Q** again to cycle right (older tabs).
- **Ctrl+Shift+Q** cycles left (newer tabs). **Tab** / **Shift+Tab** also work while the menu is open.
- Hover a preview to select it.
- Release **Ctrl** / **Cmd** to activate the highlighted tab.

Set both shortcuts at `chrome://extensions/shortcuts` if Chrome doesn't bind them automatically (some platforms reserve **Ctrl+Shift+Q**).

## Optional: remap Ctrl+Tab → Ctrl+Q

Chrome reserves **Ctrl+Tab** for built-in tab order. If you prefer that chord, use the scripts in [`scripts/`](scripts/) to send **Ctrl+Q** instead:

- **Windows**: [`scripts/remap-ctrl-tab.ahk`](scripts/remap-ctrl-tab.ahk) (AutoHotkey v2).
- **Linux (X11)**: [`scripts/remap-ctrl-tab.sh`](scripts/remap-ctrl-tab.sh) (xbindkeys + xdotool).

## Note on Ctrl+Q

On some Linux desktops, **Ctrl+Q** quits the active application. If that conflicts, pick another shortcut at `chrome://extensions/shortcuts`.

## Restricted pages

Chrome forbids in-page overlays on `chrome://`, the New Tab Page, the Web Store, and PDF viewer pages. On those pages the switcher opens a small **popup window** anchored near the bottom of the screen (instead of a full tab). Release **Ctrl** to land on a tab in your original window; the popup closes automatically. The popup is never tracked as a recent tab.

## License

MIT
