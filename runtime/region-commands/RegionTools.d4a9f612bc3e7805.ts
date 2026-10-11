/*
@plugin #plugin
@version 1.0
@desc #desc

@option operation {'info', 'actors', 'count', 'contains'}
@alias #operation {#info, #actors, #count, #contains}
@default 'info'

@string regionId
@alias #regionId
@desc #regionIdDesc

@actor-getter actor
@alias #actor
@cond operation {'contains'}

@variable-setter result
@alias #result

@lang zh
#plugin 区域工具
#desc 查询场景区域。区域不存在时信息标注 available 为 false，角色列表为空，数量为 0，包含判断为 false。
#operation 操作
#info 获取区域信息
#actors 获取区内角色列表
#count 获取区内角色数量
#contains 判断角色是否在区域内
#regionId 区域预设 ID
#regionIdDesc 留空使用当前事件的触发区域。可从 DanJuan 区域工具复制选中区域 ID。
#actor 目标角色
#result 结果变量
*/

export default class DanJuanRegionTools implements Script<Command> {
  operation!: 'info' | 'actors' | 'count' | 'contains'
  regionId!: string
  actor!: Actor | undefined
  result!: VariableSetter

  call(): void {
    const candidate = this.regionId
      ? Scene.entity.get(this.regionId)
      : CurrentEvent.triggerRegion
    const region = candidate instanceof SceneRegion && !candidate.destroyed && candidate.parent
      ? candidate : null
    const inside = (actor: Actor): boolean => !!region && !!actor && !actor.destroyed && actor.active &&
      actor.parent === region.parent!.scene.actor &&
      actor.x >= region.x - region.width / 2 && actor.x < region.x + region.width / 2 &&
      actor.y >= region.y - region.height / 2 && actor.y < region.y + region.height / 2
    // 使用引擎分区查询当前坐标，避免读取上一帧的 region.actors 缓存。
    const actors = (): Actor[] => {
      if (!region) return []
      const cells = region.parent!.scene.actor.partition.get(
        region.x - region.width / 2, region.y - region.height / 2,
        region.x + region.width / 2, region.y + region.height / 2)
      const found = new Set<Actor>()
      for (let i = 0; i < cells.count; i++) for (const actor of cells[i]!) if (inside(actor)) found.add(actor)
      return [...found]
    }
    let value: AttributeValue = { available: false }
    switch (this.operation) {
      case 'info':
        value = region ? { available: true, name: region.name, presetId: region.presetId,
          x: region.x, y: region.y, width: region.width, height: region.height,
          actorCount: actors().length } : { available: false }
        break
      case 'actors': value = actors(); break
      case 'count': value = actors().length; break
      case 'contains': value = this.actor ? inside(this.actor) : false; break
    }
    if (this.result && typeof this.result.set === 'function') this.result.set(value)
  }
}
