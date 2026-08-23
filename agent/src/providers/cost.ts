// ============================================================
// cost.ts —— 模型成本估算表 (USD / 1k tokens)
// 来源：官方定价页面，按需更新
// 中文注释、英文标识符
// ============================================================

export interface ModelPricing {
  prompt: number      // USD per 1k prompt tokens
  completion: number  // USD per 1k completion tokens
}

// 定价表：providerId:modelId -> pricing
export const PRICING_TABLE: Record<string, ModelPricing> = {
  // DeepSeek 官方 (https://api-docs.deepseek.com/pricing)
  'deepseek-official:deepseek-chat':     { prompt: 0.00014, completion: 0.00028 },
  'deepseek-official:deepseek-reasoner': { prompt: 0.00055, completion: 0.00219 },

  // Agnes AI (图像/视频生成，按次计费而非 token，此处仅占位)
  'agnes:agnes-image-2.1-flash': { prompt: 0, completion: 0 },
  'agnes:agnes-video-v2.0':      { prompt: 0, completion: 0 },

  // Ollama 本地模型：免费
  'ollama:llama3.1':       { prompt: 0, completion: 0 },
  'ollama:llama3.2':       { prompt: 0, completion: 0 },
  'ollama:qwen2.5':        { prompt: 0, completion: 0 },
  'ollama:deepseek-r1':    { prompt: 0, completion: 0 },
  'ollama:mistral':        { prompt: 0, completion: 0 },

  // 通用 OpenAI 兼容端点：未知模型按 gpt-4o-mini 近似
  'custom:gpt-4o-mini':    { prompt: 0.00015, completion: 0.00060 },
  'custom:gpt-4o':         { prompt: 0.00250, completion: 0.01000 },
  'custom:gpt-3.5-turbo':  { prompt: 0.00050, completion: 0.00150 },
}

// 默认兜底定价 (gpt-4o-mini 近似)
const DEFAULT_PRICING: ModelPricing = { prompt: 0.00015, completion: 0.00060 }

// 复合键：providerId:modelId
function key(providerId: string, modelId: string): string {
  return `${providerId}:${modelId}`
}

/**
 * 估算单次调用成本 (USD)
 * @param providerId 供应商 id
 * @param modelId 模型 id
 * @param promptTokens 提示词 token 数
 * @param completionTokens 补全 token 数
 * @returns 预估成本 (USD)
 */
export function estimateCost(
  providerId: string,
  modelId: string,
  promptTokens: number,
  completionTokens: number
): number {
  const pricing = PRICING_TABLE[key(providerId, modelId)] ?? DEFAULT_PRICING
  return (promptTokens / 1000) * pricing.prompt + (completionTokens / 1000) * pricing.completion
}

/**
 * 导出 CSV 格式成本统计
 * @param records 成本记录数组
 * @returns CSV 字符串
 */
export interface CostRecord {
  timestamp: number
  providerId: string
  modelId: string
  promptTokens: number
  completionTokens: number
  costUsd: number
}

export function exportCostCsv(records: CostRecord[]): string {
  const header = 'timestamp,providerId,modelId,promptTokens,completionTokens,costUsd'
  const rows = records.map(r =>
    `${r.timestamp},${r.providerId},${r.modelId},${r.promptTokens},${r.completionTokens},${r.costUsd.toFixed(6)}`
  )
  return [header, ...rows].join('\n')
}

/**
 * 获取模型定价信息
 */
export function getPricing(providerId: string, modelId: string): ModelPricing {
  return PRICING_TABLE[key(providerId, modelId)] ?? DEFAULT_PRICING
}