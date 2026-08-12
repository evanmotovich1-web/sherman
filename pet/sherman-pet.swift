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
    var color: String
    var x: Double?
    var y: Double?
}

let SIZES: [(name: String, label: String, height: CGFloat)] = [
    ("small", "Small", 76),
    ("medium", "Medium", 108),
    ("large", "Large", 148),
    ("huge", "Huge", 204),
]

// The coat colors /customize and the right-click menu offer. Pink is the
// house accent; blue is the reference creature's periwinkle.
let COLORS: [(name: String, label: String, base: NSColor, shade: NSColor)] = [
    ("pink", "Pink",
     NSColor(calibratedRed: 0.98, green: 0.42, blue: 0.68, alpha: 1),
     NSColor(calibratedRed: 0.80, green: 0.28, blue: 0.54, alpha: 1)),
    ("blue", "Blue",
     NSColor(calibratedRed: 0.44, green: 0.51, blue: 0.92, alpha: 1),
     NSColor(calibratedRed: 0.31, green: 0.36, blue: 0.74, alpha: 1)),
    ("green", "Green",
     NSColor(calibratedRed: 0.32, green: 0.74, blue: 0.50, alpha: 1),
     NSColor(calibratedRed: 0.21, green: 0.55, blue: 0.36, alpha: 1)),
    ("purple", "Purple",
     NSColor(calibratedRed: 0.62, green: 0.45, blue: 0.92, alpha: 1),
     NSColor(calibratedRed: 0.46, green: 0.31, blue: 0.73, alpha: 1)),
    ("gray", "Gray",
     NSColor(calibratedWhite: 0.55, alpha: 1),
     NSColor(calibratedWhite: 0.40, alpha: 1)),
]

func palette(_ name: String) -> (base: NSColor, shade: NSColor) {
    let entry = COLORS.first(where: { $0.name == name }) ?? COLORS[0]
    return (entry.base, entry.shade)
}

func blendColor(_ from: NSColor, toward to: NSColor, amount: CGFloat) -> NSColor {
    let start = from.usingColorSpace(.deviceRGB) ?? from
    let end = to.usingColorSpace(.deviceRGB) ?? to
    let t = min(max(amount, 0), 1)
    return NSColor(
        calibratedRed: start.redComponent + (end.redComponent - start.redComponent) * t,
        green: start.greenComponent + (end.greenComponent - start.greenComponent) * t,
        blue: start.blueComponent + (end.blueComponent - start.blueComponent) * t,
        alpha: start.alphaComponent + (end.alphaComponent - start.alphaComponent) * t
    )
}

func smoothstep(_ t: CGFloat) -> CGFloat {
    t * t * (3 - 2 * t)
}

func emotionPalette(_ preferred: (base: NSColor, shade: NSColor), status: String)
    -> (base: NSColor, shade: NSColor) {
    let target: (base: NSColor, shade: NSColor, amount: CGFloat)
    switch status {
    case "working":
        target = (
            NSColor(calibratedRed: 0.96, green: 0.72, blue: 0.24, alpha: 1),
            NSColor(calibratedRed: 0.74, green: 0.47, blue: 0.12, alpha: 1),
            0.58
        )
    case "done":
        target = (
            NSColor(calibratedRed: 0.32, green: 0.80, blue: 0.42, alpha: 1),
            NSColor(calibratedRed: 0.20, green: 0.61, blue: 0.30, alpha: 1),
            0.62
        )
    case "failed":
        target = (
            NSColor(calibratedRed: 0.91, green: 0.30, blue: 0.32, alpha: 1),
            NSColor(calibratedRed: 0.70, green: 0.18, blue: 0.20, alpha: 1),
            0.72
        )
    case "waiting":
        target = (
            NSColor(calibratedRed: 0.38, green: 0.62, blue: 0.96, alpha: 1),
            NSColor(calibratedRed: 0.24, green: 0.42, blue: 0.78, alpha: 1),
            0.58
        )
    case "offline":
        return (
            NSColor(calibratedWhite: 0.42, alpha: 1),
            NSColor(calibratedWhite: 0.33, alpha: 1)
        )
    default: // idle and unknown states keep the preferred coat unchanged
        return preferred
    }
    return (
        blendColor(preferred.base, toward: target.base, amount: target.amount),
        blendColor(preferred.shade, toward: target.shade, amount: target.amount)
    )
}

