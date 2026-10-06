// Printed labels are evidence, never a physical-page offset. Keep numbering
// systems separate: preliminary page xii is not body page 12.
const zeros = [
  0x30, 0x660, 0x6f0, 0x7c0, 0x966, 0x9e6, 0xa66, 0xae6, 0xb66, 0xbe6, 0xc66,
  0xce6, 0xd66, 0xde6, 0xe50, 0xed0, 0xf20, 0x1040, 0x1090, 0x17e0, 0x1810,
  0xff10,
];
const chineseDigits = new Map(
  [..."零〇一二三四五六七八九"].map((c, i) => [c, Math.max(0, i - 1)]),
);
for (const [c, n] of Object.entries({
  壹: 1,
  贰: 2,
  貳: 2,
  叁: 3,
  參: 3,
  肆: 4,
  伍: 5,
  陆: 6,
  陸: 6,
  柒: 7,
  捌: 8,
  玖: 9,
  两: 2,
  兩: 2,
}))
  chineseDigits.set(c, n);
function chineseNumber(s) {
  if ([...s].every((c) => chineseDigits.has(c)))
    return Number([...s].map((c) => chineseDigits.get(c)).join(""));
  const units = {
    十: 10,
    拾: 10,
    百: 100,
    佰: 100,
    千: 1000,
    仟: 1000,
    万: 10000,
    萬: 10000,
  };
  let total = 0,
    section = 0,
    digit = null,
    last = 10000,
    large = false;
  for (const c of s) {
    if (chineseDigits.has(c)) {
      const n = chineseDigits.get(c);
      if (digit !== null && digit !== 0) return null;
      digit = n;
    } else if (units[c]) {
      const u = units[c];
      if (u === 10000) {
        if (large || !(section || digit)) return null;
        total = (section + (digit || 0)) * u;
        section = 0;
        last = 10000;
        large = true;
      } else {
        if (u >= last || (digit === null && !(u === 10 && section === 0)))
          return null;
        section += (digit ?? 1) * u;
        last = u;
      }
      digit = null;
    } else return null;
  }
  return total + section + (digit || 0);
}
export function parsePageLabel(raw) {
  if (typeof raw !== "string" || !raw.trim() || raw.length > 80) return null;
  let s = raw.normalize("NFKC").trim();
  for (const [a, b] of [
    ["(", ")"],
    ["[", "]"],
    ["【", "】"],
    ["〔", "〕"],
  ])
    if (s.startsWith(a) && s.endsWith(b))
      s = s.slice(a.length, -b.length).trim();
  s = s.replace(/^第\s*(.+?)\s*页$/u, "$1");
  s = [...s]
    .map((c) => {
      const cp = c.codePointAt(0),
        z = zeros.find((z) => cp >= z && cp < z + 10);
      return z === undefined ? c : String(cp - z);
    })
    .join("");
  let value = null,
    system = "decimal",
    prefix = "";
  if (/^\d+$/u.test(s)) value = Number(s);
  else if (
    /^[零〇一二三四五六七八九十百千万萬壹贰貳叁參肆伍陆陸柒捌玖拾佰仟两兩]+$/u.test(
      s,
    )
  )
    value = chineseNumber(s);
  else if (
    /^(?=[MDCLXVI]+$)M{0,3}(CM|CD|D?C{0,3})(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})$/i.test(
      s,
    )
  ) {
    system = "roman";
    value = 0;
    const v = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 },
      a = [...s.toUpperCase()];
    a.forEach((c, i) => (value += v[c] < (v[a[i + 1]] || 0) ? -v[c] : v[c]));
  } else {
    const m = s.match(/^([\p{L}]+)\s*[-–—]\s*(\d+)$/u);
    if (!m) return null;
    system = "prefixed";
    prefix = m[1].toLocaleUpperCase("en-US");
    value = Number(m[2]);
  }
  if (!Number.isSafeInteger(value) || value < 1 || value > 1000000) return null;
  return { raw, system, prefix, value, key: `${system}:${prefix}:${value}` };
}
export const samePageLabel = (a, b) => {
  const x = parsePageLabel(a),
    y = parsePageLabel(b);
  return !!x && !!y && x.key === y.key;
};
