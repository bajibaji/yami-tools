'use strict'

/**
 * db-manager.js — Open Yami 数据表局部安全修改器
 * 支持对 Data/*.json（actors, skills, items, equipments, states, teams, variables 等）
 * 进行单项安全增删改（upsert/patch），避免重写整个上万行大文件。
 */

const fs = require('fs')
const path = require('path')
const { resolveInside, sha256, writeAtomic } = require('./file-ops')

/** Data/ 下实际存在的配置表名单 */
const SUPPORTED_TABLES = [
  'plugins',
  'commands',
  'teams',
  'variables',
  'attribute',
  'enumeration',
  'easings',
  'autotiles',
  'config',
  'localization'
]

/**
 * 局部打补丁合并对象（跳过 undefined）
 */
function mergePatch(target, patch) {
  if (!patch || typeof patch !== 'object') return target
  const result = Array.isArray(target) ? [...target] : { ...target }
  for (const [key, val] of Object.entries(patch)) {
    if (val === undefined) continue
    if (val !== null && typeof val === 'object' && !Array.isArray(val) && typeof result[key] === 'object' && !Array.isArray(result[key])) {
      result[key] = mergePatch(result[key], val)
    } else {
      result[key] = val
    }
  }
  return result
}

/**
 * 在变量树中递归查找并修改变量
 */
function updateVariableNode(node, id, patch) {
  if (!node) return false
  if (Array.isArray(node)) {
    for (const child of node) if (updateVariableNode(child, id, patch)) return true
    return false
  }
  if (node.id === id) {
    Object.assign(node, patch)
    return true
  }
  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      if (updateVariableNode(child, id, patch)) return true
    }
  }
  return false
}

/**
 * 在变量树指定父节点下追加新变量
 */
function appendVariableChild(node, parentId, newVar) {
  if (!node) return false
  if (Array.isArray(node)) {
    for (const child of node) if (appendVariableChild(child, parentId, newVar)) return true
    return false
  }
  if (node.id === parentId || (parentId === 'root' && node.class === 'folder')) {
    node.children = node.children || []
    node.children.push(newVar)
    return true
  }
  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      if (appendVariableChild(child, parentId, newVar)) return true
    }
  }
  return false
}

/**
 * 数据表的真实形状与「容器键」（引擎侧结构，不是可编辑的条目）：
 *   · attribute.json   = { settings, keys }        —— 两个都是引擎结构，不是条目
 *   · enumeration.json = { settings, strings }     —— 同上
 *   · config.json      = { gameId, deployed, deadzone, window, resolution, ... } —— 平铺配置，没有条目概念
 *   · teams/variables/easings/autotiles/plugins/commands = list 或数组，条目才有 id
 * 为什么要写死这份表：字典型分支会把 rawData[id] 整个换掉，
 * 传错一个键（比如 attribute 的 settings）就会把引擎结构覆盖成 {__probe:1} —— 实测 dryRun 都放行。
 */
const TABLE_SHAPES = {
  // 属性表/枚举表是**树表**（条目嵌在 keys/strings 的 children 里，引擎只读这个容器：
  // tree-data-context.ts:36）。旧实现把它们当"id 字典"，于是 upsert 会在顶层新增一个
  // "da4d32a4f1097059" 垃圾键、原条目一个字都没改 —— 还返回 ok。
  attribute: { kind: 'tree', containers: ['settings', 'keys'], roots: ['keys'] },
  enumeration: { kind: 'tree', containers: ['settings', 'strings'], roots: ['strings'] },
  config: { kind: 'flat' }
}

/** 树表里按 id 递归找条目（找不到返回 null，绝不在顶层塞键） */
function findTreeEntry(node, id) {
  if (!node || typeof node !== 'object') return null
  if (Array.isArray(node)) {
    for (const item of node) {
      const hit = findTreeEntry(item, id)
      if (hit) return hit
    }
    return null
  }
  if (node.id === id) return node
  for (const key of Object.keys(node)) {
    const value = node[key]
    // 字典形容器（{ <id>: 条目 }）：键本身就是 id，条目里未必再带 id 字段
    if (key === id && value && typeof value === 'object' && !Array.isArray(value)) return value
    if (value && typeof value === 'object') {
      const hit = findTreeEntry(value, id)
      if (hit) return hit
    }
  }
  return null
}

/**
 * 树表新增条目：容器有 children 就挂进去；是数组就 push；是字典（{ <id>: 条目 } / {0: 条目}）
 * 就按 id 写键。三种形状都认 —— 真实工程是数组+children，测试夹具与老工程有字典形。
 */
