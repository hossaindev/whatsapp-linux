# WhatsApp Linux 1.1.0

- Recover the original 1.0.0 source and make builds reproducible through GitHub Actions.
- Clear disposable HTTP cache without deleting login, cookies, chat databases or settings.
- Consistent color tray icon by default, with explicit white/black options for panel contrast.
- Wayland auto selection, PipeWire screen-capture support, bounded renderer crash recovery and corrected exit handling.
- Remote pages no longer have Node.js access; sandboxing and origin-scoped permissions enabled.
- Experimental Linux Accept/Decline notifications when WhatsApp Web exposes visible English-language call buttons and the desktop supports notification actions. Actions target the current call only and expire after 45 seconds. A successful action does not bring the window forward.

## Important limitations
WhatsApp Web calling availability depends on WhatsApp and your account. This wrapper cannot enable unavailable calls. Button detection is conservative and currently English-only. An action that cannot be verified produces a failure notification rather than pretending the call was answered. Native message notifications remain handled by Chromium/WhatsApp Web.

Automated tests do not replace testing a real call on Zorin OS/Wayland. Please test microphone/camera permission, hidden-window calls and tray behavior on your desktop before relying on this release for calls.

Install the attached amd64 package with `sudo apt install ./WhatsApp_1.1.0_amd64.deb`.
