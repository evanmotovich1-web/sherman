// sherman-pet — Sherman's floating desktop companion (macOS).
//
// A small always-on-top creature that mirrors what Sherman is doing right
// now. It is a viewer, not an actor: its one input is the state file the
// Sherman Shell writes at ~/.sherman/pet/state.json, and its one action is
// bringing the terminal Sherman runs in back to the front when clicked.
//
//   drag           move it anywhere; the spot is remembered
//   click          focus the terminal Sherman is running in
//   right-click    size menu (small → huge), open Sherman, quit
//
// Compiled locally by `sherman pet` with the system Swift toolchain — no
// Electron, no downloads, nothing unsigned from the network. State display
// only renders what the shell reported; when nothing reports, the pet says
// offline rather than inventing a status.
//
// Build: swiftc -swift-version 5 -O sherman-pet.swift -o sherman-pet

import AppKit

// ------------------------------------------------------------------ state --

struct PetState {
    var status: String   // idle | working | done | failed | waiting | offline
    var detail: String
    var terminal: String // TERM_PROGRAM of the shell that wrote the state
    var updatedAt: Double
}

let petDir = FileManager.default.homeDirectoryForCurrentUser
    .appendingPathComponent(".sherman/pet")

func readState() -> PetState {
    let url = petDir.appendingPathComponent("state.json")
    guard let data = try? Data(contentsOf: url),
          let raw = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
        return PetState(status: "offline", detail: "", terminal: "", updatedAt: 0)
    }
    return PetState(
        status: (raw["status"] as? String) ?? "offline",
        detail: (raw["detail"] as? String) ?? "",
        terminal: (raw["terminal"] as? String) ?? "",
        updatedAt: (raw["updatedAt"] as? Double) ?? 0
    )
}

// ------------------------------------------------------------------ prefs --

struct PetPrefs {
    var size: String
    var x: Double?
    var y: Double?
}

let SIZES: [(name: String, label: String, height: CGFloat)] = [
    ("small", "Small", 76),
    ("medium", "Medium", 108),
    ("large", "Large", 148),
    ("huge", "Huge", 204),
]

func readPrefs() -> PetPrefs {
    let url = petDir.appendingPathComponent("prefs.json")
    guard let data = try? Data(contentsOf: url),
          let raw = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
        return PetPrefs(size: "medium", x: nil, y: nil)
    }
    return PetPrefs(
        size: (raw["size"] as? String) ?? "medium",
        x: raw["x"] as? Double,
        y: raw["y"] as? Double
    )
}

func savePrefs(_ prefs: PetPrefs) {
    var raw: [String: Any] = ["size": prefs.size]
    if let x = prefs.x { raw["x"] = x }
    if let y = prefs.y { raw["y"] = y }
    if let data = try? JSONSerialization.data(withJSONObject: raw) {
        try? data.write(to: petDir.appendingPathComponent("prefs.json"))
    }
}

// ------------------------------------------------- bring Sherman forward --

func terminalBundleId(_ termProgram: String) -> String {
    switch termProgram {
    case "Apple_Terminal": return "com.apple.Terminal"
    case "iTerm.app": return "com.googlecode.iterm2"
    case "WezTerm": return "com.github.wez.wezterm"
    case "ghostty", "Ghostty": return "com.mitchellh.ghostty"
    case "kitty": return "net.kovidgoyal.kitty"
    case "Alacritty": return "org.alacritty"
    case "Hyper": return "co.zeit.hyper"
    case "vscode": return "com.microsoft.VSCode"
    default: return "com.apple.Terminal"
    }
}

func focusSherman(_ state: PetState) {
    let id = terminalBundleId(state.terminal)
    if let app = NSRunningApplication.runningApplications(withBundleIdentifier: id).first {
        if #available(macOS 14.0, *) {
            app.activate()
        } else {
            app.activate(options: [.activateIgnoringOtherApps])
        }
        return
    }
    // The recorded terminal is not running; fall back to the default one so a
    // click always lands somewhere Sherman can be started.
    if let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: id)
        ?? NSWorkspace.shared.urlForApplication(withBundleIdentifier: "com.apple.Terminal") {
        NSWorkspace.shared.openApplication(at: url, configuration: NSWorkspace.OpenConfiguration())
    }
}

