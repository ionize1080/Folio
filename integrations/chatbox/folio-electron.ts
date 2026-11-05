// Source-level host boundary. Upstream services never mutate Folio's app paths,
// window lifecycle or IPC namespace. Every request is scoped to the chat view.
import * as electron from 'electron'
const host = (globalThis as any).__folioChatboxHost
export const app = new Proxy(electron.app, {get(target, key) {
  if (key === 'getPath') return (name: string) => name === 'userData' ? host.profile : target.getPath(name as any)
  if (key === 'getVersion') return () => host.version
  const value = (target as any)[key]
  return typeof value === 'function' ? value.bind(target) : value
}})
export const ipcMain = {handle(name: string, fn: Function) {
  electron.ipcMain.handle('chatbox:' + name, (event, ...args) => {
    host.check(event)
    return fn(event, ...args)
  })
}}
export const {powerMonitor, nativeTheme, shell, BrowserWindow, session} = electron
