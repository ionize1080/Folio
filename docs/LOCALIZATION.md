# Localization

Folio 1.6 ships English (default), Simplified Chinese (`zh-Hans`) and Traditional Chinese (`zh-Hant`). The choice is explicit and stored as `folio-language`; unsupported/corrupt values fall back to English. It does not follow the OS automatically. OCR output scripts and display language are separate settings.

## Design references

- [Adobe Acrobat: change application language](https://helpx.adobe.com/acrobat/desktop/get-started/preferences-and-settings/change-language.html): a dedicated application-language preference.
- [Microsoft: globalization and localization](https://learn.microsoft.com/en-us/windows/apps/design/globalizing/globalizing-portal): separate language resources and locale-aware layout.
- [USWDS: selecting a language](https://designsystem.digital.gov/patterns/select-a-language/selected-content/): native language names for discoverability.

Folio adds a persistent globe/native-name selector to the top bar, mirrors it in Preferences, preserves keyboard focus and changes labels without restarting an editing session. Commands occupy their own row to accommodate longer English labels. No flags imply a one-to-one country/language mapping.

## Runtime contract

`src/i18n.mjs` owns locale normalization, static catalogs, exact/template message lookup and UI bindings. The legacy interface uses immutable Chinese source phrases as compatibility keys. A bounded cache and anchored templates preserve interpolated data. Only interface surfaces are translated; document layers, input values, editable content, file names, bookmark labels, font names and OCR text are excluded. New user-data surfaces must be marked `translate="no"` or `data-user-content`.

The UI observer updates changed subtrees, not the entire document on each input. WeakMap records retain original messages so repeated switching is reversible. Options retain original values. Application logic must never interpret translated display text; use semantic state or `sourceText` for legacy status readers. HTML is not reconstructed by translation, and strings are written as text rather than HTML.

`src/locales/en.json` and `zh-Hant.json` are reviewed source catalogs. Simplified Chinese uses the immutable source phrase. Traditional text was bootstrapped with OpenCC and common UI terminology corrected; it is shipped as a standalone catalog without runtime script conversion. `catalog.mjs` is generated and bundled for offline use.

## Updating a translation

1. Add the phrase to each catalog, preserving numbered placeholders and technical tokens.
2. Keep document data out of UI labels; mark any user-content containers explicitly.
3. Run `node scripts/build-locales.mjs` and `npm run test:unit`.
4. Run packaged Windows acceptance with `FOLIO_EXE` and inspect screenshots in all locales, at supported minimum widths and in both themes.
5. Update README and release notes in the same supported languages.

Do not add a language to the selector with a partial placeholder catalog. Older documents and release records remain historical sources; they are not silently rewritten. Native Windows dialogs follow OS language, and third-party technical diagnostics can retain original wording.

## Release contract

GitHub release bodies contain an English section followed by collapsed Simplified/Traditional sections, identified with `folio-locale` comments. The in-app update view selects the current locale and falls back to English. Existing releases without these markers display unchanged. The installer receives only an allowlisted language code; it does not evaluate translated text as code.

Validation checks default/persistence/fallback, catalog and placeholder parity, document-data preservation, live changes in dialogs, keyboard focus and window widths. The publish job must verify report/binary hashes and refuse a release if its Windows gate failed.