func readPrefs() -> PetPrefs {
    let url = petDir.appendingPathComponent("prefs.json")
    guard let data = try? Data(contentsOf: url),
          let raw = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
        return PetPrefs(size: "medium", color: "pink", x: nil, y: nil)
    }
    return PetPrefs(
        size: (raw["size"] as? String) ?? "medium",
        color: (raw["color"] as? String) ?? "pink",
        x: raw["x"] as? Double,
        y: raw["y"] as? Double
    )
}

func savePrefs(_ prefs: PetPrefs) {
    var raw: [String: Any] = ["size": prefs.size, "color": prefs.color]
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

/// One line per click attempt into ~/.sherman/pet/click.log, so a click that
/// lands wrong is diagnosable from the file instead of from memory. Bounded:
/// the log is truncated when it passes ~32KB.
func clickLog(_ message: String) {
    let url = petDir.appendingPathComponent("click.log")
    let stamp = ISO8601DateFormatter().string(from: Date())
    let line = "\(stamp) \(message)\n"
    if let existing = try? Data(contentsOf: url), existing.count < 32_768 {
        try? (String(data: existing, encoding: .utf8)! + line).write(to: url, atomically: true, encoding: .utf8)
    } else {
        try? line.write(to: url, atomically: true, encoding: .utf8)
    }
}

func runAppleScript(_ source: String) -> (matched: Bool, error: String?) {
    guard let script = NSAppleScript(source: source) else { return (false, "script did not parse") }
    var errorInfo: NSDictionary?
    let result = script.executeAndReturnError(&errorInfo)
    if let info = errorInfo {
        return (false, String(describing: info[NSAppleScript.errorBriefMessage] ?? info))
    }
    return (result.booleanValue, nil)
}

/// Raise the window titled "Sherman Abrams" (the shell names its own window)
/// inside one terminal app. Terminal and iTerm2 are scriptable directly;
/// everything else (Ghostty, WezTerm, kitty, Alacritty) goes through System
/// Events, which needs the one-time automation consent macOS asks for on
/// first use. Returns whether a Sherman window was found and raised.
func raiseIn(bundleId: String, processName: String, scriptable: String?) -> Bool {
    let source: String
    switch scriptable {
    case "terminal":
        source = """
        tell application "Terminal"
            repeat with w in windows
                if (name of w as string) contains "Sherman Abrams" then
                    set index of w to 1
                    activate
                    return true
                end if
            end repeat
        end tell
        return false
        """
    case "iterm":
        source = """
        tell application "iTerm2"
            repeat with w in windows
                if (name of w as string) contains "Sherman Abrams" then
                    select w
                    activate
                    return true
                end if
            end repeat
        end tell
        return false
        """
    default:
        source = """
        tell application "System Events"
            tell process "\(processName)"
                repeat with w in windows
                    if (name of w as string) contains "Sherman Abrams" then
                        perform action "AXRaise" of w
                        set frontmost to true
                        return true
                    end if
                end repeat
            end tell
        end tell
        return false
        """
    }
    let outcome = runAppleScript(source)
    if let error = outcome.error {
        clickLog("raise \(processName): error \(error)")
        return false
    }
    clickLog("raise \(processName): \(outcome.matched ? "matched" : "no Sherman window")")
    return outcome.matched
}

// Every terminal the pet knows how to look inside, keyed by bundle id.
let TERMINALS: [(bundleId: String, processName: String, scriptable: String?)] = [
    ("com.apple.Terminal", "Terminal", "terminal"),
    ("com.googlecode.iterm2", "iTerm2", "iterm"),
    ("com.mitchellh.ghostty", "Ghostty", nil),
    ("com.github.wez.wezterm", "wezterm-gui", nil),
    ("net.kovidgoyal.kitty", "kitty", nil),
    ("org.alacritty", "Alacritty", nil),
]

func isRunning(_ bundleId: String) -> Bool {
    !NSRunningApplication.runningApplications(withBundleIdentifier: bundleId).isEmpty
}

func focusSherman(_ state: PetState) {
    clickLog("click: recorded terminal '\(state.terminal)'")

    // Search for the Sherman window across every RUNNING terminal, the
    // recorded one first. A stale or empty recording must not send the click
    // to the wrong app when the right window is findable by name.
    let recordedId = terminalBundleId(state.terminal)
    let ordered = TERMINALS.sorted { a, _ in a.bundleId == recordedId }
    for terminal in ordered where isRunning(terminal.bundleId) {
        if raiseIn(bundleId: terminal.bundleId, processName: terminal.processName,
                   scriptable: terminal.scriptable) {
            return
        }
    }

    // No titled window anywhere (a session older than the title feature, or
    // consent declined): activate the recorded terminal's app if it runs,
    // else any running terminal, else launch the default one.
    let fallbackId = isRunning(recordedId)
        ? recordedId
        : TERMINALS.first(where: { isRunning($0.bundleId) })?.bundleId ?? recordedId
    clickLog("fallback: activating \(fallbackId)")
    if let app = NSRunningApplication.runningApplications(withBundleIdentifier: fallbackId).first {
        if #available(macOS 14.0, *) {
            app.activate()
        } else {
            app.activate(options: [.activateIgnoringOtherApps])
        }
        return
    }
    if let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: fallbackId)
        ?? NSWorkspace.shared.urlForApplication(withBundleIdentifier: "com.apple.Terminal") {
        NSWorkspace.shared.openApplication(at: url, configuration: NSWorkspace.OpenConfiguration())
    }
}

