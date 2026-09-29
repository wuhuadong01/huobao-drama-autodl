/**
 * 应用设置路由 — 全局配置的读写入口（当前：AI 内容语言）
 */
import { Hono } from 'hono'
import { getContentLanguage, setContentLanguage, getToursSeen, setToursSeen, getImageHostEnabled, setImageHostEnabled, CONTENT_LANGUAGES, type ContentLanguage } from '../services/app-settings.js'
import { success, badRequest } from '../utils/response.js'

const app = new Hono()

// GET /content-language — 当前 AI 内容语言
app.get('/content-language', async (c) => {
  return success(c, { language: await getContentLanguage() })
})

// PUT /content-language — 设置 AI 内容语言（body: { language: 'zh'|'en'|'ja'|'ko' }）
app.put('/content-language', async (c) => {
  const body = await c.req.json().catch(() => null)
  const language = body?.language
  if (!(CONTENT_LANGUAGES as readonly string[]).includes(language)) {
    return badRequest(c, `language 必须是 ${CONTENT_LANGUAGES.join(' / ')} 之一`)
  }
  const saved = await setContentLanguage(language as ContentLanguage)
  return success(c, { language: saved })
})

// GET /tours-seen — 已看过的引导漫游 id 列表
app.get('/tours-seen', async (c) => {
  return success(c, { seen: await getToursSeen() })
})

// PUT /tours-seen — 写入已看过的引导漫游 id 列表（body: { seen: string[] }）
app.put('/tours-seen', async (c) => {
  const body = await c.req.json().catch(() => null)
  if (!Array.isArray(body?.seen) || !body.seen.every((v: unknown) => typeof v === 'string')) {
    return badRequest(c, 'seen 必须是字符串数组')
  }
  return success(c, { seen: await setToursSeen(body.seen) })
})

// GET /image-host-enabled — 图床上传开关（生成视频时参考图走图床换公网 URL）
app.get('/image-host-enabled', async (c) => {
  return success(c, { enabled: getImageHostEnabled() })
})

// PUT /image-host-enabled — 切换图床上传开关（body: { enabled: boolean }），运行时生效无需重启
app.put('/image-host-enabled', async (c) => {
  const body = await c.req.json().catch(() => null)
  if (typeof body?.enabled !== 'boolean') return badRequest(c, 'enabled 必须为布尔值')
  const saved = setImageHostEnabled(body.enabled)
  return success(c, { enabled: saved })
})

export default app
