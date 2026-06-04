; Optional: remap Ctrl+Tab to Ctrl+Q so this extension opens with Firefox's chord.
; Requires AutoHotkey v2: https://www.autohotkey.com/
#Requires AutoHotkey v2.0
#SingleInstance Force

^Tab::Send "^q"
+^Tab::Send "^q"