// ------------------------------------------------------------------- view --

final class PetView: NSView {
    var state = PetState(status: "offline", detail: "", terminal: "", updatedAt: 0)
    var prefs = readPrefs()
    private var downAt: NSPoint?
    private var moved = false
    private var previousVisualStatus = "offline"
    private var currentVisualStatus = "offline"
    private var transitionStartedAt = Date().timeIntervalSince1970

    // Every animation derives from the wall clock: bob and transition lift are
    // curves of now, blinking lands in the first beat of its cycle, and the
    // sip plays in the first ~2.8s of every 15-second cycle.
    var now: Double { Date().timeIntervalSince1970 }

    static let SIP_PERIOD = 15.0
    static let SIP_LENGTH = 2.8
    static let STATE_TRANSITION_LENGTH = 0.24

    var transitionProgress: CGFloat {
        let elapsed = max(0, now - transitionStartedAt)
        return min(1, CGFloat(elapsed / PetView.STATE_TRANSITION_LENGTH))
    }

    var easedTransitionProgress: CGFloat {
        smoothstep(transitionProgress)
    }

    func synchronizeVisualStatus() {
        let next = shownStatus
        guard next != currentVisualStatus else { return }
        previousVisualStatus = currentVisualStatus
        currentVisualStatus = next
        transitionStartedAt = now
    }

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
        for color in COLORS {
            let item = NSMenuItem(title: color.label, action: #selector(pickColor(_:)), keyEquivalent: "")
            item.target = self
            item.representedObject = color.name
            item.state = prefs.color == color.name ? .on : .off
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

    /// Resize the window for the current size pref, keeping the feet planted.
    func applySize() {
        if let window = self.window {
            var frame = window.frame
            let size = desiredSize
            frame.origin.y += frame.size.height - size.height
            frame.size = size
            window.setFrame(frame, display: true, animate: false)
        }
        needsDisplay = true
    }

    @objc func pickSize(_ sender: NSMenuItem) {
        guard let name = sender.representedObject as? String else { return }
        prefs.size = name
        savePrefs(prefs)
        applySize()
    }

    @objc func pickColor(_ sender: NSMenuItem) {
        guard let name = sender.representedObject as? String else { return }
        prefs.color = name
        savePrefs(prefs)
        needsDisplay = true
    }

    @objc func openSherman() { focusSherman(state) }
    @objc func quitPet() { NSApp.terminate(nil) }

    // ----------------------------------------------------------- drawing --

    func drawExpression(status: String, alpha: CGFloat, centerX cx: CGFloat,
                        face: NSRect, petHeight h: CGFloat) {
        guard alpha > 0 else { return }
        let color = (status == "offline"
            ? NSColor(calibratedWhite: 0.65, alpha: 1)
            : NSColor(calibratedRed: 0.62, green: 0.93, blue: 0.87, alpha: 1))
            .withAlphaComponent(alpha)
        color.setStroke()
        color.setFill()

        let eyeY = face.midY + h * 0.025
        let eyeDX = face.width * 0.20
        let lineWidth = max(2.0, h * 0.028)
        for side in [-1.0, 1.0] {
            let ex = cx + CGFloat(side) * eyeDX
            if blinking && status != "failed" && status != "offline" {
                let lid = NSBezierPath()
                lid.lineWidth = lineWidth
                lid.lineCapStyle = .round
                lid.move(to: NSPoint(x: ex - h * 0.045, y: eyeY))
                lid.line(to: NSPoint(x: ex + h * 0.045, y: eyeY))
                lid.stroke()
                continue
            }
            switch status {
            case "working":
                let r = h * 0.044
                NSBezierPath(ovalIn: NSRect(
                    x: ex - r, y: eyeY - r, width: r * 2, height: r * 2
                )).fill()
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
                let ring = NSBezierPath(ovalIn: NSRect(
                    x: ex - r, y: eyeY - r, width: r * 2, height: r * 2
                ))
                ring.lineWidth = lineWidth
                ring.stroke()
            default: // idle and offline
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

        let mouthY = face.minY + face.height * 0.17
        switch status {
        case "working":
            let mouth = NSBezierPath()
            mouth.lineWidth = lineWidth * 0.80
            mouth.lineCapStyle = .round
            mouth.move(to: NSPoint(x: cx - h * 0.042, y: mouthY))
            mouth.line(to: NSPoint(x: cx + h * 0.042, y: mouthY))
            mouth.stroke()
        case "done":
            NSColor(calibratedRed: 1, green: 0.48, blue: 0.58, alpha: 0.55 * alpha).setFill()
            let cheekR = h * 0.025
            for side in [-1.0, 1.0] {
                NSBezierPath(ovalIn: NSRect(
                    x: cx + CGFloat(side) * face.width * 0.31 - cheekR,
                    y: mouthY - cheekR * 0.20,
                    width: cheekR * 2, height: cheekR * 1.15
                )).fill()
            }
            color.setStroke()
            let smile = NSBezierPath()
            smile.lineWidth = lineWidth
            smile.lineCapStyle = .round
            smile.appendArc(
                withCenter: NSPoint(x: cx, y: mouthY + h * 0.045), radius: h * 0.055,
                startAngle: 200, endAngle: 340
            )
            smile.stroke()
        case "failed":
            let frown = NSBezierPath()
            frown.lineWidth = lineWidth
            frown.lineCapStyle = .round
            frown.appendArc(
                withCenter: NSPoint(x: cx, y: mouthY - h * 0.025), radius: h * 0.055,
                startAngle: 20, endAngle: 160
            )
            frown.stroke()
        case "waiting":
            let rx = h * 0.025
            let ry = h * 0.032
            NSBezierPath(ovalIn: NSRect(
                x: cx - rx, y: mouthY - ry, width: rx * 2, height: ry * 2
            )).fill()
        default: // idle and offline
            let mouth = NSBezierPath()
            mouth.lineWidth = lineWidth * 0.75
            mouth.lineCapStyle = .round
            mouth.move(to: NSPoint(x: cx - h * 0.025, y: mouthY))
            mouth.line(to: NSPoint(x: cx + h * 0.025, y: mouthY))
            mouth.stroke()
        }
    }

    override func draw(_ dirtyRect: NSRect) {
        guard let ctx = NSGraphicsContext.current?.cgContext else { return }
        ctx.clear(bounds)

        let shown = shownStatus
        let h = petHeight
        let cx = bounds.midX
        let reduceMotion = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
        let transition = easedTransitionProgress
        let reactionProgress = transitionProgress
        let reactionLift = reduceMotion || reactionProgress >= 1
            ? 0
            : h * 0.025 * CGFloat(sin(Double.pi * Double(reactionProgress)))
        // The whole creature rides the breathing bob; the speech bubble stays
        // anchored so the text does not wobble while being read.
        let breathingLift = reduceMotion || shown == "offline" ? 0 : h * bob
        let baseY = bounds.minY + 4 + breathingLift + reactionLift
        let sip = reduceMotion ? nil : sipProgress

        // The preferred coat remains the identity underneath a transient
        // semantic tint. Body and expression share one 240ms crossfade.
        let offline = shown == "offline"
        let coat = palette(prefs.color)
        let previousCoat = emotionPalette(coat, status: previousVisualStatus)
        let currentCoat = emotionPalette(coat, status: currentVisualStatus)
        let body = blendColor(previousCoat.base, toward: currentCoat.base, amount: transition)
        let bodyDark = blendColor(previousCoat.shade, toward: currentCoat.shade, amount: transition)
        let panel = NSColor(calibratedRed: 0.078, green: 0.078, blue: 0.11, alpha: 1)
        let eye = currentVisualStatus == "offline"
            ? NSColor(calibratedWhite: 0.65, alpha: 1)
            : NSColor(calibratedRed: 0.62, green: 0.93, blue: 0.87, alpha: 1)

        // Legs first — two stubby feet the torso overlaps, the reference's
        // stance — then torso and arms, then the head over all of it.
        let torsoW = h * 0.52
        let torsoH = h * 0.34
        let legH = h * 0.10
        let torsoY = baseY + legH * 0.72
        for side in [-1.0, 1.0] {
            let leg = NSRect(
                x: cx + CGFloat(side) * torsoW * 0.26 - h * 0.07,
                y: baseY,
                width: h * 0.14, height: legH + h * 0.05
            )
            bodyDark.setFill()
            NSBezierPath(roundedRect: leg, xRadius: h * 0.05, yRadius: h * 0.05).fill()
        }

        let torso = NSRect(x: cx - torsoW / 2, y: torsoY, width: torsoW, height: torsoH)
        body.setFill()
        NSBezierPath(roundedRect: torso, xRadius: h * 0.09, yRadius: h * 0.09).fill()

        // The right arm (screen right) is the drinking arm: during a sip it is
        // drawn later, up at the face holding the bottle, instead of here.
        for side in [-1.0, 1.0] {
            if side > 0 && sip != nil { continue }
            let arm = NSRect(
                x: cx + CGFloat(side) * torsoW * 0.62 - h * 0.075,
                y: torsoY + torsoH * 0.28,
                width: h * 0.15, height: h * 0.15
            )
            bodyDark.setFill()
            NSBezierPath(ovalIn: arm).fill()
        }

        // Chest mark: the caduceus on a small dark screen, the reference's
        // chest-panel arrangement in this house's trade.
        let chestPanel = NSRect(
            x: cx - torsoW * 0.26, y: torsoY + torsoH * 0.10,
            width: torsoW * 0.52, height: torsoH * 0.52
        )
        panel.setFill()
        NSBezierPath(roundedRect: chestPanel, xRadius: h * 0.03, yRadius: h * 0.03).fill()
        let chest = "⚕" as NSString
        let chestFont = NSFont.systemFont(ofSize: torsoH * 0.42, weight: .bold)
        let chestAttrs: [NSAttributedString.Key: Any] = [
            .font: chestFont,
            .foregroundColor: eye,
        ]
        let chestSize = chest.size(withAttributes: chestAttrs)
        chest.draw(
            at: NSPoint(x: cx - chestSize.width / 2, y: chestPanel.minY + torsoH * 0.03),
            withAttributes: chestAttrs
        )

        // The cloud head: overlapping puffs, the reference silhouette.
        let headY = torsoY + torsoH * 0.72
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

        if transition < 1 {
            drawExpression(
                status: previousVisualStatus, alpha: 1 - transition,
                centerX: cx, face: face, petHeight: h
            )
        }
        drawExpression(
            status: currentVisualStatus, alpha: transition,
            centerX: cx, face: face, petHeight: h
        )

        // The sip: every fifteen seconds the right arm rises with a little
        // amber medicine bottle, tips it at the face for a pretend drink, and
        // puts it back. Phases: raise (0–0.3), sip (0.3–0.7), lower (0.7–1).
        if let p = sip {
            let restPoint = NSPoint(x: cx + torsoW * 0.62, y: torsoY + torsoH * 0.35)
            let mouthPoint = NSPoint(x: cx + faceW * 0.16, y: face.minY + faceH * 0.22)
            let lift: CGFloat
            let tilt: CGFloat
            if p < 0.3 {
                lift = smoothstep(p / 0.3)
                tilt = lift * 0.9
            } else if p < 0.7 {
                lift = 1
                // A little wobble mid-sip: the glug.
                tilt = 0.9 + 0.12 * CGFloat(sin(Double(p) * 34))
            } else {
                lift = smoothstep((1 - p) / 0.3)
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

// The animation loop runs at 30fps so state crossfades have enough frames to
// read smoothly. State and preferences still poll only every ~0.67s, leaving
// one clock in the program without doing file I/O on every drawing frame.
var frame = 0
Timer.scheduledTimer(withTimeInterval: 1.0 / 30.0, repeats: true) { _ in
    frame += 1
    if frame % 20 == 0 {
        view.state = readState()
        // /customize edits prefs.json from the shell; pick the changes up
        // live. Size and color only — position belongs to dragging, and
        // re-applying a stored origin here would fight the operator's hand.
        let fresh = readPrefs()
        if fresh.color != view.prefs.color {
            view.prefs.color = fresh.color
        }
        if fresh.size != view.prefs.size {
            view.prefs.size = fresh.size
            view.applySize()
        }
    }
    // Check every frame because `done` becomes `idle` from the wall clock,
    // independently of state-file polling.
    view.synchronizeVisualStatus()
    view.needsDisplay = true
}

app.run()
