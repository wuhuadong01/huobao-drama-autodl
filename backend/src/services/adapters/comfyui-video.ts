/**
 * AutoDL ComfyUI Workflow API — 视频适配器
 *
 * 端点（AutoDL 统一封装，与具体工作流无关）：
 *   POST {baseUrl}/{workflow_id}        提交任务，立即返回 task_id
 *   GET  {baseUrl}/result/{task_id}     轮询结果
 *
 * 协议：
 *   提交响应: { code: 'Success', data: { task_id, status: 'QUEUED', ... } }
 *   轮询响应: { code: 'Success', data: { status: 'QUEUED|RUNNING|SUCCESS|FAILED',
 *                                      results: [{url}], duration } }
 *
 * 配置约定（每条 ai_service_configs 记录 = 一个 ComfyUI 工作流）：
 *   baseUrl = AutoDL 网关根（不含 workflow_id）
 *   model   = workflow_id（如 minimax_h3_lightx2v_no_pic）
 *   apiKey  = Token
 *
 * 入参 schema 因工作流而异：
 *   已知字段（prompt/duration/aspectRatio/size/seed/参考图）按常见命名映射
 *   未知字段从 record.extraParams JSON 字符串透传 → 用户在前端填额外参数
 */
import type {
  VideoProviderAdapter,
  ProviderRequest,
  AIConfig,
  VideoGenerationRecord,
  VideoGenResponse,
  VideoPollResponse,
} from './types'

export class ComfyUIVideoAdapter implements VideoProviderAdapter {
  provider = 'comfyui'

  buildGenerateRequest(config: AIConfig, record: VideoGenerationRecord): ProviderRequest {
    return {
      url: this.taskUrl(config),
      method: 'POST',
      headers: this.headers(config),
      body: this.buildBody(record),
    }
  }

  parseGenerateResponse(result: any): VideoGenResponse {
    if (result?.code !== 'Success' || !result?.data?.task_id) {
      throw new Error(result?.msg || result?.message || 'ComfyUI 任务提交失败')
    }
    return { isAsync: true, taskId: result.data.task_id }
  }

  buildPollRequest(config: AIConfig, taskId: string): ProviderRequest {
    return {
      url: this.resultUrl(config, taskId),
      method: 'GET',
      headers: this.headers(config),
      body: undefined,
    }
  }

  parsePollResponse(result: any): VideoPollResponse {
    if (result?.code !== 'Success') {
      return { status: 'failed', error: result?.msg || result?.message || '查询失败' }
    }
    const status = result?.data?.status
    if (status === 'SUCCESS') {
      return {
        status: 'completed',
        videoUrl: result?.data?.results?.[0]?.url,
        duration: result?.data?.duration,
      }
    }
    if (status === 'FAILED') {
      const err = result?.data?.error || result?.data?.message || 'ComfyUI 工作流执行失败'
      return { status: 'failed', error: typeof err === 'string' ? err : JSON.stringify(err) }
    }
    // QUEUED / RUNNING 都归 processing（继续轮询）
    return { status: 'processing' }
  }

  extractVideoUrl(result: any): string | null {
    return result?.data?.results?.[0]?.url ?? null
  }

  // ===== 私有方法 =====

  private taskUrl(config: AIConfig): string {
    const base = (config.baseUrl || '').replace(/\/+$/, '')
    const wfId = config.model
    if (!wfId) throw new Error('ComfyUI 适配器要求 model 字段填写 workflow_id')
    return `${base}/${encodeURIComponent(wfId)}`
  }

  private resultUrl(config: AIConfig, taskId: string): string {
    const base = (config.baseUrl || '').replace(/\/+$/, '')
    return `${base}/result/${encodeURIComponent(taskId)}`
  }

