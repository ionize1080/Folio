const paths = {
  settings: 'M19.80 12.00 L21.81 13.95 L21.24 15.83 L18.49 16.33 L17.52 17.52 L17.56 20.31 L15.83 21.24 L13.52 19.65 L12.00 19.80 L10.05 21.81 L8.17 21.24 L7.67 18.49 L6.48 17.52 L3.69 17.56 L2.76 15.83 L4.35 13.52 L4.20 12.00 L2.19 10.05 L2.76 8.17 L5.51 7.67 L6.48 6.48 L6.44 3.69 L8.17 2.76 L10.48 4.35 L12.00 4.20 L13.95 2.19 L15.83 2.76 L16.33 5.51 L17.52 6.48 L20.31 6.44 L21.24 8.17 L19.65 10.48z M15.5 12a3.5 3.5 0 1 0-7 0 3.5 3.5 0 0 0 7 0',
  more: 'M6 12a1 1 0 1 0-2 0 1 1 0 0 0 2 0 M13 12a1 1 0 1 0-2 0 1 1 0 0 0 2 0 M20 12a1 1 0 1 0-2 0 1 1 0 0 0 2 0',
  unlock: 'M7 10V7a5 5 0 0 1 9-3 M4 10h16v11H4z M12 14v3',

  text: 'M4 5h16 M12 5v14 M8 19h8 M4 3v4 M20 3v4',
  scan: 'M3 8V3h5 M16 3h5v5 M21 16v5h-5 M8 21H3v-5 M7 8h10 M7 12h10 M7 16h6',
  table: 'M3 4h18v16H3z M3 9h18 M3 14h18 M10 4v16',
  link: 'M10 14l4-4 M8 16l-1 1a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0 M16 8l1-1a4 4 0 0 1 6 6l-5 5a4 4 0 0 1-6 0',
  check: 'M4 12l5 5L20 6',
  spacing: 'M3 4h18 M7 20h10 M12 7v10 M9 10l3-3 3 3 M9 14l3 3 3-3',
  sidebar: 'M3 4h18v16H3z M9 4v16 M5 8h2 M5 12h2',
  'save-as': 'M4 3h14l3 3v7 M7 3v6h10V3 M3 3v18h9 M14 18l5-5 3 3-5 5-4 1z',

  file: "M6 3h8l4 4v14H6z M14 3v5h4 M9 12h6 M9 16h6",
  folder: "M3 7V5h6l2 2h10v13H3z",
  save: "M4 3h14l3 3v15H3V3z M7 3v6h10V3 M7 21v-8h10v8",
  undo: "M8 5 3 10l5 5 M3 10h11a6 6 0 0 1 0 12",
  redo: "M16 5l5 5-5 5 M21 10H10a6 6 0 0 0 0 12",
  spark:
    "m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z M20 2v4 M18 4h4",
  sliders:
    "M4 3v7 M4 14v7 M12 3v11 M12 18v3 M20 3v3 M20 10v11 M1 10h6 M9 14h6 M17 6h6",
  exchange: "M3 7h17l-4-4 M21 17H4l4 4 M20 7l-4 4 M4 17l4-4",
  pages: "M8 3h13v16H8z M3 7v15h13",
  info: "M12 8h.01 M12 11v6 M22 12a10 10 0 1 0-20 0 10 10 0 0 0 20 0",
  search: "M21 21l-5-5 M18 10a8 8 0 1 0-16 0 8 8 0 0 0 16 0",
  plus: "M12 5v14 M5 12h14",
  chevron: "m7 10 5 5 5-5",
  bookmark: "M6 3h12v19l-6-4-6 4z",
  branch: "M6 3v13a3 3 0 0 0 3 3h10 M6 7h13 M16 4l3 3-3 3 M16 16l3 3-3 3",
  trash: "M3 6h18 M9 6V3h6v3 M5 6l1 15h12l1-15 M10 10v7 M14 10v7",
  pen: "m4 16 12-12 4 4L8 20l-5 1z M14 6l4 4",
  rotate: "M20 7V2 M20 7h-5 M20 7a9 9 0 1 0 1 9",
  shield: "m12 2 9 4v6c0 6-9 10-9 10S3 18 3 12V6z m-5 10 3 3 6-6",
  cursor: "m4 3 6 18 3-7 7-3z",
  crosshair:
    "M12 2v4 M12 18v4 M2 12h4 M18 12h4 M19 12a7 7 0 1 0-14 0 7 7 0 0 0 14 0",
  sun: "M12 2v2 M12 20v2 M2 12h2 M20 12h2 M5 5l1 1 M18 18l1 1 M5 19l1-1 M18 6l1-1 M17 12a5 5 0 1 0-10 0 5 5 0 0 0 10 0",
};
export function icon(name) {
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[name] || paths.bookmark}"/></svg>`;
}
export function icons(root = document) {
  root
    .querySelectorAll("i[data-icon]")
    .forEach((e) => (e.innerHTML = icon(e.dataset.icon)));
}
