/**
 * MiniMax 图片生成 Adapter
 * 端点: POST https://api.minimax.chat/v1/image_generation
 * 鉴权: Authorization: Bearer <api_key>
 * 请求体: { model: "image-01", prompt, aspect_ratio, response_format, n, ... }
 * 响应: { base_resp: { status_code, status_msg }, data: { image_base64 | image_urls } }
 * 同步返回（无 task_id 轮询）
 */
import type {
  ImageProviderAdapter,
  ProviderRequest,
  AIConfig,
  ImageGenerationRecord,
  ImageGenResponse,
  ImagePollResponse,
} from './types'
import { joinProviderUrl } from './url'

const DEFAULT_MODEL = 'image-01'

/** MiniMax 支持的宽高比（与 minimax-video 保持一致的取值集合） */
const VALID_RATIOS = new Set(['1:1', '16:9', '9:16', '4:3', '3:4', '21:9'])

function parseAspectRatio(size?: string | null): string {
  if (!size) return '1:1'
  const [w, h] = size.split('x').map(Number)
  if (!w || !h) return '1:1'
  const gcd = (a: number, b: number) => (b === 0 ? a : gcd(b, a % b))
  return `${w / gcd(w, h)}:${h / gcd(w, h)}`
}

export class MiniMaxImageAdapter implements ImageProviderAdapter {
  provider = 'minimax'

  buildGenerateRequest(config: AIConfig, record: ImageGenerationRecord): ProviderRequest {
    const model = record.model || config.model || DEFAULT_MODEL
    const body: any = {
      model,
      prompt: record.prompt,
      aspect_ratio: parseAspectRatio(record.size),
      n: 1,
      response_format: 'base64',
    }

    return {
      url: joinProviderUrl(config.baseUrl, '/v1', '/image_generation'),
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': this.normalizeAuth(config.apiKey),
      },
      body,
    }
  }

  parseGenerateResponse(result: any): ImageGenResponse {
    const baseResp = result?.base_resp
    if (baseResp && baseResp.status_code !== 0) {
      throw new Error(baseResp.status_msg || `MiniMax image generation failed (code=${baseResp.status_code})`)
    }

    // 优先取 URL，没有再取 base64
    const imageUrl = this.extractImageUrl(result)
    if (imageUrl) return { isAsync: false, imageUrl }

    if (this.extractImageBase64(result)) {
      // base64 模式：留 imageUrl undefined，由 generation.ts 走 extractImageBase64 分支落盘
      return { isAsync: false }
    }

    throw new Error('MiniMax image response contains no image data')
  }

  buildPollRequest(_config: AIConfig, _taskId: string): ProviderRequest {
    // MiniMax image_generation 是同步接口，不会进入轮询；保留空实现以满足接口
    return { url: '', method: 'GET', headers: {}, body: undefined }
  }

  parsePollResponse(_result: any): ImagePollResponse {
    return { status: 'completed' }
  }

  extractImageUrl(result: any): string | null {
    // MiniMax 同步接口默认返 base64；若用户配 response_format=url，则从 image_urls 数组取
    const urls = result?.data?.image_urls
    if (Array.isArray(urls) && urls.length) return urls[0]
    if (typeof result?.data?.image_url === 'string') return result.data.image_url
    return null
  }

  extractImageBase64(result: any): { data: string; mimeType: string } | null {
    const arr = result?.data?.image_base64
    if (Array.isArray(arr) && arr.length) {
      return { data: arr[0], mimeType: 'image/png' }
    }
    if (typeof result?.data?.image_base64 === 'string') {
      return { data: result.data.image_base64, mimeType: 'image/png' }
    }
    return null
  }

  private normalizeAuth(apiKey: string): string {
    if (!apiKey) return ''
    return /^bearer\s+/i.test(apiKey) ? apiKey : `Bearer ${apiKey}`
  }
}
