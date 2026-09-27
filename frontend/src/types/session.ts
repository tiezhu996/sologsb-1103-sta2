/**
 * 场次（Session）：一台演出的一个段落（幕 / 场）。
 * 场次是灯位通道（Fixture）、Cue 提示点（Cue）与排演表（RehearsalSheet）的归属单元。
 */
import { COLOR_TEMP_DEFAULT_K, COLOR_TEMP_MAX, COLOR_TEMP_MIN } from '@/types/level'

export interface Session {
  /** 主键 */
  id: string
  /** 场次名称，例如「第一幕 · 宫廷舞会」 */
  title: string
  /** 演出序号，决定场次先后，从 1 开始连续 */
  order: number
  /** 剧本页码，形如 `P12` / `P12-14` */
  scriptPage: string
  /** 计划起始时刻，`HH:mm` */
  plannedStart: string
  /** 计划结束时刻，`HH:mm` */
  plannedEnd: string
  /** 舞台状态说明：换景、道具、演员走位等 */
  stageNote: string
  /**
   * 色温基调（K）：定下后本场所有 Cue 都以它判漂移、一键对齐与新增通道默认色温也照它；
   * `null` 表示未定基调，照旧按每条 Cue 自动挑出众数。基调不随通道电平变化。
   */
  baseColorTempK: number | null
  /** 创建时间戳（毫秒） */
  createdAt: number
  /** 最近更新时间戳（毫秒） */
  updatedAt: number
}

/** 新建 / 编辑场次时提交的字段集合 */
export type SessionDraft = Omit<Session, 'id' | 'createdAt' | 'updatedAt'>

/** 场次卡片上展示的统计信息 */
export interface SessionStat {
  /** 该场 Cue 数量 */
  cueCount: number
  /** 该场所有 Cue 的过渡总时长（秒） */
  totalFadeSec: number
  /** 该场灯位通道数量 */
  fixtureCount: number
}

/** 取整并夹到合法色温区间，供基调输入兜底 */
export function clampColorTempK(value: number, fallback: number = COLOR_TEMP_DEFAULT_K): number {
  if (!Number.isFinite(value)) return fallback
  return Math.min(COLOR_TEMP_MAX, Math.max(COLOR_TEMP_MIN, Math.round(value)))
}

/** 生成一个空的场次草稿，供表单初始化使用 */
export function createEmptySessionDraft(order = 1): SessionDraft {
  return {
    title: '',
    order,
    scriptPage: '',
    plannedStart: '',
    plannedEnd: '',
    stageNote: '',
    baseColorTempK: null
  }
}
