import AppKit
import UserNotifications
import WebKit

/// The window, the material behind the sidebar, the web view the app draws in, the menu bar,
/// and the bridge the page calls for what only the Mac can do.
final class AppDelegate: NSObject, NSApplicationDelegate, WKScriptMessageHandler, WKNavigationDelegate, WKUIDelegate, UNUserNotificationCenterDelegate {
    private var window: NSWindow!
    private var web: WKWebView!
    private var backdrop: NSView?
    private let engine = Engine()
    private var loaded = false

    // MARK: Launch

    func applicationDidFinishLaunching(_ note: Notification) {
        buildMenu()
        buildWindow()
        // Notifications need an app bundle; the bare binary (LINER_UI_URL during development) has none.
        if Bundle.main.bundleIdentifier != nil { UNUserNotificationCenter.current().delegate = self }

        // While developing, point the shell at the Vite server and run the engine yourself.
        if let url = ProcessInfo.processInfo.environment["LINER_UI_URL"].flatMap(URL.init(string:)) {
            inject(token: ProcessInfo.processInfo.environment["LINER_TOKEN"] ?? "liner-dev", base: "")
            web.load(URLRequest(url: url))
            return
        }
        showBoot()
        engine.onReady = { [weak self] ready in
            guard let self else { return }
            // A restarted engine keeps its port and token; the page reconnects by itself.
            if self.loaded { return }
            self.loaded = true
            self.inject(token: ready.token, base: "")
            self.web.load(URLRequest(url: URL(string: "http://127.0.0.1:\(ready.port)/")!))
        }
        engine.onFail = { [weak self] message in self?.fail(message) }
        DispatchQueue.global(qos: .userInitiated).async {
            let keys = Keychain.all()
            DispatchQueue.main.async { self.engine.start(keys: keys) }
        }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if !flag { window.makeKeyAndOrderFront(nil) }
        return true
    }
    func applicationWillTerminate(_ note: Notification) { engine.stop() }

    // MARK: Window

