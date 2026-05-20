const fs = require("fs");
const path = require("path");
const { Resvg } = require("@resvg/resvg-js");

const ICONS_DIR = path.join(__dirname, "..", "src-tauri", "icons");

function convertSvgToPng(svgFile, pngFile, width) {
  const svgPath = path.join(ICONS_DIR, svgFile);
  const pngPath = path.join(ICONS_DIR, pngFile);

  const svgData = fs.readFileSync(svgPath);
  const resvg = new Resvg(svgData, {
    fitTo: { mode: "width", value: width },
    background: "transparent",
  });

  const pngData = resvg.render();
  fs.writeFileSync(pngPath, pngData.asPng());
  console.log(`✓ ${svgFile} → ${pngFile} (${width}x${width})`);
}

// 应用图标: 1024x1024
convertSvgToPng("icon.svg", "icon.png", 1024);

// 托盘图标: 32x32
convertSvgToPng("tray-icon.svg", "tray-icon.png", 32);

console.log("All icons converted!");
