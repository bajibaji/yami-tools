/*
@plugin #plugin
@version 1.1
@desc #desc

@option operation {'info', 'actors', 'count', 'contains', 'setPosition', 'setSize', 'setEnabled', 'follow', 'unfollow', 'clampCamera', 'unclampCamera'}
@alias #operation {#info, #actors, #count, #contains, #setPosition, #setSize, #setEnabled, #follow, #unfollow, #clampCamera, #unclampCamera}
@default 'info'

@string regionId
@alias #regionId
@desc #regionIdDesc

@actor-getter actor
@alias #actor
@cond operation {'contains', 'follow'}

@number x
@alias #x
@cond operation {'setPosition'}
@default 0

@number y
@alias #y
@cond operation {'setPosition'}
@default 0

@number width
@alias #width
@cond operation {'setSize'}
@default 100

@number height
@alias #height
@cond operation {'setSize'}
@default 100

@boolean enabled
@alias #enabled
@cond operation {'setEnabled'}
@default true

@number offsetX
@alias #offsetX
@cond operation {'follow'}
@default 0

@number offsetY
@alias #offsetY
@cond operation {'follow'}
@default 0

@variable-setter result
@alias #result
@cond operation {'info', 'actors', 'count', 'contains'}

@lang zh
#plugin 区域工具箱
#desc 场景区域全能工具：支持信息/角色/包含判定查询，动态修改位置与尺寸，区域启用开关，角色跟随绑定，以及摄像机视野边界锁定。
#operation 操作类型
#info 获取区域信息
#actors 获取区内角色列表
#count 获取区内角色数量
#contains 判断角色是否在区域内
#setPosition 设置区域位置 (X/Y)
#setSize 设置区域尺寸 (宽/高)
#setEnabled 切换区域启用状态
#follow 绑定跟随目标角色
#unfollow 解除角色跟随
#clampCamera 锁定摄像机边界至该区域
#unclampCamera 解除摄像机边界锁定
#regionId 区域预设 ID
#regionIdDesc 留空使用当前事件的触发区域。可从 DanJuan 区域工作台一键插入或复制。
#actor 目标角色
#x 水平坐标 (X)
#y 垂直坐标 (Y)
#width 宽度
#height 高度
#enabled 启用状态
#offsetX 跟随偏移 X
#offsetY 跟随偏移 Y
#result 结果变量
*/

export default class DanJuanRegionTools implements Script<Command> {
  operation!: 'info' | 'actors' | 'count' | 'contains' | 'setPosition' | 'setSize' | 'setEnabled' | 'follow' | 'unfollow' | 'clampCamera' | 'unclampCamera'
  regionId!: string
  actor!: Actor | undefined
  x!: number
  y!: number
  width!: number
  height!: number
  enabled!: boolean
  offsetX!: number
  offsetY!: number
  result!: VariableSetter

  call(): void {
    // 摄像机全局操作（无需指定区域即可解锁）
    if (this.operation === 'unclampCamera') {
      if (typeof (globalThis as any).Camera?.unclamp === 'function') {
        (globalThis as any).Camera.unclamp()
      }
      return
    }

    const candidate = this.regionId
      ? Scene.entity.get(this.regionId)
      : CurrentEvent.triggerRegion
    const region = candidate instanceof SceneRegion && !candidate.destroyed && candidate.parent
      ? candidate : null

    // 摄像机边界锁定
    if (this.operation === 'clampCamera') {
      if (region && typeof (globalThis as any).Camera?.clamp === 'function') {
        const left = Math.round(region.x - region.width / 2)
        const top = Math.round(region.y - region.height / 2)
        const right = Math.round(region.x + region.width / 2)
        const bottom = Math.round(region.y + region.height / 2)
        ;(globalThis as any).Camera.clamp(left, top, right, bottom)
      }
      return
    }

    // 动态修改位置
    if (this.operation === 'setPosition') {
      if (region) {
        region.x = Number(this.x) || 0
        region.y = Number(this.y) || 0
      }
      return
    }

    // 动态修改尺寸
    if (this.operation === 'setSize') {
      if (region) {
        region.width = Math.max(1, Number(this.width) || 1)
        region.height = Math.max(1, Number(this.height) || 1)
      }
      return
    }

    // 动态切换启用状态
    if (this.operation === 'setEnabled') {
      if (region) {
        const isEnabled = this.enabled !== false
        ;(region as any).enabled = isEnabled
        if (!isEnabled && region.actors) {
          region.actors.length = 0
        }
        if (!(region as any).__danjuanHooked) {
          ;(region as any).__danjuanHooked = true
          const origUpdate = region.update
          region.update = function(deltaTime: number) {
            if ((this as any).enabled === false) return
            return origUpdate.call(this, deltaTime)
          }
        }
      }
      return
    }

    // 绑定角色跟随
    if (this.operation === 'follow') {
      if (region && this.actor && !this.actor.destroyed) {
        const target = this.actor
        const ox = Number(this.offsetX) || 0
        const oy = Number(this.offsetY) || 0
        region.x = target.x + ox
        region.y = target.y + oy
        let followMod = (region as any).__danjuanFollowModule
        if (!followMod) {
          followMod = {
            region,
            target,
            ox,
            oy,
            update() {
              if (this.target && !this.target.destroyed && this.target.parent) {
                this.region.x = this.target.x + this.ox
                this.region.y = this.target.y + this.oy
              } else {
                this.region.updaters?.remove?.(this)
                delete (this.region as any).__danjuanFollowModule
              }
            }
          }
          ;(region as any).__danjuanFollowModule = followMod
          region.updaters.append(followMod)
        } else {
          followMod.target = target
          followMod.ox = ox
          followMod.oy = oy
        }
      }
      return
    }

    // 解除角色跟随
    if (this.operation === 'unfollow') {
      if (region && (region as any).__danjuanFollowModule) {
        const mod = (region as any).__danjuanFollowModule
        region.updaters?.remove?.(mod)
        delete (region as any).__danjuanFollowModule
      }
      return
    }

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
        value = region ? {
          available: true,
          name: region.name,
          presetId: region.presetId,
          x: region.x,
          y: region.y,
          width: region.width,
          height: region.height,
          left: Math.round(region.x - region.width / 2),
          top: Math.round(region.y - region.height / 2),
          right: Math.round(region.x + region.width / 2),
          bottom: Math.round(region.y + region.height / 2),
          actorCount: actors().length
        } : { available: false }
        break
      case 'actors': {
        const list = actors()
        for (const item of list) {
          if (item && typeof (item as any).toJSON !== 'function') {
            try {
              Object.defineProperty(item, 'toJSON', {
                value: function() {
                  return {
                    entityId: (this as any).entityId,
                    presetId: (this as any).presetId,
                    name: (this as any).name,
                    x: (this as any).x,
                    y: (this as any).y
                  }
                },
                configurable: true,
                writable: true,
                enumerable: false
              })
            } catch (_) {}
          }
        }
        value = list
        break
      }
      case 'count': value = actors().length; break
      case 'contains': value = this.actor ? inside(this.actor) : false; break
    }
    if (this.result && typeof this.result.set === 'function') this.result.set(value)
  }
}
