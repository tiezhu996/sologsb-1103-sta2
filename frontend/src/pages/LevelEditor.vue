<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { NAlert, NButton, NInput, NInputNumber, NSlider, NSwitch, NTag, useMessage } from 'naive-ui'
import BlankHint from '@/components/common/BlankHint.vue'
import ChannelChip from '@/components/common/ChannelChip.vue'
import CueNoInput from '@/components/common/CueNoInput.vue'
import FadeBar from '@/components/common/FadeBar.vue'
import { useCueStore } from '@/stores/cueStore'
import { useFixtureStore } from '@/stores/fixtureStore'
import { useLevelStore } from '@/stores/levelStore'
import { useSessionStore } from '@/stores/sessionStore'
import type { Fixture, FixturePosition } from '@/types/fixture'
import type { ColorTempCheck, ColorTempItem } from '@/types/level'
import { COLOR_TEMP_MAX, COLOR_TEMP_MIN, COLOR_TEMP_STEP } from '@/types/level'
import { cueTotalSeconds, checkColorTempConsistency, formatSeconds, formatTransition } from '@/utils/fade'
import { normalizeCueNo } from '@/utils/cueOrder'

const route = useRoute()
const router = useRouter()
const message = useMessage()
const cueStore = useCueStore()
const fixtureStore = useFixtureStore()
const levelStore = useLevelStore()
const sessionStore = useSessionStore()

const cueId = computed(() => String(route.params.id ?? ''))
const cue = computed(() => cueStore.cueById(cueId.value))
const sessionId = computed(() => cue.value?.sessionId ?? '')
const session = computed(() => (sessionId.value ? sessionStore.sessionById(sessionId.value) : null))

const fixtures = computed(() => (sessionId.value ? fixtureStore.sortedFixturesOfSession(sessionId.value) : []))
const levels = computed(() => levelStore.levelsOfCue(cueId.value))

const siblingNos = computed(() =>
  cue.value
    ? cueStore
        .cuesOfSession(sessionId.value)
        .map((item) => item.cueNo)
        .filter((no) => no !== cue.value?.cueNo)
    : []
)

/** 已设定电平的通道（用于色温一致性判定） */
const tempItems = computed(() => {
  const items: Array<{ fixtureId: string; channel: number; position: FixturePosition; colorTempK: number }> = []
  levels.value.forEach((level) => {
    const fixture = fixtureStore.fixtureById(level.fixtureId)
    if (!fixture) return
    items.push({
      fixtureId: level.fixtureId,
      channel: fixture.channel,
      position: fixture.position,
      colorTempK: level.colorTempK
    })
  })
  return items.sort((a, b) => a.channel - b.channel)
})

/** 场次色温基调：设定后本场所有 Cue 按它判漂移，不随通道数值变化 */
const baselineK = computed(() => session.value?.colorTempBaselineK ?? null)

const tempCheck = computed(() => checkColorTempConsistency(tempItems.value, baselineK.value))

/** 新增通道 / 一键对齐使用的默认色温：基调优先，否则自动基准，都没有时回落 3200K */
const defaultTempK = computed(() => (tempCheck.value.baselineK > 0 ? tempCheck.value.baselineK : 3200))

/** 基调输入草稿：跟随场次已设基调初始化，点「设为基调」才落库 */
const baselineDraft = ref<number | null>(null)

watch(
  sessionId,
  () => {
    baselineDraft.value = session.value?.colorTempBaselineK ?? null
  },
  { immediate: true }
)

/** 对比两次判定，找出原先一致、按新基准偏出去的通道 */
function newlyDrifted(before: ColorTempCheck, after: ColorTempCheck): ColorTempItem[] {
  return after.items.filter(
    (item) => !item.consistent && before.items.find((prev) => prev.fixtureId === item.fixtureId)?.consistent === true
  )
}

function notifyBaselineChange(prefix: string, newly: ColorTempItem[]): void {
  if (newly.length > 0) {
    message.warning(`${prefix}；${newly.map((item) => `CH${item.channel}`).join('、')} 由一致变为漂移，已按新基准标出`)
    return
  }
  message.success(prefix)
}

async function saveBaseline(): Promise<void> {
  if (!session.value || baselineDraft.value === null) return
  const target = Math.round(baselineDraft.value)
  const before = tempCheck.value
  await sessionStore.updateSession(session.value.id, { colorTempBaselineK: target })
  const after = checkColorTempConsistency(tempItems.value, target)
  notifyBaselineChange(`色温基调已设为 ${target}K，本场 Cue 按它判定漂移`, newlyDrifted(before, after))
}

