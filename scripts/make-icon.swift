// Draws Liner Code's app icon: the two nested Ls on a white squircle, at every size macOS
// asks for, into an .iconset that iconutil turns into AppIcon.icns.
// Usage: swift scripts/make-icon.swift <out.iconset>
import AppKit

let out = URL(fileURLWithPath: CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "AppIcon.iconset")
try? FileManager.default.createDirectory(at: out, withIntermediateDirectories: true)

func draw(_ px: Int) -> Data? {
    let s = CGFloat(px)
    guard let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: px, pixelsHigh: px, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0) else { return nil }
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
    let ctx = NSGraphicsContext.current!.cgContext

    // macOS icon grid: an 824/1024 squircle with a soft shadow.
    let inset = s * 100 / 1024
    let box = CGRect(x: inset, y: inset, width: s - inset * 2, height: s - inset * 2)
    let radius = box.width * 0.2237
    ctx.saveGState()
    ctx.setShadow(offset: CGSize(width: 0, height: -s * 0.012), blur: s * 0.03, color: NSColor(white: 0, alpha: 0.28).cgColor)
    let shape = CGPath(roundedRect: box, cornerWidth: radius, cornerHeight: radius, transform: nil)
    ctx.addPath(shape)
    ctx.setFillColor(NSColor.white.cgColor)
    ctx.fillPath()
    ctx.restoreGState()
    ctx.saveGState()
    ctx.addPath(shape)
    ctx.clip()
    let grad = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(), colors: [NSColor(srgbRed: 1, green: 1, blue: 1, alpha: 1).cgColor, NSColor(srgbRed: 0.93, green: 0.94, blue: 0.96, alpha: 1).cgColor] as CFArray, locations: [0, 1])!
    ctx.drawLinearGradient(grad, start: CGPoint(x: 0, y: box.maxY), end: CGPoint(x: 0, y: box.minY), options: [])
    ctx.restoreGState()

    // The mark, in its own 28 × 36.4 box, centred and scaled to about half the icon.
    let h = box.height * 0.52
    let k = h / 36.4
    let w = 28 * k
    let ox = box.midX - w / 2 + k * 0.6
    let oy = box.midY + h / 2
    func p(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: ox + x * k, y: oy - y * k) }
    ctx.setLineCap(.round)
    ctx.setLineJoin(.round)
    ctx.setLineWidth(2.6 * k)
    // Outer L: down, a rounded corner, across.
    let outer = CGMutablePath()
    outer.move(to: p(1.13, 1.13))
    outer.addLine(to: p(1.13, 29.9))
    outer.addArc(tangent1End: p(1.13, 35.2), tangent2End: p(6.43, 35.2), radius: 5.3 * k)
    outer.addLine(to: p(26.87, 35.2))
    ctx.addPath(outer)
    ctx.setStrokeColor(NSColor(srgbRed: 0.13, green: 0.14, blue: 0.16, alpha: 1).cgColor)
    ctx.strokePath()
    // Inner L, in a light accent blue.
    let inner = CGMutablePath()
    inner.move(to: p(8.76, 1.13))
    inner.addLine(to: p(8.76, 26.2))
    inner.addArc(tangent1End: p(8.76, 27.75), tangent2End: p(10.31, 27.75), radius: 1.55 * k)
    inner.addLine(to: p(26.87, 27.75))
    ctx.addPath(inner)
    ctx.setStrokeColor(NSColor(srgbRed: 0.42, green: 0.63, blue: 0.96, alpha: 1).cgColor)
    ctx.strokePath()

    NSGraphicsContext.restoreGraphicsState()
    return rep.representation(using: .png, properties: [:])
}

for (base, scales) in [(16, [1, 2]), (32, [1, 2]), (128, [1, 2]), (256, [1, 2]), (512, [1, 2])] {
    for sc in scales {
        let name = sc == 1 ? "icon_\(base)x\(base).png" : "icon_\(base)x\(base)@2x.png"
        if let data = draw(base * sc) { try? data.write(to: out.appendingPathComponent(name)) }
    }
}
print("wrote \(out.path)")
