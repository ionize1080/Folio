import { icon } from './icons.mjs';
import { getLanguage, onLanguageChange, t } from './i18n.mjs';

export function installRibbon() {
  const header = document.querySelector('.appbar');
  if (header.dataset.ribbon) return;
  header.dataset.ribbon = 'true';
  const home = header.querySelector('.toolbar'), more = home.querySelector('.more-tools');
  const actions = header.querySelector('.app-actions'), ai = header.querySelector('.folio-ai-open');
  if (ai) { actions.prepend(ai); ai.classList.add('ai-primary'); ai.title = 'AI 助手 · Chatbox'; }
  for (const group of home.querySelectorAll('.toolgroup')) if (!group.children.length) group.remove();
  const row = document.createElement('div'); row.className = 'ribbon-tab-row';
  const tabs = document.createElement('nav'); tabs.className = 'ribbon-tabs';
  tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', '功能区');
  const panel = document.createElement('nav'); panel.className = 'ribbon-context toolbar';
  panel.id = 'ribbon-context'; panel.hidden = true;
  const collapse = document.createElement('button'); collapse.className = 'ribbon-collapse';
  collapse.innerHTML = icon('collapse'); collapse.title = '收起功能区 Ctrl+F1';
  collapse.setAttribute('aria-label', collapse.title);
  row.append(tabs, more, collapse); header.append(row, panel);
  home.classList.add('ribbon-home'); home.id = 'ribbon-home'; home.setAttribute('role', 'tabpanel');
  home.setAttribute('aria-labelledby', 'ribbon-tab-home');
  const definitions = [
    ['home', '常用', 'Home', []], ['read', '阅读', 'Read', []],
    ['edit', '编辑', 'Edit', ['flow-edit', 'edit-content', 'table-structure', 'font-tools', 'undo', 'redo']],
    ['photo', '图像', 'Image', ['photo-studio', 'edit-image', 'graphics-editor']],
    ['vector', '矢量', 'Vector', ['vector-studio', 'graphics-editor', 'edit-content']],
    ['bookmarks', '书签', 'Bookmarks', ['bookmark-qc', 'bookmark-every', 'bookmark-sort', 'smart-toc', 'generate', 'calibrate', 'calibrate-pages', 'whitespace', 'batch', 'exchange']],
    ['organize', '组织', 'Organize', ['insert-blank-page', 'page-organizer', 'document-assembly', 'pages']],
    ['export', '导出', 'Export', ['export-word', 'export-excel', 'save-as', 'save-project', 'exchange', 'office-import', 'document-utilities']],
  ];
  const selection = document.querySelector('.selection-toolbar');
  const originals = new Map([...document.querySelectorAll('button')].map(b => [b.id || b.dataset.action, b]).filter(([id]) => id));
  const proxies = [], groups = new Map([['home', home]]), buttons = new Map();
  function proxy(original) {
    const b = document.createElement('button'); b.className = 'ribbon-command';
    b.dataset.ribbonCommand = original.id || original.dataset.action;
    if (original.hasAttribute('data-doc')) b.dataset.doc = '';
    const sync = () => {
      if (b.disabled !== original.disabled) b.disabled = original.disabled;
      const pressed = original.getAttribute('aria-pressed');
      if (pressed == null) b.removeAttribute('aria-pressed');
      else if (b.getAttribute('aria-pressed') !== pressed) b.setAttribute('aria-pressed', pressed);
    };
    sync();
    new MutationObserver(sync).observe(original, { attributes: true, attributeFilter: ['disabled', 'aria-pressed'] });
    b.onclick = () => original.click(); proxies.push({ button: b, original }); return b;
  }
  let current = null;
  function choose(id, focus = false) {
    if (id !== current) {
      if (current != null) {
        groups.get(current).hidden = true;
        const previous = buttons.get(current); previous.setAttribute('aria-selected', 'false'); previous.tabIndex = -1;
      }
      groups.get(id).hidden = false; panel.hidden = id === 'home';
      const tab = buttons.get(id); tab.setAttribute('aria-selected', 'true'); tab.tabIndex = 0; current = id;
    }
    if (focus) buttons.get(id).focus({ preventScroll: true });
  }
  function setCollapsed(off, persist = true) {
    if (header.classList.contains('ribbon-collapsed') !== off) header.classList.toggle('ribbon-collapsed', off);
    collapse.setAttribute('aria-expanded', String(!off));
    if (persist) { try { localStorage.setItem('folio-ribbon-collapsed', String(off)); } catch {} }
  }
  for (const [id, , , commands] of definitions) {
    // Keep controls mounted: switching never moves the reading toolbar through
    // the document or re-runs localization on a detached command subtree.
    if (id !== 'home') {
      const group = document.createElement('div'); group.className = 'ribbon-category';
      group.id = 'ribbon-panel-' + id; group.hidden = true; group.setAttribute('role', 'tabpanel');
      group.setAttribute('aria-labelledby', 'ribbon-tab-' + id);
      if (id === 'read') { selection.hidden = false; group.append(selection); }
      else group.append(...commands.map(key => originals.get(key)).filter(Boolean).map(proxy));
      panel.append(group); groups.set(id, group);
    }
    const b = document.createElement('button'); b.id = 'ribbon-tab-' + id; b.dataset.category = id;
    b.setAttribute('role', 'tab'); b.setAttribute('aria-controls', groups.get(id).id);
    b.setAttribute('aria-selected', 'false'); b.tabIndex = -1;
    b.onclick = () => { setCollapsed(false); choose(id); }; tabs.append(b); buttons.set(id, b);
  }
  const labels = () => {
    for (const [id, zh, en] of definitions) buttons.get(id).textContent = getLanguage() === 'en' ? en : t(zh);
    // Originals have already been localized. Copy only on language changes.
    for (const { button, original } of proxies) {
      button.innerHTML = original.innerHTML; button.title = original.title || original.textContent;
    }
  };
  tabs.onkeydown = e => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault(); let i = definitions.findIndex(d => d[0] === (e.target.closest('[data-category]')?.dataset.category || current));
    i = e.key === 'Home' ? 0 : e.key === 'End' ? definitions.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + definitions.length) % definitions.length;
    setCollapsed(false); choose(definitions[i][0], true);
  };
  const toggle = () => setCollapsed(!header.classList.contains('ribbon-collapsed'));
  collapse.onclick = toggle;
  document.addEventListener('keydown', e => { if (e.ctrlKey && e.key === 'F1') { e.preventDefault(); toggle(); } });
  let collapsed = false;
  try { collapsed = localStorage.getItem('folio-ribbon-collapsed') === 'true'; } catch {}
  setCollapsed(collapsed, false); labels(); onLanguageChange(labels); choose('home');
}
