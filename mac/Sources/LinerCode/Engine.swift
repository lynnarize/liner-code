import Foundation

/// The engine, as a child process: Node runs engine/src/main.ts, which prints
/// `LINER_READY {"port":…}` once it listens. Its stdin stays open; when the app quits, the
/// pipe closes and the engine stops with it. If it crashes, it comes back on the same port and
/// token, so the page reconnects on its own.
final class Engine {
    struct Ready { let port: Int; let token: String }

    private var process: Process?
    private var stdin: Pipe?
    private(set) var port = 0
    let token: String
    private var restarts: [Date] = []
    private var stopping = false
    private let log: FileHandle?

    var onReady: ((Ready) -> Void)?
    var onFail: ((String) -> Void)?

    init() {
        var bytes = [UInt8](repeating: 0, count: 24)
        _ = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        token = bytes.map { String(format: "%02x", $0) }.joined()
        let logs = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Logs/Liner Code")
        try? FileManager.default.createDirectory(at: logs, withIntermediateDirectories: true)
        let file = logs.appendingPathComponent("engine.log")
        FileManager.default.createFile(atPath: file.path, contents: nil)
        log = try? FileHandle(forWritingTo: file)
        log?.truncateFile(atOffset: 0)
    }

    /// Where the engine's code and the built app live: inside the bundle, or in the repo while developing.
    static func resources() -> (engine: URL, ui: URL)? {
        let fm = FileManager.default
        if let res = Bundle.main.resourceURL {
            let engine = res.appendingPathComponent("app/engine/src/main.ts")
            let ui = res.appendingPathComponent("ui")
            if fm.fileExists(atPath: engine.path) { return (engine, ui) }
        }
        if let repo = ProcessInfo.processInfo.environment["LINER_REPO"] {
            let root = URL(fileURLWithPath: repo)
            return (root.appendingPathComponent("engine/src/main.ts"), root.appendingPathComponent("ui/dist"))
        }
        return nil
    }

    func start(keys: [String: String]) {
        guard let paths = Engine.resources() else {
            onFail?("Liner Code can't find its engine. Reinstall the app.")
            return
        }
        let env = Shell.loginEnvironment()
        // A build made with --bundle-node carries its own Node, so the app runs without one installed.
        let bundled = Bundle.main.resourceURL?.appendingPathComponent("node/bin/node").path
        let own = bundled.flatMap { FileManager.default.isExecutableFile(atPath: $0) ? $0 : nil }
        guard let node = own ?? Shell.which("node", path: env["PATH"] ?? "") else {
            onFail?("Liner Code needs Node.js 22.18 or newer to run its engine. Install it from nodejs.org, or with `brew install node`, then open Liner Code again.")
            return
        }
        launch(node: node, engine: paths.engine, ui: paths.ui, env: env, keys: keys)
    }

    private func launch(node: String, engine: URL, ui: URL, env: [String: String], keys: [String: String]) {
        let p = Process()
        p.executableURL = URL(fileURLWithPath: node)
        p.arguments = [engine.path, "--port", String(port), "--ui", ui.path]
        p.currentDirectoryURL = engine.deletingLastPathComponent()
        var e = ProcessInfo.processInfo.environment
        for (k, v) in env { e[k] = v }
        e["LINER_TOKEN"] = token
        e["LINER_PATH"] = env["PATH"]
        e["LINER_USER_NAME"] = NSFullUserName()
        e["LINER_MACHINE"] = Host.current().localizedName ?? "This Mac"
        if let data = try? JSONSerialization.data(withJSONObject: keys), let json = String(data: data, encoding: .utf8) { e["LINER_KEYS"] = json }
        p.environment = e

        let input = Pipe()
        let out = Pipe()
        let err = Pipe()
        p.standardInput = input
        p.standardOutput = out
        p.standardError = err
        stdin = input

        var buffer = ""
        out.fileHandleForReading.readabilityHandler = { [weak self] h in
            let data = h.availableData
            guard !data.isEmpty, let self else { return }
            self.log?.write(data)
            buffer += String(decoding: data, as: UTF8.self)
            while let nl = buffer.firstIndex(of: "\n") {
                let line = String(buffer[..<nl])
                buffer = String(buffer[buffer.index(after: nl)...])
                if line.hasPrefix("LINER_READY "),
                   let json = line.dropFirst("LINER_READY ".count).data(using: .utf8),
                   let obj = try? JSONSerialization.jsonObject(with: json) as? [String: Any],
                   let port = obj["port"] as? Int {
                    self.port = port
                    DispatchQueue.main.async { self.onReady?(Ready(port: port, token: self.token)) }
                }
            }
        }
        err.fileHandleForReading.readabilityHandler = { [weak self] h in
            let data = h.availableData
            if !data.isEmpty { self?.log?.write(data) }
        }
        p.terminationHandler = { [weak self] proc in
            guard let self, !self.stopping else { return }
            DispatchQueue.main.async {
                // Back on the same port and token; more than five falls in a minute means something is wrong.
                let now = Date()
                self.restarts = self.restarts.filter { now.timeIntervalSince($0) < 60 } + [now]
                if self.restarts.count > 5 {
                    self.onFail?("The engine keeps stopping (exit \(proc.terminationStatus)). Its log is in ~/Library/Logs/Liner Code/engine.log.")
                    return
                }
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) {
                    self.launch(node: node, engine: engine, ui: ui, env: env, keys: keys)
                }
            }
        }
        do {
            try p.run()
            process = p
        } catch {
            onFail?("The engine didn't start: \(error.localizedDescription)")
        }
    }

    func stop() {
        stopping = true
        try? stdin?.fileHandleForWriting.close()
        process?.terminate()
    }
}

/// The user's login shell, for the PATH a Dock-launched app doesn't get.
enum Shell {
    static func loginEnvironment() -> [String: String] {
        let shell = ProcessInfo.processInfo.environment["SHELL"] ?? "/bin/zsh"
        let p = Process()
        p.executableURL = URL(fileURLWithPath: shell)
        p.arguments = ["-l", "-c", "printf '%s' \"$PATH\""]
        let out = Pipe()
        p.standardOutput = out
        p.standardError = FileHandle.nullDevice
        p.standardInput = FileHandle.nullDevice
        var path = ProcessInfo.processInfo.environment["PATH"] ?? "/usr/bin:/bin"
        if (try? p.run()) != nil {
            let deadline = Date().addingTimeInterval(5)
            while p.isRunning && Date() < deadline { usleep(20_000) }
            if p.isRunning { p.terminate() }
            let s = String(decoding: out.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self)
            if !s.isEmpty { path = s }
        }
        // Common places tools land, in case the shell's config doesn't say.
        let extra = ["/opt/homebrew/bin", "/usr/local/bin", "\(NSHomeDirectory())/.local/bin", "\(NSHomeDirectory())/.bun/bin"]
        let parts = path.split(separator: ":").map(String.init)
        path = (parts + extra.filter { !parts.contains($0) }).joined(separator: ":")
        return ["PATH": path]
    }

    static func which(_ cmd: String, path: String) -> String? {
        for dir in path.split(separator: ":") {
            let full = "\(dir)/\(cmd)"
            if FileManager.default.isExecutableFile(atPath: full) { return full }
        }
        return nil
    }
}
