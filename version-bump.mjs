import { readFileSync, writeFileSync } from "fs";

const targetVersion = process.argv[2];
const minAppVersion = process.argv[3];

// 读取 manifest.json
const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));

// 更新版本
const { version } = manifest;
manifest.version = targetVersion || version;
if (minAppVersion) {
  manifest.minAppVersion = minAppVersion;
}

// 写入 manifest.json
writeFileSync("manifest.json", JSON.stringify(manifest, null, 2));

// 处理 versions.json
let versions = {};
try {
  versions = JSON.parse(readFileSync("versions.json", "utf8"));
} catch (e) {
  console.log("创建 versions.json");
}

versions[targetVersion || version] = manifest.minAppVersion;

writeFileSync("versions.json", JSON.stringify(versions, null, 2));