async function clearBaseline(): Promise<void> {
  if (!session.value) return
  const before = tempCheck.value
  await sessionStore.updateSession(session.value.id, { colorTempBaselineK: null })
  baselineDraft.value = null
  const after = checkColorTempConsistency(tempItems.value)
  notifyBaselineChange('已清除色温基调，恢复按出现最多的色温档自动判定', newlyDrifted(before, after))
}

function isEnabled(fixtureId: string): boolean {
  return levelStore.levelOf(cueId.value, fixtureId) !== null
}

function intensityOf(fixtureId: string): number {
  return levelStore.levelOf(cueId.value, fixtureId)?.intensity ?? 0
}

function tempOf(fixtureId: string): number {
  return levelStore.levelOf(cueId.value, fixtureId)?.colorTempK ?? defaultTempK.value
}

const focusDrafts = ref<Record<string, string>>({})

function focusValue(fixtureId: string): string {
  return focusDrafts.value[fixtureId] ?? levelStore.levelOf(cueId.value, fixtureId)?.focusNote ?? ''
}

function onFocusInput(fixtureId: string, value: string): void {
  focusDrafts.value = { ...focusDrafts.value, [fixtureId]: value }
}

async function commitFocus(fixtureId: string): Promise<void> {
  const draft = focusDrafts.value[fixtureId]
  if (draft === undefined) return
  const next = { ...focusDrafts.value }
  delete next[fixtureId]
  focusDrafts.value = next
  if (!isEnabled(fixtureId)) return
  await levelStore.upsertLevel(cueId.value, fixtureId, { focusNote: draft })
}

async function toggleFixture(fixture: Fixture, enabled: boolean): Promise<void> {
  if (enabled) {
    await levelStore.upsertLevel(cueId.value, fixture.id, {
      intensity: 70,
      colorTempK: defaultTempK.value,
      focusNote: focusValue(fixture.id)
    })
    return
  }
  await levelStore.removeLevel(cueId.value, fixture.id)
}

async function setIntensity(fixtureId: string, value: number): Promise<void> {
  await levelStore.upsertLevel(cueId.value, fixtureId, { intensity: value })
}

async function setColorTemp(fixtureId: string, value: number | null): Promise<void> {
  if (value === null) return
  await levelStore.upsertLevel(cueId.value, fixtureId, { colorTempK: value })
}

async function alignToBaseline(): Promise<void> {
  if (levels.value.length === 0) return
  const target = tempCheck.value.baselineK
  await Promise.all(levels.value.map((level) => levelStore.upsertLevel(cueId.value, level.fixtureId, { colorTempK: target })))
  message.success(`已将 ${levels.value.length} 个通道对齐到 ${target}K`)
}

async function clearAll(): Promise<void> {
  const count = levels.value.length
  await levelStore.removeByCue(cueId.value)
  message.success(`已清空 ${count} 个通道电平`)
}

async function commitCueNo(value: string): Promise<void> {
  if (!cue.value) return
  const normalized = normalizeCueNo(value)
  if (normalized === cue.value.cueNo) return
  if (cueStore.isCueNoTaken(sessionId.value, normalized, cue.value.id)) {
    message.error(`${normalized} 已被占用`)
    return
  }
  await cueStore.updateCue(cue.value.id, { cueNo: normalized })
  message.success(`编号已改为 ${normalized}`)
}

const siblingCues = computed(() => (sessionId.value ? cueStore.sortedCuesOfSession(sessionId.value) : []))

function goSiblingCue(direction: -1 | 1): void {
  if (!cue.value) return
  const index = siblingCues.value.findIndex((item) => item.id === cue.value?.id)
  const next = siblingCues.value[index + direction]
  if (!next) {
    message.warning(direction === -1 ? '已经是第一条 Cue' : '已经是最后一条 Cue')
    return
  }
  void router.push(`/cues/${next.id}/levels`)
}

function goTimeline(): void {
  void router.push(`/sessions/${sessionId.value}/cues`)
}

function goFixtures(): void {
  void router.push(`/sessions/${sessionId.value}/fixtures`)
}

function goSheets(): void {
  void router.push('/sheets')
}
</script>