  private headers(config: AIConfig): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'Authorization': this.normalizeAuth(config.apiKey),
    }
  }

  /** 自动加 Bearer 前缀（用户填 token 本体即可；已带 Bearer 不会重复加） */
  private normalizeAuth(apiKey: string): string {
    if (!apiKey) return ''
    return /^bearer\s+/i.test(apiKey) ? apiKey : `Bearer ${apiKey}`
  }

  /**
   * 把 record 已知字段映射成 AutoDL ComfyUI 工作流 body
   * 未知字段从 extraParams 透传，让每个工作流可自定义入参
   */
  /**
   * 构造 AutoDL ComfyUI 工作流 body
   *
   * 设计原则：AutoDL 每个工作流字段名都是自定义的（可能是 text/video_length/ratio 等任意命名），
   * adapter 不应该硬编码任何字段名（除了 prompt 作为最通用 fallback），否则会触发
   * "存在未定义的参数"错误。
   *
   * 用法：
   *   1. 用户在前端"高级参数（JSON）"输入框里填工作流要求的字段：
   *        { "text": "...", "video_length": 5, "ratio": "16:9", "image": "..." }
   *   2. extraParams 字段会完全替换默认 body（仅保留 prompt 作为最常见 fallback）
   *   3. 如果用户在 extraParams 里写了 prompt 字段，会覆盖默认 prompt
   */
  private buildBody(record: VideoGenerationRecord): Record<string, any> {
    const body: Record<string, any> = {}

    // 1) 先把用户填的 extraParams 合进去（用户在 UI 里写什么就发什么）
    const extra = (record as any).extraParams
    if (extra) {
      try {
        const obj = typeof extra === 'string' ? JSON.parse(extra) : extra
        if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
          Object.assign(body, obj)
        }
      } catch {
        body.extra = extra
      }
    }

    // 2) 保底：参考图自动从 record.referenceImageUrls 映射到 ref_image_0..5
    //    工作流约定：ref_image_0 必填、ref_image_1..5 选填
    const refImages = this.parseUrlArray(record.referenceImageUrls)
    for (let i = 0; i < 6 && i < refImages.length; i++) {
      const key = `ref_image_${i}`
      if (!(key in body) && refImages[i]) body[key] = refImages[i]
    }

    // 3) 保底：参考音频自动从 record.referenceAudioUrls 映射到 ref_audio_0..2
    //    工作流约定：ref_audio_0 必填、ref_audio_1..2 选填
    const refAudios = this.parseUrlArray(record.referenceAudioUrls)
    for (let i = 0; i < 3 && i < refAudios.length; i++) {
      const key = `ref_audio_${i}`
      if (!(key in body) && refAudios[i]) body[key] = refAudios[i]
    }

    // 4) 保底：参考视频（虽然工作流没列，但保留扩展性）
    const refVideos = this.parseUrlArray(record.referenceVideoUrls)
    for (let i = 0; i < 3 && i < refVideos.length; i++) {
      const key = `ref_video_${i}`
      if (!(key in body) && refVideos[i]) body[key] = refVideos[i]
    }

    // 5) 保底：把 record.duration / aspectRatio / size / seed 等"已知字段"也映射到 body
    //    —— AutoDL 工作流经常用 duration 作为视频秒数（如 minimax_h3_z0903 默认 5 秒），
    //    如果 UI 上填了 12 但 adapter 不发，AutoDL 会默认 5 秒导致用户困惑。
    //
    //    字段命名多样：先发"最常见命名"作为保底；用户如果填了 extraParams 里的同名字段（如 {"duration": 8}），
    //    Object.assign 已经覆盖了 body[key]，下面的 `!(key in body)` 判断会跳过。
    if (record.duration != null && record.duration !== 0) {
      if (!('duration' in body)) body.duration = Number(record.duration)
    }
    // aspect_ratio / size / resolution 三者是同一类（描述输出尺寸），
    // 不同工作流字段名不同：volcengine 用 aspect_ratio='16:9'，AutoDL minimax_h3_zm_u24 用
    // resolution='768p竖'（枚举值）。如果用户已经在 extraParams 里指定了任何一个，
    // 就跳过 record 字段的保底注入——避免产生"未定义参数"。
    const hasSizeField = 'aspect_ratio' in body || 'size' in body || 'resolution' in body || 'ratio' in body
    if (record.aspectRatio && !hasSizeField) {
      body.aspect_ratio = record.aspectRatio
    }
    if (record.size && !hasSizeField) {
      body.size = record.size
      body.resolution = record.size
    }
    if (record.seed != null && record.seed !== 0) {
      if (!('seed' in body)) body.seed = Number(record.seed)
    }
    if (record.firstFrameUrl && !('first_frame' in body)) body.first_frame = record.firstFrameUrl
    if (record.lastFrameUrl && !('last_frame' in body)) body.last_frame = record.lastFrameUrl

    // 6) 保底：如果用户没填任何文本字段，把 record.prompt 作为 prompt 注入
    if (record.prompt != null && String(record.prompt).trim() && !this.hasAnyTextField(body)) {
      body.prompt = record.prompt
    }

    // 7) 不在 adapter 硬编码必填字段：不同 AutoDL 工作流必填项不一样，
    //    强制校验会把"文档说必填但实际可选"的场景卡死。让 AutoDL 自己报缺什么字段的错误，
    //    错误信息（如"缺少必填参数：ref_audio_0"）会透传给前端。

    return body
  }

  /** 检查 body 是否已经有任何"文本提示词"类字段 */
  private hasAnyTextField(body: Record<string, any>): boolean {
    const textKeys = ['text', 'positive_prompt', 'prompt', 'description', 'text_prompt']
    return textKeys.some(k => k in body)
  }

  /** 解析 JSON 字符串为 URL 数组 */
  private parseUrlArray(raw: unknown): string[] {
    if (!raw) return []
    try {
      const arr = typeof raw === 'string' ? JSON.parse(raw) : raw
      return Array.isArray(arr) ? arr.filter((u: unknown) => typeof u === 'string' && u) : []
    } catch {
      return []
    }
  }
}
