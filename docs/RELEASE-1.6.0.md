# Folio PDF Studio 1.6.0

**English** · [简体中文](RELEASE-1.6.0.zh-Hans.md) · [繁體中文](RELEASE-1.6.0.zh-Hant.md)

This release makes English the default interface and adds immediate switching between English, Simplified Chinese and Traditional Chinese.

## Changes

- A globe-and-language control stays visible in the top bar. Preferences provides the same setting. Native language names, keyboard access, focus indicators and both themes are supported.
- Language choice is stored locally. Switching updates interface labels, tooltips, dialogs and notices without reopening the document or resetting pending edits.
- Offline catalogs cover bookmarks and rules, text and image editing, tables, OCR, large-file controls and update messages. Document content, names, input values and OCR corrections are excluded from translation.
- The portable updater uses the chosen language. Current multilingual release notes select the corresponding section in the update window, with English as the fallback.
- English-first README, documentation index and release notes link directly to Simplified and Traditional Chinese versions.
- Translation tests check placeholder consistency, default/fallback behavior and data preservation. Windows acceptance covers the packaged EXE, language persistence, dialog coverage, keyboard access, multiple window widths and themes, followed by editing regressions.

## Upgrading

Download `Folio-PDF-Studio-1.6.0-portable-win-x64.zip`, extract the complete folder and run `Folio.exe`. Source, validation results and SHA-256 checksums are supplied alongside it. Existing language choices are retained; profiles without a choice start in English.

The updater retains the application directory name, so a shortcut to that path stays valid. Settings remain in the user profile. The old 1.3 installer cannot be replaced before it runs: if it previously closed without restarting, close Folio completely, rename the old folder as a backup, and put the newly extracted `Folio-PDF-Studio` folder at the old path before starting `Folio.exe`.

## Scope and limits

This release supplies three complete UI catalogs. Additional languages require a reviewed catalog and acceptance tests before they appear in the selector. OCR language choices are separate and do not extend the recognition model. Windows-native dialogs follow OS language; lower-level technical diagnostics can remain in their source language. Earlier release notes retain their historical wording.

Existing PDF/font/OCR limitations remain documented in the README. Automated Windows tests do not replace real hardware, mixed-DPI or IME testing. The attached validation report identifies the actual tested source, executable and application archive; prior releases are not counted as evidence for this build.
