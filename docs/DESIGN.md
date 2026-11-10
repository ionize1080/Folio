# Desktop interface conventions in 2.1.0

## Color and selection

Preferences separates **appearance** (system, light or dark) from **palette** (Cobalt, Celadon, Amber, Mulberry, Graphite or a custom accent). In the default light theme, Cobalt is `#165DDB` with white button text, a contrast ratio of 5.80:1. In dark appearance the accent is `#85AEFF` with a dark foreground. Custom choices go through the same foreground-contrast calculation. Selection fills and borders are mixed in OKLab. PDF page colors, bookmark styling written to the document and image adjustments belong to the document.

Selected tools use a tinted fill, outline and stronger label weight. A selected bookmark row also has a leading indicator. The focused control has a separate visible outline. These cues help distinguish “this tool is on” from “the keyboard will act here.” [Apple HIG on color](https://developer.apple.com/design/human-interface-guidelines/color) · [Apple HIG on accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility)

## Controls and layout

- Keep primary commands in a dedicated toolbar row. Related actions share spacing. Compact toolbar targets use 32 px height with 18 px main icons and 16 px viewer icons. The language picker belongs in Preferences.
- A document tab shows the filename, a close control and a dot for pending edits. The active tab remains visible when tabs overflow. Ctrl+Tab and Ctrl+Shift+Tab cycle through documents. With a tab label focused, arrows, Home and End navigate the strip.
- Dropdowns and disclosure controls use stroked chevrons. Checkboxes distinguish checked, unchecked and mixed states. Preserve native semantics, keyboard interaction and forced-colors handling when updating their appearance.
- Menus fit the viewport and scroll vertically. Escape dismisses the overflow menu and returns focus. Chatbox yields its native view while a Folio menu or modal needs the space. Model progress occupies its own row above the composer.

Implementation is split between [palette and contrast calculations](../src/appearance.mjs), [shared controls](../src/controls.css), [desktop layout](../src/chrome.css) and [tab interaction](../src/document-tabs.mjs). The UI suite checks three languages at 1080, 1250 and 1500 px widths in both light and dark modes. Separate hosted-view tests check overlay visibility and composer geometry. [Release validation](VALIDATION.md)

## 2.5 studio and insertion review

Both embedded editors use the host language and native UI font families. Menus distinguish keyboard focus, active tools and currently open popovers; switching or dismissing a popover clears the previous anchor. Shared select styling provides checkmarks, aligned rows, visible focus and bounded scrolling while retaining native keyboard semantics. Blank-page insertion groups page size and destination, with a live page silhouette. The provider settings are reachable from both Chatbox layouts. See [the workflow review and evidence](WORKFLOW-2.5.0.md).
