const fs = require('node:fs');
const path = require('node:path');

// Copy once, atomically, leaving the old profile available for rollback. Never
// put credentials in the portable app folder or a version-dependent directory.
function prepareProfile(appData, override) {
  if (override) { fs.mkdirSync(override, { recursive: true }); return override; }
  const base = path.join(appData, 'Folio');
  const target = path.join(base, 'Chatbox');
  if (fs.existsSync(target)) return target;
  fs.mkdirSync(base, { recursive: true });
  const legacy = fs.readdirSync(base).filter(n => /^Chatbox-\d/.test(n))
    .filter(n => fs.existsSync(path.join(base, n, 'config.json')))
    .sort((a,b) => b.localeCompare(a, undefined, {numeric:true}))[0];
  const staging = fs.mkdtempSync(path.join(base, '.chatbox-migration-'));
  if (legacy) fs.cpSync(path.join(base, legacy), staging, { recursive: true,
    filter: p => !/^(Singleton.*|LOCK|lockfile)$/.test(path.basename(p)) });
  fs.writeFileSync(path.join(staging, 'folio-profile.json'), JSON.stringify({schema:1, migratedFrom:legacy || null}));
  fs.renameSync(staging, target);
  return target;
}

function migrateSettings(value = {}) {
  const s = structuredClone(value);
  const legacy = s.providers?.['folio-qwen'];
  const fake = s.customProviders?.find(p => p.id === 'folio-qwen');
  // An empty old seed is disposable. A configured account is user data: retain
  // its ID, endpoint, models and session references, only remove Folio branding.
  if (fake && !legacy?.apiKey?.trim()) {
    s.customProviders = s.customProviders.filter(p => p.id !== 'folio-qwen');
    if (s.providers) delete s.providers['folio-qwen'];
    if (s.provider === 'folio-qwen') { delete s.provider; delete s.modelId; }
    if (s.defaultChatModel?.provider === 'folio-qwen') delete s.defaultChatModel;
  } else if (fake?.name === 'Folio Qwen') fake.name = 'Qwen (custom)';
  return s;
}
function settings(value, {root, pipe, token}) {
  const s = migrateSettings(value);
  return {...s, autoUpdate:false, allowReportingAndTracking:false,
    mcp:{...s.mcp, enabledBuiltinServers:s.mcp?.enabledBuiltinServers || [],
      servers:[...(s.mcp?.servers || []).filter(s => s.id !== 'folio-pdf'),
        {id:'folio-pdf', name:'Folio PDF', enabled:true,
          transport:{type:'stdio', command:process.execPath,
            args:[path.join(root,'stdio.cjs')],
            env:{ELECTRON_RUN_AS_NODE:'1',FOLIO_MCP_PIPE:pipe,FOLIO_MCP_TOKEN:token}}}]}};
}
module.exports = {prepareProfile, migrateSettings, settings};
