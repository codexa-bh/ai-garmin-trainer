// Read-only 10ms frontmost-PID/pointer observer; no activation, AX or input APIs.
import AppKit
import Foundation
while true {
    let pid = NSWorkspace.shared.frontmostApplication?.processIdentifier ?? -1
    let point = NSEvent.mouseLocation
    print("\(ProcessInfo.processInfo.systemUptime) \(pid) \(point.x) \(point.y)")
    fflush(stdout)
    Thread.sleep(forTimeInterval: 0.01)
}