<template>
  <div class="page">
    <header class="page__header">
      <div>
        <h1 class="page__title">通道电平编辑</h1>
        <p class="page__subtitle">
          {{ session ? `${session.order}. ${session.title}` : '所属场次不存在' }} ·
          逐通道设定亮度与色温，超出容差的色温漂移会被提示；可为场次设定固定色温基调。
        </p>
      </div>
      <div class="page__actions">
        <NButton @click="goTimeline">返回 Cue 时间轴</NButton>
        <NButton @click="goFixtures">灯位通道</NButton>
        <NButton @click="goSheets">排演表</NButton>
      </div>
    </header>

    <NAlert v-if="!cue" type="warning" :bordered="false">
      该 Cue 不存在，可能已被删除。请返回 Cue 编排时间轴重新选择。
    </NAlert>

    <template v-else>
      <section class="panel">
        <div class="cue-head">
          <CueNoInput :model-value="cue.cueNo" :existing-nos="siblingNos" width="130px" @commit="commitCueNo" />
          <div class="cue-head__titles">
            <p class="cue-head__label">{{ cue.label || '（未填写提示语）' }}</p>
            <p class="cue-head__meta mono">{{ formatTransition(cue) }} · 合计 {{ formatSeconds(cueTotalSeconds(cue)) }}</p>
          </div>
          <NTag size="small" :bordered="false" type="warning">{{ cue.trigger }}</NTag>
          <span class="toolbar__spacer" />
          <NButton size="small" quaternary @click="goSiblingCue(-1)">上一条 Cue</NButton>
          <NButton size="small" quaternary @click="goSiblingCue(1)">下一条 Cue</NButton>
        </div>

        <div class="cue-head__bar">
          <FadeBar :fade-in-sec="cue.fadeInSec" :hold-sec="cue.holdSec" :fade-out-sec="cue.fadeOutSec" :height="14" />
        </div>
      </section>

      <NAlert :type="tempCheck.consistent ? 'success' : 'warning'" :bordered="false">
        {{ tempCheck.message }}
      </NAlert>

      <div class="baseline-bar">
        <span class="baseline-bar__label">色温基调</span>
        <NInputNumber
          v-model:value="baselineDraft"
          size="small"
          :min="COLOR_TEMP_MIN"
          :max="COLOR_TEMP_MAX"
          :step="COLOR_TEMP_STEP"
          placeholder="未设定"
          style="width: 110px"
        />
        <span class="baseline-bar__unit">K</span>
        <NButton size="small" :disabled="baselineDraft === null || baselineDraft === baselineK" @click="saveBaseline">
          设为基调
        </NButton>
        <NButton v-if="baselineK !== null" size="small" quaternary @click="clearBaseline">恢复自动</NButton>
        <span class="baseline-bar__hint">
          {{
            baselineK !== null
              ? `本场按基调 ${baselineK}K 判定漂移，通道数值变化不影响基调`
              : '未设基调，按出现最多的色温档自动判定'
          }}
        </span>
      </div>

      <div class="toolbar">
        <span class="toolbar__label">已设定 {{ levels.length }} / {{ fixtures.length }} 个通道</span>
        <span class="toolbar__spacer" />
        <NButton size="small" :disabled="levels.length === 0" @click="alignToBaseline">
          全部对齐到 {{ defaultTempK }}K
        </NButton>
        <NButton size="small" quaternary type="error" :disabled="levels.length === 0" @click="clearAll">
          清空本 Cue 电平
        </NButton>
      </div>

      <BlankHint
        v-if="fixtures.length === 0"
        title="该场次还没有灯位通道"
        description="通道电平需要先有灯位通道。请到灯位通道配置台完成配接后回来设定亮度与色温。"
        action-text="去配置灯位通道"
        @action="goFixtures"
      />

      <section v-else class="panel">
        <h2 class="panel__title">
          通道电平<span class="panel__title-tag">开关控制该通道是否参与本 Cue</span>
        </h2>

        <div class="level-table">
          <div class="level-table__head">
            <span>参与</span>
            <span>通道</span>
            <span>亮度</span>
            <span>色温</span>
            <span>对焦说明</span>
          </div>

          <div
            v-for="fixture in fixtures"
            :key="fixture.id"
            class="level-row"
            :class="{ 'level-row--off': !isEnabled(fixture.id) }"
          >
            <NSwitch
              :value="isEnabled(fixture.id)"
              size="small"
              @update:value="(value) => toggleFixture(fixture, value === true)"
            />

            <div class="level-row__chip">
              <ChannelChip
                :channel="fixture.channel"
                :position="fixture.position"
                :intensity="isEnabled(fixture.id) ? intensityOf(fixture.id) : null"
                :gel="fixture.gel"
                :fixture-type="fixture.fixtureType"
                size="small"
              />
              <span class="level-row__type">{{ fixture.fixtureType }}</span>
            </div>

            <div class="level-row__control">
              <NSlider
                :value="intensityOf(fixture.id)"
                :min="0"
                :max="100"
                :step="1"
                :disabled="!isEnabled(fixture.id)"
                @update:value="(value) => setIntensity(fixture.id, value)"
              />
              <NInputNumber
                :value="intensityOf(fixture.id)"
                size="small"
                :min="0"
                :max="100"
                :show-button="false"
                :disabled="!isEnabled(fixture.id)"
                style="width: 82px"
                @update:value="(value) => setIntensity(fixture.id, value ?? 0)"
              />
            </div>

            <div class="level-row__control">
              <NInputNumber
                :value="tempOf(fixture.id)"
                size="small"
                :min="COLOR_TEMP_MIN"
                :max="COLOR_TEMP_MAX"
                :step="COLOR_TEMP_STEP"
                :disabled="!isEnabled(fixture.id)"
                style="width: 108px"
                @update:value="(value) => setColorTemp(fixture.id, value)"
              />
              <span class="level-row__drift mono">
                {{
                  isEnabled(fixture.id)
                    ? `偏移 ${Math.abs(tempOf(fixture.id) - defaultTempK)}K`
                    : '未参与'
                }}
              </span>
            </div>

            <NInput
              :value="focusValue(fixture.id)"
              size="small"
              :disabled="!isEnabled(fixture.id)"
              placeholder="对焦说明（失焦保存）"
              @update:value="(value) => onFocusInput(fixture.id, value)"
              @blur="commitFocus(fixture.id)"
              @keyup.enter="commitFocus(fixture.id)"
            />
          </div>
        </div>
      </section>

      <section v-if="levels.length > 0" class="panel">
        <h2 class="panel__title">
          色温一致性检查
          <span class="panel__title-tag">
            {{ tempCheck.baselineSource === 'manual' ? '场次基调' : '自动基准' }} {{ tempCheck.baselineK }}K · 容差 ±{{
              tempCheck.toleranceK
            }}K
          </span>
        </h2>
        <div class="temp-grid">
          <div
            v-for="item in tempCheck.items"
            :key="item.fixtureId"
            class="temp-item"
            :class="{ 'temp-item--drift': !item.consistent }"
          >
            <ChannelChip :channel="item.channel" :position="item.position" :intensity="null" size="small" />
            <span class="mono">{{ item.colorTempK }}K</span>
            <span class="temp-item__drift mono">偏移 {{ item.driftK }}K</span>
          </div>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.cue-head {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
}

