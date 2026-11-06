import { getModel } from '@shared/providers'
import './folio-conversion-review'
import { createModelDependencies } from './adapters'
import platform from './platform'
import { settingsStore } from './stores/settingsStore'

// The user chooses the image provider in Chatbox Image Creator. A chat model
// cannot choose an endpoint or obtain credentials through this bridge.
window.folioGenerateImage = async ({prompt, reference}) => {
  const choice = JSON.parse(localStorage.getItem('folio-image-model') || 'null')
  if (!choice) throw Error('请先在 Chatbox 的图像创作中选择已配置的出图模型。')
  const settings = settingsStore.getState().getSettings()
  const model = getModel(choice, settings, await platform.getConfig(), await createModelDependencies())
  const result = await model.paint({prompt, num:1, images:reference ? [{imageUrl:reference}] : []}, AbortSignal.timeout(230000))
  const first = result?.[0]
  if (typeof first !== 'string') throw Error('Image provider returned no pixels')
  if (first.startsWith('data:image/')) return first
  if (!/^[A-Za-z0-9+/]+=*$/.test(first)) throw Error('Image provider must return embedded image data')
  const mime = first.startsWith('iVBOR') ? 'png' : first.startsWith('/9j/') ? 'jpeg' : first.startsWith('UklGR') ? 'webp' : ''
  if (!mime) throw Error('Unsupported generated image format')
  return 'data:image/'+mime+';base64,'+first
}
