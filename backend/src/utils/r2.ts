/**
 * 图床上传工具 — 仅在 R2_ENABLED=true 时激活
 *
 * 用途：本地开发模式下，将生成的图片/视频上传到自建图床，
 * 使 AI API（ComfyUI、Seedance 等）能通过公网 URL 拉取参考文件。
 *
 * Docker 部署不设置 R2_ENABLED，完全不受影响。
 */
import fs from 'fs'
import path from 'path'
import { getAbsolutePath } from './storage.js'
import { getImageHostEnabled } from '../services/app-settings.js'

/**
 * 是否启用图床上传（三态优先级）：
 * 设置页运行时开关（app_settings.image_host_enabled）> 环境变量 R2_ENABLED > 关
 * 运行时切换无需重启；未在设置页操作过时保持 .env 配置的既有行为。
 */
export function isR2Enabled(): boolean {
  return getImageHostEnabled()
}

/**
 * 上传本地文件到图床，返回公网 URL。
 */
export async function uploadToR2(localPath: string): Promise<string> {
  const apiUrl = process.env.IMAGE_HOST_API!
  const token = process.env.IMAGE_HOST_TOKEN!
  const filePath = getAbsolutePath(localPath)

  const formData = new FormData()
  const fileBuffer = fs.readFileSync(filePath)
  const fileName = path.basename(filePath)
  // EasyImages API 要求文件字段名为 image（非 file）
  formData.append('image', new File([fileBuffer], fileName))
  formData.append('token', token)

  const resp = await fetch(apiUrl, {
    method: 'POST',
    body: formData,
  })

  if (!resp.ok) {
    throw new Error(`图床上传失败: HTTP ${resp.status} ${await resp.text()}`)
  }

  const result = await resp.json() as any

  if (result?.result !== 'success') {
    throw new Error(`图床上传失败: ${result?.message || JSON.stringify(result)}`)
  }

  const url = result?.url
  if (!url) {
    throw new Error(`图床返回异常: ${JSON.stringify(result)}`)
  }

  return url
}
