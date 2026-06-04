; Remap Ctrl+Tab to Ctrl+Shift+E so the Ctrl+Tab MRU extension opens.
; Requires AutoHotkey v2: https://www.autohotkey.com/
#Requires AutoHotkey v2.0
#SingleInstance Force

^Tab::Send "^+e"
+^Tab::Send "^+e"
