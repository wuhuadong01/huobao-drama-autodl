import { Hono } from 'hono'
import { success, badRequest } from '../utils/response.js'
import { saveUploadedFile, generateImageThumb } from '../utils/storage.js'

const app = new Hono()

// POST /upload/image
app.post('/image', async (c) => {
  const body = await c.req.parseBody()
  const file = body['file']

  if (!file || !(file instanceof File)) {
    return badRequest(c, '文件必填')
  }

  const buffer = await file.arrayBuffer()
  const path = await saveUploadedFile(buffer, 'uploads', file.name)
  // 同步生成列表页缩略图，上传图与生图走同一套展示链路（失败不影响上传结果）
  await generateImageThumb(path)
  return success(c, { url: `/${path}`, path })
})

const VIDEO_EXT = new Set(['.mp4', '.mov', '.webm', '.m4v'])
const VIDEO_MIME = new Set(['video/mp4', 'video/quicktime', 'video/webm', 'video/x-m4v'])
const VIDEO_MAX = 50 * 1024 * 1024 // 50MB

const AUDIO_EXT = new Set(['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac', '.webm'])
const AUDIO_MIME = new Set(['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/wave', 'audio/mp4', 'audio/x-m4a', 'audio/aac', 'audio/aacp', 'audio/ogg', 'audio/vorbis', 'audio/flac', 'audio/x-flac', 'audio/webm'])
const AUDIO_MAX = 20 * 1024 * 1024 // 20MB

function extOf(name: string): string {
  const i = name.lastIndexOf('.')
  return i >= 0 ? name.slice(i).toLowerCase() : ''
}

async function saveMediaUpload(
  c: any,
  kind: 'video' | 'audio',
  allowedExt: Set<string>,
  maxBytes: number,
) {
  const body = await c.req.parseBody()
  const file = body['file']
  if (!file || !(file instanceof File)) {
    return badRequest(c, '文件必填')
  }
  const label = kind === 'video' ? '视频' : '音频'
  const ext = extOf(file.name)
  // 仅按扩展名校验：MIME 可伪造且各浏览器/系统返回不一致（如 .mp3 可能返回 audio/mp3 或 audio/mpeg），
  // 卡 MIME 容易误杀合法文件。扩展名是用户可控的真实文件后缀，足够兜底。
  if (!allowedExt.has(ext)) {
    return badRequest(c, `仅支持 ${Array.from(allowedExt).join('/')} 格式的${label}文件`)
  }
  const buffer = await file.arrayBuffer()
  if (buffer.byteLength > maxBytes) {
    return badRequest(c, `${label}文件大小不能超过 ${Math.round(maxBytes / 1024 / 1024)}MB`)
  }
  const path = await saveUploadedFile(buffer, 'uploads', file.name)
  return success(c, { url: `/${path}`, path })
}

// POST /upload/video — 参考视频上传（Seedance 多模态参考用）
app.post('/video', async (c) => saveMediaUpload(c, 'video', VIDEO_EXT, VIDEO_MAX))

// POST /upload/audio — 参考音频上传（Seedance 多模态参考用）
app.post('/audio', async (c) => saveMediaUpload(c, 'audio', AUDIO_EXT, AUDIO_MAX))

export default app
