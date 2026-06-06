# WhatsApp for Ubuntu Linux

An unofficial WhatsApp Desktop client for Ubuntu Linux, built on Electron.  
Wraps WhatsApp Web with a native-feeling experience: custom slim titlebar, system tray, and full system notification support.

---

## Screenshots

> The app loads WhatsApp Web inside a frameless window with a slim custom titlebar showing the WhatsApp icon, unread count, and native window controls (minimize · maximize · close).

---

## Features

- **Frameless custom titlebar** — slim bar with the real WhatsApp icon, title, and working window controls
- **System tray** — monochromatic tray icon (auto-switches white/black for dark/light panels)
- **Background running** — close the window and keep running in the tray; tray icon controls everything
- **Starts silently at login** — launches to the tray on Ubuntu startup, no window popup
- **System notifications** — messages and calls use Ubuntu's native notification system (libnotify)
- **Call notifications** — incoming calls trigger critical/persistent notifications
- **Unread count** — shown in the titlebar and tray tooltip
- **In-app settings panel** — accessible via tray → Settings
- **Startup Applications** — appears in GNOME Startup Applications (`gnome-session-properties`)
- **Single instance** — clicking the tray icon or launching again restores the existing window

---

## Installation

### Download

Grab the latest `.deb` from the [**Releases**](../../releases) page.

### Install

```bash
# Install the .deb
sudo dpkg -i WhatsApp_1.0.0_amd64.deb

# Fix any missing dependencies
sudo apt-get install -f
```

### Launch

Search for **WhatsApp** in your application launcher, or run:

```bash
whatsapp
```

The app will also appear in **Startup Applications** and launch automatically at next login.

---

## Tray Icon Controls

| Action | Result |
|--------|--------|
| Left-click tray icon | Show / hide the window |
| Right-click tray icon | Context menu |
| **Run in Background** (menu) | Toggle close-to-tray behaviour |
| **Launch at Login** (menu) | Enable / disable autostart |
| **Notifications** (menu) | Enable / disable system notifications |
| **Quit WhatsApp** (menu) | Fully exit the app |

---

## Settings Panel

Open via **Tray → Settings**:

| Setting | Default | Description |
|---------|---------|-------------|
| Minimize to tray | Off | Minimize button → taskbar (off) or tray (on) |
| Keep running on close | **On** | Close button hides to tray |
| Show unread count in title bar | On | `(3) WhatsApp` in the title |
| Start minimized | Off | Open to tray instead of window |
| Enable system notifications | On | Native libnotify notifications |
| Notification sound | On | System sound with notifications |
| Launch automatically at login | **On** | Writes `~/.config/autostart/` entry |

---

## Uninstall

```bash
sudo apt-get remove whatsapp-linux
```

---

## Requirements

- Ubuntu 20.04 or later (64-bit)
- Internet connection (loads WhatsApp Web)
- Dependencies installed automatically by the `.deb`: `libnotify4`, `libxtst6`, `libnss3`, `libsecret-1-0`

---

## How it works

The app uses **Electron** to wrap `https://web.whatsapp.com` inside a `<webview>` tag embedded in a local shell page. The shell page owns the custom titlebar and window controls — completely independent of WhatsApp Web's own DOM — so buttons always work. Notifications are intercepted via `executeJavaScript` inside the webview and sent to the main process as native libnotify notifications.

---

## Building from source

```bash
# Clone the repo
git clone https://github.com/YOUR_USERNAME/whatsapp-linux.git
cd whatsapp-linux

# Install dependencies
npm install

# Run in development
npm start

# Build .deb
npm run build
```

> Requires Node.js 18+ and a Linux host for `.deb` packaging.

---

## License

This project is not affiliated with or endorsed by WhatsApp LLC or Meta Platforms, Inc.  
Distributed under the [MIT License](LICENSE).  
WhatsApp® is a trademark of WhatsApp LLC.
