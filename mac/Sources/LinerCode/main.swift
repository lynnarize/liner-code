import AppKit

// Liner Code starts here: one app delegate owns the window, the engine and the bridge.
let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
