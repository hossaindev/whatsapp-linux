# WhatsApp Linux 1.2.0

### Fixes & Improvements
- **Taskbar icon fix**: Configured `StartupWMClass: whatsapp` and desktop name matching `whatsapp.desktop` so GNOME, KDE, and other Linux desktop environments display the official green WhatsApp icon instead of a generic gear or Wayland placeholder icon.
- **Tray icon stability**: Added icon validation and caching with graceful fallbacks if icon assets are missing or corrupted. Added safeguards across all tray interactions and automatic tray re-registration if the desktop panel restarts, preventing blank icons or tray crashes.
- **Reproducible builds**: Added `package-lock.json` and updated CI dependencies for deterministic packaging.
- **Automated release workflow**: CI automatically builds and attaches `WhatsApp_1.2.0_amd64.deb` to GitHub Releases on `v*` tag pushes.

### Installation
Download the attached `WhatsApp_1.2.0_amd64.deb` from the release assets and install via:
```bash
sudo apt install ./WhatsApp_1.2.0_amd64.deb
```