.cue-head__titles {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 220px;
}

.cue-head__label {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
}

.cue-head__meta {
  margin: 0;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.45);
}

.cue-head__bar {
  margin-top: 14px;
  max-width: 620px;
}

.toolbar__label {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.5);
}

.baseline-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  padding: 12px 14px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.07);
}

.baseline-bar__label {
  font-size: 13px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.82);
}

.baseline-bar__unit {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.5);
  margin-left: -6px;
}

.baseline-bar__hint {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.45);
}

.level-table__head,
.level-row {
  display: grid;
  grid-template-columns: 58px 220px 240px 220px 1fr;
  align-items: center;
  gap: 12px;
  padding: 9px 4px;
}

.level-table__head {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.42);
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.level-row {
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  transition: opacity 0.16s ease;
}

.level-row--off {
  opacity: 0.5;
}

.level-row__chip {
  display: flex;
  align-items: center;
  gap: 8px;
}

.level-row__type {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.5);
}

.level-row__control {
  display: flex;
  align-items: center;
  gap: 10px;
}

.level-row__drift {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.42);
  white-space: nowrap;
}

.temp-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.temp-item {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  border-radius: 10px;
  font-size: 12px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
}

.temp-item--drift {
  border-color: rgba(232, 168, 84, 0.65);
  background: rgba(232, 168, 84, 0.1);
}

.temp-item__drift {
  color: rgba(255, 255, 255, 0.5);
}
</style>
