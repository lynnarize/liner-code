// Prints the window number of the largest on-screen window owned by a process name (default
// "Electron"), for `screencapture -l`.  swift scripts/winid.swift [owner]
import CoreGraphics
import Foundation

let owner = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "Electron"
let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
let mine = list.filter { ($0[kCGWindowOwnerName as String] as? String) == owner && ($0[kCGWindowLayer as String] as? Int) == 0 }
let area = { (w: [String: Any]) -> Double in
  let b = w[kCGWindowBounds as String] as? [String: Double] ?? [:]
  return (b["Width"] ?? 0) * (b["Height"] ?? 0)
}
if let w = mine.max(by: { area($0) < area($1) }), let n = w[kCGWindowNumber as String] as? Int {
  print(n)
} else {
  exit(1)
}
