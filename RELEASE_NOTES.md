# WhatsApp Desktop for Linux — Version 1.3.0 Release Notes

### Native System Tray & Indicator Stability
- **Fixed Tray Rendering on Linux**: Fixed an issue where the color tray icon failed to render or appeared distorted on GNOME AppIndicator, KDE StatusNotifierItem, and XFCE panels due to oversized asset definitions. Pre-rendered pixel-crisp 22x22 and 24x24 tray assets and enforced runtime downscaling.
- **Standalone Cache Clearing**: You can now clear the browser cache directly from the system tray menu (`Clear Cache…`) even when WhatsApp is minimized or hidden in the background, without needing to restore or open the main window.
- **Background Notification on Cleanup**: Replaced blocking modal popups with non-intrusive desktop notifications upon cache cleanup completion.

### Performance & Package Optimization
- **Lighter .deb Package**: Configured `maximum` compression and `xz` archive packaging for Debian distributions, noticeably reducing download footprint.
- **Optimized Chromium Engine Switches**: Disabled unnecessary telemetry and site isolation overhead for the webview container to cut down memory consumption and CPU usage.
- **Hardware Acceleration**: Enabled PipeWire WebRTC screen capture and VA-API hardware video decode flags for smooth calling on Linux.
- **Official Native Meta Polish**: Added native Linux desktop shortcuts (`Ctrl+Q` to quit, `Ctrl+W` to close to tray, `F5` / `Ctrl+R` to reload), enhanced `.desktop` categories, keywords, and Meta authorship metadata.
