/* 挂机验证台：工程数据读取、可校准战斗模拟、全图体检与流程推演。 */
'use strict'

const ROWS = 10
const COLS = 10
const GOLD_ITEM_ID = '4280405b44a821f8'
const DROP_ATTRIBUTE_ID = '4cb407bd71929620'
const DROP_COMMAND_ID = '249c9c9d4de177c9'
const DEFAULT_IDS = {
  name: 'da4d32a4f1097059', level: 'fb9d675011f6c08f', health: 'a5fd5e9f229abb2d',
  maxHealth: 'a8451228fe0c120a', attack: '96efe7ef1b6999bc', defense: '752c94a8aa99161b',
  critical: '2b66c53fcb9e7680', hit: '8b294b83e30f41ac', dodge: 'd4f44a28ced26547',
  attackTime: '843a8b363059e086', attackSpeed: '6421aebf4c298605', healthRegen: '9a7528d2de781a0d',
  rewardExp: '47f57252180f77c7', loopList: DROP_ATTRIBUTE_ID,
}
const DEFAULT_PLAYER = { actorId: '', level: 1, hp: 100, atk: 10, def: 0, interval: 1, skillPower: 100, crit: 0, hit: 0, dodge: 0, regen: 0, killHeal: 0 }
// 数值模型对齐游戏实际（D:\new-game）：
// - perLevelGrowth: 怪物线性成长（通用怪物模板：每级 HP/攻击/命中/闪避/经验 +1）
// - attackSpeedBase: 攻击间隔 SPDTime = attackTime×attackSpeed + attackSpeedBase×10（毫秒）
// - baseHit/hitDice: 命中 = clamp((基础命中+攻方命中−守方闪避)/命中骰子, 0, 1)，游戏骰子 80 无下限
//   基础命中默认 80 = 游戏「基础命中率」派生属性基准（主菜单公式 80 起）
// - mobsPerEncounter: 同场怪物数（游戏当前每格刷 30 只，默认 1 便于对照）
const DEFAULT_MODEL = { minutes: 10, iterations: 200, baseHit: 80, hitDice: 80, critMultiplier: 2, minDamage: 1, perLevelGrowth: 1, attackSpeedBase: 80, mobsPerEncounter: 1 }
const DEFAULT_STAGE = { kills: 20, spawnDelay: 0.8, travelSeconds: 4, goldMultiplier: 1, targetClearMinutes: 3 }

