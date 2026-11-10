import { Alert, Button, Checkbox, Group, Image, PasswordInput, Select, Stack, Text, Textarea, TextInput, Title } from '@mantine/core'
import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { router } from '@/router'

export const Route = createFileRoute('/settings/image-provider')({ component: ImageProviderSettings })

const presets: Record<string, { endpoint: string; model: string; referenceMode: string }> = {
  'token-plan': { endpoint: 'https://token-plan.maas.qianwenaiapi.com/api/v1/services/aigc/multimodal-generation/generation', model: 'qwen-image-3.0-pro', referenceMode: 'json' },
  dashscope: { endpoint: 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation', model: 'qwen-image-3.0-pro', referenceMode: 'json' },
  openai: { endpoint: 'https://api.openai.com/v1/images/generations', model: 'gpt-image-1.5', referenceMode: 'multipart' },
}

export function ImageProviderSettings() {
  const { i18n } = useTranslation()
  const tr = (zh: string, en: string, hant?: string) => i18n.language.startsWith('zh') ? (i18n.language === 'zh-Hant' ? hant || zh : zh) : en
  const api = (window as any).folioImages
  const [config, setConfig] = useState<any>(null)
  const [apiKey, setApiKey] = useState('')
  const [clearKey, setClearKey] = useState(false)
  const [extra, setExtra] = useState('{}')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [preview, setPreview] = useState<any>(null)
  const [dirty, setDirty] = useState(false)
  const load = (value: any) => { setConfig(value); setExtra(JSON.stringify(value.extra || {}, null, 2)); setApiKey(''); setClearKey(false); setDirty(false) }
  useEffect(() => { api.config().then(load).catch((e: Error) => setError(e.message)) }, [])
  const change = (key: string, value: any) => { setConfig((c: any) => ({ ...c, [key]: value })); setDirty(true); setStatus(''); setPreview(null) }
  const save = async (test: boolean) => {
    setBusy(true); setError(''); setStatus(''); setPreview(null)
    try {
      const saved = await api.save({ protocol: config.protocol, endpoint: config.endpoint.trim(), model: config.model.trim(), keyFile: config.keyFile.trim(), referenceMode: config.referenceMode, extra: JSON.parse(extra || '{}'), apiKey, clearKey })
      load(saved)
      if (test) {
        setStatus(tr('正在生成测试图片…', 'Generating a test image…', '正在生成測試圖片…'))
        const result = await api.test()
        setPreview(result)
        setStatus(tr('已连接，测试图片已生成。', 'Connected. The test image is ready.', '已連線，測試圖片已生成。'))
      } else setStatus(tr('配置已保存。', 'Settings saved.', '設定已儲存。'))
      return true
    } catch (e: any) { setStatus(''); setError(e.message); return false }
    finally { setBusy(false) }
  }
  return <Stack p="md" gap="lg" maw={720} mx="auto" data-folio-image-settings>
    <Stack gap={6}>
      <Title order={5}>{tr('生图模型提供方', 'Image Model Provider', '生圖模型提供方')}</Title>
      <Text size="sm" c="dimmed">{tr('为 PDF 图片生成和参考图编辑选择独立服务。聊天模型和图像工作室共用此配置。', 'Choose a service for PDF image generation and reference-image editing. Chat tools and the image studio use these settings.', '為 PDF 圖片生成和參考圖編輯選擇獨立服務。聊天模型和圖像工作室共用此設定。')}</Text>
    </Stack>
    {config && <>
      <Select data-image-protocol label={tr('提供方 / 接口协议', 'Provider / API protocol', '提供方 / 介面協定')} value={config.protocol} allowDeselect={false} disabled={busy}
        data={[{ value: 'token-plan', label: 'Qwen · Token Plan' }, { value: 'dashscope', label: 'Qwen / Wan · DashScope' }, { value: 'openai', label: tr('OpenAI 或兼容服务', 'OpenAI or compatible service', 'OpenAI 或相容服務') }, { value: 'chatbox', label: tr('Chatbox 图像创作中的模型', 'A model from Chatbox Image Creator', 'Chatbox 圖像創作中的模型') }]}
        onChange={protocol => { if (!protocol) return; setConfig((c: any) => ({ ...c, ...presets[protocol], protocol, keyFile: '', hasKey: false })); setApiKey(''); setClearKey(true); setDirty(true); setStatus(''); setPreview(null) }} />
      {config.protocol === 'chatbox' ? <Stack gap="xs">
        <Text size="sm">{tr('在图像创作中选择已配置的图片模型，Folio 将使用相同服务。', 'Select a configured image model in Image Creator. Folio will use the same service.', '在圖像創作中選擇已設定的圖片模型，Folio 將使用相同服務。')}</Text>
        <Button variant="light" disabled={busy} onClick={async () => { if (!dirty || await save(false)) router.navigate({to:'/image-creator/'}) }}>{tr('打开图像创作', 'Open Image Creator', '開啟圖像創作')}</Button>
      </Stack> : <>
        <TextInput data-image-endpoint label={tr('接口地址', 'API endpoint', '介面位址')} value={config.endpoint} disabled={busy} onChange={e => change('endpoint', e.currentTarget.value)} placeholder="https://your-provider.example/v1/images/generations" spellCheck={false} styles={{ input: { fontVariantNumeric: 'tabular-nums' } }} />
        <TextInput data-image-model label={tr('模型名称', 'Model ID', '模型名稱')} value={config.model} disabled={busy} onChange={e => change('model', e.currentTarget.value)} placeholder="qwen-image-3.0-pro" spellCheck={false} />
        <PasswordInput data-image-key label="API Key" value={apiKey} disabled={busy} autoComplete="new-password" placeholder={config.hasKey && !clearKey ? tr('已配置；留空保留', 'Configured; leave blank to keep', '已設定；留空保留') : tr('输入服务提供方的密钥', 'Enter the provider API key', '輸入服務提供方的金鑰')} onChange={e => { setApiKey(e.currentTarget.value); setDirty(true) }} />
        <Stack gap="xs">
          <TextInput data-image-key-file label={tr('或从密钥文件读取', 'Or read from a key file', '或從金鑰檔案讀取')} value={config.keyFile} disabled={busy} onChange={e => change('keyFile', e.currentTarget.value)} placeholder={tr('仅含 API Key 的文本文件', 'A text file containing only the API key', '僅含 API Key 的文字檔案')} />
          <Group justify="space-between" gap="sm">
            <Button data-image-pick variant="default" size="xs" disabled={busy} onClick={async () => { try { const file = await api.pickKeyFile(); if (file) { change('keyFile', file); setApiKey('') } } catch (e: any) { setError(e.message) } }}>{tr('选择文件…', 'Choose file…', '選擇檔案…')}</Button>
            <Checkbox data-image-clear checked={clearKey} disabled={busy} onChange={e => { setClearKey(e.currentTarget.checked); setDirty(true) }} label={tr('清除已保存密钥', 'Clear saved key', '清除已儲存金鑰')} />
          </Group>
        </Stack>
        {config.protocol === 'openai' && <Select data-image-reference label={tr('参考图接口', 'Reference-image API', '參考圖介面')} value={config.referenceMode} allowDeselect={false} disabled={busy} onChange={v => change('referenceMode', v)} data={[
          { value: 'multipart', label: 'OpenAI · /images/edits (multipart)' },
          { value: 'json', label: 'Qwen / compatible · /images/generations (JSON)' },
          { value: 'none', label: tr('仅文生图', 'Text to image only', '僅文生圖') },
        ]} />}
        <details style={{ minWidth: 0 }}><summary style={{ cursor: 'pointer', fontSize: 14, paddingBlock: 8 }}>{tr('高级参数', 'Advanced parameters', '進階參數')}</summary>
          <Textarea data-image-extra label={tr('附加参数（JSON）', 'Additional parameters (JSON)', '附加參數（JSON）')} value={extra} autosize minRows={3} maxRows={8} disabled={busy} spellCheck={false} w="100%" styles={{ input: { width: '100%', maxWidth: '100%', minWidth: 0, boxSizing: 'border-box' } }} onChange={e => { setExtra(e.currentTarget.value); setDirty(true) }} />
        </details>
        <Text size="xs" c="dimmed">{tr('密钥由系统加密保存或调用时从文件读取，不会提供给聊天模型。测试会生成一张图片并使用服务额度。', 'Keys are encrypted by the system or read from the file when needed. They are never shared with the chat model. Testing generates one image and uses provider credits.', '金鑰由系統加密儲存或呼叫時從檔案讀取，不會提供給聊天模型。測試會生成一張圖片並使用服務額度。')}</Text>
      </>}
      <Group gap="sm" wrap="wrap">
        <Button data-image-save onClick={() => save(false)} loading={busy} disabled={!dirty}>{tr('保存配置', 'Save settings', '儲存設定')}</Button>
        {config.protocol !== 'chatbox' && <Button data-image-test variant="default" onClick={() => save(true)} disabled={busy}>{tr('保存并测试生图', 'Save and test image generation', '儲存並測試生圖')}</Button>}
      </Group>
      {status && <Text size="sm" role="status" data-image-status>{status}</Text>}
      {preview && <Stack gap="xs"><Image data-image-preview src={preview.image} alt={tr('生成测试：白色背景上的蓝色圆形', 'Generation test: a blue circle on white', '生成測試：白色背景上的藍色圓形')} radius="md" maw={280} fit="contain" /><Text size="xs" c="dimmed">{preview.model} · {(preview.elapsedMs / 1000).toFixed(1)} s</Text></Stack>}
    </>}
    {error && <Alert color="red" role="alert" style={{ overflowWrap: 'anywhere' }}>{error}</Alert>}
  </Stack>
}
