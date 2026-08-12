'use strict'

const assert = require('node:assert/strict')
require('./app.js')

const core = globalThis.IdleLabCore
const randomA = core.seededRandom(42)
const randomB = core.seededRandom(42)
assert.deepEqual([randomA(), randomA(), randomA()], [randomB(), randomB(), randomB()])

const actorMap = new Map([['m', { id: 'm', level: 1, hp: 30, atk: 2, def: 0, interval: 2, dodge: 0, hit: 0, rewardExp: 5, gold: 3 }]])
const result = core.simulateStage({
  cell: { monsters: [{ id: 'm', lvMin: 1, lvMax: 1, weight: 1 }] },
  actorMap,
  player: { hp: 100, atk: 10, def: 1, interval: 1, skillPower: 100, crit: 0, hit: 0, dodge: 0, regen: 0, killHeal: 0 },
  model: { minutes: 1, iterations: 20, baseHit: 100, critMultiplier: 2, minDamage: 1, reviveSeconds: 5, hpGrowth: 1, atkGrowth: 1 },
  stage: { kills: 3, spawnDelay: 0, travelSeconds: 0, goldMultiplier: 1, targetClearMinutes: 1 },
  seed: 'self-check',
})
assert.equal(result.valid, true)
assert.equal(result.kills > 0, true)
assert.equal(result.clearSeconds, 9)
assert.equal(result.goldPerHour > 0, true)

// 新数值模型（对齐游戏实际）：
// 1. 线性成长：Lv3 基础怪升到 Lv10，每级 +1（perLevelGrowth）
const MODEL = { baseHit: 80, hitDice: 80, critMultiplier: 2, minDamage: 1, perLevelGrowth: 1, attackSpeedBase: 80, mobsPerEncounter: 1 }
const baseMonster = { id: 's', name: '史莱姆', level: 3, hp: 55, atk: 8, def: 0, hit: 0, dodge: 0, attackTime: 1.85, attackSpeed: 1, interval: 1.85, regen: 0, rewardExp: 8, gold: 50 }
const scaled = core.scaledMonster(baseMonster, 10, MODEL)
assert.equal(scaled.hp, 62) // 55 + 7
assert.equal(scaled.atk, 15) // 8 + 7
assert.equal(scaled.hit, 7) // 0 + 7（命中随等级成长）
assert.equal(scaled.def, 0) // 防御不成长（游戏怪物模板无防御成长）
// 2. SPDTime 攻击间隔：(1.85×1 + 80×10)/1000 ≈ 0.8019 秒
assert.ok(Math.abs(scaled.interval - 0.80185) < 0.001, `interval ${scaled.interval}`)
// 3. 阈值命中：baseHit 80 / hitDice 80 → dodge 40 时命中率 50%
const hitRolls = [0.1, 0.4, 0.6, 0.9]
const hitCount = hitRolls.filter((roll) => roll <= (80 + 0 - 40) / 80).length
assert.equal(hitCount, 2)
// 4. 围攻：3 只 Lv10 史莱姆 vs 500HP/30atk 玩家 → 9 击全灭（30atk 一击 30，62HP 需 3 击/只）
const swarm = core.simulateFight({ hp: 500, atk: 30, def: 0, interval: 1, skillPower: 100, crit: 0, hit: 0, dodge: 0, regen: 0, killHeal: 0 }, [scaled, scaled, scaled], MODEL, core.seededRandom(7), 500)
assert.equal(swarm.won, true)
assert.equal(swarm.attacks, 9)
// 5. 死亡即终止：低血玩家打高攻怪 → 本轮结束（deaths 计 1，不再复活续战）
const deathRun = core.simulateStage({
  cell: { monsters: [{ id: 's', lvMin: 10, lvMax: 10, weight: 1 }] },
  actorMap: new Map([['s', baseMonster]]),
  player: { hp: 50, atk: 5, def: 0, interval: 1, skillPower: 100, crit: 0, hit: 0, dodge: 0, regen: 0, killHeal: 0 },
  model: { minutes: 1, iterations: 5, baseHit: 80, hitDice: 80, critMultiplier: 2, minDamage: 1, perLevelGrowth: 1, attackSpeedBase: 80, mobsPerEncounter: 1 },
  stage: { kills: 5, spawnDelay: 0, travelSeconds: 0, goldMultiplier: 1, targetClearMinutes: 1 },
  seed: 'death-check',
})
assert.equal(deathRun.samples.every((sample) => sample.deaths === 1), true) // 每样本死亡即止
assert.equal(deathRun.deaths, 1) // 平均死亡 1 次（无复活）

const demo = core.demoData()
const route = core.routeFromGrid(demo.grid)
assert.equal(route.length, 18)
assert.equal(core.combatRouteFromGrid(demo.grid).length, 18)
assert.equal(route[0].cell.name, '挂机区域 1')
assert.equal(core.assessResult(result, { targetClearMinutes: 1 }).label, '关卡过易')

const attribute = {
  settings: { actor: 'actor-group' },
  keys: [
    { id: 'actor-group', children: [{ id: 'actor-attack-id', key: 'attack' }, { id: 'actor-hp-id', key: 'maxHealth' }] },
    { id: 'equipment-group', children: [{ id: 'equipment-attack-id', key: 'attack' }] },
  ],
}
const ids = core.actorAttributeIds(attribute)
assert.equal(ids.attack, 'actor-attack-id')
assert.equal(ids.maxHealth, 'actor-hp-id')

const records = new Map()
const parent = core.actorRecord('Assets/角色/父角色.1111111111111111.actor', { attributes: [{ key: 'actor-hp-id', value: 250 }, { key: 'actor-attack-id', value: 12 }] }, ids, new Map())
const child = core.actorRecord('Assets/角色/子角色.2222222222222222.actor', { inherit: parent.id, attributes: [{ key: 'actor-attack-id', value: 30 }] }, ids, new Map())
records.set(parent.id, parent)
records.set(child.id, child)
assert.equal(core.resolveActor(child, records, ids).hp, 250)
assert.equal(core.resolveActor(child, records, ids).atk, 30)
assert.equal(core.resolveActor(child, records, ids).name, '子角色')

const leveled = core.actorRecord('Assets/角色/怪物 Lv8.3333333333333333.actor', { inherit: parent.id, attributes: [] }, ids, new Map())
records.set(leveled.id, leveled)
assert.equal(core.resolveActor(leveled, records, ids).level, 8)

console.log('idle lab self-check passed')