// ------------------------------------------------------------------- view --

final class PetView: NSView {
    var state = PetState(status: "offline", detail: "", terminal: "", updatedAt: 0)
    var pulse = false          // toggled by the tick while working, for a live feel
    var prefs = readPrefs()
    private var downAt: NSPoint?
    private var moved = false

    // Everything animated derives from the wall clock, so the motion needs no
    // state machine: the bob is a sine of now, a blink happens when now lands
    // in the first beat of its cycle, and the sip plays in the first ~2.8s of
    // every 15-second cycle.
    var now: Double { Date().timeIntervalSince1970 }

    static let SIP_PERIOD = 15.0
    static let SIP_LENGTH = 2.8

    /// 0..1 while the sip animation plays, nil the rest of the cycle.
    var sipProgress: CGFloat? {
        guard shownStatus != "offline" else { return nil }
        let cycle = now.truncatingRemainder(dividingBy: PetView.SIP_PERIOD)
        return cycle < PetView.SIP_LENGTH ? CGFloat(cycle / PetView.SIP_LENGTH) : nil
    }

    /// True during the ~140ms of a blink, roughly every 4.3 seconds.
    var blinking: Bool {
        now.truncatingRemainder(dividingBy: 4.3) < 0.14
    }

    /// The idle breathing bob, in pet-height fractions.
    var bob: CGFloat {
        CGFloat(sin(now * 2 * Double.pi / 3.2)) * 0.012
    }

    // The face the pet SHOWS. `done` decays to idle on the pet's own clock so
    // a finished turn celebrates briefly instead of grinning forever.
    var shownStatus: String {
        if state.status == "done",
           Date().timeIntervalSince1970 * 1000 - state.updatedAt > 6000 {
            return "idle"
        }
        // A state nobody has refreshed in ten minutes is a session that went
        // away without saying goodbye; showing its last word as current would
        // be a lie about now.
        if state.status != "offline",
           Date().timeIntervalSince1970 * 1000 - state.updatedAt > 600_000 {
            return "offline"
        }
        return state.status
    }

    var showBubble: Bool {
        let shown = shownStatus
        if shown == "working" || shown == "failed" || shown == "waiting" { return true }
        if shown == "done" { return true }
        return false
    }

    // ---------------------------------------------------------- geometry --

    var petHeight: CGFloat {
        SIZES.first(where: { $0.name == prefs.size })?.height ?? 108
    }

    static let BUBBLE_ROOM: CGFloat = 46

    var desiredSize: NSSize {
        NSSize(width: max(petHeight * 1.7, 220), height: petHeight + PetView.BUBBLE_ROOM)
    }

    // ------------------------------------------------------------- input --

    override func mouseDown(with event: NSEvent) {
        downAt = NSEvent.mouseLocation
        moved = false
    }

    override func mouseDragged(with event: NSEvent) {
        guard let start = downAt, let window = self.window else { return }
        let now = NSEvent.mouseLocation
        let dx = now.x - start.x
        let dy = now.y - start.y
        if abs(dx) + abs(dy) > 3 { moved = true }
        var origin = window.frame.origin
        origin.x += dx
        origin.y += dy
        window.setFrameOrigin(origin)
        downAt = now
    }

    override func mouseUp(with event: NSEvent) {
        defer { downAt = nil }
        if moved {
            if let origin = window?.frame.origin {
                prefs.x = Double(origin.x)
                prefs.y = Double(origin.y)
                savePrefs(prefs)
            }
            return
        }
        focusSherman(state)
    }

