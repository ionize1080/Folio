# Desktop interface conventions

Folio's controls follow consistent alignment, recognizable symbols and adaptable layouts described in [Apple HIG Layout](https://developer.apple.com/design/human-interface-guidelines/layout), [Icons](https://developer.apple.com/design/human-interface-guidelines/icons), [Menus](https://developer.apple.com/design/human-interface-guidelines/menus) and [Windows design basics](https://learn.microsoft.com/en-us/windows/apps/design/basics/). Folio remains a Windows document application; these references guide principles rather than prescribe identical platform controls.

`src/chrome.css` centralizes the application chrome. The PDF canvas and its coordinate system are independent.

- Use a 4 px spacing rhythm, 32 px compact command controls, 34 px document/language controls, 18 px main icons and 16 px viewer icons. These are Folio's density choices, not dimensions mandated by Apple.
- Align icon centers and label baselines. Distinct operations use distinct silhouettes; automatic bookmarks uses a bookmark with a plus, while AI uses a spark. Only the automatic-approval shield is red.
- Reserve the blue primary action for the main action. Selection uses neutral fill and a subtle border; keyboard focus retains an unmistakable outline. The same treatment applies to document tools, selection tools, rule navigation, page tiles and OCR page labels.
- Menus size to their content, stay inside the viewport and scroll vertically. Long translated labels remain readable. Arrow keys, Home/End and Escape operate the overflow menu and restore focus.
- Avoid backdrop blur and transitions of geometry. Hidden menu colors update immediately on a theme change. Reduced-motion and forced-colors modes remain supported.
- The native AI view yields while host menus or modal dialogs are open. Only mutations relevant to overlays trigger updates, coalesced once per frame; scrolling through text layers does not repeatedly scan the interface.

`tests/chrome-202.cjs` checks English, Simplified and Traditional Chinese at 1080, 1250 and 1500 px widths, in both themes. It checks geometry, menu clipping, theme inheritance, keyboard traversal and icon uniqueness. Screenshots are reviewed alongside native mouse/keyboard testing; geometry checks alone do not establish visual quality.
