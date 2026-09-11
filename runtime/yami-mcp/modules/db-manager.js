'use strict'

/**
 * db-manager.js — Open Yami 数据表局部安全修改器
 * 支持对 Data/*.json（actors, skills, items, equipments, states, teams, variables 等）
 * 进行单项安全增删改（upsert/patch），避免重写整个上万行大文件。
 */

const fs = require('fs')
const path = require('path')
const { resolveInside, writeAtomic } = require('./file-ops')

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
  upsertItem({ table, id, item, parentId, dryRun = true }) {
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
    try {
      rawData = JSON.parse(fs.readFileSync(absPath, 'utf8'))
    } catch (e) {
      return { ok: false, error: `读取解析 ${relPath} 失败: ${e.message}` }
    }

    let action = 'updated'
    let targetId = id

    if (cleanTable === 'variables') {
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
          ...item
        }
        const appended = appendVariableChild(rawData, parentId || 'root', newVar)
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
      // 字典型对象表（如 enumeration, attribute 等）
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

    const outputJson = JSON.stringify(rawData, null, 2) + '\n'

    if (dryRun !== false) {
      return {
        ok: true,
        dryRun: true,
        action,
        table: cleanTable,
        id: targetId,
        path: relPath,
        message: `校验通过：${action === 'created' ? '新增' : '更新'} ${cleanTable} [${targetId}]（未落盘，dryRun）`,
        preview: outputJson.slice(0, 500) + (outputJson.length > 500 ? '\n... (省略后续内容)' : '')
      }
    }

    try {
      const written = writeAtomic(this.root, relPath, outputJson)
      return {
        ok: true,
        dryRun: false,
        action,
        table: cleanTable,
        id: targetId,
        path: relPath,
        ...written,
        message: `成功落盘更新 ${relPath}：${action === 'created' ? '新增' : '更新'} [${targetId}]`
      }
    } catch (e) {
      return { ok: false, error: `写盘失败: ${e.message}` }
    }
  }
}

module.exports = DatabaseManager
