// Read-only 10ms frontmost-PID/pointer observer; no activation, AX or input APIs.
import AppKit
import Foundation
// No runner survives this ownership pipe. EOF/any data stops only this observer;
// no PID-based adoption, unrelated-process signal or unbounded input buffering.
DispatchQueue.global().async {
    _ = try? FileHandle.standardInput.read(upToCount: 1)
    exit(0)
}
while true {
    let pid = NSWorkspace.shared.frontmostApplication?.processIdentifier ?? -1
    let point = NSEvent.mouseLocation
    print("\(ProcessInfo.processInfo.systemUptime) \(pid) \(point.x) \(point.y)")
    fflush(stdout)
    Thread.sleep(forTimeInterval: 0.01)
}
