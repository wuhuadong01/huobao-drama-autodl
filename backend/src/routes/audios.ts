import { Hono } from 'hono'
import { and, eq } from 'drizzle-orm'
import { db, getInsertId, schema } from '../db/index.js'
import { success, created, badRequest, now } from '../utils/response.js'
import { toSnakeCase } from '../utils/transform.js'

const app = new Hono()

// POST /audios — 手动新增音频资产（传入 episode_id 时关联到该集）
app.post('/', async (c) => {
  const body = await c.req.json()
  if (!body.drama_id) return badRequest(c, 'drama_id 必填')
  if (!body.name?.trim()) return badRequest(c, '名称必填')
  const ts = now()
  const res = await db.insert(schema.audios).values({
    name: body.name.trim(),
    type: body.type || '',
    description: body.description || '',
    dramaId: body.drama_id,
    audioUrl: body.audio_url || null,
    localPath: body.local_path || null,
    createdAt: ts,
    updatedAt: ts,
  })
  const audioId = getInsertId(res)
  if (body.episode_id) {
    const existing = await db.select().from(schema.episodeAudios)
      .where(and(eq(schema.episodeAudios.episodeId, Number(body.episode_id)), eq(schema.episodeAudios.audioId, audioId)))
    if (!existing.length) {
      await db.insert(schema.episodeAudios).values({ episodeId: Number(body.episode_id), audioId, createdAt: ts })
    }
  }
  const [row] = await db.select().from(schema.audios).where(eq(schema.audios.id, audioId))
  return created(c, toSnakeCase(row))
})

// DELETE /audios/:id — 软删除
app.delete('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  await db.update(schema.audios).set({ deletedAt: now(), updatedAt: now() }).where(eq(schema.audios.id, id))
  return success(c)
})

// PUT /audios/:id — 更新音频资产
app.put('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const body = await c.req.json()
  const updates: Record<string, any> = { updatedAt: now() }
  if (body.name !== undefined) updates.name = body.name
  if (body.type !== undefined) updates.type = body.type
  if (body.description !== undefined) updates.description = body.description
  if (body.audio_url !== undefined) updates.audioUrl = body.audio_url
  else if (body.audioUrl !== undefined) updates.audioUrl = body.audioUrl
  if (body.local_path !== undefined) updates.localPath = body.local_path
  else if (body.localPath !== undefined) updates.localPath = body.localPath
  if (body.final_prompt !== undefined) updates.finalPrompt = body.final_prompt || null
  else if (body.finalPrompt !== undefined) updates.finalPrompt = body.finalPrompt || null
  await db.update(schema.audios).set(updates).where(eq(schema.audios.id, id))
  return success(c)
})

export default app
