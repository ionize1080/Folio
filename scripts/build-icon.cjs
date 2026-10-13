// The SVG is the only brand source. Export raster Windows assets from it.
const { chromium } = require("playwright");
const path = require("path");
const { pathToFileURL } = require("url");
require("fs").copyFileSync("assets/icon.svg", "src/brand.svg");
(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.FOLIO_CHROMIUM,
    headless: true,
  });
  try {
    const page = await browser.newPage({
      viewport: { width: 256, height: 256 },
      deviceScaleFactor: 4,
    });
    await page.goto(pathToFileURL(path.resolve("assets/icon.svg")).href);
    await page.screenshot({
      path: "assets/icon-master.png",
      omitBackground: true,
    });
    require("child_process").execFileSync(
      process.env.FOLIO_PYTHON || "python",
      [
        "-c",
        "from PIL import Image; im=Image.open('assets/icon-master.png'); im.resize((256,256),Image.Resampling.LANCZOS).save('assets/icon.png'); im.save('assets/icon.ico',sizes=[(n,n) for n in [16,20,24,32,40,48,64,128,256]])",
      ],
      { stdio: "inherit" },
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
