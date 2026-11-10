const fs = require('node:fs');
// CDP screenshots can stall on hidden Windows windows after fonts are ready.
// Ask Electron to render the hidden window without foregrounding the desktop.
module.exports = async function capture(app, page, file, {url = null} = {}) {
  await page.evaluate(() => document.fonts.ready.then(() => true));
  // The AI panel is a WebContentsView, not the parent BrowserWindow. Resolve its
  // exact URL once so both compositor captures use the same renderer.
  const id = await app.evaluate(({BrowserWindow, webContents}, url) => {
    const targets = url === null
      ? [BrowserWindow.getAllWindows()[0]?.webContents].filter(Boolean)
      : webContents.getAllWebContents().filter(w => !w.isDestroyed() && w.getURL() === url);
    if (targets.length !== 1) throw Error('Native screenshot target must identify one renderer');
    return targets[0].id;
  }, url);
  // A hidden WebContents may still hold the previous compositor frame. Wake it,
  // then capture after the next paint so screenshots match the DOM assertions.
  await app.evaluate(async({webContents}, id)=>{await webContents.fromId(id).capturePage(undefined,{stayHidden:true,stayAwake:true});}, id);
  await page.waitForTimeout(150);
  const png = await app.evaluate(async ({webContents}, id) => {
    const image = await webContents.fromId(id).capturePage(undefined, {stayHidden:true, stayAwake:true});
    if (image.isEmpty()) throw Error('Empty native UI screenshot');
    return image.toPNG().toString('base64');
  }, id);
  fs.writeFileSync(file, Buffer.from(png, 'base64'));
};