function appendTreeEntry(container, entry, id) {
  if (!container || typeof container !== 'object') return false
  if (Array.isArray(container)) { container.push(entry); return true }
  if (Array.isArray(container.children)) { container.children.push(entry); return true }
  const keys = Object.keys(container)
  if (keys.length && keys.every(k => container[k] && typeof container[k] === 'object' && !Array.isArray(container[k]))) {
    container[id] = entry
    return true
  }
  for (const key of keys) {
    const value = container[key]
    if (value && typeof value === 'object' && appendTreeEntry(value, entry, id)) return true
  }
  return false
}

class DatabaseManager {
  constructor(projectRoot, guidGenerator) {
    this.root = projectRoot
    this.generateGuid = guidGenerator
  }

  /**
   * 针对指定数据表进行单项增删改
   * @param {Object} options
   * @param {string} options.table 表名（如 'actors', 'skills', 'items', 'variables'）
   * @param {string} [options.id] 目标 ID / GUID
   * @param {Object} options.item 要写入或补丁的数据
   * @param {string} [options.parentId] 变量树专用：父节点 ID
   * @param {boolean} [options.dryRun=true] 是否仅预览
   */
  upsertItem({ table, id, item, parentId, expectedSha256, dryRun = true }) {
    if (!table || typeof table !== 'string') {
      return { ok: false, error: '缺少 table 参数' }
    }
    const cleanTable = table.replace(/\.json$/, '').toLowerCase()
    if (!SUPPORTED_TABLES.includes(cleanTable)) {
      return { ok: false, error: `不支持的数据表: ${table}，仅支持: ${SUPPORTED_TABLES.join(', ')}` }
    }
    if (!item || typeof item !== 'object') {
      return { ok: false, error: '缺少 item 数据对象' }
    }

    const relPath = path.join('Data', `${cleanTable}.json`)
    let absPath
    try { absPath = resolveInside(this.root, relPath) } catch (e) { return { ok: false, error: e.message } }
    if (!fs.existsSync(absPath)) {
      return { ok: false, error: `数据表文件不存在: ${relPath}` }
    }

    let rawData
    let originalText
    try {
      originalText = fs.readFileSync(absPath, 'utf8')
      if (expectedSha256 && sha256(originalText) !== expectedSha256) return { ok: false, conflict: true, error: '数据表已被其他操作修改，请重新读取后再改' }
      rawData = JSON.parse(originalText)
    } catch (e) {
      return { ok: false, error: `读取解析 ${relPath} 失败: ${e.message}` }
    }

    let action = 'updated'
    let targetId = id

    if (cleanTable === 'config' && !id) {
      // config.json 是平铺配置，没有条目概念：把 item 的字段补丁到根对象上
      // （旧实现要求「必须指定 id 键名」，而这表根本没有条目 id —— 等于 AI 换不了任何一项配置）
      const next = mergePatch(rawData, item)
      const outputJson = JSON.stringify(next, null, 2) + '\n'
      if (dryRun !== false) {
        return { ok: true, dryRun: true, action: 'patched', table: cleanTable, path: relPath, oldSha256: sha256(originalText), message: `校验通过：补丁 config 的 ${Object.keys(item).join('、')}（未落盘，dryRun）` }
      }
      try {
        const written = writeAtomic(this.root, relPath, outputJson, { tool: 'upsert_database_item' })
        return { ok: true, dryRun: false, action: 'patched', table: cleanTable, path: relPath, oldSha256: sha256(originalText), ...written, message: `成功落盘更新 ${relPath}：补丁 ${Object.keys(item).join('、')}` }
      } catch (e) {
        return { ok: false, error: `写盘失败: ${e.message}` }
      }
    }
    if (rawData && typeof rawData === 'object' && !Array.isArray(rawData)) {
      const shape = TABLE_SHAPES[cleanTable]
      const containers = (shape && shape.containers) || []
      if (targetId && containers.includes(targetId)) {
        return { ok: false, error: `「${targetId}」是 ${cleanTable} 的引擎结构键（容器），不是可编辑的条目；写它会覆盖整块结构。改这里的子字段请用 read_resource 的 key 参数读出结构后再决定` }
      }
    }    if (cleanTable === 'variables') {
      // 变量树处理
      if (targetId) {
        const found = updateVariableNode(rawData, targetId, item)
        if (!found) {
          return { ok: false, error: `未在变量树中找到 ID 为 ${targetId} 的变量` }
        }
      } else {
        targetId = this.generateGuid()
        const newVar = {
          id: targetId,
          name: item.name || '新变量',
          value: item.value !== undefined ? item.value : 0,
          // sort 必须有：运行时 Variable.unpack 是 groups[item.sort].push(item)（variable.ts:85），
          // 缺了它 groups[undefined] 直接抛 TypeError，而 Variable.initialize 在启动流程里（main.ts:54）
          // → 新建一个没有 sort 的变量 = 游戏起不来。编辑器自己建变量也是带 sort:0 + note:'' 的
          // （Script/variable/list-methods.ts:53-60），两条通道必须同形状。
          sort: item.sort !== undefined ? item.sort : 0,
          note: item.note !== undefined ? item.note : '',
          ...item
        }
        const appended = parentId === undefined && Array.isArray(rawData)
          ? (rawData.push(newVar), true)
          : appendVariableChild(rawData, parentId || 'root', newVar)
        if (!appended) {
          if (Array.isArray(rawData.children)) {
            rawData.children.push(newVar)
          } else {
            return { ok: false, error: `未找到指定的父节点 ${parentId}` }
          }
        }
        action = 'created'
      }
    } else if (Array.isArray(rawData) || (rawData && Array.isArray(rawData.list))) {
      // 数组型数据表（plugins, commands 等）或带 list 的表（teams）
      const list = Array.isArray(rawData) ? rawData : rawData.list
      let foundIndex = -1
      if (targetId) {
        foundIndex = list.findIndex(x => x && (x.id === targetId || x.guid === targetId))
      }

      if (foundIndex !== -1) {
        list[foundIndex] = mergePatch(list[foundIndex], item)
        action = 'updated'
      } else {
        if (!targetId) targetId = this.generateGuid()
        const newItem = {
          id: targetId,
          name: item.name || `新${cleanTable}`,
          ...item
        }
        list.push(newItem)
        action = 'created'
      }
    } else if (typeof rawData === 'object') {
      const shape = TABLE_SHAPES[cleanTable] || {}
      if (shape.kind === 'tree') {
        // 树表（属性表/枚举表）：按 id 在 keys/strings 树里找，找到就合并，找不到才新建
        if (!targetId) targetId = this.generateGuid()
        const found = findTreeEntry(rawData, targetId)
        if (found) {
          Object.assign(found, mergePatch(found, item))
          action = 'updated'
        } else {
          const entry = { id: targetId, name: item.name || `新${cleanTable}`, ...item }
          let appended = false
          for (const rootKey of (shape.roots || [])) {
            if (rawData[rootKey] && appendTreeEntry(rawData[rootKey], entry, targetId)) { appended = true; break }
          }
          if (!appended) return { ok: false, error: `表 ${cleanTable} 的 ${(shape.roots || []).join('/')} 结构不认识，未写入（请先用 read_resource 查看结构）` }
          action = 'created'
        }
      } else {
        // 字典型对象表（目前没有这类表；保留兜底：必须显式给 id，绝不凭空造顶层键）
        if (!targetId) {
          return { ok: false, error: `表 ${cleanTable} 为字典结构，必须指定 id 键名` }
        }
        if (rawData[targetId]) {
          rawData[targetId] = mergePatch(rawData[targetId], item)
          action = 'updated'
        } else {
          rawData[targetId] = item
          action = 'created'
        }
      }
    }

    const outputJson = JSON.stringify(rawData, null, 2) + '\n'

    if (dryRun !== false) {
      return {
        ok: true,
        dryRun: true,
        action,
        table: cleanTable,
        id: targetId,
        path: relPath,
        oldSha256: sha256(originalText),
        message: `校验通过：${action === 'created' ? '新增' : '更新'} ${cleanTable} [${targetId}]（未落盘，dryRun）`,
        preview: outputJson.slice(0, 500) + (outputJson.length > 500 ? '\n... (省略后续内容)' : '')
      }
    }

    try {
      const written = writeAtomic(this.root, relPath, outputJson, { tool: 'upsert_database_item' })
      return {
        ok: true,
        dryRun: false,
        action,
        table: cleanTable,
        id: targetId,
        path: relPath,
        oldSha256: sha256(originalText),
        ...written,
        message: `成功落盘更新 ${relPath}：${action === 'created' ? '新增' : '更新'} [${targetId}]`
      }
    } catch (e) {
      return { ok: false, error: `写盘失败: ${e.message}` }
    }
  }
}

module.exports = DatabaseManager
