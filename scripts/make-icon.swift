// Draws Liner Code's app icon: the line comment mark, two slanted strokes, the first in ink and the
// second in blue, as the website's mark and favicon have it (site/public/favicon.svg), on a flat
// squircle tile with a soft shadow, at every size macOS asks for, into an .iconset that iconutil turns
// into AppIcon.icns (and scripts/make-ico.ts into Windows' .ico). A 1024 grid, y down, the tile inset
// 100 (824 across, a superellipse of exponent 5); the favicon's 32 grid scaled by 824 / 32 onto it.
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
// The favicon's colours, light and dark.
let tile = rgb(dark ? 0x171A20 : 0xF5F6F8)
let edge = dark ? rgb(0xFFFFFF, 0.10) : rgb(0x141828, 0.08)
let ink = rgb(dark ? 0xECEEF1 : 0x0D0F12)
let blue = rgb(dark ? 0x4F8FF7 : 0x2A6FE8)

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

    // The mark: two strokes from bottom left to top right, the favicon's (5.2, 19.6) to (10.6, 4.4) and
    // (13.4, 19.6) to (18.8, 4.4) inside its 4 unit margin, 3.4 wide, scaled onto the tile.
    let k: CGFloat = 824 / 32
    let at = { (x: CGFloat, y: CGFloat) in CGPoint(x: 100 + (4 + x) * k, y: 100 + (4 + y) * k) }
    ctx.setLineCap(.round)
    ctx.setLineWidth(3.4 * k)
    let first = CGMutablePath()
    first.move(to: at(5.2, 19.6))
    first.addLine(to: at(10.6, 4.4))
    ctx.addPath(first)
    ctx.setStrokeColor(ink)
    ctx.strokePath()
    let second = CGMutablePath()
    second.move(to: at(13.4, 19.6))
    second.addLine(to: at(18.8, 4.4))
    ctx.addPath(second)
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
