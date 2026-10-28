// swift-tools-version:6.0
// Liner Code's macOS shell: a native window, the window's own glass behind a transparent web
// view, and the engine as a child process. scripts/build-mac.sh wraps the binary in an .app.
import PackageDescription

let package = Package(
    name: "LinerCode",
    platforms: [.macOS(.v14)],
    targets: [
        .executableTarget(
            name: "LinerCode",
            path: "Sources/LinerCode",
            swiftSettings: [.swiftLanguageMode(.v5)],
            linkerSettings: [
                .linkedFramework("AppKit"),
                .linkedFramework("WebKit"),
                .linkedFramework("Security"),
                .linkedFramework("UserNotifications"),
            ]
        ),
    ]
)
