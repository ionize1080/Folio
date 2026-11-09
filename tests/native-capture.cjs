const fs = require('node:fs');
// CDP screenshots can stall on hidden Windows windows after fonts are ready.
// Ask Electron to render the hidden window without foregrounding the desktop.
module.exports = async function capture(app, page, file) {
  await page.evaluate(() => document.fonts.ready.then(() => true));
  // A hidden WebContents may still hold the previous compositor frame. Wake it,
  // then capture after the next paint so screenshots match the DOM assertions.
  await app.evaluate(async({BrowserWindow})=>{await BrowserWindow.getAllWindows()[0].webContents.capturePage(undefined,{stayHidden:true,stayAwake:true});});
  await page.waitForTimeout(150);
  const png = await app.evaluate(async ({BrowserWindow}) => {
    const image = await BrowserWindow.getAllWindows()[0].webContents.capturePage(undefined, {stayHidden:true, stayAwake:true});
    if (image.isEmpty()) throw Error('Empty native UI screenshot');
    return image.toPNG().toString('base64');
  });
  fs.writeFileSync(file, Buffer.from(png, 'base64'));
};
