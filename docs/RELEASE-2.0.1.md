# Folio PDF Studio 2.0.1

AI sidebar input and Windows portability maintenance release.

- Chatbox runs as an independent, borderless companion window aligned to the sidebar. Native activation and IME remain in its own process; no cross-process SetParent or input-thread attachment. The sidebar follows Folio visibility and foreground ordering. Chatbox remains separately discoverable in the taskbar.
- Sidebar integration and the portable updater use bundled Python with Win32 APIs. Neither launches PowerShell or needs WebView2. The updater checks archive paths, SHA-256, package version, explicit commit approval and renderer health; failures preserve or restore the previous installation.
- Chatbox 1.20.3 provider SDK, network adapter and outbound header forwarding are unchanged.

Validation: 268 unit tests; repeated sidebar/window switching, keyboard input, Backspace, Chinese text, resize, hide/show and minimize/restore; settings and approval flows; real Qwen API response; real model PDF bookmark creation and image interpretation; 60 PDF tools; Windows updater rejection/rollback and full packaged update with renderer health acknowledgement. Computer-use testing clicked the actual sidebar, entered mixed Chinese/English text, used Backspace, switched windows, and typed n/i/Space through Sogou IME to commit the character 你. Candidate-window stacking was verified after repair.

Target: Windows 10 21H1 x64 with PowerShell blocked and no WebView2. Validation was performed on the available Windows host, not a separate 21H1 target. Other IMEs, multiple monitors and other DPI combinations are not certified by this run.

Installation: extract the entire portable ZIP to a writable folder and run Folio.exe. On a machine where PowerShell is blocked, upgrade from older Folio versions by extracting this release manually, because the old updater itself still requires PowerShell. Updates initiated by 2.0.1 use the new bundled helper. Keep the previous folder until your documents and API configuration have been checked.
