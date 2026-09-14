# WhatsApp Desktop for Linux — Version 1.4.0 Release Notes

### Background Pseudo-Sleep (RAM & Battery Saver)
- **Automatic Pseudo-Sleep**: When minimized or hidden in the system tray, WhatsApp enters a low-footprint pseudo-sleep mode after 4 seconds of inactivity.
- **Deep Memory Reclaim**: Automatically executes V8 garbage collection across the browser process, guest webview, and shell window; purges intermediate DNS and host cache buffers; and pauses offscreen media elements.
- **Always-Alive Calls & Notifications**: The persistent WhatsApp WebSocket connection and DOM mutation watchers remain completely active. Incoming calls, messages, and mentions wake the UI immediately without any dropped or delayed notifications.
- **User Configurable**: Toggle "Pseudo-Sleep (Save RAM)" anytime from the system tray context menu or the in-app Settings dialog.
