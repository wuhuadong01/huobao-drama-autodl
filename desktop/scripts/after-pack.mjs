/**
 * electron-builder afterPack 钩子 — 修 Windows 包的 better-sqlite3 原生模块。
 *
 * 背景：dist:win 在 mac 上交叉打包，@electron/rebuild/prebuild-install 按宿主机
 * 平台下载预编译产物，导致 win 包里的 build/Release/better_sqlite3.node 实为
 * Mach-O（mac 二进制），Windows 上 dlopen 失败 → 后端 exit code 1。
 *
 * 修复：打包后（win-unpacked 生成、NSIS 封装前）用官方 win32-x64 预编译 .node
 * 覆盖。预编译文件缓存于 build/win-bin/better_sqlite3.node（同 ffmpeg.exe 的
 * 缓存方式；better-sqlite3 或 Electron 主版本升级时需重新下载对应 ABI：
 * https://github.com/WiseLibs/better-sqlite3/releases）
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const WIN_BIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'build', 'win-bin', 'better_sqlite3.node')

export default async function afterPack(context) {
  // electron-builder 对缺失的 extraResources 只警告不报错（曾导致整包没打进 ffmpeg），
  // 这里硬性校验：任何平台都必须有本平台的 ffmpeg/ffprobe
  const resourcesDir = context.electronPlatformName === 'darwin'
    ? path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents', 'Resources')
    : path.join(context.appOutDir, 'resources')
  const exe = context.electronPlatformName === 'win32' ? '.exe' : ''
  for (const name of [`ffmpeg${exe}`, `ffprobe${exe}`]) {
    const p = path.join(resourcesDir, 'bin', name)
    if (!fs.existsSync(p)) throw new Error(`打包产物缺少 bin/${name}（检查 prepare-resources 与 \${os} 目录命名）`)
  }

  if (context.electronPlatformName !== 'win32') return
  if (!fs.existsSync(WIN_BIN)) {
    throw new Error(
      `缺少 win32 better-sqlite3 预编译: ${WIN_BIN}\n` +
      '下载 https://github.com/WiseLibs/better-sqlite3/releases/download/v12.11.1/' +
      'better-sqlite3-v12.11.1-electron-v136-win32-x64.tar.gz 解出 build/Release/better_sqlite3.node 放入该路径',
    )
  }
  const target = path.join(
    context.appOutDir, 'resources', 'app.asar.unpacked', 'node_modules',
    'better-sqlite3', 'build', 'Release', 'better_sqlite3.node',
  )
  if (!fs.existsSync(target)) throw new Error(`未找到待替换的 better_sqlite3.node: ${target}`)
  fs.copyFileSync(WIN_BIN, target)
  // 顺手清掉宿主机平台预编译残留（bindings 不会命中，但白占体积）
  fs.rmSync(path.join(path.dirname(path.dirname(path.dirname(target))), 'bin'), { recursive: true, force: true })
  console.log(`[after-pack] win32 better_sqlite3.node 已替换为 PE 二进制 (${(fs.statSync(target).size / 1024 / 1024).toFixed(1)}MB)`)

  // sharp 同理：宿主机装的是 linux/darwin 的 @img/sharp-*，win 包必须换入官方
  // win32-x64 预编译（含 libvips DLL）。缓存于 build/win-bin/sharp-win32-x64/。
  const SHARP_STAGE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'build', 'win-bin', 'sharp-win32-x64')
  if (!fs.existsSync(path.join(SHARP_STAGE, 'package.json'))) {
    throw new Error(
      `缺少 win32 sharp 预编译: ${SHARP_STAGE}\n` +
      '下载 https://registry.npmjs.org/@img/sharp-win32-x64/-/sharp-win32-x64-0.34.5.tgz ' +
      '解出 package/ 目录内容放入该路径',
    )
  }
  const imgDir = path.join(context.appOutDir, 'resources', 'app.asar.unpacked', 'node_modules', '@img')
  if (!fs.existsSync(imgDir)) throw new Error(`未找到待替换的 @img 目录: ${imgDir}`)
  // 清掉宿主机平台的 sharp 预编译（@img/colour 是纯 JS，保留）
  for (const entry of fs.readdirSync(imgDir)) {
    if (entry.startsWith('sharp-')) fs.rmSync(path.join(imgDir, entry), { recursive: true, force: true })
  }
  fs.cpSync(SHARP_STAGE, path.join(imgDir, 'sharp-win32-x64'), { recursive: true })
  console.log('[after-pack] win32 @img/sharp-win32-x64 已换入（含 libvips DLL），宿主机 sharp 预编译已清除')
}
