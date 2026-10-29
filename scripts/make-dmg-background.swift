// Draws the disk image's window: what to drag where, an arrow between the two icons, and how to
// open Liner Code the first time, since macOS stops an app it can't check until you say so in
// Privacy & Security. At 1x and 2x; tiffutil puts them in one TIFF that Finder shows sharp.
// The icons go at (170, 152) and (490, 152) in a 660 × 400 window (scripts/dmg-layout.applescript).
// Finder counts the title bar in those 400, which leaves 368 for the picture: the card ends at 346.
// Usage: swift scripts/make-dmg-background.swift <out folder>
import AppKit

let out = URL(fileURLWithPath: CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : ".")
try? FileManager.default.createDirectory(at: out, withIntermediateDirectories: true)

let W: CGFloat = 660, H: CGFloat = 400
let ink = NSColor(srgbRed: 0.12, green: 0.13, blue: 0.16, alpha: 1)
let ink2 = NSColor(srgbRed: 0.36, green: 0.38, blue: 0.42, alpha: 1)
let ink4 = NSColor(srgbRed: 0.66, green: 0.68, blue: 0.72, alpha: 1)
let hair = NSColor(srgbRed: 0.12, green: 0.13, blue: 0.16, alpha: 0.09)
let accent = NSColor(srgbRed: 0.42, green: 0.63, blue: 0.96, alpha: 1)

func text(_ s: String, size: CGFloat, weight: NSFont.Weight, color: NSColor, in rect: CGRect, align: NSTextAlignment = .left, leading: CGFloat = 0) {
    let style = NSMutableParagraphStyle()
    style.alignment = align
    style.lineSpacing = leading
    let attrs: [NSAttributedString.Key: Any] = [.font: NSFont.systemFont(ofSize: size, weight: weight), .foregroundColor: color, .paragraphStyle: style]
    NSAttributedString(string: s, attributes: attrs).draw(with: rect, options: [.usesLineFragmentOrigin])
}

func draw(scale: CGFloat) -> Data? {
    let pw = Int(W * scale), ph = Int(H * scale)
    guard let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: pw, pixelsHigh: ph, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0) else { return nil }
    NSGraphicsContext.saveGraphicsState()
    let base = NSGraphicsContext(bitmapImageRep: rep)!
    let ctx = base.cgContext
    // Drawn top-down, in points, like the window it fills.
    ctx.translateBy(x: 0, y: CGFloat(ph))
    ctx.scaleBy(x: scale, y: -scale)
    NSGraphicsContext.current = NSGraphicsContext(cgContext: ctx, flipped: true)

    // The ground: white, falling to Liner's paper grey.
    let ground = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(), colors: [NSColor.white.cgColor, NSColor(srgbRed: 0.955, green: 0.96, blue: 0.97, alpha: 1).cgColor] as CFArray, locations: [0, 1])!
    ctx.drawLinearGradient(ground, start: .zero, end: CGPoint(x: 0, y: H), options: [])

    text("Drag Liner Code into Applications", size: 17, weight: .semibold, color: ink, in: CGRect(x: 0, y: 26, width: W, height: 24), align: .center)
    text("Then open it from Applications or Launchpad.", size: 12.5, weight: .regular, color: ink2, in: CGRect(x: 0, y: 52, width: W, height: 18), align: .center)

    // The arrow from the app to the folder: a dashed line that ends in a chevron.
    let y: CGFloat = 148
    ctx.setLineCap(.round)
    ctx.setLineJoin(.round)
    ctx.setLineWidth(2)
    ctx.setStrokeColor(ink4.cgColor)
    ctx.setLineDash(phase: 0, lengths: [0.5, 7])
    ctx.move(to: CGPoint(x: 252, y: y))
    ctx.addLine(to: CGPoint(x: 400, y: y))
    ctx.strokePath()
    ctx.setLineDash(phase: 0, lengths: [])
    ctx.setStrokeColor(accent.cgColor)
    ctx.setLineWidth(2.4)
    ctx.move(to: CGPoint(x: 398, y: y - 8))
    ctx.addLine(to: CGPoint(x: 408, y: y))
    ctx.addLine(to: CGPoint(x: 398, y: y + 8))
    ctx.strokePath()

    // The first time: a white card with a 1px ring, as cards are in the app.
    let card = CGRect(x: 40, y: 248, width: W - 80, height: 98)
    let shape = CGPath(roundedRect: card, cornerWidth: 14, cornerHeight: 14, transform: nil)
    ctx.saveGState()
    ctx.setShadow(offset: CGSize(width: 0, height: 1), blur: 3, color: NSColor(white: 0, alpha: 0.05).cgColor)
    ctx.addPath(shape)
    ctx.setFillColor(NSColor.white.cgColor)
    ctx.fillPath()
    ctx.restoreGState()
    ctx.addPath(shape)
    ctx.setStrokeColor(hair.cgColor)
    ctx.setLineWidth(1)
    ctx.strokePath()

    // A shield, for Privacy & Security.
    let s = CGMutablePath()
    let sx: CGFloat = 62, sy: CGFloat = 266
    s.move(to: CGPoint(x: sx + 9, y: sy))
    s.addLine(to: CGPoint(x: sx + 17, y: sy + 3.2))
    s.addLine(to: CGPoint(x: sx + 17, y: sy + 10))
    s.addCurve(to: CGPoint(x: sx + 9, y: sy + 20), control1: CGPoint(x: sx + 17, y: sy + 15), control2: CGPoint(x: sx + 13.5, y: sy + 18.4))
    s.addCurve(to: CGPoint(x: sx + 1, y: sy + 10), control1: CGPoint(x: sx + 4.5, y: sy + 18.4), control2: CGPoint(x: sx + 1, y: sy + 15))
    s.addLine(to: CGPoint(x: sx + 1, y: sy + 3.2))
    s.closeSubpath()
    ctx.addPath(s)
    ctx.setStrokeColor(ink2.cgColor)
    ctx.setLineWidth(1.5)
    ctx.strokePath()

    text("The first time you open it", size: 13, weight: .semibold, color: ink, in: CGRect(x: 92, y: 266, width: card.maxX - 112, height: 18))
    text("macOS can't check Liner Code yet, so it won't open it at first. Open System Settings › Privacy & Security, scroll down to Security, and press Open Anyway beside Liner Code. Once is enough.",
         size: 12, weight: .regular, color: ink2, in: CGRect(x: 92, y: 286, width: card.maxX - 112, height: 54), leading: 1.5)

    NSGraphicsContext.restoreGraphicsState()
    return rep.representation(using: .png, properties: [:])
}

for (scale, name) in [(CGFloat(1), "background.png"), (2, "background@2x.png")] {
    if let data = draw(scale: scale) { try? data.write(to: out.appendingPathComponent(name)) }
}
print("wrote \(out.path)")
