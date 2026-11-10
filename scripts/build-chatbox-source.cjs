// Reproducible source integration. Each edit starts from the pinned Git object;
// changed upstream anchors fail the build rather than silently patching bundles.
const fs=require('node:fs'), path=require('node:path'), cp=require('node:child_process'), crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'), adapter=path.join(root,'integrations/chatbox'), source=path.join(root,'.ai-runtime/chatbox-source');
const pin=require('../integrations/chatbox/upstream.json');
const git=(...args)=>cp.execFileSync('git',['-C',source,...args],{encoding:'utf8',maxBuffer:32*1024*1024});
if(git('rev-parse','HEAD').trim()!==pin.commit)throw Error('Chatbox source revision mismatch');
const changed=[];
function patch(file, replacements) {
  let text=git('show',pin.commit+':'+file);
  for(const [from,to,count=1] of replacements) {
    if(text.split(from).length-1!==count)throw Error('Source contract changed: '+file+' / '+from.slice(0,70));
    text=text.split(from).join(to);
  }
  fs.writeFileSync(path.join(source,file),text);changed.push(file);
}
// The published source tag references a provider implementation it does not
// contain. Do not ship an unusable provider entry; all supplied providers remain.
patch('src/shared/providers/index.ts', [["import './definitions/github-copilot'\n",'']]);
patch('src/renderer/hooks/useOAuth.ts', [["import { isOAuthExpired, OAuthIpcChannels } from '@shared/oauth'", "import { isOAuthExpired } from '@shared/oauth'\nconst OAuthIpcChannels = {} as Record<string,string>"], ["const isDesktop = platform.type === 'desktop'",'const isDesktop = false // OAuth is not supplied by the upstream community edition']]);
patch('src/renderer/components/chat/MessageErrTips.tsx', [["import { translateTexts } from '@/packages/translation'", "const translateTexts = async (..._args: any[]): Promise<string[]> => { throw Error('Error translation is unavailable in the upstream community source') }"], ["const showTranslateButton = language !== 'en' && errorMessage.length > 0",'const showTranslateButton = false']]);
patch('src/renderer/routes/image-creator/index.tsx', [
  ['setSelectedProvider(provider)', 'localStorage.setItem("folio-image-model", JSON.stringify({provider,modelId:model}))\n    setSelectedProvider(provider)']
]);
patch('src/renderer/routes/settings/route.tsx', [
  ["    key: 'default-models',", "    key: 'image-provider',\n    label: 'Image Model Provider',\n    icon: <IconSparkles className=\"w-full h-full\" />,\n  },\n  {\n    key: 'default-models',"],
  ['  const { t } = useTranslation()', '  const { t, i18n } = useTranslation()', 2],
  ['{t(item.label)}', "{item.key === 'image-provider' ? (i18n.language.startsWith('zh') ? (i18n.language === 'zh-Hant' ? '生圖模型提供方' : '生图模型提供方') : 'Image Model Provider') : t(item.label)}"]
]);
fs.copyFileSync(path.join(adapter,'image-provider-settings.tsx'),path.join(source,'src/renderer/routes/settings/image-provider.tsx'));
changed.push('src/renderer/routes/settings/image-provider.tsx');
patch('src/renderer/modals/Settings.tsx', [
  ["import { SettingsRoot }", "import { ImageProviderSettings } from '@/routes/settings/image-provider'\nimport { SettingsRoot }"],
  ['const SettingsDefaultModelsRoute =', "const SettingsImageProviderRoute = createRoute({ component: ImageProviderSettings, path: '/settings/image-provider', getParentRoute: () => RootRoute })\n\nconst SettingsDefaultModelsRoute ="],
  ['  SettingsDefaultModelsRoute,', '  SettingsDefaultModelsRoute,\n  SettingsImageProviderRoute,']
]);
for (const name of ['gemini','custom-gemini']) {
  patch('src/shared/providers/definitions/models/'+name+'.ts', [
    ["messages: [{ role: 'user', content: params.prompt }]", "messages: [{role:'user',content:[...(params.images || []).map(img=>({type:'image' as const,image:img.imageUrl})),{type:'text',text:params.prompt}]}]"]
  ]);
}
patch('src/shared/models/abstract-ai-sdk.ts', [
  ['// images 暂时不支持', '// source-aware edits require a provider that accepts reference images'],
  ['    const imageModel = this.getImageModel()', "    if (params.images?.length) throw Error('This provider supports generation only. Select a reference-image capable model for local edits.')\n    const imageModel = this.getImageModel()"]
]);
fs.copyFileSync(path.join(adapter,'image-generation.ts'),path.join(source,'src/renderer/folio-image-generation.ts'));
fs.copyFileSync(path.join(adapter,'conversion-review.ts'),path.join(source,'src/renderer/folio-conversion-review.ts'));
changed.push('src/renderer/folio-conversion-review.ts');
changed.push('src/renderer/folio-image-generation.ts');
// Services use a scoped Electron facade, keeping Folio lifecycle and data intact.
for(const file of ['store-node.ts','locales.ts','adapters/sentry.ts','adapters/index.ts','analystic-node.ts','knowledge-base/db.ts','knowledge-base/remote-file-parser.ts','knowledge-base/ipc-handlers.ts','mcp/ipc-stdio-transport.ts']) {
  patch('src/main/'+file, [["from 'electron'", "from '"+(file.includes('/')?'../':'./')+"folio-electron'"]]);
}
let store=fs.readFileSync(path.join(source,'src/main/store-node.ts'),'utf8').replace('clearInvalidConfig: true,','cwd: app.getPath(\'userData\'),\n  clearInvalidConfig: true,');
fs.writeFileSync(path.join(source,'src/main/store-node.ts'),store);
// Upstream's debug logging includes credentials and full tool images. Keep only
// lifecycle errors, not request bodies, environment tokens or document payloads.
const ipc=path.join(source,'src/main/mcp/ipc-stdio-transport.ts');
fs.writeFileSync(ipc,fs.readFileSync(ipc,'utf8').replace(/logger\.info\('(?:create|send|onmessage)'[^\n]*\n/g,''));
fs.copyFileSync(path.join(adapter,'services.ts'),path.join(source,'src/main/main.ts'));changed.push('src/main/main.ts');
fs.copyFileSync(path.join(adapter,'folio-electron.ts'),path.join(source,'src/main/folio-electron.ts'));changed.push('src/main/folio-electron.ts');
patch('src/preload/index.ts', [['invoke: ipcRenderer.invoke,',"invoke: ((channel: string, ...args: any[]) => ipcRenderer.invoke('chatbox:' + channel, ...args)) as any,"]]);
fs.appendFileSync(path.join(source,'src/preload/index.ts'),'\n'+fs.readFileSync(path.join(adapter,'network-preload.cjs'),'utf8'));
patch('src/shared/defaults.ts', [["provider: ModelProviderEnum.ChatboxAI,\n    modelId: 'chatboxai-4',", "provider: '' as any,\n    modelId: '',"]]);
// Replace the upstream promotional landing card with help for the open PDFs.
const homePath = 'src/renderer/routes/index.tsx';
const homeSource = git('show', pin.commit + ':' + homePath);
const start = homeSource.indexOf("        {messageLayout || welcomeCardMode !== 'none'");
const end = homeSource.indexOf('        <Stack gap="sm">\n          {session.copilotId', start);
if (start < 0 || end <= start) throw Error('Chatbox home layout changed');
patch(homePath, [[homeSource.slice(start,end), `
        <Stack align="flex-start" justify="center" gap="xs" flex={1} w="100%" maw={560} mx="auto" px="lg" py="md" style={{minHeight:0,overflowY:'auto'}}>
          <Text component="h1" size="xl" fw={600} m={0}>{language.startsWith('zh') ? (language === 'zh-Hant' ? '詢問 PDF' : '询问 PDF') : 'Ask about your PDFs'}</Text>
          <Text size="sm" c="dimmed">{language.startsWith('zh') ? (language === 'zh-Hant' ? '選取一段文字來提問，或比較已開啟文件中的內容。' : '选取一段文字来提问，或比较已打开文档中的内容。') : 'Select a passage to ask about it, or compare content across open documents.'}</Text>
          {!providers.length && <Button size="xs" variant="default" onClick={() => navigateToSettings('provider')}>{language.startsWith('zh') ? (language === 'zh-Hant' ? '設定模型服務' : '设置模型服务') : 'Set up a model provider'}</Button>}
        </Stack>
`]]);
patch('src/renderer/components/InputBox/InputBox.tsx', [
  ['{currentSessionId && <CompactionStatus', '<div id="folio-progress-slot" style={{display:"contents"}} />\n          {currentSessionId && <CompactionStatus'],
  ['        // Use the already constructed message\n        if (!preConstructedMessage.message) {\n          console.error(\'No constructed message available\')\n          return\n        }', `        // Build from the submitted draft; a passive preview effect may still hold the previous text.
        const submittedMessage = sessionHelpers.constructUserMessage(
          inputRef.current?.value ?? messageInput,
          pictureKeys,
          preConstructedMessage.preprocessedFiles,
          preConstructedMessage.preprocessedLinks
        )`],
  ['          preConstructedMessage.message.contentParts.find', '          submittedMessage.contentParts.find'],
  ['constructedMessage: preConstructedMessage.message,\n          needGenerating,','constructedMessage: await (window as any).folioCaptureMessage(submittedMessage),\n          needGenerating,'],
  ['                onClick={generating ? onStopGenerating : () => handleSubmit()}', '                aria-label={generating ? t(\'Stop\') : t(\'Send\')}\n                data-folio-send\n                onClick={generating ? onStopGenerating : () => handleSubmit()}'],
  ['{featureFlags.knowledgeBase && !isSmallScreen && (','<span id="folio-toolbar-slot" />\n                {featureFlags.knowledgeBase && !isSmallScreen && (']]);
// A responsive/initialization remount can happen inside the upstream 300ms
// debounce. Retain the latest draft synchronously and flush on page departure.
patch('src/renderer/hooks/useMessageInput.ts', [
  ["const DEFAULT_OPTIONS =", "const liveDrafts = new Map<string, string>()\nconst DEFAULT_OPTIONS ="],
  ["useCallback, useEffect, useMemo", "useCallback, useLayoutEffect, useMemo"],
  ["  const [messageInput, _setMessageInput] = useState<string>(initialMessage)\n", ""],
  ["  const restoreDraft = useCallback(() => {\n    const draft = localStorage.getItem(draftStorageKey)\n    if (!draft) return", "  const [messageInput, _setMessageInput] = useState<string>(() => options.saveDraft ? (liveDrafts.get(draftStorageKey) ?? localStorage.getItem(draftStorageKey) ?? initialMessage) : initialMessage)\n\n  const restoreDraft = useCallback(() => {\n    const draft = liveDrafts.get(draftStorageKey) ?? localStorage.getItem(draftStorageKey) ?? initialMessage"],
  ["  }, [draftStorageKey])", "  }, [draftStorageKey, initialMessage])"],
  ["      _debouncedStoreDraft(message)", "      if (options.saveDraft) {\n        liveDrafts.set(draftStorageKey, message)\n        _debouncedStoreDraft(message)\n      }"],
  ["    [_debouncedStoreDraft]", "    [_debouncedStoreDraft, draftStorageKey, options.saveDraft]"],
  ["    localStorage.removeItem(draftStorageKey)", "    liveDrafts.set(draftStorageKey, '')\n    localStorage.removeItem(draftStorageKey)"],
  ["  useEffect(() => {\n    if (options.saveDraft)", "  useLayoutEffect(() => {\n    if (options.saveDraft)"],
  ["  return {\n    messageInput,", "  useLayoutEffect(() => {\n    const flush = () => _debouncedStoreDraft.flush()\n    window.addEventListener('pagehide', flush)\n    window.addEventListener('beforeunload', flush)\n    return () => {\n      flush()\n      window.removeEventListener('pagehide', flush)\n      window.removeEventListener('beforeunload', flush)\n    }\n  }, [_debouncedStoreDraft])\n\n  return {\n    messageInput,"]
]);
patch('src/renderer/stores/session/tools-builder.ts', [["let instructions = ''","let instructions = (window as any).folioInstructions || ''"]]);
const toolsFile=path.join(source,'src/renderer/stores/session/tools-builder.ts');
let toolSource=fs.readFileSync(toolsFile,'utf8');
toolSource=toolSource.replace("import sandboxToolSet from '@/packages/model-calls/toolsets/sandbox'", "const sandboxToolSet = {description:''}")
  .replace("import { skillsController } from '@/packages/skills/controller'", "const skillsController = {discoverSkills: async () => [], loadSkill: async (_:string) => null, executeScript: async (..._:any[]) => {throw Error('Skills are unavailable in upstream community source')}}");
fs.writeFileSync(toolsFile,toolSource);
patch('src/renderer/stores/session/orchestration.ts', [
  ['        void persistStreamingMessage(sessionId, targetMsg)', '        await persistStreamingMessage(sessionId, targetMsg)'],
  ['    for (const part of processorState.contentParts) {', "    const interruption = (window as any).folioCompletionIssue(processorState.finishReason, controller.signal.aborted)\n    if (interruption) throw Error(interruption)\n\n    for (const part of processorState.contentParts) {"],
  ['    const stream = model.chatStream(coreMessages, chatOptions) as AsyncGenerator<ModelStreamPart<ToolSet>>', `    const stream = (window as any).folioContinueStream({
      model, messages: coreMessages, options: chatOptions,
      checkpoint: async () => { await persistStreamingMessage(sessionId, targetMsg) },
      history: async () => (window as any).folioExpandImages(await convertToModelMessages([{...targetMsg, contentParts: processorState.contentParts}], {modelSupportVision:model.isSupportVision(), preserveReasoning:settings.provider === ModelProviderEnum.DeepSeek})),
      phase: (text: string) => (window as any).folioProgress?.phase(sessionId, text),
    }) as AsyncGenerator<ModelStreamPart<ToolSet>>`],
  ['maxSteps: 10,', 'maxSteps: 32, // PDF tasks can require generation, edits, verification and export'],
  ['  try {\n    const dependencies', '  ;(window as any).folioProgress?.begin(sessionId)\n  try {\n    const dependencies'],
  ['    const coreMessages = await convertToModelMessages','    let coreMessages = await convertToModelMessages'],
  ['    targetMsg = {\n      ...targetMsg,\n      cancel:', '    coreMessages = await (window as any).folioRefreshContext((window as any).folioExpandImages(coreMessages))\n    targetMsg = {\n      ...targetMsg,\n      cancel:'],
  ['    for await (const chunk of stream) {','    for await (const chunk of stream) {\n      ;(window as any).folioProgress?.chunk(sessionId, chunk)'],
  ['    await persistStreamingMessage(sessionId, targetMsg, { refreshCounting: true })\n  }\n}', '    await persistStreamingMessage(sessionId, targetMsg, { refreshCounting: true })\n  } finally {\n    ;(window as any).folioProgress?.end(sessionId)\n  }\n}']]);
// Keep binary image data out of the expanded tool-result panel. The stored
// result and native image input remain intact for subsequent model turns.
patch('src/renderer/components/message-parts/ToolCallPartUI.tsx', [
  ['JSON.stringify(part.result, null, 2)', "JSON.stringify(part.result, (key, value) => typeof value === 'string' && ((key === 'data' && value.length > 512) || value.startsWith('data:image/')) ? '[image data omitted from text preview]' : value, 2)"]]);
patch('src/renderer/index.tsx', [["import { SplashScreen }", "import './folio-integration'\nimport './folio-image-generation'\nimport { SplashScreen }"]]);
const integration=`import {mcpController} from './packages/mcp/controller'\nimport {uiStore} from './stores/uiStore'\n`+
  ['network-renderer.js','controls.js','vision.js','continuation.js','conversion-json.js','completion.js','progress.js','live-context.js'].map(n=>fs.readFileSync(path.join(adapter,n),'utf8')).join('\n')+`
window.folioInstructions=${JSON.stringify(fs.readFileSync(path.join(adapter,'instructions.txt'),'utf8'))};
window.folioToolsStatus=()=>({state:mcpController.getServer('folio-pdf')?.status?.state,count:Object.keys(mcpController.getAvailableTools()).filter(n=>n.includes('folio_')||n.includes('pdf_help')).length});
window.folioLiveContext=async()=>{const entry=Object.entries(mcpController.getAvailableTools()).find(([name])=>name.endsWith('__folio_document'));if(!entry?.[1]?.execute)return null;return await entry[1].execute({action:'context'}, {toolCallId:'live-view-'+Date.now(),messages:[]});};
window.folioCaptureMessage=async message=>{window.folioProgress.begin('connection');try{const start=Date.now();while(!window.folioToolsStatus().count){if(Date.now()-start>15000)throw Error('Folio工具尚未连接，请稍后重试');await new Promise(r=>setTimeout(r,100));}return message;}finally{window.folioProgress.end('connection')}};
window.folioLayout=mode=>{document.body.dataset.folioDisplay=mode;if(mode==='sidebar')uiStore.getState().setShowSidebar(false);};
window.folioLayout('sidebar');window.folioControls.subscribe(state=>{if(state.mode)window.folioLayout(state.mode)});
const folioStyle=document.createElement('style');folioStyle.textContent='.controls.self-start {display:none!important;}';document.head.append(folioStyle);
`;
fs.writeFileSync(path.join(source,'src/renderer/folio-integration.ts'),integration);changed.push('src/renderer/folio-integration.ts');
if(!process.argv.includes('--patch-only')) {
  const run=(args)=>cp.execFileSync('cmd.exe',['/d','/s','/c',args],{cwd:source,stdio:'inherit',env:{...process.env,NODE_OPTIONS:'--max-old-space-size=8192',CHATBOX_BUILD_PLATFORM:'win32',CHATBOX_BUILD_TARGET:'desktop',NODE_ENV:'production'}});
  if(!process.argv.includes('--skip-install')) {
    fs.copyFileSync(path.join(adapter,'pnpm-lock.yaml'),path.join(source,'pnpm-lock.yaml'));
    run(`npx --yes --package=node@${pin.node} --package=pnpm@${pin.pnpm} pnpm install --frozen-lockfile --ignore-scripts`);
  }
  run(`npx --yes --package=node@${pin.node} --package=pnpm@${pin.pnpm} pnpm exec electron-vite build`);
  const out=path.join(root,'.ai-runtime/Chatbox');
  const oldDist=path.resolve(out,'native/dist');
  if(!oldDist.startsWith(path.resolve(root,'.ai-runtime')+path.sep))throw Error('Invalid build directory');
  fs.rmSync(oldDist,{recursive:true,force:true});
  fs.cpSync(path.join(source,'release/app/dist'),path.join(out,'native/dist'),{recursive:true});
  function stripMaps(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isDirectory())stripMaps(file);else if(entry.name.endsWith('.map'))fs.unlinkSync(file)}}
  stripMaps(oldDist);
  for(const name of ['bootstrap.cjs','dock.py','package.json'])fs.rmSync(path.join(out,name),{force:true});
  for(const name of ['profile.cjs','stdio.cjs','network.cjs','vision-body.cjs','upstream.json','tool-schema.cjs','result-cache.cjs'])fs.copyFileSync(path.join(adapter,name),path.join(out,name));
  const sha=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  const patches=['dist/main/main.js','dist/preload/index.js',...fs.readdirSync(path.join(out,'native/dist/renderer/js')).filter(n=>n.endsWith('.js')).map(n=>'dist/renderer/js/'+n)].map(file=>({file,sha256:sha(path.join(out,'native',file))}));
  fs.writeFileSync(path.join(out,'provenance.json'),JSON.stringify({upstream:pin.repository,sourceCommit:pin.commit,build:'pinned-source',adapterVersion:pin.adapterVersion,lockSha256:sha(path.join(adapter,'pnpm-lock.yaml')),sourceChanges:changed,patches,network:'Unmodified upstream provider SDK headers forwarded through Node fetch'},null,2));
}
