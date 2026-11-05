// Draws Liner Code's app icon: two turns round one centre, the outer in ink and the inner in blue,
// on a flat squircle tile with a soft shadow, at every size macOS asks for, into an .iconset that
// iconutil turns into AppIcon.icns. The geometry is docs/brand/icon-2026's: a 1024 grid, y down, the
// tile inset 100 (824 across, a superellipse of exponent 5), strokes 78 wide with round caps.
// Usage: swift scripts/make-icon.swift <out.iconset> [light|dark]
//        swift scripts/make-icon.swift <out.png> [light|dark] [px]    one image, 1024 px unless px says
import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

let args = CommandLine.arguments
let out = URL(fileURLWithPath: args.count > 1 ? args[1] : "AppIcon.iconset")
let dark = args.count > 2 && args[2] == "dark"

func rgb(_ hex: UInt32, _ alpha: CGFloat = 1) -> CGColor {
    CGColor(srgbRed: CGFloat(hex >> 16 & 0xFF) / 255, green: CGFloat(hex >> 8 & 0xFF) / 255, blue: CGFloat(hex & 0xFF) / 255, alpha: alpha)
}
let tile = rgb(dark ? 0x161719 : 0xF9FAFB)
let edge = dark ? rgb(0xFFFFFF, 0.10) : rgb(0x141828, 0.08)
let ink = rgb(dark ? 0xF4F5F6 : 0x16181C)
let blue = rgb(dark ? 0x609EFA : 0x297CEF)

func draw(_ px: Int) -> Data? {
    let s = CGFloat(px)
    let space = CGColorSpace(name: CGColorSpace.sRGB)!
    guard let ctx = CGContext(data: nil, width: px, height: px, bitsPerComponent: 8, bytesPerRow: 0, space: space, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return nil }
    // Draw on the 1024 grid with y down, as the SVGs are written; shadows stay in pixels, y up.
    ctx.translateBy(x: 0, y: s)
    ctx.scaleBy(x: s / 1024, y: -s / 1024)

    // The tile: |x|^5 + |y|^5 = 412^5 round (512, 512).
    let shape = CGMutablePath()
    for i in 0..<720 {
        let t = CGFloat(i) / 720 * 2 * .pi
        let c = cos(t), n = sin(t)
        let p = CGPoint(x: 512 + 412 * (c < 0 ? -1 : 1) * pow(abs(c), 0.4), y: 512 + 412 * (n < 0 ? -1 : 1) * pow(abs(n), 0.4))
        if i == 0 { shape.move(to: p) } else { shape.addLine(to: p) }
    }
    shape.closeSubpath()
    ctx.saveGState()
    ctx.setShadow(offset: CGSize(width: 0, height: -s * 0.012), blur: s * 0.03, color: rgb(0x000000, 0.28))
    ctx.addPath(shape)
    ctx.setFillColor(tile)
    ctx.fillPath()
    ctx.restoreGState()
    ctx.addPath(shape)
    ctx.setStrokeColor(edge)
    ctx.setLineWidth(3)
    ctx.strokePath()

    // The mark: down, a quarter turn round (545, 488), across.
    ctx.setLineCap(.round)
    ctx.setLineWidth(78)
    let outer = CGMutablePath()
    outer.move(to: CGPoint(x: 309, y: 300))
    outer.addLine(to: CGPoint(x: 309, y: 488))
    outer.addArc(tangent1End: CGPoint(x: 309, y: 724), tangent2End: CGPoint(x: 545, y: 724), radius: 236)
    outer.addLine(to: CGPoint(x: 715, y: 724))
    ctx.addPath(outer)
    ctx.setStrokeColor(ink)
    ctx.strokePath()
    let inner = CGMutablePath()
    inner.move(to: CGPoint(x: 433, y: 424))
    inner.addLine(to: CGPoint(x: 433, y: 488))
    inner.addArc(tangent1End: CGPoint(x: 433, y: 600), tangent2End: CGPoint(x: 545, y: 600), radius: 112)
    inner.addLine(to: CGPoint(x: 591, y: 600))
    ctx.addPath(inner)
    ctx.setStrokeColor(blue)
    ctx.strokePath()

    guard let image = ctx.makeImage() else { return nil }
    let data = NSMutableData()
    guard let dest = CGImageDestinationCreateWithData(data, UTType.png.identifier as CFString, 1, nil) else { return nil }
    CGImageDestinationAddImage(dest, image, nil)
    return CGImageDestinationFinalize(dest) ? data as Data : nil
}

if out.pathExtension == "png" {
    try? FileManager.default.createDirectory(at: out.deletingLastPathComponent(), withIntermediateDirectories: true)
    let px = args.count > 3 ? Int(args[3]) ?? 1024 : 1024
    guard let data = draw(px) else { fatalError("couldn't draw the icon") }
    try data.write(to: out)
} else {
    try? FileManager.default.createDirectory(at: out, withIntermediateDirectories: true)
    for (base, scales) in [(16, [1, 2]), (32, [1, 2]), (128, [1, 2]), (256, [1, 2]), (512, [1, 2])] {
        for sc in scales {
            let name = sc == 1 ? "icon_\(base)x\(base).png" : "icon_\(base)x\(base)@2x.png"
            if let data = draw(base * sc) { try data.write(to: out.appendingPathComponent(name)) }
        }
    }
}
print("wrote \(out.path)")
