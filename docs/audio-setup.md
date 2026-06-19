# Virtual Audio Driver Setup Guide

This guide walks through setting up a virtual audio cable/device to capture system audio from meeting apps (Zoom, Google Meet, Microsoft Teams, etc.) for use with the Meeting Recorder.

---

## Table of Contents

- [Windows: VB-Cable](#windows-vb-cable)
- [macOS: BlackHole](#macos-blackhole)
- [Linux: PulseAudio module-loopback](#linux-pulseaudio-module-loopback)
- [Configuring Meeting Recorder](#configuring-meeting-recorder)
- [Troubleshooting](#troubleshooting)

---

## Windows: VB-Cable

### Installation

1. Download the **VB-Cable Virtual Audio Cable** (free version) from [vb-audio.com/Cable](https://vb-audio.com/Cable/).
2. Unzip the downloaded archive.
3. Right-click `VBCABLE_Setup_x64.exe` (or `VBCABLE_Setup.exe` for 32-bit) and select **Run as administrator**.
4. Click **Install Driver**. You may see a Windows security prompt — click **Install** to proceed.
5. A success message appears once installation completes. Reboot your PC when prompted.

### Configuration

- After reboot, open **Sound Settings** (right-click the speaker icon in the system tray → **Sounds**).
- Go to the **Playback** tab — you should see **CABLE Input** listed.
- Go to the **Recording** tab — you should see **CABLE Output** listed.

To route system audio to the virtual cable:

1. Open **Sound Settings** → **App volume and device preferences**.
2. Under **Output**, find your meeting app (e.g., Zoom, Teams).
3. Change its output device to **CABLE Input**.
4. Now the app's audio is sent through the virtual cable.

> **Note:** The free version allows one virtual cable. You will not hear audio from the meeting app through your speakers — use the **Listen** feature (see Troubleshooting) or a second cable (paid version) if you need simultaneous monitoring.

---

## macOS: BlackHole

### Installation

BlackHole is a free, open-source virtual audio driver for macOS.

**Option A — Homebrew (recommended):**

```bash
brew install blackhole-2ch
```

**Option B — Manual install:**

1. Download the latest `BlackHole.pkg` from [github.com/ExistentialAudio/BlackHole/releases](https://github.com/ExistentialAudio/BlackHole/releases).
2. Open the `.pkg` file and follow the installer prompts.
3. Enter your admin password when prompted.
4. Restart your Mac.

### Configuration using Audio MIDI Setup

1. Open **Audio MIDI Setup** (`Applications/Utilities/Audio MIDI Setup.app`).
2. You should see **BlackHole 2ch** listed as an audio device.
3. Create a **Multi-Output Device** to hear audio while recording:
   - Click the **+** at the bottom left and choose **Create Multi-Output Device**.
   - In the right panel, check **BlackHole 2ch** and **Built-in Output**.
   - Set **Built-in Output** as the **Drift Correction** device.
4. In **System Settings** → **Sound**, set **Output** to the **Multi-Output Device** you created.
5. Set **Input** to **BlackHole 2ch**.

Now all system audio is routed through BlackHole and can be captured as an input device.

> **Tip:** Use **BlackHole 16ch** (via `brew install blackhole-16ch`) for multi-channel workflows.

---

## Linux: PulseAudio module-loopback

### Installation

Most Linux distributions include PulseAudio by default. Install `pavucontrol` for a graphical mixer:

```bash
# Debian / Ubuntu
sudo apt install pulseaudio pavucontrol

# Fedora
sudo dnf install pulseaudio pavucontrol

# Arch Linux
sudo pacman -S pulseaudio pavucontrol
```

### Loading the loopback module

1. Load the loopback module (replace `alsa_output.pci-0000_00_1f.3.analog-stereo` with your actual output sink name):

```bash
# List available sinks to find your output device
pactl list short sinks

# Load the loopback module
pactl load-module module-loopback latency_msec=20
```

2. By default, the loopback will capture whatever is playing on your default sink. To verify:

```bash
pactl list short source-outputs
```

You should see a source output pointing to `module-loopback`.

### Making it permanent

Add the following line to `/etc/pulse/default.pa` (or `~/.config/pulse/default.pa` for user-level):

```
load-module module-loopback latency_msec=20
```

Then restart PulseAudio:

```bash
pulseaudio -k
pulseaudio --start
```

### Using pavucontrol (GUI)

1. Launch `pavucontrol`.
2. Go to the **Recording** tab.
3. Your recording app will appear — click the dropdown next to it and select **Monitor of <your internal audio>**.

This achieves the same result as the loopback module without editing config files.

---

## Configuring Meeting Recorder

Once the virtual audio driver is installed and system audio is routed through it:

1. Open the Meeting Recorder app.
2. Navigate to **Settings** → **Audio**.
3. In the **Input Device** dropdown, select the virtual device:

   | OS      | Device Name        |
   |---------|--------------------|
   | Windows | **CABLE Output**   |
   | macOS   | **BlackHole 2ch**  |
   | Linux   | **Monitor of <sink>** or **module-loopback** |

4. Set the sample rate to **48000 Hz** (recommended for most meeting apps).
5. Click **Save** or **Apply**.

The app will now capture system audio from your meeting apps.

---

## Troubleshooting

### No audio is being captured

- **Check device routing:** Verify the meeting app is outputting to the virtual cable (Windows: App volume settings, macOS: Multi-Output Device, Linux: pavucontrol Playback tab).
- **Check recording level:** In your OS sound settings, ensure the virtual input device is not muted and its level is at 100%.
- **Restart the app:** Close and reopen the Meeting Recorder after changing audio devices.
- **Restart audio service (Linux):** `pulseaudio -k; pulseaudio --start`.

### Wrong device is selected

- In Meeting Recorder settings, confirm the correct input device is chosen from the dropdown.
- On Windows, disable other recording devices temporarily.
- On macOS, verify BlackHole is set as **Input** in System Settings → Sound.
- On Linux, use `pavucontrol` Recording tab to explicitly assign the app to the monitor source.

### Audio is too quiet or distorted

- Reduce the meeting app's output volume — virtual cables can clip if the source is too loud.
- In Meeting Recorder, lower the **Input Gain** setting.
- On Linux, adjust `latency_msec` — higher values (e.g., 50) reduce crackling but add delay.

### Hear audio while recording (monitoring)

**Windows (VB-Cable):**
1. Go to **Sound Settings** → **Recording** tab.
2. Right-click **CABLE Output** → **Properties** → **Listen** tab.
3. Check **Listen to this device** and select your speakers/headphones.
4. Wait — this adds a small delay.

**macOS (BlackHole):**
- Use a **Multi-Output Device** as described in the Configuration section.

**Linux (PulseAudio):**
- Use `pavucontrol` → Playback tab to route the loopback monitor to your speakers.

### Loopback module not found (Linux)

Ensure PulseAudio is running:

```bash
pulseaudio --check
pulseaudio --start
```

If you changed `default.pa`, restart PulseAudio afterwards.

### Virtual device not appearing

- **Windows:** Reboot after VB-Cable installation. Check Device Manager under **Sound, video and game controllers** for "CABLE" entries.
- **macOS:** Run `sudo killall coreaudiod` to restart the audio daemon. Reboot if it still does not appear.
- **Linux:** Run `pacmd list-sources | grep name:` to list available sources — the monitor source should have a `.monitor` suffix.

### Audio crackling or popping

- Increase latency (Linux: `latency_msec=50`, Windows/macOS: increase buffer size in Meeting Recorder settings).
- Close other apps consuming high CPU or audio resources.
- Try a different sample rate (44100 vs 48000).
