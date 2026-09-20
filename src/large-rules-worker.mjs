onmessage = ({ data: { patterns, lines, page } }) => {
  try {
    const rules = patterns.map((p) => new RegExp(p, "u"));
    const results = [];
    for (const line of lines)
      for (const text of line.text.split(/\r?\n/)) {
        const clean = text.trim();
        if (!clean) continue;
        for (let i = 0; i < rules.length; i++)
          if (rules[i].test(clean)) {
            results.push({ level: i + 1, title: clean, page });
            break;
          }
      }
    postMessage({ results });
  } catch (e) {
    postMessage({ error: e.message });
  }
};
