# Folio PDF Studio 1.6.2

This follow-up also fixes false rollback when the initialized new window is minimized or occluded. Startup acknowledgement no longer depends on animation frames or window visibility. A real minimized-window regression is included.

This patch fixes Windows portable updates that silently exit or leave the old version installed. It retains the editing and multilingual features of 1.6.0.

## Fixed

- Windows PowerShell could exit with code 0 without executing a script when started with Node's `detached: true`. Simply sharing the parent's console could also terminate the helper when Folio exited. A short-lived bootstrap now starts the helper in its own hidden console, captures output and verifies preparation before quitting Folio.
- Each installation has a separate script and startup log, preventing concurrent launches from overwriting the helper and preserving failures that occur before script logging starts.
- Replacement requires an explicit acknowledgement after verification and the unsaved-document check. Closing or crashing during preparation cannot silently authorize a replacement.
- Restart preserves the user profile and verifies both the new version and the exact restarted process. Failed startup restores the previous directory.
- The update dialog shows preparation progress and the previous installation result; failed downloads and installations can be retried.

## Upgrading from 1.3–1.6

The affected updater cannot reliably install its own fix. Download both `Folio-PDF-Studio-1.6.2-portable-win-x64.zip` and `Folio-PDF-Studio-1.6.2-update-repair.zip` from this release. Save documents and close Folio, extract the repair ZIP, run `Repair-Folio-Update.cmd`, then select the existing `Folio.exe` and the downloaded portable ZIP. The repair tool verifies the pinned release hash, installs in the same directory, starts the new version and retains a sibling backup. Shortcuts keep their existing target. Do not select GitHub's automatically generated source ZIP.

Alternatively, extract the full portable ZIP into a new directory and run its `Folio.exe`. Settings remain in the existing Windows user profile.

## Verification and limits

The Windows release workflow runs unit tests, package verification, existing editor/native/multilingual regressions, actual PowerShell failure/rollback tests, and an end-to-end packaged Electron update through the production launcher. Release assets are published only after these checks pass; their validation report records the source commit, workflow and binary hashes.

The application remains unsigned. A directory held open by another Folio instance or other software can prevent replacement; the original installation and error details are retained. No automatic forced termination of unrelated applications is performed.