    override func rightMouseDown(with event: NSEvent) {
        let menu = NSMenu()
        for size in SIZES {
            let item = NSMenuItem(title: size.label, action: #selector(pickSize(_:)), keyEquivalent: "")
            item.target = self
            item.representedObject = size.name
            item.state = prefs.size == size.name ? .on : .off
            menu.addItem(item)
        }
        menu.addItem(NSMenuItem.separator())
        let open = NSMenuItem(title: "Open Sherman", action: #selector(openSherman), keyEquivalent: "")
        open.target = self
        menu.addItem(open)
        let quit = NSMenuItem(title: "Quit Pet", action: #selector(quitPet), keyEquivalent: "")
        quit.target = self
        menu.addItem(quit)
        NSMenu.popUpContextMenu(menu, with: event, for: self)
    }

    @objc func pickSize(_ sender: NSMenuItem) {
        guard let name = sender.representedObject as? String else { return }
        prefs.size = name
        savePrefs(prefs)
        if let window = self.window {
            var frame = window.frame
            let size = desiredSize
            frame.origin.y += frame.size.height - size.height // keep the feet planted
            frame.size = size
            window.setFrame(frame, display: true, animate: false)
        }
        needsDisplay = true
    }

    @objc func openSherman() { focusSherman(state) }
    @objc func quitPet() { NSApp.terminate(nil) }

    // ----------------------------------------------------------- drawing --

    override func draw(_ dirtyRect: NSRect) {
        guard let ctx = NSGraphicsContext.current?.cgContext else { return }
        ctx.clear(bounds)

        let shown = shownStatus
        let h = petHeight
        let cx = bounds.midX
        // The whole creature rides the breathing bob; the speech bubble stays
        // anchored so the text does not wobble while being read.
        let baseY = bounds.minY + 4 + h * (shown == "offline" ? 0 : bob)
        let sip = sipProgress

        // Sherman's inks: the shell's accent 205 for the body, its dark panel
        // for the face, the meter's mint for the eyes.
        let offline = shown == "offline"
        let body = offline
            ? NSColor(calibratedWhite: 0.42, alpha: 1)
            : NSColor(calibratedRed: 0.98, green: 0.42, blue: 0.68, alpha: 1)
        let bodyDark = offline
            ? NSColor(calibratedWhite: 0.33, alpha: 1)
            : NSColor(calibratedRed: 0.80, green: 0.28, blue: 0.54, alpha: 1)
        let panel = NSColor(calibratedRed: 0.078, green: 0.078, blue: 0.11, alpha: 1)
        let eye = offline
            ? NSColor(calibratedWhite: 0.65, alpha: 1)
            : NSColor(calibratedRed: 0.62, green: 0.93, blue: 0.87, alpha: 1)

        // Torso, feet, arms first so the head overlaps them.
        let torsoW = h * 0.52
        let torsoH = h * 0.34
        let torso = NSRect(x: cx - torsoW / 2, y: baseY, width: torsoW, height: torsoH)
        bodyDark.setFill()
        NSBezierPath(roundedRect: torso, xRadius: h * 0.09, yRadius: h * 0.09).fill()

        // The right arm (screen right) is the drinking arm: during a sip it is
        // drawn later, up at the face holding the bottle, instead of here.
        for side in [-1.0, 1.0] {
            if side > 0 && sip != nil { continue }
            let arm = NSRect(
                x: cx + CGFloat(side) * torsoW * 0.62 - h * 0.075,
                y: baseY + torsoH * 0.28,
                width: h * 0.15, height: h * 0.15
            )
            bodyDark.setFill()
            NSBezierPath(ovalIn: arm).fill()
        }

        // Chest mark: the caduceus, Sherman Abrams Labs' trade.
        let chest = "⚕" as NSString
        let chestFont = NSFont.systemFont(ofSize: torsoH * 0.5, weight: .bold)
        let chestAttrs: [NSAttributedString.Key: Any] = [
            .font: chestFont,
            .foregroundColor: NSColor(calibratedWhite: 1.0, alpha: 0.9),
        ]
        let chestSize = chest.size(withAttributes: chestAttrs)
        chest.draw(
            at: NSPoint(x: cx - chestSize.width / 2, y: baseY + torsoH * 0.12),
            withAttributes: chestAttrs
        )

        // The cloud head: overlapping puffs, the reference silhouette.
        let headY = baseY + torsoH * 0.72
        let headH = h * 0.62
        body.setFill()
        let puffs: [(dx: CGFloat, dy: CGFloat, r: CGFloat)] = [
            (-0.30, 0.42, 0.26), (0.00, 0.55, 0.31), (0.30, 0.42, 0.26),
            (-0.38, 0.18, 0.24), (0.38, 0.18, 0.24), (0.00, 0.20, 0.36),
        ]
        for puff in puffs {
            let r = headH * puff.r
            let rect = NSRect(
                x: cx + headH * puff.dx - r, y: headY + headH * puff.dy - r,
                width: r * 2, height: r * 2
            )
            NSBezierPath(ovalIn: rect).fill()
        }

        // Face panel.
        let faceW = headH * 1.05
        let faceH = headH * 0.60
        let face = NSRect(x: cx - faceW / 2, y: headY + headH * 0.05, width: faceW, height: faceH)
        panel.setFill()
        NSBezierPath(roundedRect: face, xRadius: faceH * 0.30, yRadius: faceH * 0.30).fill()

        // Eyes, by state. A blink flattens whatever face is showing for a
        // beat — except the failed ×, which does not blink away a failure.
        eye.setStroke()
        eye.setFill()
        let eyeY = face.midY
        let eyeDX = faceW * 0.20
        let lineWidth = max(2.0, h * 0.028)
        for side in [-1.0, 1.0] {
            let ex = cx + CGFloat(side) * eyeDX
            if blinking && shown != "failed" && shown != "offline" {
                let lid = NSBezierPath()
                lid.lineWidth = lineWidth
                lid.lineCapStyle = .round
                lid.move(to: NSPoint(x: ex - h * 0.045, y: eyeY))
                lid.line(to: NSPoint(x: ex + h * 0.045, y: eyeY))
                lid.stroke()
                continue
            }
            switch shown {
            case "working":
                let r = h * (pulse ? 0.048 : 0.040)
                NSBezierPath(ovalIn: NSRect(x: ex - r, y: eyeY - r, width: r * 2, height: r * 2)).fill()
            case "done":
                let arc = NSBezierPath()
                arc.lineWidth = lineWidth
                arc.lineCapStyle = .round
                arc.appendArc(
                    withCenter: NSPoint(x: ex, y: eyeY - h * 0.01), radius: h * 0.045,
                    startAngle: 20, endAngle: 160
                )
                arc.stroke()
            case "failed":
                let r = h * 0.035
                for flip in [-1.0, 1.0] {
                    let stroke = NSBezierPath()
                    stroke.lineWidth = lineWidth
                    stroke.lineCapStyle = .round
                    stroke.move(to: NSPoint(x: ex - r, y: eyeY - r * CGFloat(flip)))
                    stroke.line(to: NSPoint(x: ex + r, y: eyeY + r * CGFloat(flip)))
                    stroke.stroke()
                }
            case "waiting":
                let r = h * 0.045
                let ring = NSBezierPath(ovalIn: NSRect(x: ex - r, y: eyeY - r, width: r * 2, height: r * 2))
                ring.lineWidth = lineWidth
                ring.stroke()
            default: // idle, offline: the reference's sleepy arcs
                let arc = NSBezierPath()
                arc.lineWidth = lineWidth
                arc.lineCapStyle = .round
                arc.appendArc(
                    withCenter: NSPoint(x: ex, y: eyeY + h * 0.02), radius: h * 0.045,
                    startAngle: 200, endAngle: 340
                )
                arc.stroke()
            }
        }

        // The sip: every fifteen seconds the right arm rises with a little
        // amber medicine bottle, tips it at the face for a pretend drink, and
        // puts it back. Phases: raise (0–0.3), sip (0.3–0.7), lower (0.7–1).
        if let p = sip {
            let restPoint = NSPoint(x: cx + torsoW * 0.62, y: baseY + torsoH * 0.35)
            let mouthPoint = NSPoint(x: cx + faceW * 0.16, y: face.minY + faceH * 0.22)
            let ease = { (t: CGFloat) -> CGFloat in t * t * (3 - 2 * t) } // smoothstep
            let lift: CGFloat
            let tilt: CGFloat
            if p < 0.3 {
                lift = ease(p / 0.3)
                tilt = lift * 0.9
            } else if p < 0.7 {
                lift = 1
                // A little wobble mid-sip: the glug.
                tilt = 0.9 + 0.12 * CGFloat(sin(Double(p) * 34))
            } else {
                lift = ease((1 - p) / 0.3)
                tilt = lift * 0.9
            }
            let hand = NSPoint(
                x: restPoint.x + (mouthPoint.x - restPoint.x) * lift,
                y: restPoint.y + (mouthPoint.y - restPoint.y) * lift
            )

            // A small open mouth on the panel while drinking.
            if p >= 0.3 && p < 0.7 {
                let mouthR = h * 0.022
                eye.setFill()
                NSBezierPath(ovalIn: NSRect(
                    x: cx - mouthR, y: face.minY + faceH * 0.16 - mouthR,
                    width: mouthR * 2, height: mouthR * 2
                )).fill()
            }

            // The arm, following the hand.
            bodyDark.setFill()
            NSBezierPath(ovalIn: NSRect(
                x: hand.x - h * 0.075, y: hand.y - h * 0.075,
                width: h * 0.15, height: h * 0.15
            )).fill()

            // The bottle, tilted toward the face as it rises.
            ctx.saveGState()
            ctx.translateBy(x: hand.x, y: hand.y)
            ctx.rotate(by: -tilt) // clockwise toward the mouth
            let bw = h * 0.11
            let bh = h * 0.20
            let amber = NSColor(calibratedRed: 0.72, green: 0.44, blue: 0.16, alpha: 1)
            let amberDark = NSColor(calibratedRed: 0.55, green: 0.32, blue: 0.10, alpha: 1)
            amber.setFill()
            NSBezierPath(roundedRect: NSRect(x: -bw / 2, y: 0, width: bw, height: bh),
                         xRadius: bw * 0.25, yRadius: bw * 0.25).fill()
            // Label.
            NSColor(calibratedWhite: 0.95, alpha: 0.95).setFill()
            NSBezierPath(roundedRect: NSRect(x: -bw * 0.36, y: bh * 0.22, width: bw * 0.72, height: bh * 0.34),
                         xRadius: 1.5, yRadius: 1.5).fill()
            // Neck and cap.
            amberDark.setFill()
            NSBezierPath(rect: NSRect(x: -bw * 0.18, y: bh, width: bw * 0.36, height: bh * 0.16)).fill()
            NSColor(calibratedWhite: 0.25, alpha: 1).setFill()
            NSBezierPath(roundedRect: NSRect(x: -bw * 0.24, y: bh * 1.14, width: bw * 0.48, height: bh * 0.14),
                         xRadius: 1, yRadius: 1).fill()
            ctx.restoreGState()

            // Two rising bubbles mid-sip, alternating with the wobble.
            if p >= 0.35 && p < 0.7 {
                eye.setFill()
                let phase = CGFloat((Double(p) * 20).truncatingRemainder(dividingBy: 2))
                for (i, r) in [h * 0.012, h * 0.018].enumerated() {
                    let rise = (phase / 2 + CGFloat(i) * 0.4).truncatingRemainder(dividingBy: 1)
                    NSBezierPath(ovalIn: NSRect(
                        x: mouthPoint.x + h * 0.10 + CGFloat(i) * h * 0.04,
                        y: mouthPoint.y + rise * h * 0.10,
                        width: r * 2, height: r * 2
                    )).fill()
                }
            }
        }

        if offline {
            let z = "z z" as NSString
            let zAttrs: [NSAttributedString.Key: Any] = [
                .font: NSFont.systemFont(ofSize: h * 0.11, weight: .semibold),
                .foregroundColor: NSColor(calibratedWhite: 0.75, alpha: 0.9),
            ]
            z.draw(
                at: NSPoint(x: cx + headH * 0.55, y: headY + headH * 0.75),
                withAttributes: zAttrs
            )
        }

        // Status bubble above the head: what Sherman is doing, in words.
        if showBubble {
            let dot: NSColor
            switch shown {
            case "working": dot = NSColor(calibratedRed: 0.95, green: 0.77, blue: 0.29, alpha: 1)
            case "done": dot = NSColor(calibratedRed: 0.36, green: 0.80, blue: 0.42, alpha: 1)
            case "failed": dot = NSColor(calibratedRed: 0.90, green: 0.33, blue: 0.33, alpha: 1)
            default: dot = NSColor(calibratedRed: 0.42, green: 0.62, blue: 0.95, alpha: 1)
            }
            var text = shown
            if !state.detail.isEmpty && shown != "done" { text += " · " + state.detail }
            if shown == "done" { text = "done" + (state.detail.isEmpty ? "" : " · " + state.detail) }

            let font = NSFont.monospacedSystemFont(ofSize: max(10, h * 0.085), weight: .medium)
            var attrs: [NSAttributedString.Key: Any] = [
                .font: font,
                .foregroundColor: NSColor(calibratedWhite: 0.92, alpha: 1),
            ]
            var label = text as NSString
            var size = label.size(withAttributes: attrs)
            let maxWidth = bounds.width - 24
            while size.width > maxWidth - 30 && label.length > 8 {
                label = (label.substring(to: label.length - 4) + "…") as NSString
                size = label.size(withAttributes: attrs)
            }
            attrs[.foregroundColor] = NSColor(calibratedWhite: 0.92, alpha: 1)

            let dotR: CGFloat = 4
            let padX: CGFloat = 10
            let bubbleW = size.width + padX * 2 + dotR * 2 + 6
            let bubbleH = size.height + 8
            let bubble = NSRect(
                x: cx - bubbleW / 2,
                y: bounds.maxY - bubbleH - 2,
                width: bubbleW, height: bubbleH
            )
            NSColor(calibratedRed: 0.10, green: 0.10, blue: 0.14, alpha: 0.94).setFill()
            NSBezierPath(roundedRect: bubble, xRadius: bubbleH / 2, yRadius: bubbleH / 2).fill()
            dot.setFill()
            NSBezierPath(ovalIn: NSRect(
                x: bubble.minX + padX - 2, y: bubble.midY - dotR,
                width: dotR * 2, height: dotR * 2
            )).fill()
            label.draw(
                at: NSPoint(x: bubble.minX + padX + dotR * 2 + 4, y: bubble.minY + 4),
                withAttributes: attrs
            )
        }
    }
}

// -------------------------------------------------------------------- app --

let app = NSApplication.shared
app.setActivationPolicy(.accessory)

let view = PetView()
view.prefs = readPrefs()

let size = view.desiredSize
let screen = NSScreen.main?.visibleFrame
    ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
let origin = NSPoint(
    x: view.prefs.x.map { CGFloat($0) } ?? (screen.maxX - size.width - 24),
    y: view.prefs.y.map { CGFloat($0) } ?? (screen.minY + 24)
)

let panel = NSPanel(
    contentRect: NSRect(origin: origin, size: size),
    styleMask: [.borderless, .nonactivatingPanel],
    backing: .buffered,
    defer: false
)
panel.level = .floating
panel.isOpaque = false
panel.backgroundColor = .clear
panel.hasShadow = false
panel.hidesOnDeactivate = false
panel.isFloatingPanel = true
panel.becomesKeyOnlyIfNeeded = true
panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
panel.contentView = view
panel.orderFrontRegardless()

// The animation loop: ~12 frames a second, which is plenty for a bob, a
// blink, and a sip, and costs nothing measurable for a view this small. The
// state file is re-read every ~0.7s inside the same loop rather than on its
// own timer, so there is exactly one clock in the program.
var frame = 0
Timer.scheduledTimer(withTimeInterval: 1.0 / 12.0, repeats: true) { _ in
    frame += 1
    if frame % 8 == 0 {
        view.state = readState()
        if view.shownStatus == "working" { view.pulse.toggle() }
    }
    view.needsDisplay = true
}

app.run()
