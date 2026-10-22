import { readFile, writeFile } from "node:fs/promises";

const path = process.argv[2];
if (!path) throw new Error("Usage: node tools/lock-landscape.mjs <AndroidManifest.xml>");
const source = await readFile(path, "utf8");
if (!/<activity\b/.test(source)) throw new Error("No <activity> element found; manifest left unchanged.");
let changed = false;
const result = source.replace(/<activity\b([^>]*?)(\s*\/?>)/s, (_match, attrs, close) => {
  changed = true;
  const nextAttrs = /\bandroid:screenOrientation\s*=/.test(attrs)
    ? attrs.replace(/android:screenOrientation="[^"]*"/, "android:screenOrientation=\"sensorLandscape\"")
    : `${attrs} android:screenOrientation="sensorLandscape"`;
  return `<activity${nextAttrs}${close}`;
});
if (!changed || result === source) throw new Error("Could not safely set landscape orientation; manifest left unchanged.");
await writeFile(path, result, "utf8");
console.log("Android orientation set to sensorLandscape.");
