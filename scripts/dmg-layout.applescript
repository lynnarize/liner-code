-- Lays out the disk image's window: its picture (make-dmg-background.swift), Liner Code on the
-- left and Applications on the right with the arrow between them, and no toolbar or status bar.
-- Finder keeps it in the volume's .DS_Store, which goes into the image.
-- Usage: osascript scripts/dmg-layout.applescript "<volume name>"
on run argv
	set volumeName to item 1 of argv
	tell application "Finder"
		tell disk volumeName
			open
			set current view of container window to icon view
			set toolbar visible of container window to false
			set statusbar visible of container window to false
			set the bounds of container window to {200, 120, 860, 520}
			set viewOptions to the icon view options of container window
			set arrangement of viewOptions to not arranged
			set icon size of viewOptions to 112
			set text size of viewOptions to 13
			set background picture of viewOptions to file ".background:background.tiff"
			set position of item "Liner Code.app" of container window to {170, 152}
			set position of item "Applications" of container window to {490, 152}
			close
			open
			update without registering applications
			delay 2
			close
		end tell
	end tell
end run
