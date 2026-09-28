/**
 * 迁移脚本：将 storyboards.reference_audios (JSON) 迁移到 audios 表 + storyboard_audios 关联表
 *
 * 用法：cd backend && npx tsx scripts/migrate-audio-assets.ts [--force]
 */
import Database from 'better-sqlite3'
import { join } from 'path'

const SQLITE_PATH = process.env.SQLITE_PATH || join(__dirname, '../../data/huobao.sqlite3')
const force = process.argv.includes('--force')

const db = new Database(SQLITE_PATH)

// 确保新表存在
db.exec(`
  CREATE TABLE IF NOT EXISTS audios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    drama_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    type TEXT,
    description TEXT,
    final_prompt TEXT,
    audio_url TEXT,
    local_path TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
  );
  CREATE TABLE IF NOT EXISTS episode_audios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    episode_id INTEGER NOT NULL,
    audio_id INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS storyboard_audios (
    storyboard_id INTEGER NOT NULL,
    audio_id INTEGER NOT NULL,
    PRIMARY KEY (storyboard_id, audio_id)
  );
`)

// 检查是否已迁移
const alreadyMigrated = db.prepare(`
  SELECT COUNT(*) as count FROM storyboard_audios
`).get() as { count: number }

if (alreadyMigrated.count > 0 && !force) {
  console.log('⚠️  storyboard_audios 已有数据，跳过迁移（使用 --force 强制重新迁移）')
  db.close()
  process.exit(0)
}

// 获取所有分镜的 reference_audios
const storyboards = db.prepare(`
  SELECT id, episode_id, reference_audios FROM storyboards WHERE reference_audios IS NOT NULL AND reference_audios != ''
`).all() as Array<{ id: number; episode_id: number; reference_audios: string }>

console.log(`找到 ${storyboards.length} 个分镜有参考音频数据`)

const insertAudio = db.prepare(`
  INSERT INTO audios (drama_id, name, type, description, audio_url, local_path, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`)
const insertEpisodeAudio = db.prepare(`
  INSERT OR IGNORE INTO episode_audios (episode_id, audio_id, created_at) VALUES (?, ?, ?)
`)
const insertStoryboardAudio = db.prepare(`
  INSERT OR IGNORE INTO storyboard_audios (storyboard_id, audio_id) VALUES (?, ?)
`)
const getDramaId = db.prepare(`SELECT drama_id FROM episodes WHERE id = ?`)

let totalAudios = 0
let totalLinks = 0

for (const sb of storyboards) {
  let audios: Array<{ id: string; name: string; url: string; bound: boolean }> = []
  try {
    const parsed = JSON.parse(sb.reference_audios)
    if (Array.isArray(parsed)) audios = parsed
  } catch {
    continue
  }

  for (const audio of audios) {
    if (!audio.url) continue

    // 查找或创建音频资产
    const existing = db.prepare(`SELECT id FROM audios WHERE audio_url = ? AND deleted_at IS NULL`).get(audio.url) as { id: number } | undefined

    let audioId: number
    if (existing) {
      audioId = existing.id
    } else {
      // 获取 drama_id
      const ep = getDramaId.get(sb.episode_id) as { drama_id: number } | undefined
      const dramaId = ep?.drama_id || 0

      const ts = new Date().toISOString()
      const name = audio.name || audio.url.split('/').pop()?.replace(/\.[^.]+$/, '') || '音频'
      const result = insertAudio.run(dramaId, name, 'audio', '', audio.url, audio.url, ts, ts)
      audioId = Number(result.lastInsertRowid)
      totalAudios++
    }

    // 建立分镜关联
    insertStoryboardAudio.run(sb.id, audioId)
    totalLinks++

    // 建立集关联
    insertEpisodeAudio.run(sb.episode_id, audioId, new Date().toISOString())
  }
}

console.log(`✅ 迁移完成：新建 ${totalAudios} 个音频资产，建立 ${totalLinks} 个分镜关联`)
db.close()