    private func buildWindow() {
        window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1360, height: 860),
            styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
            backing: .buffered, defer: false)
        window.title = "Liner Code"
        window.titleVisibility = .hidden
        window.titlebarAppearsTransparent = true
        window.isOpaque = true
        window.backgroundColor = .windowBackgroundColor
        window.minSize = NSSize(width: 880, height: 580)
        // An empty unified toolbar gives the traffic lights a 52px row, the height of the page's top bar.
        let toolbar = NSToolbar(identifier: "main")
        toolbar.showsBaselineSeparator = false
        window.toolbar = toolbar
        window.toolbarStyle = .unified
        window.setFrameAutosaveName("LinerCodeMain")
        if !window.setFrameUsingName("LinerCodeMain") { window.center() }

        let container = NSView()
        container.wantsLayer = true
        window.contentView = container

        let config = WKWebViewConfiguration()
        config.userContentController.add(self, name: "liner")
        // The Web Inspector is for building Liner Code, not for using it: LINER_INSPECT=1 turns it on.
        let inspect = ProcessInfo.processInfo.environment["LINER_INSPECT"] == "1"
        if inspect { config.preferences.setValue(true, forKey: "developerExtrasEnabled") }
        // The composer is a chat with an agent: no "Write with Siri" pill, Writing Tools or
        // Apple Intelligence suggestions over its fields (the page also says writingsuggestions="false").
        if #available(macOS 15.0, *) { config.writingToolsBehavior = .none }
        config.allowsInlinePredictions = false
        web = AppWebView(frame: .zero, configuration: config)
        web.setValue(false, forKey: "drawsBackground")
        web.underPageBackgroundColor = .clear
        web.navigationDelegate = self
        web.uiDelegate = self
        if #available(macOS 13.3, *) { web.isInspectable = inspect }
        web.translatesAutoresizingMaskIntoConstraints = false

        setMaterial(UserDefaults.standard.string(forKey: "material") ?? "solid")
        container.addSubview(web)
        NSLayoutConstraint.activate([
            web.leadingAnchor.constraint(equalTo: container.leadingAnchor),
            web.trailingAnchor.constraint(equalTo: container.trailingAnchor),
            web.topAnchor.constraint(equalTo: container.topAnchor),
            web.bottomAnchor.constraint(equalTo: container.bottomAnchor),
        ])
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        // macOS 27 floats an Apple Intelligence badge (its "lightweight UI" window) over any focused
        // web text field, even with Writing Tools off for the web view, and offers no switch for it.
        // In a chat box it's in the way, so whenever AppKit puts it up, it goes away again.
        NotificationCenter.default.addObserver(forName: NSApplication.didUpdateNotification, object: nil, queue: .main) { _ in
            for w in NSApp.windows where w.isVisible && String(describing: type(of: w)).contains("LightweightUIHostWindow") {
                w.alphaValue = 0
                w.ignoresMouseEvents = true
                w.orderOut(nil)
            }
        }
        // Full screen hides the traffic lights, so the page's top row moves back to the edge.
        for name in [NSWindow.didEnterFullScreenNotification, NSWindow.didExitFullScreenNotification] {
            NotificationCenter.default.addObserver(forName: name, object: window, queue: .main) { [weak self] _ in self?.syncLights() }
        }
    }

    /// Where the traffic lights sit, as CSS variables, so the sidebar's name lines up with them:
    /// --lc-lights-y is their centre from the top, --lc-lights-x where they end (0 in full screen).
    private func lightsScript() -> String {
        guard let close = window.standardWindowButton(.closeButton), let zoom = window.standardWindowButton(.zoomButton),
              let row = close.superview, let height = window.contentView?.bounds.height else { return "" }
        let c = row.convert(close.frame, to: nil)
        let z = row.convert(zoom.frame, to: nil)
        let full = window.styleMask.contains(.fullScreen)
        let y = Int((height - c.midY).rounded())
        let x = full ? 0 : Int(z.maxX.rounded())
        return "document.documentElement.style.setProperty('--lc-lights-y','\(y)px');document.documentElement.style.setProperty('--lc-lights-x','\(x)px');"
    }

    private func syncLights() {
        web.evaluateJavaScript(lightsScript())
    }

    /// What sits behind the transparent page: Liquid Glass (macOS 26+), classic vibrancy, or solid.
    /// The window is opaque, so macOS composites only what's in it. Vibrancy and Liquid Glass show the
    /// desktop through the sidebar column alone (where the page says it is): a live material behind
    /// the whole window kept WindowServer's GPU busy whenever anything behind it moved.
    private func setMaterial(_ material: String) {
        UserDefaults.standard.set(material, forKey: "material")
        window.isOpaque = true
        window.backgroundColor = .windowBackgroundColor
        backdrop?.removeFromSuperview()
        backdrop = nil
        guard material != "solid", let container = window.contentView else { return }
        let fx = NSVisualEffectView()
        fx.material = .sidebar
        fx.blendingMode = .behindWindow
        fx.state = .followsWindowActiveState
        var view: NSView = fx
        if material == "glass", #available(macOS 26.0, *) {
            // The vibrancy shows the desktop; the glass on top of it gives the rim and lensing.
            let glass = NSGlassEffectView()
            glass.style = .clear
            glass.cornerRadius = 0
            glass.contentView = fx
            view = glass
        }
        view.autoresizingMask = [.height]
        container.addSubview(view, positioned: .below, relativeTo: web)
        backdrop = view
        placeBackdrop()
    }

    /// The sidebar column, in the page's coordinates (top left, points); none while it's hidden.
    private var glassRect = NSRect.zero
    private func placeBackdrop() {
        guard let view = backdrop, let container = window.contentView else { return }
        let r = glassRect
        view.isHidden = r.width < 1 || r.height < 1
        view.frame = NSRect(x: r.minX, y: container.bounds.height - r.maxY, width: r.width, height: r.height)
    }

    /// Tells the page where the engine is and the token it wants, before any of its scripts run.
    private func inject(token: String, base: String) {
        let machine = (Host.current().localizedName ?? "This Mac").replacingOccurrences(of: "\"", with: "")
        let user = NSFullUserName().replacingOccurrences(of: "\"", with: "")
        let js = "window.__LINER__ = { base: \"\(base)\", token: \"\(token)\", machine: \"\(machine)\", user: \"\(user)\" };" + lightsScript()
        web.configuration.userContentController.removeAllUserScripts()
        web.configuration.userContentController.addUserScript(WKUserScript(source: js, injectionTime: .atDocumentStart, forMainFrameOnly: true))
    }

    private func showBoot() {
        let html = """
        <html><body style="margin:0;height:100vh;display:grid;place-items:center;background:transparent;font:13px -apple-system;color:#8a8f98">
        <span>Starting the engine…</span></body></html>
        """
        web.loadHTMLString(html, baseURL: nil)
    }

    private func fail(_ message: String) {
        let alert = NSAlert()
        alert.messageText = "Liner Code can't start"
        alert.informativeText = message
        alert.addButton(withTitle: "Quit")
        alert.addButton(withTitle: "Show the log")
        if alert.runModal() == .alertSecondButtonReturn {
            NSWorkspace.shared.open(FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Logs/Liner Code/engine.log"))
        }
        NSApp.terminate(nil)
    }

    /// Menu-bar commands reach the page as liner:command events.
    private func send(_ command: String) {
        let safe = command.replacingOccurrences(of: "'", with: "")
        web.evaluateJavaScript("window.dispatchEvent(new CustomEvent('liner:command', { detail: '\(safe)' }))")
        window.makeKeyAndOrderFront(nil)
    }

    // MARK: Bridge

    func userContentController(_ ucc: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let method = body["method"] as? String else { return }
        let id = body["id"] as? Int ?? 0
        let p = body["params"] as? [String: Any] ?? [:]
        let reply: (Bool, Any?) -> Void = { [weak self] ok, value in
            let json: String
            if let value, let data = try? JSONSerialization.data(withJSONObject: [value], options: [.fragmentsAllowed]), let s = String(data: data, encoding: .utf8) {
                json = String(s.dropFirst().dropLast())
            } else {
                json = "null"
            }
            self?.web.evaluateJavaScript("window.__linerReply && window.__linerReply(\(id), \(ok), \(json.isEmpty ? "null" : json))")
        }
        switch method {
        case "pickFolder":
            let panel = NSOpenPanel()
            panel.canChooseDirectories = true
            panel.canChooseFiles = false
            panel.allowsMultipleSelection = false
            panel.prompt = "Add project"
            panel.message = "Pick a folder for Liner Code to work in."
            panel.beginSheetModal(for: window) { r in reply(true, r == .OK ? panel.url?.path : nil) }
        case "notify":
            notify(title: p["title"] as? String ?? "", body: p["body"] as? String ?? "", thread: p["threadId"] as? String)
            reply(true, nil)
        case "badge":
            let n = p["count"] as? Int ?? 0
            NSApp.dockTile.badgeLabel = n > 0 ? String(n) : nil
            reply(true, nil)
        case "reveal":
            if let path = p["path"] as? String { NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: path)]) }
            reply(true, nil)
        case "openIn":
            openIn(path: p["path"] as? String ?? "", app: p["app"] as? String ?? "finder")
            reply(true, nil)
        case "runInTerminal":
            runInTerminal(p["command"] as? String ?? "")
            reply(true, nil)
        case "openExternal":
            if let s = p["url"] as? String, let url = URL(string: s), ["https", "http", "mailto"].contains(url.scheme ?? "") { NSWorkspace.shared.open(url) }
            reply(true, nil)
        case "keychainSet":
            let ok = Keychain.set(p["account"] as? String ?? "", p["key"] as? String)
            reply(ok, ok ? nil : "The keychain didn't save it.")
        case "setMaterial":
            setMaterial(p["material"] as? String ?? "glass")
            reply(true, nil)
        case "setGlassRect":
            let num = { (k: String) -> CGFloat in CGFloat((p[k] as? NSNumber)?.doubleValue ?? 0) }
            glassRect = NSRect(x: num("x"), y: num("y"), width: num("width"), height: num("height"))
            placeBackdrop()
            reply(true, nil)
        case "setAppearance":
            let t = p["theme"] as? String
            NSApp.appearance = t == "dark" ? NSAppearance(named: .darkAqua) : t == "light" ? NSAppearance(named: .aqua) : nil
            reply(true, nil)
        case "haptic":
            NSHapticFeedbackManager.defaultPerformer.perform(.generic, performanceTime: .now)
            reply(true, nil)
        case "dragWindow":
            if let event = NSApp.currentEvent { window.performDrag(with: event) }
            reply(true, nil)
        case "zoomWindow":
            window.performZoom(nil)
            reply(true, nil)
        case "setMenuKeys":
            // Your shortcuts, on the menu items that run the same commands.
            for (command, spec) in p["keys"] as? [String: String] ?? [:] { setMenuKey(command, spec) }
            reply(true, nil)
        case "snapshot":
            // A part of the page (the Browser's frame, for an agent), as a PNG.
            let cfg = WKSnapshotConfiguration()
            let num = { (k: String) -> CGFloat in CGFloat((p[k] as? NSNumber)?.doubleValue ?? 0) }
            cfg.rect = CGRect(x: num("x"), y: num("y"), width: num("width"), height: num("height"))
            web.takeSnapshot(with: cfg) { image, error in
                guard let image, let tiff = image.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff), let png = rep.representation(using: .png, properties: [:]) else {
                    reply(false, error?.localizedDescription ?? "The window didn't give a snapshot.")
                    return
                }
                reply(true, png.base64EncodedString())
            }
        default:
            reply(false, "Unknown method \(method)")
        }
    }

    private func notify(title: String, body: String, thread: String?) {
        // Only while you're in another app: in Liner Code, the sidebar already says it.
        if NSApp.isActive || Bundle.main.bundleIdentifier == nil { return }
        let center = UNUserNotificationCenter.current()
        center.requestAuthorization(options: [.alert, .sound, .badge]) { granted, _ in
            guard granted else { return }
            let c = UNMutableNotificationContent()
            c.title = title
            c.body = body
            c.sound = .default
            if let thread { c.userInfo = ["thread": thread] }
            center.add(UNNotificationRequest(identifier: UUID().uuidString, content: c, trigger: nil))
        }
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse, withCompletionHandler done: @escaping () -> Void) {
        if let thread = response.notification.request.content.userInfo["thread"] as? String {
            DispatchQueue.main.async {
                NSApp.activate(ignoringOtherApps: true)
                self.send("open:\(thread)")
            }
        }
        done()
    }

    private func openIn(path: String, app: String) {
        let url = URL(fileURLWithPath: path)
        switch app {
        case "terminal":
            NSWorkspace.shared.open([url], withApplicationAt: URL(fileURLWithPath: "/System/Applications/Utilities/Terminal.app"), configuration: NSWorkspace.OpenConfiguration())
        case "editor":
            let editors = ["com.microsoft.VSCode", "com.todesktop.230313mzl4w4u92", "dev.zed.Zed", "com.apple.dt.Xcode"]
            if let id = editors.first(where: { NSWorkspace.shared.urlForApplication(withBundleIdentifier: $0) != nil }), let app = NSWorkspace.shared.urlForApplication(withBundleIdentifier: id) {
                NSWorkspace.shared.open([url], withApplicationAt: app, configuration: NSWorkspace.OpenConfiguration())
            } else {
                NSWorkspace.shared.open(url)
            }
        default:
            NSWorkspace.shared.open(url)
        }
    }

    /// Sign-in commands run in Terminal, where the tool can ask for what it needs. A .command file
    /// opens there without asking for Automation access.
    private func runInTerminal(_ command: String) {
        guard !command.isEmpty else { return }
        let file = FileManager.default.temporaryDirectory.appendingPathComponent("liner-\(UUID().uuidString.prefix(8)).command")
        let script = "#!/bin/zsh -l\nclear\necho '\\033[1mLiner Code\\033[0m runs: \(command.replacingOccurrences(of: "'", with: ""))'\necho\n\(command)\necho\necho 'Done. You can close this window and go back to Liner Code.'\n"
        do {
            try script.write(to: file, atomically: true, encoding: .utf8)
            try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: file.path)
            NSWorkspace.shared.open(file)
        } catch {
            NSSound.beep()
        }
    }

    // MARK: Web view

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        syncLights()
    }

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        // Links out of the app open in the browser; the app itself stays on the engine's origin.
        if let url = action.request.url, action.navigationType == .linkActivated, url.host != "127.0.0.1", url.host != "localhost" {
            NSWorkspace.shared.open(url)
            decisionHandler(.cancel)
            return
        }
        decisionHandler(.allow)
    }

    /// A link that asks for a new window (target="_blank", like the PR card's View pull request)
    /// opens in the browser; the app never opens a second web view.
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = action.request.url, ["https", "http"].contains(url.scheme ?? "") { NSWorkspace.shared.open(url) }
        return nil
    }

    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.canChooseDirectories = false
        panel.beginSheetModal(for: window) { r in completionHandler(r == .OK ? panel.urls : nil) }
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let a = NSAlert()
        a.messageText = message
        a.beginSheetModal(for: window) { _ in completionHandler() }
    }

    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (String?) -> Void) {
        let a = NSAlert()
        a.messageText = prompt
        let field = NSTextField(frame: NSRect(x: 0, y: 0, width: 320, height: 24))
        field.stringValue = defaultText ?? ""
        a.accessoryView = field
        a.addButton(withTitle: "OK")
        a.addButton(withTitle: "Cancel")
        a.beginSheetModal(for: window) { r in completionHandler(r == .alertFirstButtonReturn ? field.stringValue : nil) }
    }

    // MARK: Menu bar

    private func buildMenu() {
        let main = NSMenu()
        func item(_ title: String, _ key: String, _ mods: NSEvent.ModifierFlags = .command, command: String? = nil, action: Selector? = nil) -> NSMenuItem {
            let i = NSMenuItem(title: title, action: action ?? #selector(menuCommand(_:)), keyEquivalent: key)
            i.keyEquivalentModifierMask = mods
            i.representedObject = command
            i.target = action == nil ? self : nil
            return i
        }
        func add(_ title: String, _ items: [NSMenuItem]) -> NSMenu {
            let top = NSMenuItem()
            let m = NSMenu(title: title)
            items.forEach(m.addItem)
            top.submenu = m
            main.addItem(top)
            return m
        }
        _ = add("Liner Code", [
            NSMenuItem(title: "About Liner Code", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: ""),
            .separator(),
            item("Settings…", ",", command: "settings"),
            .separator(),
            NSMenuItem(title: "Hide Liner Code", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h"),
            NSMenuItem(title: "Quit Liner Code", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q"),
        ])
        _ = add("File", [
            item("New Session", "n", command: "new"),
            item("Add a Project…", "o", command: "open-project"),
            .separator(),
            NSMenuItem(title: "Close Window", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w"),
        ])
        _ = add("Edit", [
            NSMenuItem(title: "Undo", action: Selector(("undo:")), keyEquivalent: "z"),
            item("Redo", "z", [.command, .shift], action: Selector(("redo:"))),
            .separator(),
            NSMenuItem(title: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x"),
            NSMenuItem(title: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c"),
            NSMenuItem(title: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v"),
            NSMenuItem(title: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a"),
        ])
        _ = add("View", [
            item("Command Menu", "k", command: "commands"),
            item("Toggle Sidebar", "\\", command: "sidebar"),
            item("Usage and Cost", "u", [.command, .shift], command: "usage"),
            .separator(),
            item("Enter Full Screen", "f", [.command, .control], action: #selector(NSWindow.toggleFullScreen(_:))),
        ])
        let win = add("Window", [
            NSMenuItem(title: "Minimize", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m"),
            NSMenuItem(title: "Zoom", action: #selector(NSWindow.performZoom(_:)), keyEquivalent: ""),
        ])
        NSApp.windowsMenu = win
        NSApp.mainMenu = main
    }

    /// "mod+shift+u" onto the menu item for that command; an empty spec leaves it without keys.
    private func setMenuKey(_ command: String, _ spec: String) {
        func find(_ menu: NSMenu?) -> NSMenuItem? {
            for i in menu?.items ?? [] {
                if i.representedObject as? String == command { return i }
                if let hit = find(i.submenu) { return hit }
            }
            return nil
        }
        guard let item = find(NSApp.mainMenu) else { return }
        var mods: NSEvent.ModifierFlags = []
        var key = ""
        let parts = spec.lowercased().split(separator: "+", omittingEmptySubsequences: false).map(String.init)
        for (n, part) in parts.enumerated() {
            switch part {
            case "mod", "cmd", "meta": mods.insert(.command)
            case "ctrl", "control": mods.insert(.control)
            case "alt", "option", "opt": mods.insert(.option)
            case "shift": mods.insert(.shift)
            case "": if n == parts.count - 1 { key = "+" }
            default: key = ["comma": ",", "backslash": "\\", "slash": "/", "period": ".", "space": " "][part] ?? part
            }
        }
        item.keyEquivalent = key.count == 1 ? key : ""
        item.keyEquivalentModifierMask = mods
    }

    @objc private func menuCommand(_ sender: NSMenuItem) {
        if let c = sender.representedObject as? String { send(c) }
    }
}

/// The page is an app, not a web page: its right-click menu keeps text actions (Copy, Paste,
/// Look Up) and drops the browser's own (Reload, Back, Inspect Element).
final class AppWebView: WKWebView {
    private static let browserItems: Set<String> = [
        "WKMenuItemIdentifierReload", "WKMenuItemIdentifierGoBack", "WKMenuItemIdentifierGoForward",
        "WKMenuItemIdentifierInspectElement", "WKMenuItemIdentifierOpenLinkInNewWindow",
        "WKMenuItemIdentifierDownloadLinkedFile", "WKMenuItemIdentifierOpenImageInNewWindow",
        "WKMenuItemIdentifierDownloadImage", "WKMenuItemIdentifierOpenFrameInNewWindow",
    ]
    override func willOpenMenu(_ menu: NSMenu, with event: NSEvent) {
        if ProcessInfo.processInfo.environment["LINER_INSPECT"] != "1" {
            for item in menu.items where AppWebView.browserItems.contains(item.identifier?.rawValue ?? "") {
                menu.removeItem(item)
            }
            // No separator left at either end, or on its own.
            while let first = menu.items.first, first.isSeparatorItem { menu.removeItem(first) }
            while let last = menu.items.last, last.isSeparatorItem { menu.removeItem(last) }
        }
        super.willOpenMenu(menu, with: event)
    }
}