function clone(value) {
  return typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value))
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function finite(value, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function hashSeed(text) {
  let hash = 2166136261
  for (const character of String(text)) {
    hash ^= character.charCodeAt(0)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function seededRandom(seed) {
  let value = seed >>> 0
  return () => {
    value += 0x6D2B79F5
    let mixed = value
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1)
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61)
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296
  }
}

function weightedChoice(entries, random) {
  const total = entries.reduce((sum, entry) => sum + Math.max(0, finite(entry.weight, 0)), 0)
  if (!total) return entries[0] || null
  let cursor = random() * total
  for (const entry of entries) {
    cursor -= Math.max(0, finite(entry.weight, 0))
    if (cursor <= 0) return entry
  }
  return entries.at(-1)
}

function emptyCell() {
  return { name: '', icon: -1, Passability: { down: false, right: false }, monsters: [] }
}

const DEFAULT_ICON_TYPES = [
  { value: -1, label: '无地点', imageGuid: '' },
  { value: 0, label: '未配置', imageGuid: '' },
  ...[1, 2, 3, 4, 5, 6, 7, 100, 101, 102].map((value) => ({ value, label: String(value), imageGuid: '' })),
]

// 从工程「地图icon自动切换图标」事件解析 icon 数值 → 地标图片 GUID（与地图编辑器同规则）
function parseIconDefinitions(eventData) {
  const types = [clone(DEFAULT_ICON_TYPES[0])]
  const branches = eventData?.commands?.find((command) => command?.id === 'switch')?.params?.branches || []
  for (const branch of branches) {
    const values = (branch.conditions || []).map((condition) => Number(condition.value)).filter(Number.isFinite)
    const label = branch.commands?.find((command) => command?.id === 'comment')?.params?.comment || '未命名图标'
    const imageCommand = branch.commands?.find((command) => command?.id === 'setImage')
    const imageGuid = String(imageCommand?.params?.properties?.find((property) => property.key === 'image')?.value || '').toLowerCase()
    for (const value of values) types.push({ value, label, imageGuid })
  }
  if (!types.some((entry) => entry.value === 0)) types.push({ value: 0, label: '未配置', imageGuid: '' })
  return types.sort((a, b) => a.value - b.value)
}

function demoData() {
  const actors = [
    { id: 'demo-hero', name: '演示战士', level: 1, hp: 120, atk: 18, def: 5, crit: 8, hit: 0, dodge: 3, interval: 1, regen: 0.4, rewardExp: 0, gold: 0 },
  ]
  const monsters = []
  for (let level = 1; level <= 18; level++) {
    monsters.push({
      id: `demo-monster-${level}`, name: `演示怪物 Lv${level}`, level,
      hp: Math.round(42 * 1.22 ** (level - 1)), atk: Math.round(6 * 1.15 ** (level - 1)),
      def: Math.round(1.8 * 1.13 ** (level - 1)), crit: 3, hit: 0, dodge: Math.min(18, level * .7),
      interval: 1.5, regen: 0, rewardExp: Math.round(8 * 1.2 ** (level - 1)), gold: Math.round(4 * 1.18 ** (level - 1)),
    })
  }
  const grid = Array.from({ length: ROWS }, () => Array.from({ length: COLS }, emptyCell))
  const route = [
    [4, 0], [4, 1], [4, 2], [3, 2], [2, 2], [2, 3], [2, 4], [3, 4], [4, 4],
    [4, 5], [4, 6], [5, 6], [6, 6], [6, 7], [6, 8], [7, 8], [8, 8], [8, 9],
  ]
  route.forEach(([r, c], index) => {
    const next = route[index + 1]
    const level = index + 1
    grid[r][c] = {
      name: index % 5 === 4 ? `区域首领 ${Math.ceil(level / 5)}` : `挂机区域 ${level}`,
      icon: index === 0 ? 100 : index % 5 === 4 ? 7 : 1,
      levelRange: { min: level, max: level + 1 },
      Passability: { down: Boolean(next && next[0] === r + 1), right: Boolean(next && next[1] === c + 1) },
      monsters: [{ id: monsters[Math.min(index, monsters.length - 1)].id, lvMin: level, lvMax: level + 1, weight: 1 }],
    }
  })
  return { actors: [...actors, ...monsters], playerActors: actors, grid, source: '演示地图' }
}

function stageKey(r, c) {
  return `${r}:${c}`
}

function stageConfig(overrides, r, c) {
  return { ...DEFAULT_STAGE, ...(overrides[stageKey(r, c)] || {}) }
}

function scaledMonster(record, targetLevel, model) {
  const level = Math.max(1, Math.round(finite(targetLevel, record.level || 1)))
  const baseLevel = Math.max(1, finite(record.level, level))
  const delta = level - baseLevel
  // 攻击间隔对齐游戏 SPDTime = attackTime × attackSpeed + attackSpeedBase × 10（毫秒）
  const interval = record.attackTime != null
    ? Math.max(.05, (finite(record.attackTime, 1) * finite(record.attackSpeed, 1) + finite(model.attackSpeedBase, 80) * 10) / 1000)
    : Math.max(.05, finite(record.interval, 1.5))
  const growth = Math.max(0, finite(model.perLevelGrowth, 1))
  return {
    ...record,
    level,
    interval,
    hp: Math.max(1, finite(record.hp, 40) + growth * delta),
    atk: Math.max(0, finite(record.atk, 5) + growth * delta),
    def: Math.max(0, finite(record.def, 0)),
    hit: Math.max(0, finite(record.hit, 0) + growth * delta),
    dodge: Math.max(0, finite(record.dodge, 0) + growth * delta),
    rewardExp: Math.max(0, finite(record.rewardExp, level * 5) + growth * delta),
    gold: Math.max(0, finite(record.gold, level * 2)),
  }
}

function simulateFight(player, monsters, model, random, initialHp) {
  let playerHp = clamp(initialHp, 1, player.hp)
  if (!monsters.length) return { won: true, seconds: 0, hp: playerHp, attacks: 0 }
  const alive = monsters.map((monster) => ({ ...monster, hp: Math.max(1, finite(monster.hp, 1)) }))
  let targetIndex = 0
  let elapsed = 0
  let nextPlayer = Math.max(.05, player.interval)
  const nextMonsters = alive.map((monster) => Math.max(.05, finite(monster.interval, 1.5)))
  let attacks = 0
  const ceiling = 3600
  const hitChance = (attacker, defender) => clamp((finite(model.baseHit, 0) + finite(attacker.hit, 0) - finite(defender.dodge, 0)) / Math.max(1, finite(model.hitDice, 80)), 0, 1)
  while (elapsed < ceiling) {
    const next = Math.min(nextPlayer, ...nextMonsters)
    const delta = next - elapsed
    playerHp = Math.min(player.hp, playerHp + Math.max(0, player.regen) * delta)
    elapsed = next
    if (nextPlayer <= Math.min(...nextMonsters)) {
      // 玩家攻击当前目标，击杀后切换下一个
      const monster = alive[targetIndex]
      attacks++
      if (random() <= hitChance(player, monster)) {
        let damage = Math.max(model.minDamage, player.atk * player.skillPower / 100 - finite(monster.def))
        if (random() < clamp(player.crit / 100, 0, 1)) damage *= model.critMultiplier
        monster.hp -= damage
      }
      nextPlayer += Math.max(.05, player.interval)
      if (monster.hp <= 0) {
        targetIndex++
        if (targetIndex >= alive.length) return { won: true, seconds: elapsed, hp: playerHp, attacks }
      }
    } else {
      // 最早到攻击时刻的怪物攻击玩家
      let index = 0
      for (let i = 1; i < nextMonsters.length; i++) if (nextMonsters[i] < nextMonsters[index]) index = i
      const monster = alive[index]
      if (random() <= hitChance(monster, player)) playerHp -= Math.max(model.minDamage, monster.atk - finite(player.def))
      nextMonsters[index] += Math.max(.05, finite(monster.interval, 1.5))
      if (playerHp <= 0) return { won: false, seconds: elapsed, hp: 0, attacks }
    }
  }
  return { won: false, seconds: ceiling, hp: playerHp, attacks, stalemate: true }
}

function simulateStage(input) {
  const { cell, actorMap, player, model, stage } = input
  const iterations = Math.max(1, Math.floor(model.iterations))
  const duration = Math.max(1, model.minutes) * 60
  const samples = []
  const monsterOverrides = stage.monsters || {}
  const pool = (cell?.monsters || []).filter((entry) => actorMap.has(entry.id)).map((entry) => ({
    ...entry,
    weight: Math.max(0, finite(monsterOverrides[entry.id]?.weight, entry.weight)),
  }))
  if (!pool.length) return { valid: false, kills: 0, killsPerHour: 0, survival: 0, deaths: 0, clearSeconds: null, goldPerHour: 0, expPerHour: 0, samples: [] }
  for (let iteration = 0; iteration < iterations; iteration++) {
    const random = seededRandom(hashSeed(`${input.seed || 'idle-lab'}:${iteration}`))
    let time = Math.max(0, stage.travelSeconds)
    let hp = player.hp
    let kills = 0
    let deaths = 0
    let gold = 0
    let exp = 0
    let clearSeconds = null
    while (time < duration) {
      const spawn = weightedChoice(pool, random)
      const minLevel = Math.max(1, Math.floor(finite(spawn.lvMin, cell.levelRange?.min || 1)))
      const maxLevel = Math.max(minLevel, Math.floor(finite(spawn.lvMax, cell.levelRange?.max || minLevel)))
      const monster = scaledMonster(actorMap.get(spawn.id), minLevel + Math.floor(random() * (maxLevel - minLevel + 1)), model)
      const override = monsterOverrides[spawn.id] || {}
      monster.hp *= Math.max(0, finite(override.hp, 1))
      monster.atk *= Math.max(0, finite(override.atk, 1))
      monster.def *= Math.max(0, finite(override.def, 1))
      monster.rewardExp *= Math.max(0, finite(override.exp, 1))
      monster.gold *= Math.max(0, finite(override.gold, 1))
      const count = Math.max(1, Math.floor(finite(model.mobsPerEncounter, 1)))
      const fight = simulateFight(player, Array.from({ length: count }, () => ({ ...monster })), model, random, hp)
      time += fight.seconds
      hp = fight.hp
      if (fight.won) {
        kills += count
        gold += monster.gold * stage.goldMultiplier * count
        exp += monster.rewardExp * count
        hp = Math.min(player.hp, hp + player.hp * player.killHeal / 100)
        if (clearSeconds === null && kills >= stage.kills) clearSeconds = time
        time += Math.max(0, stage.spawnDelay)
      } else {
        // 游戏实际无复活：本轮死亡即终止
        deaths++
        break
      }
      if (kills + deaths > 100000) break
    }
    samples.push({ kills, deaths, gold, exp, clearSeconds, survived: deaths === 0 })
  }
  const average = (key) => samples.reduce((sum, item) => sum + finite(item[key]), 0) / samples.length
  const clearValues = samples.map((item) => item.clearSeconds).filter(Number.isFinite).sort((a, b) => a - b)
  return {
    valid: true,
    kills: average('kills'),
    killsPerHour: average('kills') * 60 / model.minutes,
    survival: samples.filter((item) => item.survived).length / samples.length,
    deaths: average('deaths'),
    clearSeconds: clearValues.length ? clearValues[Math.floor(clearValues.length / 2)] : null,
    clearRate: clearValues.length / samples.length,
    goldPerHour: average('gold') * 60 / model.minutes,
    expPerHour: average('exp') * 60 / model.minutes,
    samples,
  }
}

function assessResult(result, stage) {
  if (!result.valid) return { level: 'error', label: '缺少有效怪物', note: '怪物 GUID 未读取或关卡为空' }
  if (!result.clearSeconds || result.clearRate < .5) return { level: 'error', label: '无法稳定通关', note: `仅 ${Math.round(result.clearRate * 100)}% 样本完成目标` }
  if (result.survival < .5) return { level: 'error', label: '死亡风险过高', note: `无死亡样本仅 ${Math.round(result.survival * 100)}%` }
  const ratio = result.clearSeconds / (stage.targetClearMinutes * 60)
  if (ratio > 1.5) return { level: 'error', label: '节奏严重偏慢', note: `比目标慢 ${Math.round((ratio - 1) * 100)}%` }
  if (ratio > 1.2) return { level: 'warning', label: '节奏偏慢', note: `比目标慢 ${Math.round((ratio - 1) * 100)}%` }
  if (ratio < .55) return { level: 'warning', label: '关卡过易', note: `只用了目标时间的 ${Math.round(ratio * 100)}%` }
  return { level: 'healthy', label: '节奏健康', note: `通关时间为目标的 ${Math.round(ratio * 100)}%` }
}

function routeFromGrid(grid) {
  const stages = []
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (grid[r]?.[c]?.name) stages.push({ r, c, cell: grid[r][c] })
  if (!stages.length) return []
  const byKey = new Map(stages.map((entry) => [stageKey(entry.r, entry.c), entry]))
  const neighbors = new Map(stages.map((entry) => [stageKey(entry.r, entry.c), []]))
  for (const entry of stages) {
    const { r, c, cell } = entry
    if (cell.Passability?.right && byKey.has(stageKey(r, c + 1))) {
      neighbors.get(stageKey(r, c)).push(byKey.get(stageKey(r, c + 1)))
      neighbors.get(stageKey(r, c + 1)).push(entry)
    }
    if (cell.Passability?.down && byKey.has(stageKey(r + 1, c))) {
      neighbors.get(stageKey(r, c)).push(byKey.get(stageKey(r + 1, c)))
      neighbors.get(stageKey(r + 1, c)).push(entry)
    }
  }
  const startCandidates = stages.filter((entry) => entry.cell.icon >= 100)
  startCandidates.sort((a, b) => ((a.cell.levelRange?.min || 999) - (b.cell.levelRange?.min || 999)) || a.r - b.r || a.c - b.c)
  const start = startCandidates[0] || stages[0]
  const queue = [start]
  const visited = new Set([stageKey(start.r, start.c)])
  const ordered = []
  while (queue.length) {
    const current = queue.shift()
    ordered.push(current)
    const nextEntries = neighbors.get(stageKey(current.r, current.c)) || []
    nextEntries.sort((a, b) => ((a.cell.levelRange?.min || 0) - (b.cell.levelRange?.min || 0)) || a.r - b.r || a.c - b.c)
    for (const next of nextEntries) {
      const key = stageKey(next.r, next.c)
      if (!visited.has(key)) { visited.add(key); queue.push(next) }
    }
  }
  const unvisited = stages.filter((entry) => !visited.has(stageKey(entry.r, entry.c)))
  unvisited.sort((a, b) => ((a.cell.levelRange?.min || 999) - (b.cell.levelRange?.min || 999)) || a.r - b.r || a.c - b.c)
  return [...ordered, ...unvisited]
}

function combatRouteFromGrid(grid) {
  return routeFromGrid(grid).filter((entry) => entry.cell.monsters?.length)
}

function flattenDefinitions(nodes, result = []) {
  for (const node of nodes || []) node.children ? flattenDefinitions(node.children, result) : result.push(node)
  return result
}

function actorAttributeIds(attribute) {
  const ids = { ...DEFAULT_IDS }
  const actorGroup = (attribute.keys || []).find((entry) => entry.id === attribute.settings?.actor)
  for (const definition of flattenDefinitions(actorGroup?.children || [])) {
    if (Object.hasOwn(ids, definition.key)) ids[definition.key] = definition.id
  }
  return ids
}

function parseLocalization(data) {
  const map = new Map()
  const walk = (nodes) => {
    for (const node of nodes || []) node.children ? walk(node.children) : map.set(node.id, node.contents?.['zh-CN'] || node.contents?.zh || Object.values(node.contents || {})[0] || node.name || '')
  }
  walk(data?.list)
  return map
}

function localize(value, localization) {
  const match = /^<ref:([a-f0-9]{16})>$/i.exec(String(value || ''))
  return match ? localization.get(match[1].toLowerCase()) || value : value
}

function parseDrops(data, ids) {
  const entries = []
  const attribute = (data.attributes || []).find((entry) => entry.key === ids.loopList || entry.key === DROP_ATTRIBUTE_ID)
  if (typeof attribute?.value === 'string') {
    try { entries.push(...JSON.parse(attribute.value)) } catch {}
  }
  for (const event of data.events || []) for (const command of event.commands || []) {
    if (String(command.id || '').replace(/^!/, '') !== DROP_COMMAND_ID || String(command.id).startsWith('!')) continue
    const params = command.params || {}
    entries.push({ type: params.type, id: params.itemId || params.equipmentId, min: params.min, max: params.max, dropRate: params.dropRate })
  }
  return entries
}

function expectedGold(entries) {
  return entries.filter((entry) => entry.type === 'item' && entry.id === GOLD_ITEM_ID).reduce((sum, entry) => sum + ((finite(entry.min, 1) + finite(entry.max, entry.min || 1)) / 2) * clamp(finite(entry.dropRate, 1), 0, 1), 0)
}

function actorRecord(path, data, ids, localization) {
  const normalized = String(path || '').replace(/\\/g, '/')
  const name = normalized.split('/').pop() || ''
  const id = (name.match(/\.([a-f0-9]{16})\.[^.]+$/i)?.[1] || '').toLowerCase()
  const fileName = name.replace(new RegExp(`\\.${id}\\.actor$`, 'i'), '').replace(/\.actor$/i, '')
  return {
    id, path, fileName, inherit: String(data.inherit || '').toLowerCase(), data,
    attributes: new Map((data.attributes || []).map((entry) => [entry.key, entry.value])),
    drops: parseDrops(data, ids), localization,
  }
}

function resolveActor(record, records, ids, stack = new Set()) {
  if (record.resolved) return record.resolved
  if (stack.has(record.id)) return {}
  stack.add(record.id)
  const parent = record.inherit && records.get(record.inherit) ? resolveActor(records.get(record.inherit), records, ids, stack) : {}
  const parentKeys = {
    name: 'name', level: 'level', health: 'hp', maxHealth: 'hp', attack: 'atk', defense: 'def',
    critical: 'crit', hit: 'hit', dodge: 'dodge', attackTime: 'attackTime', attackSpeed: 'attackSpeed',
    healthRegen: 'regen', rewardExp: 'rewardExp',
  }
  const value = (key, fallback) => record.attributes.has(ids[key]) ? record.attributes.get(ids[key]) : parent[parentKeys[key] || key] ?? fallback
  const fileLevel = Number(record.fileName.match(/Lv\s*(\d+)/i)?.[1]) || 0
  const level = record.attributes.has(ids.level) ? finite(record.attributes.get(ids.level), 1) : fileLevel || finite(parent.level, 1)
  const name = record.attributes.has(ids.name) ? localize(record.attributes.get(ids.name), record.localization) : record.fileName
  const resolved = {
    id: record.id, name: String(name || record.fileName), path: record.path, inherit: record.inherit, level,
    hp: Math.max(1, finite(value('maxHealth', value('health', 100)), 100)), atk: finite(value('attack', 10), 10), def: finite(value('defense', 0)),
    crit: finite(value('critical', 0)), hit: finite(value('hit', 0)), dodge: finite(value('dodge', 0)),
    attackTime: Math.max(.1, finite(value('attackTime', 1.5), 1.5)), attackSpeed: Math.max(0, finite(value('attackSpeed', 1), 1)),
    interval: Math.max(.1, finite(value('attackTime', 1.5), 1.5)), regen: Math.max(0, finite(value('healthRegen', 0))),
    rewardExp: Math.max(0, finite(value('rewardExp', level * 5), level * 5)),
    gold: expectedGold(record.drops) || finite(parent.gold, level * 2),
  }
  record.resolved = resolved
  return resolved
}

const IdleLabCore = { seededRandom, weightedChoice, scaledMonster, simulateFight, simulateStage, assessResult, routeFromGrid, combatRouteFromGrid, demoData, actorAttributeIds, actorRecord, resolveActor }
globalThis.IdleLabCore = IdleLabCore

if (typeof document !== 'undefined') initializeIdleLab()

function initializeIdleLab() {
  const $ = (selector) => document.querySelector(selector)
  const $$ = (selector) => [...document.querySelectorAll(selector)]
  const ids = [
    'project-state','restore-project','pick-project','import-map','export-plan','import-plan','folder-fallback','map-input','plan-input',
    'player-actor','player-level','player-hp','player-atk','player-def','player-interval','skill-power','player-crit','player-hit','player-dodge','player-regen','kill-heal','reset-player',
    'stage-minutes','iterations','base-hit','hit-dice','crit-multiplier','min-damage','per-level-growth','attack-speed-base','mobs-per-encounter',
    'selected-stage-name','selected-stage-coord','stage-kills','spawn-delay','travel-seconds','gold-multiplier','target-clear-minutes','clear-stage-override',
    'metric-kills','metric-kph','metric-survival','metric-deaths','metric-clear','metric-target','metric-gold','metric-exp','metric-status','metric-note',
    'heat-mode','run-all','map-grid','icon-legend','grid-zoom','zoom-output','monster-count','monster-list','stage-result','run-stage','snapshot-a','snapshot-b','issue-count','issue-list',
    'progress-minutes','start-gold','upgrade-cost','upgrade-cost-growth','upgrade-power','run-progression','flow-stage','flow-coordinate','flow-upgrades','flow-attack','flow-gold','flow-exp','flow-wait','timeline-scale','timeline-chart','timeline-events',
    'a-state','b-state','a-results','b-results','delta-results','data-status','simulation-status','toast-region',
  ]
  const els = Object.fromEntries(ids.map((id) => [id.replace(/-([a-z])/g, (_, value) => value.toUpperCase()), document.getElementById(id)]))
  const demo = demoData()
  const state = {
    grid: demo.grid,
    source: demo.source,
    actors: demo.actors,
    playerActors: demo.playerActors,
    actorMap: new Map(demo.actors.map((actor) => [actor.id, actor])),
    player: clone(DEFAULT_PLAYER),
    model: clone(DEFAULT_MODEL),
    overrides: {},
    selected: { r: 4, c: 0 },
    results: new Map(),
    snapshots: { a: null, b: null },
    rootHandle: null,
    lastRootHandle: null,
    attributeIds: clone(DEFAULT_IDS),
    iconTypes: clone(DEFAULT_ICON_TYPES),
    imagePaths: new Map(),
    bitmapCache: new Map(),
    // 自动同步关心的文件路径（轮询兜底模式用）。
    watchPaths: [],
  }
  state.player.actorId = demo.playerActors[0].id
  Object.assign(state.player, pickPlayerStats(demo.playerActors[0]))

  function normalizePath(path) { return String(path || '').replace(/\\/g, '/') }
  function basename(path) { return normalizePath(path).split('/').pop() || '' }
  function pickPlayerStats(actor) {
    return { level: actor.level || 1, hp: Math.max(1, actor.hp || 100), atk: actor.atk || 10, def: actor.def || 0, interval: actor.interval || 1, crit: actor.crit || 0, hit: actor.hit || 0, regen: actor.regen || 0 }
  }
  function currentCell() { return state.grid[state.selected.r]?.[state.selected.c] || emptyCell() }
  function currentStage() { return stageConfig(state.overrides, state.selected.r, state.selected.c) }
  function currentSeed() { return `${state.source}:${state.selected.r}:${state.selected.c}:${JSON.stringify(state.player)}:${JSON.stringify(state.model)}:${JSON.stringify(currentStage())}` }
  function formatNumber(value, digits = 0) { return Number.isFinite(value) ? new Intl.NumberFormat('zh-CN', { maximumFractionDigits: digits }).format(value) : '--' }
  function formatDuration(seconds) {
    if (!Number.isFinite(seconds)) return '--'
    if (seconds < 60) return `${formatNumber(seconds, 1)} 秒`
    const minutes = Math.floor(seconds / 60)
    const rest = Math.round(seconds % 60)
    return rest ? `${minutes}分${rest}秒` : `${minutes} 分钟`
  }
  function escapeHtml(value) { return String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character])) }
  function toast(message, type = 'info') {
    const element = document.createElement('div')
    element.className = `toast ${type}`
    element.textContent = message
    els.toastRegion.appendChild(element)
    setTimeout(() => element.remove(), 3000)
  }

  let settingsDatabasePromise = null
  function openSettingsDatabase() {
    if (settingsDatabasePromise) return settingsDatabasePromise
    settingsDatabasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open('loot-smith-settings', 1)
      request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains('settings')) request.result.createObjectStore('settings') }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    return settingsDatabasePromise
  }
  async function setting(key, value) {
    const database = await openSettingsDatabase()
    return new Promise((resolve, reject) => {
      const transaction = database.transaction('settings', value === undefined ? 'readonly' : 'readwrite')
      const store = transaction.objectStore('settings')
      const request = value === undefined ? store.get(key) : store.put(value, key)
      request.onsuccess = () => resolve(value === undefined ? request.result : value)
      request.onerror = () => reject(request.error)
    })
  }
  async function getHandle(root, path) {
    const parts = normalizePath(path).split('/').filter(Boolean)
    let directory = root
    for (const part of parts.slice(0, -1)) directory = await directory.getDirectoryHandle(part)
    return directory.getFileHandle(parts.at(-1))
  }
  async function readText(root, path) { return (await (await getHandle(root, path)).getFile()).text() }
  async function readBuffer(root, path) { return (await (await getHandle(root, path)).getFile()).arrayBuffer() }
  async function workbookGrid(buffer) {
    if (!globalThis.ExcelJS) throw new Error('ExcelJS 未加载')
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(buffer)
    const find = (key) => workbook.worksheets.find((sheet) => sheet.name.includes(key))
    const sheets = { name: find('名称'), level: find('等级'), icon: find('图标'), pass: find('通行'), spawn: find('刷怪') }
    if (Object.values(sheets).some((sheet) => !sheet)) throw new Error('地图 Excel 缺少名称、等级、图标、通行或刷怪工作表')
    const cellValue = (sheet, r, c) => sheet.getRow(r + 1).getCell(c + 1).value
    const grid = Array.from({ length: ROWS }, () => Array.from({ length: COLS }, emptyCell))
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      const name = cellValue(sheets.name, r, c)
      const levelValue = cellValue(sheets.level, r, c)
      const icon = cellValue(sheets.icon, r, c)
      const pass = String(cellValue(sheets.pass, r, c) ?? '')
      const spawn = String(cellValue(sheets.spawn, r, c) ?? '')
      const levelMatch = String(levelValue ?? '').match(/(\d+)\s*[-~～]?\s*(\d+)?/)
      const range = levelMatch ? { min: Number(levelMatch[1]), max: Number(levelMatch[2] || levelMatch[1]) } : null
      const passValues = /^[01],[01]$/.test(pass) ? pass.split(',').map(Number) : [0, 0]
      const monsters = spawn && spawn !== '-' ? spawn.split(',').map((id) => id.trim().toLowerCase()).filter(Boolean).map((id) => ({ id, lvMin: range?.min || 1, lvMax: range?.max || 1, weight: 1 })) : []
      grid[r][c] = { name: typeof name === 'string' ? name : '', icon: Number.isInteger(icon) ? icon : -1, Passability: { right: passValues[0] === 1, down: passValues[1] === 1 }, monsters }
      if (range) grid[r][c].levelRange = range
    }
    return grid
  }
  async function scanProject(root) {
    stopAutoSync()
    els.projectState.textContent = '正在扫描…'
    const [manifest, attribute, localizationData] = await Promise.all([
      readText(root, 'Data/manifest.json').then(JSON.parse), readText(root, 'Data/attribute.json').then(JSON.parse),
      readText(root, 'Data/localization.json').then(JSON.parse).catch(() => ({ list: [] })),
    ])
    const ids = actorAttributeIds(attribute)
    const localization = parseLocalization(localizationData)
    const records = new Map()
    for (const entry of manifest.actors || []) {
      try {
        const data = JSON.parse(await readText(root, entry.path))
        const record = actorRecord(entry.path, data, ids, localization)
        records.set(record.id, record)
      } catch (error) { console.warn('跳过无法读取的角色', entry.path, error) }
    }
    const actors = [...records.values()].map((record) => resolveActor(record, records, ids))
    const mapEntry = (manifest.others || []).find((entry) => /地图格\.[a-f0-9]{16}\.xlsx$/i.test(entry.path))
      || (manifest.others || []).find((entry) => /地图格/i.test(entry.path) && /\.xlsx$/i.test(entry.path))
    let grid = state.grid
    let source = state.source
    if (mapEntry) { grid = await workbookGrid(await readBuffer(root, mapEntry.path)); source = basename(mapEntry.path) }
    const iconEvent = (manifest.events || []).find((entry) => /地图icon自动切换图标/i.test(entry.path))
    let iconTypes = clone(DEFAULT_ICON_TYPES)
    if (iconEvent) {
      try { iconTypes = parseIconDefinitions(JSON.parse(await readText(root, iconEvent.path))) } catch {}
    }
    const imagePaths = new Map((manifest.images || []).map((entry) => [String(entry.path.match(/([a-f0-9]{16})\.\S+$/i)?.[1] || '').toLowerCase(), entry.path]))
    const referenced = new Set(grid.flat().flatMap((cell) => (cell.monsters || []).map((entry) => entry.id)))
    const nonMonsters = actors.filter((actor) => !referenced.has(actor.id) && !/怪物|首领|boss|slime|goblin|兽人|骷髅/i.test(actor.path))
    const heroes = nonMonsters.filter((actor) => /英雄|召唤兽|通用英雄/i.test(actor.path))
    const playerActors = heroes.length ? heroes : nonMonsters
    state.rootHandle = root
    state.lastRootHandle = root
    state.attributeIds = ids
    state.actors = actors
    state.playerActors = playerActors.length ? playerActors : actors
    state.actorMap = new Map(actors.map((actor) => [actor.id, actor]))
    state.grid = grid
    state.source = source
    state.iconTypes = iconTypes
    state.imagePaths = imagePaths
    state.results.clear()
    state.watchPaths = ['Data/manifest.json', 'Data/attribute.json', 'Data/localization.json',
      ...(manifest.actors || []).map((entry) => entry.path),
      ...(mapEntry ? [mapEntry.path] : []),
      ...(iconEvent ? [iconEvent.path] : [])]
    const first = combatRouteFromGrid(grid)[0] || routeFromGrid(grid)[0]
    if (first) state.selected = { r: first.r, c: first.c }
    await setting('last-project-handle', root).catch(() => {})
    els.projectState.textContent = root.name
    els.restoreProject.classList.add('hidden')
    populateActors()
    renderAll()
    toast(`已读取 ${actors.length} 个角色与 ${source}`)
    startAutoSync()
  }
  async function scanProjectFiles(files) {
    stopAutoSync()
    const fileMap = new Map(files.map((file) => [normalizePath(file.webkitRelativePath || file.name).replace(/^[^/]+\//, ''), file]))
    const readFile = async (path) => {
      const file = fileMap.get(normalizePath(path))
      if (!file) throw new Error(`缺少 ${path}`)
      return file
    }
    els.projectState.textContent = '正在扫描…'
    const [manifest, attribute, localizationData] = await Promise.all([
      readFile('Data/manifest.json').then((file) => file.text()).then(JSON.parse),
      readFile('Data/attribute.json').then((file) => file.text()).then(JSON.parse),
      readFile('Data/localization.json').then((file) => file.text()).then(JSON.parse).catch(() => ({ list: [] })),
    ])
    const ids = actorAttributeIds(attribute)
    const localization = parseLocalization(localizationData)
    const records = new Map()
    for (const entry of manifest.actors || []) {
      try {
        const data = JSON.parse(await (await readFile(entry.path)).text())
        const record = actorRecord(entry.path, data, ids, localization)
        records.set(record.id, record)
      } catch (error) { console.warn('跳过无法读取的角色', entry.path, error) }
    }
    const actors = [...records.values()].map((record) => resolveActor(record, records, ids))
    const mapEntry = (manifest.others || []).find((entry) => /地图格\.[a-f0-9]{16}\.xlsx$/i.test(entry.path))
      || (manifest.others || []).find((entry) => /地图格/i.test(entry.path) && /\.xlsx$/i.test(entry.path))
    let grid = state.grid
    let source = state.source
    if (mapEntry && fileMap.has(normalizePath(mapEntry.path))) {
      grid = await workbookGrid(await (await readFile(mapEntry.path)).arrayBuffer())
      source = basename(mapEntry.path)
    }
    const iconEvent = (manifest.events || []).find((entry) => /地图icon自动切换图标/i.test(entry.path))
    let iconTypes = clone(DEFAULT_ICON_TYPES)
    if (iconEvent && fileMap.has(normalizePath(iconEvent.path))) {
      try { iconTypes = parseIconDefinitions(JSON.parse(await (await readFile(iconEvent.path)).text())) } catch {}
    }
    const imagePaths = new Map((manifest.images || []).map((entry) => [String(entry.path.match(/([a-f0-9]{16})\.\S+$/i)?.[1] || '').toLowerCase(), entry.path]))
    const referenced = new Set(grid.flat().flatMap((cell) => (cell.monsters || []).map((entry) => entry.id)))
    const nonMonsters = actors.filter((actor) => !referenced.has(actor.id) && !/怪物|首领|boss|slime|goblin|兽人|骷髅/i.test(actor.path))
    const heroes = nonMonsters.filter((actor) => /英雄|召唤兽|通用英雄/i.test(actor.path))
    const playerActors = heroes.length ? heroes : nonMonsters
    state.rootHandle = null
    state.attributeIds = ids
    state.actors = actors
    state.playerActors = playerActors.length ? playerActors : actors
    state.actorMap = new Map(actors.map((actor) => [actor.id, actor]))
    state.grid = grid
    state.source = source
    state.iconTypes = iconTypes
    state.imagePaths = imagePaths
    state.results.clear()
    const first = combatRouteFromGrid(grid)[0] || routeFromGrid(grid)[0]
    if (first) state.selected = { r: first.r, c: first.c }
    els.projectState.textContent = files[0]?.webkitRelativePath?.split('/')[0] || '已导入工程'
    populateActors()
    renderAll()
    toast(`已读取 ${actors.length} 个角色与 ${source}`)
  }

  // ---- 工程文件自动同步 ----
  // 优先 FileSystemObserver 事件驱动（Chrome 133+），不可用时回退 5 秒元数据轮询。
  // 全量重扫会重解析 Excel；ponytail: 若解析变慢再拆增量重建 actors。
  const WATCH_INTERVAL_MS = 5000
  let fileObserver = null
  let watchTimer = null
  let watchSnapshot = new Map()
  let scheduleRescanTimer = null

  function scheduledRescan() {
    clearTimeout(scheduleRescanTimer)
    scheduleRescanTimer = setTimeout(async () => {
      scheduleRescanTimer = null
      if (!state.rootHandle) return
      await scanProject(state.rootHandle)
      toast('工程文件已更新，已自动重新读取', 'info')
    }, 500)
  }

  function onFileChange(records) {
    const invalid = records.some((record) => record.type === 'errored' || record.type === 'unknown')
    const changed = records.some((record) => ['appeared', 'disappeared', 'modified', 'moved'].includes(record.type))
    if (invalid) stopAutoSync()
    if (changed || invalid) scheduledRescan()
    if (invalid) startAutoSync()
  }

  function stopAutoSync() {
    fileObserver?.disconnect(); fileObserver = null
    clearInterval(watchTimer); watchTimer = null
    clearTimeout(scheduleRescanTimer); scheduleRescanTimer = null
    watchSnapshot = new Map()
  }

  async function startAutoSync() {
    if (!state.rootHandle) return
    if ('FileSystemObserver' in window) {
      fileObserver = new FileSystemObserver(onFileChange)
      try { await fileObserver.observe(state.rootHandle, { recursive: true }) } catch { fileObserver = null }
    }
    if (!fileObserver) {
      await captureWatchSnapshot()
      watchTimer = setInterval(async () => {
        if (document.visibilityState !== 'visible') return
        try { if (await pollWatchSnapshot()) scheduledRescan() } catch {}
      }, WATCH_INTERVAL_MS)
    }
  }

  async function fileStamp(path) {
    try {
      const file = await (await getHandle(state.rootHandle, path)).getFile()
      return { mtime: file.lastModified, size: file.size }
    } catch { return null }
  }

  async function captureWatchSnapshot() {
    watchSnapshot = new Map()
    for (const path of state.watchPaths || []) {
      const stamp = await fileStamp(path)
      if (stamp) watchSnapshot.set(normalizePath(path), stamp)
    }
  }

  async function pollWatchSnapshot() {
    let changed = false
    for (const path of state.watchPaths || []) {
      const key = normalizePath(path)
      const stamp = await fileStamp(path)
      const prev = watchSnapshot.get(key)
      if (!stamp || !prev || prev.mtime !== stamp.mtime || prev.size !== stamp.size) changed = true
      if (stamp) watchSnapshot.set(key, stamp)
    }
    return changed
  }

  async function chooseProject() {
    try {
      if (!window.showDirectoryPicker) return els.folderFallback.click()
      const root = await window.showDirectoryPicker({ mode: 'read' })
      await scanProject(root)
    } catch (error) { if (error?.name !== 'AbortError') toast(`读取工程失败：${error.message}`, 'error') }
  }
  async function restoreProject() {
    if (!state.lastRootHandle) return
    try {
      let permission = await state.lastRootHandle.queryPermission({ mode: 'read' })
      if (permission !== 'granted') permission = await state.lastRootHandle.requestPermission({ mode: 'read' })
      if (permission === 'granted') await scanProject(state.lastRootHandle)
    } catch (error) { toast(`恢复工程失败：${error.message}`, 'error') }
  }
  async function loadRememberedProject() {
    if (!window.showDirectoryPicker || !window.indexedDB) return
    try {
      const handle = await setting('last-project-handle')
      if (!handle) return
      state.lastRootHandle = handle
      if (await handle.queryPermission({ mode: 'read' }) === 'granted') await scanProject(handle)
      else { els.restoreProject.textContent = `加载 ${handle.name}`; els.restoreProject.classList.remove('hidden') }
    } catch {}
  }

  function inputNumber(element, fallback) { return finite(element.value, fallback) }
  function syncInputsFromState() {
    const player = state.player
    els.playerActor.value = player.actorId
    els.playerLevel.value = player.level; els.playerHp.value = player.hp; els.playerAtk.value = player.atk; els.playerDef.value = player.def
    els.playerInterval.value = player.interval; els.skillPower.value = player.skillPower; els.playerCrit.value = player.crit; els.playerHit.value = player.hit
    els.playerDodge.value = player.dodge
    els.playerRegen.value = player.regen; els.killHeal.value = player.killHeal
    const model = state.model
    els.stageMinutes.value = model.minutes; els.iterations.value = model.iterations; els.baseHit.value = model.baseHit; els.hitDice.value = model.hitDice
    els.critMultiplier.value = model.critMultiplier; els.minDamage.value = model.minDamage
    els.perLevelGrowth.value = model.perLevelGrowth; els.attackSpeedBase.value = model.attackSpeedBase; els.mobsPerEncounter.value = model.mobsPerEncounter
    const stage = currentStage()
    els.stageKills.value = stage.kills; els.spawnDelay.value = stage.spawnDelay; els.travelSeconds.value = stage.travelSeconds
    els.goldMultiplier.value = stage.goldMultiplier; els.targetClearMinutes.value = stage.targetClearMinutes
  }
  function readInputs() {
    state.player = {
      ...state.player, actorId: els.playerActor.value, level: inputNumber(els.playerLevel, 1), hp: Math.max(1, inputNumber(els.playerHp, 100)),
      atk: Math.max(0, inputNumber(els.playerAtk, 10)), def: Math.max(0, inputNumber(els.playerDef, 0)), interval: Math.max(.05, inputNumber(els.playerInterval, 1)),
      skillPower: Math.max(1, inputNumber(els.skillPower, 100)), crit: clamp(inputNumber(els.playerCrit, 0), 0, 100), hit: clamp(inputNumber(els.playerHit, 0), -100, 100),
      dodge: clamp(inputNumber(els.playerDodge, 0), 0, 100),
      regen: Math.max(0, inputNumber(els.playerRegen, 0)), killHeal: clamp(inputNumber(els.killHeal, 0), 0, 100),
    }
    state.model = {
      minutes: clamp(inputNumber(els.stageMinutes, 10), 1, 1440), iterations: clamp(Math.round(inputNumber(els.iterations, 200)), 1, 2000),
      baseHit: clamp(inputNumber(els.baseHit, 80), -100, 100), hitDice: clamp(inputNumber(els.hitDice, 80), 1, 1000),
      critMultiplier: Math.max(1, inputNumber(els.critMultiplier, 2)), minDamage: Math.max(0, inputNumber(els.minDamage, 1)),
      perLevelGrowth: Math.max(0, inputNumber(els.perLevelGrowth, 1)), attackSpeedBase: Math.max(0, inputNumber(els.attackSpeedBase, 80)),
      mobsPerEncounter: clamp(Math.round(inputNumber(els.mobsPerEncounter, 1)), 1, 100),
    }
  }
  function writeStageOverride() {
    const existing = state.overrides[stageKey(state.selected.r, state.selected.c)] || {}
    state.overrides[stageKey(state.selected.r, state.selected.c)] = {
      ...existing,
      kills: Math.max(1, Math.round(inputNumber(els.stageKills, DEFAULT_STAGE.kills))), spawnDelay: Math.max(0, inputNumber(els.spawnDelay, DEFAULT_STAGE.spawnDelay)),
      travelSeconds: Math.max(0, inputNumber(els.travelSeconds, DEFAULT_STAGE.travelSeconds)), goldMultiplier: Math.max(0, inputNumber(els.goldMultiplier, DEFAULT_STAGE.goldMultiplier)),
      targetClearMinutes: Math.max(.1, inputNumber(els.targetClearMinutes, DEFAULT_STAGE.targetClearMinutes)),
    }
    state.results.delete(stageKey(state.selected.r, state.selected.c))
  }
  function populateActors() {
    els.playerActor.innerHTML = state.playerActors.map((actor) => `<option value="${escapeHtml(actor.id)}">${escapeHtml(actor.name)} · Lv${formatNumber(actor.level)}</option>`).join('')
    if (!state.playerActors.some((actor) => actor.id === state.player.actorId)) {
      const actor = state.playerActors[0]
      state.player.actorId = actor?.id || ''
      if (actor) Object.assign(state.player, pickPlayerStats(actor), { dodge: actor.dodge || 0 })
    }
    syncInputsFromState()
  }
  function selectPlayer(id) {
    const actor = state.actorMap.get(id)
    if (!actor) return
    state.player = { ...state.player, actorId: id, ...pickPlayerStats(actor), dodge: actor.dodge || 0 }
    syncInputsFromState()
    runCurrent(false)
  }
  function runCurrent(render = true) {
    readInputs()
    const result = simulateStage({ cell: currentCell(), actorMap: state.actorMap, player: state.player, model: state.model, stage: currentStage(), seed: currentSeed() })
    state.results.set(stageKey(state.selected.r, state.selected.c), result)
    if (render) { renderMetrics(result); renderMap() }
    return result
  }
  function renderMetrics(result = state.results.get(stageKey(state.selected.r, state.selected.c))) {
    const stage = currentStage()
    if (!result) result = runCurrent(false)
    const assessment = assessResult(result, stage)
    els.metricKills.textContent = formatNumber(result.kills, 1)
    els.metricKph.textContent = `${formatNumber(result.killsPerHour)} / 小时`
    els.metricSurvival.textContent = `${formatNumber(result.survival * 100, 1)}%`
    els.metricDeaths.textContent = `${formatNumber(result.deaths, 2)} 次平均死亡`
    els.metricClear.textContent = formatDuration(result.clearSeconds)
    els.metricTarget.textContent = `目标 ${formatDuration(stage.targetClearMinutes * 60)}`
    els.metricGold.textContent = `${formatNumber(result.goldPerHour)} 金币`
    els.metricExp.textContent = `${formatNumber(result.expPerHour)} 经验`
    els.metricStatus.textContent = assessment.label
    els.metricNote.textContent = assessment.note
    const parent = els.metricStatus.closest('.metric')
    parent.classList.toggle('danger', assessment.level === 'error')
    parent.classList.toggle('warning', assessment.level === 'warning')
    renderStageResult(result, stage, assessment)
  }
  // 本关模拟结果面板：结论 + 关键指标 + 每只怪缩放后的实际属性
  function renderStageResult(result, stage, assessment) {
    if (!els.stageResult) return
    if (els.resultCoord) els.resultCoord.textContent = `R${state.selected.r + 1} C${state.selected.c + 1}`
    if (!result?.valid) {
      els.stageResult.innerHTML = '<div class="result-empty">模拟当前关卡后，这里显示本关完整结果与怪物实际属性。</div>'
      return
    }
    const cell = currentCell()
    const model = state.model
    const rows = (cell.monsters || []).map((entry) => {
      const actor = state.actorMap.get(entry.id)
      if (!actor) return null
      const low = scaledMonster(actor, entry.lvMin || actor.level, model)
      const high = scaledMonster(actor, entry.lvMax || entry.lvMin || actor.level, model)
      const same = low.level === high.level
      const range = (name) => same ? formatNumber(low[name]) : `${formatNumber(low[name])}-${formatNumber(high[name])}`
      const levelText = same ? `Lv${low.level}` : `Lv${low.level}-${high.level}`
      const row = (name, value) => `<span>${name}</span><strong>${value}</strong>`
      return `<div class="result-monster">
        <div class="result-monster-head"><strong>${escapeHtml(actor.name)}</strong><span>${levelText}</span></div>
        <div class="result-monster-stats">
          ${row('生命', range('hp'))}${row('攻击', range('atk'))}${row('防御', range('def'))}
          ${row('间隔', `${formatNumber(low.interval, 2)}s`)}${row('经验', range('rewardExp'))}${row('金币', range('gold'))}
        </div>
      </div>`
    }).filter(Boolean).join('')
    const levelClass = assessment.level === 'error' ? 'error' : assessment.level === 'warning' ? 'warning' : 'ok'
    const ratio = result.clearSeconds ? result.clearSeconds / (stage.targetClearMinutes * 60) : null
    els.stageResult.innerHTML = `
      <div class="result-verdict ${levelClass}"><strong>${escapeHtml(assessment.label)}</strong><span>${escapeHtml(assessment.note)}</span></div>
      <div class="result-grid">
        <span>通关时间</span><strong>${formatDuration(result.clearSeconds)} / 目标 ${formatDuration(stage.targetClearMinutes * 60)}${ratio ? `（${formatNumber(ratio * 100)}%）` : ''}</strong>
        <span>击杀</span><strong>${formatNumber(result.kills, 1)} · ${formatNumber(result.killsPerHour)} / 小时</strong>
        <span>生存率</span><strong>${formatNumber(result.survival * 100, 1)}% · 平均死亡 ${formatNumber(result.deaths, 2)}</strong>
        <span>每小时收益</span><strong>${formatNumber(result.goldPerHour)} 金币 · ${formatNumber(result.expPerHour)} 经验</strong>
      </div>
      <div class="result-monsters">${rows}</div>`
  }
  function heatColor(result, stage) {
    if (!result?.valid) return 'var(--surface-3)'
    const mode = els.heatMode.value
    if (mode === 'survival') return result.survival < .5 ? 'var(--danger)' : result.survival < .85 ? 'var(--orange)' : 'var(--lime)'
    if (mode === 'gold') return result.goldPerHour <= 0 ? 'var(--danger)' : result.goldPerHour < 100 ? 'var(--orange)' : 'var(--cyan)'
    const ratio = result.clearSeconds ? result.clearSeconds / (stage.targetClearMinutes * 60) : 9
    if (mode === 'efficiency') return ratio > 1.2 ? 'var(--danger)' : ratio < .55 ? 'var(--blue)' : 'var(--lime)'
    return ratio > 1.2 ? 'var(--danger)' : ratio > .85 ? 'var(--orange)' : ratio < .55 ? 'var(--blue)' : 'var(--lime)'
  }
  function heatValue(result, stage) {
    if (!result?.valid) return '未验证'
    if (els.heatMode.value === 'survival') return `${formatNumber(result.survival * 100)}%`
    if (els.heatMode.value === 'gold') return `${formatNumber(result.goldPerHour)} /h`
    if (els.heatMode.value === 'efficiency') return result.clearSeconds ? `${formatNumber(result.clearSeconds / (stage.targetClearMinutes * 60) * 100)}%` : '阻塞'
    return formatDuration(result.clearSeconds)
  }
  function iconClass(icon) {
    return state.iconTypes.some((entry) => entry.value === icon) ? `icon--${icon === -1 ? 'n1' : icon}` : 'icon--other'
  }
  function iconResource(icon) {
    const type = state.iconTypes.find((entry) => entry.value === icon)
    return type?.imageGuid ? { imageGuid: type.imageGuid, clip: null } : null
  }
  function shortLevel(range) {
    if (!range) return ''
    return range.min === range.max ? `Lv${range.min}` : `${range.min}-${range.max}`
  }
  async function loadImageBitmap(guid) {
    if (!guid) return null
    if (state.bitmapCache.has(guid)) return state.bitmapCache.get(guid)
    const promise = (async () => {
      const path = state.imagePaths.get(String(guid).toLowerCase())
      if (!path || !state.rootHandle) return null
      const buffer = await readBuffer(state.rootHandle, path)
      return await createImageBitmap(new Blob([buffer]))
    })().catch(() => null)
    state.bitmapCache.set(guid, promise)
    return promise
  }
  function hydratePreviews(container = els.mapGrid) {
    for (const node of container.querySelectorAll('canvas[data-image-guid]')) {
      loadImageBitmap(node.dataset.imageGuid).then((bitmap) => {
        if (!bitmap || !node.isConnected) return
        const context = node.getContext('2d')
        context.clearRect(0, 0, node.width, node.height)
        context.imageSmoothingEnabled = false
        context.drawImage(bitmap, 0, 0, node.width, node.height)
        node.classList.add('loaded')
      })
    }
  }
  function renderMap() {
    const fragment = document.createDocumentFragment()
    const corner = document.createElement('span')
    corner.className = 'grid-corner axis-button'
    corner.textContent = '全'
    fragment.appendChild(corner)
    for (let c = 0; c < COLS; c++) {
      const label = document.createElement('span')
      label.className = 'axis-button'
      label.textContent = String(c + 1)
      fragment.appendChild(label)
    }
    for (let r = 0; r < ROWS; r++) {
      const rowLabel = document.createElement('span')
      rowLabel.className = 'axis-button'
      rowLabel.textContent = String(r + 1)
      fragment.appendChild(rowLabel)
      for (let c = 0; c < COLS; c++) {
        const cell = state.grid[r]?.[c] || emptyCell()
        const key = stageKey(r, c)
        const result = state.results.get(key)
        const selected = r === state.selected.r && c === state.selected.c
        const stage = stageConfig(state.overrides, r, c)
        const landmark = iconResource(cell.icon)
        const heat = result?.valid ? heatColor(result, stage) : ''
        const heatText = result?.valid ? heatValue(result, stage) : ''
        const button = document.createElement('button')
        button.className = `map-cell ${iconClass(cell.icon)}${selected ? ' selected' : ''}${cell.name ? '' : ' empty'}${heat ? ' has-heat' : ''}`
        button.style.setProperty('--heat-color', heat || 'transparent')
        button.dataset.r = r
        button.dataset.c = c
        button.type = 'button'
        button.setAttribute('aria-label', cell.name || `R${r + 1} C${c + 1}`)
        button.innerHTML = `
          ${landmark ? `<span class="cell-landmark"><canvas data-image-guid="${landmark.imageGuid}" width="80" height="80"></canvas></span>` : ''}
          <span class="cell-name">${escapeHtml(cell.name || '·')}</span>
          <span class="cell-icon">${cell.icon}</span>
          ${cell.monsters?.length ? `<span class="cell-monster">${cell.monsters.length}</span>` : ''}
          ${cell.levelRange ? `<span class="cell-level">${escapeHtml(shortLevel(cell.levelRange))}</span>` : ''}
          ${heat ? `<span class="cell-heat" style="--heat-color:${heat}">${escapeHtml(heatText)}</span>` : ''}
          <span class="cell-edge edge-right${cell.Passability?.right ? ' on' : ''}"></span>
          <span class="cell-edge edge-down${cell.Passability?.down ? ' on' : ''}"></span>`
        button.addEventListener('click', () => selectStage(r, c))
        fragment.appendChild(button)
      }
    }
    els.mapGrid.replaceChildren(fragment)
    hydratePreviews()
    renderIconLegend()
  }
  function renderIconLegend() {
    if (!els.iconLegend) return
    els.iconLegend.innerHTML = state.iconTypes.map((entry) => {
      const swatch = entry.imageGuid
        ? `<span class="legend-swatch"><canvas data-image-guid="${entry.imageGuid}" width="20" height="20"></canvas></span>`
        : `<span class="legend-swatch ${iconClass(entry.value)}"></span>`
      return `<span class="legend-chip">${swatch}${entry.value} ${escapeHtml(entry.label)}</span>`
    }).join('')
    hydratePreviews(els.iconLegend)
  }
  function renderStageDetail() {
    const cell = currentCell()
    const stage = currentStage()
    els.selectedStageName.textContent = cell.name || '空关卡'
    els.selectedStageCoord.textContent = `R${state.selected.r + 1} C${state.selected.c + 1}`
    const monsters = cell.monsters || []
    els.monsterCount.textContent = monsters.length
    els.monsterList.innerHTML = monsters.length ? monsters.map((entry) => {
      const actor = state.actorMap.get(entry.id)
      const level = `${entry.lvMin || 1}-${entry.lvMax || entry.lvMin || 1}`
      const override = stage.monsters?.[entry.id] || {}
      return `<div class="monster-row" data-monster-id="${escapeHtml(entry.id)}">
        <div class="monster-summary"><div><strong>${escapeHtml(actor?.name || '未找到角色')}</strong><small>${escapeHtml(entry.id)}</small></div><div class="monster-stats">Lv ${level}${actor ? `<br>HP ${formatNumber(actor.hp)} · ATK ${formatNumber(actor.atk)} · DEF ${formatNumber(actor.def)}` : ''}</div></div>
        <div class="monster-tuning">
          ${monsterTuneField('weight', '权重', finite(override.weight, entry.weight), .1)}
          ${monsterTuneField('hp', '生命 ×', finite(override.hp, 1), .05)}
          ${monsterTuneField('atk', '攻击 ×', finite(override.atk, 1), .05)}
          ${monsterTuneField('def', '防御 ×', finite(override.def, 1), .05)}
          ${monsterTuneField('exp', '经验 ×', finite(override.exp, 1), .05)}
          ${monsterTuneField('gold', '金币 ×', finite(override.gold, 1), .05)}
        </div>
      </div>`
    }).join('') : '<div class="empty-state">该格没有配置刷怪角色。</div>'
    syncInputsFromState()
  }
  function monsterTuneField(key, label, value, step) {
    return `<label><span>${label}</span><input data-monster-field="${key}" type="number" min="0" step="${step}" value="${value}"></label>`
  }
  function updateMonsterOverride(target) {
    const row = target.closest('.monster-row')
    if (!row?.dataset.monsterId) return
    const key = stageKey(state.selected.r, state.selected.c)
    const existing = state.overrides[key] || {}
    const monsters = clone(existing.monsters || {})
    monsters[row.dataset.monsterId] = {
      ...(monsters[row.dataset.monsterId] || {}),
      [target.dataset.monsterField]: Math.max(0, finite(target.value, target.dataset.monsterField === 'weight' ? 1 : 1)),
    }
    state.overrides[key] = { ...existing, monsters }
    state.results.delete(key)
    renderMetrics(runCurrent(false))
    renderMap()
  }
  function selectStage(r, c) {
    state.selected = { r, c }
    renderStageDetail()
    renderMetrics(runCurrent(false))
    renderMap()
  }
  function renderAll() {
    els.dataStatus.textContent = `${state.source} · ${routeFromGrid(state.grid).length} 个地点 · ${combatRouteFromGrid(state.grid).length} 个战斗关卡 · ${state.actors.length} 个角色`
    renderMap(); renderStageDetail(); renderMetrics(runCurrent(false)); renderCompare()
  }
  async function runAll() {
    readInputs()
    els.runAll.disabled = true
    els.runAll.textContent = '正在体检…'
    const issues = []
    const stages = combatRouteFromGrid(state.grid)
    for (let index = 0; index < stages.length; index++) {
      const entry = stages[index]
      const stage = stageConfig(state.overrides, entry.r, entry.c)
      const result = simulateStage({ cell: entry.cell, actorMap: state.actorMap, player: state.player, model: { ...state.model, iterations: Math.min(100, state.model.iterations) }, stage, seed: `${state.source}:${entry.r}:${entry.c}` })
      state.results.set(stageKey(entry.r, entry.c), result)
      const assessment = assessResult(result, stage)
      if (assessment.level !== 'healthy') issues.push({ ...entry, assessment, result })
      if (index % 5 === 0) { renderMap(); await new Promise((resolve) => setTimeout(resolve, 0)) }
    }
    renderMap(); renderMetrics()
    renderIssues(issues)
    els.runAll.disabled = false
    els.runAll.textContent = '运行全图体检'
    els.simulationStatus.textContent = `已体检 ${stages.length} 关 · ${issues.length} 项需关注`
  }
  function renderIssues(issues) {
    const severity = { error: 0, warning: 1, healthy: 2 }
    issues.sort((a, b) => severity[a.assessment.level] - severity[b.assessment.level])
    els.issueCount.textContent = `${issues.length} 项需关注`
    els.issueList.innerHTML = issues.length ? issues.map((issue) => `<button class="issue-item ${issue.assessment.level}" data-r="${issue.r}" data-c="${issue.c}" type="button"><i class="issue-mark"></i><span class="issue-text"><strong>${escapeHtml(issue.cell.name)}</strong><small>${escapeHtml(issue.assessment.label)} · ${escapeHtml(issue.assessment.note)}</small></span><span class="issue-value">${formatDuration(issue.result.clearSeconds)}</span></button>`).join('') : '<div class="empty-state">当前玩家构筑下，全部关卡均在设定阈值内。</div>'
  }

  function snapshot(slot) {
    const result = runCurrent(false)
    state.snapshots[slot] = { name: currentCell().name || `R${state.selected.r + 1} C${state.selected.c + 1}`, player: clone(state.player), model: clone(state.model), stage: clone(currentStage()), result: clone(result) }
    renderCompare()
    toast(`已存为方案 ${slot.toUpperCase()}`)
  }
  function scenarioRows(snapshot) {
    if (!snapshot) return '<div class="empty-state">尚未保存方案</div>'
    const result = snapshot.result
    return [
      ['关卡', snapshot.name], ['攻击 / 生命', `${formatNumber(snapshot.player.atk)} / ${formatNumber(snapshot.player.hp)}`],
      ['平均击杀', formatNumber(result.kills, 1)], ['每小时击杀', formatNumber(result.killsPerHour)],
      ['生存率', `${formatNumber(result.survival * 100, 1)}%`], ['通关时间', formatDuration(result.clearSeconds)],
      ['金币 / 小时', formatNumber(result.goldPerHour)], ['经验 / 小时', formatNumber(result.expPerHour)],
    ].map(([label, value]) => `<div class="scenario-result"><span>${label}</span><strong>${escapeHtml(value)}</strong></div>`).join('')
  }
  function renderCompare() {
    const a = state.snapshots.a
    const b = state.snapshots.b
    els.aState.textContent = a ? a.name : '未保存'; els.bState.textContent = b ? b.name : '未保存'
    els.aResults.innerHTML = scenarioRows(a); els.bResults.innerHTML = scenarioRows(b)
    if (!a || !b) { els.deltaResults.innerHTML = '<div class="empty-state">需要同时保存 A 和 B</div>'; return }
    const metrics = [
      ['攻击', b.player.atk - a.player.atk, ''], ['生命', b.player.hp - a.player.hp, ''],
      ['击杀 / 小时', b.result.killsPerHour - a.result.killsPerHour, ''], ['生存率', (b.result.survival - a.result.survival) * 100, '%'],
      ['通关时间', finite(b.result.clearSeconds) - finite(a.result.clearSeconds), '秒', true],
      ['金币 / 小时', b.result.goldPerHour - a.result.goldPerHour, ''], ['经验 / 小时', b.result.expPerHour - a.result.expPerHour, ''],
    ]
    els.deltaResults.innerHTML = metrics.map(([label, value, unit, reverse]) => {
      const positive = reverse ? value < 0 : value > 0
      const negative = reverse ? value > 0 : value < 0
      const sign = value > 0 ? '+' : ''
      return `<div class="scenario-result ${positive ? 'positive' : negative ? 'negative' : ''}"><span>${label}</span><strong>${sign}${formatNumber(value, 1)}${unit}</strong></div>`
    }).join('')
  }

  function runProgression() {
    readInputs()
    const duration = Math.max(10, inputNumber(els.progressMinutes, 60)) * 60
    let gold = Math.max(0, inputNumber(els.startGold, 0))
    let exp = 0
    let upgradeCost = Math.max(1, inputNumber(els.upgradeCost, 100))
    const costGrowth = Math.max(1, inputNumber(els.upgradeCostGrowth, 1.5))
    const powerGrowth = Math.max(.001, inputNumber(els.upgradePower, 15) / 100)
    const route = combatRouteFromGrid(state.grid)
    let player = clone(state.player)
    let elapsed = 0
    let stageIndex = 0
    let upgrades = 0
    let longestWait = 0
    let lastGrowth = 0
    const events = []
    const segments = []
    const evaluate = (entry, minutes = Math.max(5, Math.min(30, (duration - elapsed) / 60))) => simulateStage({ cell: entry.cell, actorMap: state.actorMap, player, model: { ...state.model, minutes, iterations: Math.min(80, state.model.iterations) }, stage: stageConfig(state.overrides, entry.r, entry.c), seed: `flow:${stageIndex}:${upgrades}` })
    let guard = 0
    while (elapsed < duration && route.length && guard++ < 1000) {
      while (gold >= upgradeCost) {
        gold -= upgradeCost
        const oldCost = upgradeCost
        upgradeCost *= costGrowth
        player.atk *= 1 + powerGrowth
        upgrades++
        longestWait = Math.max(longestWait, elapsed - lastGrowth)
        lastGrowth = elapsed
        events.push({ time: elapsed, type: '升级', detail: `攻击提升至 ${formatNumber(player.atk, 1)}`, value: `-${formatNumber(oldCost)} 金币` })
        segments.push({ start: Math.max(0, elapsed - 1), end: elapsed, type: 'upgrade', label: `+${upgrades}` })
      }
      const entry = route[Math.min(stageIndex, route.length - 1)]
      const result = evaluate(entry)
      const stage = stageConfig(state.overrides, entry.r, entry.c)
      const clearable = result.valid && result.clearSeconds && result.clearRate >= .5 && result.survival >= .35
      if (clearable) {
        const seconds = Math.min(result.clearSeconds, duration - elapsed)
        const start = elapsed
        elapsed += seconds
        gold += result.goldPerHour * seconds / 3600
        exp += result.expPerHour * seconds / 3600
        events.push({ time: elapsed, type: '通关', detail: entry.cell.name, value: `+${formatNumber(result.goldPerHour * seconds / 3600)} 金币` })
        segments.push({ start, end: elapsed, type: 'stage', label: `S${stageIndex + 1}` })
        if (stageIndex < route.length - 1) stageIndex++
        else {
          const farmSeconds = Math.min(60, duration - elapsed)
          gold += result.goldPerHour * farmSeconds / 3600; exp += result.expPerHour * farmSeconds / 3600; elapsed += farmSeconds
        }
      } else {
        const farm = route[Math.max(0, stageIndex - 1)]
        const farmResult = evaluate(farm, 5)
        if (!farmResult.valid || farmResult.goldPerHour <= 0 || upgradeCost <= gold) break
        const wait = Math.min(duration - elapsed, Math.max(1, (upgradeCost - gold) / farmResult.goldPerHour * 3600))
        const start = elapsed
        gold += farmResult.goldPerHour * wait / 3600
        exp += farmResult.expPerHour * wait / 3600
        elapsed += wait
        events.push({ time: elapsed, type: '等待', detail: `在 ${farm.cell.name} 攒下一次升级`, value: `${formatDuration(wait)}` })
        segments.push({ start, end: elapsed, type: 'wait', label: '攒资源' })
        if (wait <= 1) break
      }
    }
    longestWait = Math.max(longestWait, elapsed - lastGrowth)
    const finalEntry = route[Math.min(stageIndex, Math.max(0, route.length - 1))]
    els.flowStage.textContent = finalEntry?.cell.name || '--'
    els.flowCoordinate.textContent = finalEntry ? `R${finalEntry.r + 1} C${finalEntry.c + 1}` : '--'
    els.flowUpgrades.textContent = `${upgrades} 次`; els.flowAttack.textContent = `攻击 ${formatNumber(player.atk, 1)}`
    els.flowGold.textContent = `${formatNumber(gold)} 金币`; els.flowExp.textContent = `${formatNumber(exp)} 经验`
    els.flowWait.textContent = formatDuration(longestWait)
    renderTimeline(segments, events, Math.max(duration, elapsed))
  }
  function renderTimeline(segments, events, duration) {
    els.timelineScale.textContent = `0 → ${formatDuration(duration)}`
    const lanes = [{ label: '关卡推进', filter: (segment) => segment.type === 'stage' }, { label: '资源等待', filter: (segment) => segment.type === 'wait' }, { label: '购买成长', filter: (segment) => segment.type === 'upgrade' }]
    els.timelineChart.innerHTML = lanes.map((lane, index) => `<div class="timeline-lane" style="top:${index * 48}px"><span class="timeline-lane-label">${lane.label}</span>${segments.filter(lane.filter).map((segment) => `<span class="timeline-segment ${segment.type}" style="left:${segment.start / duration * 100}%;width:${Math.max(.4, (segment.end - segment.start) / duration * 100)}%">${escapeHtml(segment.label)}</span>`).join('')}</div>`).join('')
    els.timelineEvents.innerHTML = events.length ? events.map((event) => `<div class="timeline-event"><span>${formatDuration(event.time)}</span><strong>${event.type}</strong><span>${escapeHtml(event.detail)}</span><em>${escapeHtml(event.value)}</em></div>`).join('') : '<div class="empty-state">当前参数没有形成可推进的流程。</div>'
  }

  async function importMapFile(file) {
    if (!file) return
    try {
      const grid = /\.xlsx$/i.test(file.name) ? await workbookGrid(await file.arrayBuffer()) : JSON.parse(await file.text())
      if (!Array.isArray(grid) || grid.length !== ROWS || !grid.every((row) => Array.isArray(row) && row.length === COLS)) throw new Error('地图必须是 10×10 二维数组')
      state.grid = grid; state.source = file.name; state.results.clear()
      const first = combatRouteFromGrid(grid)[0] || routeFromGrid(grid)[0]; if (first) state.selected = { r: first.r, c: first.c }
      renderAll(); toast(`已导入 ${file.name}`)
    } catch (error) { toast(`地图导入失败：${error.message}`, 'error') }
  }
  function exportPlan() {
    readInputs(); writeStageOverride()
    const payload = { schema: 'yami-idle-lab/1', exportedAt: new Date().toISOString(), source: state.source, player: state.player, model: state.model, overrides: state.overrides, grid: state.grid }
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }))
    const link = document.createElement('a'); link.href = url; link.download = '挂机验证方案.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 0)
  }
  async function importPlanFile(file) {
    if (!file) return
    try {
      const payload = JSON.parse(await file.text())
      if (payload.schema !== 'yami-idle-lab/1') throw new Error('不是挂机验证台方案文件')
      state.player = { ...DEFAULT_PLAYER, ...payload.player }; state.model = { ...DEFAULT_MODEL, ...payload.model }; state.overrides = payload.overrides || {}
      if (Array.isArray(payload.grid)) state.grid = payload.grid
      state.source = payload.source || file.name; state.results.clear(); populateActors(); renderAll(); toast('验证方案已导入')
    } catch (error) { toast(`方案导入失败：${error.message}`, 'error') }
  }

  $$('.view-tab').forEach((button) => button.addEventListener('click', () => {
    $$('.view-tab').forEach((entry) => entry.classList.toggle('active', entry === button))
    $$('.view').forEach((view) => view.classList.toggle('active', view.id === `${button.dataset.view}-view`))
  }))
  els.pickProject.addEventListener('click', chooseProject)
  els.restoreProject.addEventListener('click', restoreProject)
  els.importMap.addEventListener('click', () => els.mapInput.click())
  els.mapInput.addEventListener('change', () => { importMapFile(els.mapInput.files?.[0]); els.mapInput.value = '' })
  els.exportPlan.addEventListener('click', exportPlan)
  els.importPlan.addEventListener('click', () => els.planInput.click())
  els.planInput.addEventListener('change', () => { importPlanFile(els.planInput.files?.[0]); els.planInput.value = '' })
  els.folderFallback.addEventListener('change', async () => {
    const files = [...(els.folderFallback.files || [])]
    els.folderFallback.value = ''
    if (!files.length) return
    try { await scanProjectFiles(files) } catch (error) { toast(`读取工程失败：${error.message}`, 'error') }
  })
  els.playerActor.addEventListener('change', () => selectPlayer(els.playerActor.value))
  els.resetPlayer.addEventListener('click', () => selectPlayer(els.playerActor.value))
  els.runStage.addEventListener('click', () => {
    els.runStage.disabled = true
    els.runStage.textContent = '模拟中…'
    setTimeout(() => {
      runCurrent()
      els.runStage.disabled = false
      els.runStage.textContent = '模拟当前关卡'
      const strip = document.querySelector('.result-strip')
      strip.classList.remove('flash')
      void strip.offsetWidth
      strip.classList.add('flash')
      toast('当前关卡模拟完成，结果已刷新')
    }, 50)
  })
  els.runAll.addEventListener('click', runAll)
  els.heatMode.addEventListener('change', renderMap)
  if (els.gridZoom) {
    els.gridZoom.addEventListener('input', () => {
      els.mapGrid.style.setProperty('--cell-size', `${els.gridZoom.value}px`)
      if (els.zoomOutput) els.zoomOutput.value = els.gridZoom.value
    })
  }
  els.snapshotA.addEventListener('click', () => snapshot('a')); els.snapshotB.addEventListener('click', () => snapshot('b'))
  els.runProgression.addEventListener('click', runProgression)
  els.mapGrid.addEventListener('click', (event) => { const cell = event.target.closest('.map-cell'); if (cell) selectStage(Number(cell.dataset.r), Number(cell.dataset.c)) })
  els.issueList.addEventListener('click', (event) => { const item = event.target.closest('.issue-item'); if (item) selectStage(Number(item.dataset.r), Number(item.dataset.c)) })
  els.monsterList.addEventListener('change', (event) => { if (event.target.matches('[data-monster-field]')) updateMonsterOverride(event.target) })
  els.clearStageOverride.addEventListener('click', () => { delete state.overrides[stageKey(state.selected.r, state.selected.c)]; state.results.delete(stageKey(state.selected.r, state.selected.c)); renderStageDetail(); renderMetrics(runCurrent(false)); renderMap() })
  const playerAndModelInputs = [els.playerLevel,els.playerHp,els.playerAtk,els.playerDef,els.playerInterval,els.skillPower,els.playerCrit,els.playerHit,els.playerDodge,els.playerRegen,els.killHeal,els.stageMinutes,els.iterations,els.baseHit,els.hitDice,els.critMultiplier,els.minDamage,els.perLevelGrowth,els.attackSpeedBase,els.mobsPerEncounter]
  playerAndModelInputs.forEach((input) => input.addEventListener('change', () => { readInputs(); state.results.clear(); renderMetrics(runCurrent(false)); renderMap() }))
  ;[els.stageKills,els.spawnDelay,els.travelSeconds,els.goldMultiplier,els.targetClearMinutes].forEach((input) => input.addEventListener('change', () => { writeStageOverride(); renderMetrics(runCurrent(false)); renderMap() }))

  els.progressMinutes.value = 60; els.startGold.value = 0; els.upgradeCost.value = 100; els.upgradeCostGrowth.value = 1.5; els.upgradePower.value = 15
  populateActors(); renderAll(); loadRememberedProject()
}
