// This is the only replaced upstream entry point; all store, file, KB and MCP
// implementations below are compiled directly from the pinned Chatbox source.
import { app, ipcMain, nativeTheme, shell } from './folio-electron'
import os from 'node:os'
import {store, getSettings, getConfig, getStoreBlob, setStoreBlob, delStoreBlob, listStoreBlobKeys} from './store-node'
import {parseFile} from './file-parser'
import {closeAllTransports} from './mcp/ipc-stdio-transport'
import {getInitPromise} from './knowledge-base/index'
const host = (globalThis as any).__folioChatboxHost
store.set('settings', host.migrateSettings(getSettings()))
ipcMain.handle('getSettings', () => host.settings(getSettings()))
ipcMain.handle('getStoreValue', (_: any, key: string) => key === 'settings' ? host.settings(getSettings()) : store.get(key))
ipcMain.handle('setStoreValue', (_: any, key: string, json: string) => store.set(key, JSON.parse(json)))
ipcMain.handle('delStoreValue', (_: any, key: string) => store.delete(key))
ipcMain.handle('getAllStoreValues', () => JSON.stringify(store.store))
ipcMain.handle('setAllStoreValues', (_: any, json: string) => {store.store = {...store.store, ...JSON.parse(json)}})
ipcMain.handle('getStoreBlob', (_: any, key: string) => getStoreBlob(key))
ipcMain.handle('setStoreBlob', (_: any, key: string, value: string) => setStoreBlob(key, value))
ipcMain.handle('delStoreBlob', (_: any, key: string) => delStoreBlob(key))
ipcMain.handle('listStoreBlobKeys', () => listStoreBlobKeys())
ipcMain.handle('getConfig', () => getConfig())
ipcMain.handle('getVersion', () => host.version)
ipcMain.handle('getPlatform', () => process.platform)
ipcMain.handle('getArch', () => process.arch)
ipcMain.handle('getHostname', () => os.hostname())
ipcMain.handle('getDeviceName', () => os.hostname())
ipcMain.handle('getLocale', () => app.getLocale())
ipcMain.handle('shouldUseDarkColors', () => nativeTheme.shouldUseDarkColors)
ipcMain.handle('openLink', (_: any, link: string) => {
  if (!/^https?:\/\//i.test(link)) throw Error('Unsupported link')
  return shell.openExternal(link)
})
ipcMain.handle('ensureProxy', (_: any, json: string) => host.view.webContents.session.setProxy({proxyRules:JSON.parse(json).proxy || ''}))
ipcMain.handle('parseFileLocally', async (_: any, json: string) => {
  try {return JSON.stringify({text:await parseFile(JSON.parse(json).filePath), isSupported:true})}
  catch {return JSON.stringify({isSupported:false})}
})
ipcMain.handle('parseUrl', () => JSON.stringify({key:'',title:''}))
ipcMain.handle('shouldShowAboutDialogWhenStartUp', () => false)
for (const name of ['ensureShortcutConfig','ensureAutoLaunch','analysticTrackingEvent','appLog','clearLogs','switch-theme']) ipcMain.handle(name, () => {})
ipcMain.handle('exportLogs', () => '')
ipcMain.handle('install-update', () => {throw Error('请通过 Folio 升级 Chatbox')})
ipcMain.handle('relaunch', () => host.view.webContents.reload())
ipcMain.handle('isFullscreen', () => host.window().isFullScreen())
ipcMain.handle('setFullscreen', (_: any, value: boolean) => host.window().setFullScreen(value))
ipcMain.handle('window:is-maximized', () => host.window().isMaximized())
for (const [name, method] of [['minimize','minimize'],['maximize','maximize'],['unmaximize','unmaximize']]) ipcMain.handle('window:'+name, () => host.window()[method]())
ipcMain.handle('window:close', () => host.hide())
nativeTheme.on('updated', () => {if (!host.view.webContents.isDestroyed()) host.view.webContents.send('system-theme-updated')})
app.on('before-quit', () => closeAllTransports())
getInitPromise().catch(() => {})
