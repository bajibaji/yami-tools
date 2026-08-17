/* 存档台 · save-lab v0.1.0
 * 读取 Yami 游戏工程 Save 目录，格式化查看存档 JSON，
 * 把 GUID/键名注解成游戏内中文名称与图片，支持编辑写回（自动备份）。
 * 工程位置与 yami-tools 其他工具联动（IndexedDB loot-smith-settings / last-project-handle）。
 */
(() => {
  'use strict'

  // ---------- 小工具 ----------
  const $ = (id) => document.getElementById(id)
  const els = {
    projectState: $('project-state'),
    restoreProject: $('restore-project'),
    pickProject: $('pick-project'),
    btnRefresh: $('btn-refresh'),
    folderFallback: $('folder-fallback'),
    saveList: $('save-list'),
    saveDirPath: $('save-dir-path'),
    chkAnnotate: $('chk-annotate'),
    chkExpand: $('chk-expand'),
    fileInfo: $('file-info'),
    metaPreview: $('meta-preview'),
    viewer: $('viewer'),
    editArea: $('edit-area'),
    editText: $('edit-text'),
    sourceArea: $('source-area'),
    sourceText: $('source-text'),
    btnSource: $('btn-source'),
    searchInput: $('search-input'),
    searchCount: $('search-count'),
    searchPrev: $('search-prev'),
    searchNext: $('search-next'),
    btnCopy: $('btn-copy'),
    btnEdit: $('btn-edit'),
    btnSave: $('btn-save'),
    btnCancelEdit: $('btn-cancel-edit'),
    statusText: $('status-text'),
    toastRegion: $('toast-region'),
  }

  const state = {
    root: null,            // FileSystemDirectoryHandle | null
    virtual: null,         // fallback 模式虚拟文件树 { path: File }
    rootName: '',
    saveEntries: [],       // Save 目录文件 { name, size, lastModified, kind }
    selected: null,        // { name, text, json, isJson }
    viewMode: 'tree',      // 'tree' | 'source' | 'edit'
    searchMatches: [],     // 搜索匹配位置（源码文本偏移）
    searchIndex: -1,
    meta: null,            // 工程元数据映射
    pollTimer: null,
    pollSnapshot: new Map(),
  }

  // ---------- Toast ----------
  function toast(message, kind = '') {
    const node = document.createElement('div')
    node.className = `toast ${kind}`
    node.textContent = message
    els.toastRegion.appendChild(node)
    setTimeout(() => node.remove(), 3600)
  }

  function setStatus(text) { els.statusText.textContent = text }

  // ---------- 工程记忆（与其他工具同库同键联动） ----------
  let settingsDatabasePromise = null
  function openSettingsDatabase() {
    if (settingsDatabasePromise) return settingsDatabasePromise
    settingsDatabasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open('loot-smith-settings', 1)
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains('settings')) request.result.createObjectStore('settings')
      }
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

  // ---------- 工程加载 ----------
  async function rememberRoot(root) { try { await setting('last-project-handle', root) } catch {} }

  async function restoreLastProject() {
    let root
    try { root = await setting('last-project-handle') } catch {}
    if (!root) { toast('没有找到上次的工程记录', 'error'); return }
    try {
      let permission = await root.queryPermission({ mode: 'readwrite' })
      if (permission !== 'granted') permission = await root.requestPermission({ mode: 'readwrite' })
      if (permission !== 'granted') { toast('上次工程授权已失效，请重新选择', 'error'); return }
      await setupRoot(root)
    } catch (error) {
      console.warn(error)
      toast('读取上次工程失败：' + error.message, 'error')
    }
  }

  async function pickProject() {
    try {
      const root = await window.showDirectoryPicker({ mode: 'readwrite' })
      await setupRoot(root)
    } catch (error) {
      if (error && error.name === 'AbortError') return
      console.warn(error)
      toast('选择工程失败：' + error.message, 'error')
    }
  }

  async function setupRoot(root) {
    state.root = root
    state.virtual = null
    state.rootName = root.name
    await rememberRoot(root)
    els.pickProject.textContent = '切换工程'
    els.restoreProject.classList.add('hidden')
    await scanProject()
  }

  // fallback：无 File System Access API 时的文件夹导入（只读）
  async function pickFallback(files) {
    // webkitRelativePath 首段是所选目录名（如 yami-save-lab-e2e/Save/save00.save），
    // 去掉后才是工程内相对路径（与 localization-lab 同规则）
    const rel = (file) => { const p = file.webkitRelativePath || file.name || ''; const i = p.indexOf('/'); return i === -1 ? p : p.slice(i + 1) }
    const virtual = {}
    for (const file of files) virtual[rel(file)] = file
    const saveFiles = Object.keys(virtual).filter((p) => /(^|\/)Save\//.test(p))
    if (saveFiles.length === 0) {
      toast('未在导入的文件夹里找到 Save 目录', 'error')
      return
    }
    const firstPath = files[0] && (files[0].webkitRelativePath || '')
    state.root = null
    state.virtual = virtual
    state.rootName = firstPath.split('/')[0] || '导入工程'
    els.restoreProject.classList.add('hidden')
    els.pickProject.textContent = '导入工程'
    toast('导入模式为只读：可查看与下载修改副本，不能写回', '')
    await scanProject()
  }

  // ---------- 文件读取 ----------
  async function getHandle(root, path) {
    const parts = String(path).split('/').filter(Boolean)
    let directory = root
    for (const part of parts.slice(0, -1)) directory = await directory.getDirectoryHandle(part)
    return directory.getFileHandle(parts.at(-1))
  }
  async function readText(root, path) { return (await (await getHandle(root, path)).getFile()).text() }
  async function readJson(root, path) { return JSON.parse(await readText(root, path)) }

  async function readVirtualText(path) {
    const file = state.virtual[path]
    if (!file) throw new Error(`文件不存在：${path}`)
    return file.text()
  }

  // ---------- 工程扫描 ----------
  const GUID_RE = /[0-9a-f]{16}/i
  const TYPE_NAMES = {
    actors: '角色', skills: '技能', states: '状态', equipments: '装备', items: '物品',
    events: '事件', triggers: '触发器', ui: '界面', scenes: '场景', tilesets: '图块',
    animations: '动画', particles: '粒子', images: '图片', audio: '音频', videos: '视频',
    fonts: '字体', script: '脚本', others: '其他',
  }

  async function scanProject() {
    stopPolling()
    setStatus('正在扫描工程…')
    try {
      const meta = {
        manifest: null,
        guidType: new Map(),   // guid -> { type, path, display }
        attributes: new Map(), // 属性 key -> 中文名
        variables: new Map(),  // 变量 id -> 中文名
        localization: new Map(), // 本地化 id -> 中文名
        teams: new Map(),      // 队伍 id -> 名称
        images: new Map(),     // guid -> path
      }
      if (state.root) {
        const manifest = await readJson(state.root, 'Data/manifest.json').catch(() => null)
        if (manifest) {
          meta.manifest = manifest
          for (const [type, group] of Object.entries(manifest)) {
            if (!Array.isArray(group)) continue
            const typeName = TYPE_NAMES[type] || type
            for (const entry of group) {
              const guid = parsePathGuid(entry.path)
              if (!guid) continue
              meta.guidType.set(guid, { type, typeName, path: entry.path, display: displayName(entry.path) })
              if (type === 'images') meta.images.set(guid, entry.path)
            }
          }
        }
        const [attributeJson, variablesJson, localizationJson, teamsJson] = await Promise.all([
          readJson(state.root, 'Data/attribute.json').catch(() => null),
          readJson(state.root, 'Data/variables.json').catch(() => null),
          readJson(state.root, 'Data/localization.json').catch(() => null),
          readJson(state.root, 'Data/teams.json').catch(() => null),
        ])
        collectAttributeNames(attributeJson, meta.attributes)
        collectVariableNames(variablesJson, meta.variables)
        collectLocalizationNames(localizationJson, meta.localization)
        collectTeamNames(teamsJson, meta.teams)
      } else {
        const manifest = await readVirtualText('Data/manifest.json').then(JSON.parse).catch(() => null)
        if (manifest) {
          meta.manifest = manifest
          for (const [type, group] of Object.entries(manifest)) {
            if (!Array.isArray(group)) continue
            const typeName = TYPE_NAMES[type] || type
            for (const entry of group) {
              const guid = parsePathGuid(entry.path)
              if (!guid) continue
              meta.guidType.set(guid, { type, typeName, path: entry.path, display: displayName(entry.path) })
              if (type === 'images') meta.images.set(guid, entry.path)
            }
          }
        }
        for (const [type, file] of [['attribute', 'Data/attribute.json'], ['variables', 'Data/variables.json'], ['localization', 'Data/localization.json'], ['teams', 'Data/teams.json']]) {
          try {
            const data = JSON.parse(await readVirtualText(file))
            if (type === 'attribute') collectAttributeNames(data, meta.attributes)
            else if (type === 'variables') collectVariableNames(data, meta.variables)
            else if (type === 'localization') collectLocalizationNames(data, meta.localization)
            else collectTeamNames(data, meta.teams)
          } catch {}
        }
      }
      state.meta = meta
      await listSaveFiles()
      renderSaveList()
      startPolling()
      setStatus(`工程已加载：${state.rootName}（Save 目录 ${state.saveEntries.length} 个文件）`)
    } catch (error) {
      console.warn(error)
      setStatus('扫描失败：' + error.message)
      toast('扫描工程失败：' + error.message, 'error')
    }
  }

  function parsePathGuid(path) {
    const match = String(path).match(/\.([0-9a-f]{16})\.\S+$/)
    return match ? match[1] : ''
  }
  function displayName(path) {
    let base = String(path).split('/').pop() || path
    base = base.replace(/\.[0-9a-f]{16}\.\S+$/, '')
    base = base.replace(/^\d+\./, '')
    return base
  }

  function collectAttributeNames(json, map) {
    if (!json || !Array.isArray(json.keys)) return
    ;(function walk(items) {
      for (const item of items) {
        if (item && item.children) walk(item.children)
        else if (item && item.key) {
          if (!map.has(item.key)) map.set(item.key, item.name || item.key)
        }
      }
    })(json.keys)
  }
  function collectVariableNames(json, map) {
    if (!Array.isArray(json)) return
    ;(function walk(items) {
      for (const item of items) {
        if (item && item.children) walk(item.children)
        else if (item && item.id) map.set(item.id, item.name || item.id)
      }
    })(json)
  }
  function collectLocalizationNames(json, map) {
    if (!json || !Array.isArray(json.list)) return
    ;(function walk(items) {
      for (const item of items) {
        if (item && item.children) walk(item.children)
        else if (item && item.id) map.set(item.id, item.name || item.id)
      }
    })(json.list)
  }
  function collectTeamNames(json, map) {
    if (!json || !Array.isArray(json.list)) return
    for (const item of json.list) {
      if (item && item.id) map.set(item.id, item.name || item.id)
    }
  }

  // ---------- Save 目录列表 ----------
  async function listSaveFiles() {
    const entries = []
    if (state.root) {
      try {
        const saveDir = await state.root.getDirectoryHandle('Save', { create: false })
        for await (const [name, handle] of saveDir.entries()) {
          if (handle.kind === 'file') {
            const file = await handle.getFile()
            entries.push({ name, size: file.size, lastModified: file.lastModified })
          }
        }
      } catch {
        entries.length = 0
      }
    } else {
      for (const path of Object.keys(state.virtual)) {
        const match = path.match(/(?:^|\/)Save\/(.+)$/)
        if (!match) continue
        const file = state.virtual[path]
        entries.push({ name: match[1], size: file.size, lastModified: file.lastModified })
      }
    }
    entries.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN', { numeric: true }))
    state.saveEntries = entries
  }

  function saveKind(name) {
    if (/^save\d{2}\.save$/.test(name)) return 'save'
    if (/^save\d{2}\.meta$/.test(name)) return 'meta'
    if (/\.save\.bak$/.test(name)) return 'bak'
    if (/\.save\.tmp$/.test(name)) return 'tmp'
    if (name === 'global.save') return 'global'
    if (/^save\d{2}\.json$/.test(name)) return 'json'
    return 'other'
  }

  function renderSaveList() {
    const groups = [
      ['进度存档', ['save', 'global']],
      ['元数据', ['meta']],
      ['旁路数据', ['json']],
      ['备份文件', ['bak']],
      ['其他文件', ['tmp', 'other']],
    ]
    const html = []
    for (const [title, kinds] of groups) {
      const items = state.saveEntries.filter((e) => kinds.includes(saveKind(e.name)))
      if (items.length === 0) continue
      html.push(`<div class="save-group-title">${title}</div>`)
      for (const entry of items) {
        const kind = saveKind(entry.name)
        html.push(`<div class="save-item" data-name="${escapeAttr(entry.name)}">
          <span class="save-item-name">${escapeHtml(entry.name)}</span>
          <span class="save-item-badges">${badgeHtml(kind, entry.name)}</span>
          <span class="save-item-size">${formatSize(entry.size)}</span>
        </div>`)
      }
    }
    els.saveList.innerHTML = html.join('') || '<div class="empty-state">Save 目录为空或不存在。</div>'
    els.saveDirPath.textContent = state.root ? '工程根 / Save' : '导入模式（只读）'
    els.btnRefresh.disabled = state.saveEntries.length === 0
    for (const item of els.saveList.querySelectorAll('.save-item')) {
      item.addEventListener('click', () => selectSaveFile(item.dataset.name))
    }
  }

  function badgeHtml(kind, name) {
    switch (kind) {
      case 'save': return '<span class="badge badge-v1">存档</span>'
      case 'meta': return '<span class="badge badge-meta">meta</span>'
      case 'json': return '<span class="badge badge-json">json</span>'
      case 'bak': return '<span class="badge badge-bak">bak</span>'
      case 'tmp': return '<span class="badge badge-bak">tmp</span>'
      case 'global': return '<span class="badge badge-v1">全局</span>'
      default: return ''
    }
  }

  function formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B'
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
    return (bytes / 1024 / 1024).toFixed(2) + ' MB'
  }
  function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  }
  function escapeAttr(text) {
    return String(text).replace(/"/g, '&quot;')
  }

  // ---------- 选择存档文件 ----------
  async function selectSaveFile(name) {
    setViewMode('tree')
    const entry = state.saveEntries.find((e) => e.name === name)
    if (!entry) return
    for (const item of els.saveList.querySelectorAll('.save-item')) {
      item.classList.toggle('selected', item.dataset.name === name)
    }
    setStatus(`读取 ${name} …`)
    let text
    try {
      text = state.root ? await readText(state.root, `Save/${name}`) : await readVirtualText(`Save/${name}`)
    } catch (error) {
      console.warn(error)
      setStatus('读取失败')
      toast(`读取 ${name} 失败：${error.message}`, 'error')
      return
    }
    let json = null
    let parseError = null
    try { json = JSON.parse(text) } catch (error) { parseError = error }
    state.selected = { name, text, json, parseError, size: entry.size, lastModified: entry.lastModified }
    state.searchMatches = []
    state.searchIndex = -1
    els.searchInput.value = ''
    els.searchCount.textContent = ''
    els.btnSource.disabled = Boolean(parseError)
    els.btnEdit.disabled = Boolean(parseError)
    els.btnCopy.disabled = false
    renderFileInfo()
    renderMetaPreview()
    renderViewer()
    setStatus(`${name} · ${formatSize(entry.size)} · ${parseError ? 'JSON 解析失败（可能已损坏）' : 'JSON 有效'}`)
  }

  function renderFileInfo() {
    const sel = state.selected
    if (!sel) { els.fileInfo.classList.add('hidden'); return }
    const kind = saveKind(sel.name)
    const versionBadge = sel.json && typeof sel.json.version === 'number'
      ? `<span class="fi"><span class="fi-label">版本</span><span class="fi-value big">v${sel.json.version}${sel.json.version === 2 ? '（稀疏格式）' : ''}</span></span>`
      : ''
    const playTime = sel.json && typeof sel.json.playTime === 'number'
      ? `<span class="fi"><span class="fi-label">游玩时间</span><span class="fi-value">${formatPlayTime(sel.json.playTime)}</span></span>`
      : ''
    const actors = sel.json && Array.isArray(sel.json.actors)
      ? `<span class="fi"><span class="fi-label">角色数</span><span class="fi-value">${sel.json.actors.length}</span></span>`
      : ''
    els.fileInfo.innerHTML = `
      <span class="fi"><span class="fi-label">文件</span><span class="fi-value">${escapeHtml(sel.name)}</span></span>
      <span class="fi"><span class="fi-label">大小</span><span class="fi-value">${formatSize(sel.size)}</span></span>
      <span class="fi"><span class="fi-label">修改时间</span><span class="fi-value">${formatDate(sel.lastModified)}</span></span>
      ${kind === 'save' ? '<span class="fi"><span class="fi-label">槽位</span><span class="fi-value">' + sel.name.slice(4, 6) + '</span></span>' : ''}
      ${versionBadge}${playTime}${actors}`
    els.fileInfo.classList.remove('hidden')
  }

  function renderMetaPreview() {
    const sel = state.selected
    els.metaPreview.classList.add('hidden')
    els.metaPreview.innerHTML = ''
    if (!sel || !sel.json || typeof sel.json !== 'object') return
    const { json } = sel
    if (typeof json.screenshot === 'string' && json.screenshot.startsWith('data:image/')) {
      els.metaPreview.innerHTML = `
        <img class="screenshot" src="${json.screenshot}" alt="存档截图" />
        <div class="meta-fields">
          <div class="fi"><span class="fi-label">截图格式</span><span class="fi-value">${json.screenshot.slice(11, 20)} · ${formatSize(json.screenshot.length)}</span></div>
          ${typeof json.timestamp === 'number' ? `<div class="fi"><span class="fi-label">保存时间</span><span class="fi-value">${formatDate(json.timestamp)}</span></div>` : ''}
        </div>`
      els.metaPreview.classList.remove('hidden')
    } else if (typeof json.timestamp === 'number') {
      els.metaPreview.innerHTML = `<div class="meta-fields">
        <div class="fi"><span class="fi-label">保存时间</span><span class="fi-value">${formatDate(json.timestamp)}</span></div>
      </div>`
      els.metaPreview.classList.remove('hidden')
    }
  }

  function formatDate(value) {
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return String(value)
    const pad = (n) => String(n).padStart(2, '0')
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  }
  function formatPlayTime(seconds) {
    const s = Math.floor(seconds)
    const h = Math.floor(s / 3600)
    const m = Math.floor((s % 3600) / 60)
    const sec = s % 60
    return `${h} 小时 ${m} 分 ${sec} 秒`
  }

  // ---------- 查看渲染（JSON 树 + 映射） ----------
  const KNOWN_KEYS = {
    playTime: '游玩时间', version: '存档版本', actors: '角色', party: '队伍', player: '玩家角色',
    members: '队员', team: '势力', keys: 'ID 列表', relations: '关系编码', collisions: '碰撞编码',
    scene: '场景', active: '激活场景', contexts: '场景上下文', camera: '摄像机', target: '跟随目标',
    x: 'X', y: 'Y', zoom: '缩放', variables: '常规变量', selfVariables: '独立变量', plugins: '插件数据',
    visible: '可见', entityId: '实体 ID', presetId: '预设 ID', selfVarId: '独立变量 ID', fileId: '角色文件',
    teamId: '队伍', passage: '通行', priority: '优先级', name: '名称', scale: '缩放', angle: '角度',
    portrait: '头像', clip: '裁剪', sprites: '精灵', weight: '重量', motions: '动作',
    movementSpeed: '移动速度', movementFactor: '移动倍率', attributes: '属性', animations: '动画',
    skills: '技能', states: '状态', equipments: '装备', cooldowns: '冷却', shortcuts: '快捷栏',
    inventory: '背包', list: '列表', money: '金币', id: 'ID', cooldown: '冷却(ms)', duration: '持续(ms)',
    caster: '施放者', currentTime: '当前时间(ms)', slot: '槽位', order: '序号', quantity: '数量',
    ref: '引用库存', screenshot: '截图', timestamp: '保存时间', width: '宽', height: '高',
    ambient: '环境光', terrains: '地形', emitters: '粒子', regions: '区域', lights: '光源',
    parallaxes: '视差', subscenes: '子场景', index: '索引', subdata: '子场景数据',
  }

  // 视图切换：tree / source / edit
  function setViewMode(mode) {
    state.viewMode = mode
    const sel = state.selected
    els.viewer.classList.toggle('hidden', mode !== 'tree')
    els.editArea.classList.toggle('hidden', mode !== 'edit')
    els.sourceArea.classList.toggle('hidden', mode !== 'source')
    els.btnEdit.classList.toggle('hidden', mode === 'edit')
    els.btnSave.classList.toggle('hidden', mode !== 'edit')
    els.btnCancelEdit.classList.toggle('hidden', mode !== 'edit')
    els.btnSource.textContent = mode === 'source' ? '树视图' : '源码'
    if (mode === 'edit' && sel) els.editText.value = JSON.stringify(sel.json, null, 2)
    if (mode === 'source' && sel) {
      els.sourceText.value = JSON.stringify(sel.json, null, 2)
      runSearch()
    }
  }

  function renderViewer() {
    const sel = state.selected
    if (!sel) {
      els.viewer.innerHTML = '<div class="empty-state">选择左侧存档文件查看内容。</div>'
      return
    }
    els.viewer.innerHTML = ''
    if (sel.parseError) {
      els.viewer.innerHTML = `<div class="empty-state">JSON 解析失败：${escapeHtml(sel.parseError.message)}<br />该文件可能已损坏（可尝试引擎的 .bak 自动回退）。</div>`
      return
    }
    if (state.viewMode === 'source' || state.viewMode === 'edit') {
      setViewMode(state.viewMode)
      return
    }
    const annotate = els.chkAnnotate.checked
    const expandAll = els.chkExpand.checked
    const tree = document.createElement('div')
    tree.className = 'json-tree'
    // 根节点：不勾选全部展开时也默认展开第一层（顶层词条可见）
    tree.appendChild(renderNode(sel.json, '', '', 0, annotate, expandAll, true))
    els.viewer.appendChild(tree)
    hydrateImages(tree)
  }

  // 惰性渲染：折叠的节点先不渲染子内容，点击展开时才生成（大存档不卡）
  function renderNode(value, key, parentKey, depth, annotate, expandAll, isRoot = false) {
    const container = document.createElement('div')
    container.className = 'jt-node'
    const row = document.createElement('div')
    row.className = 'jt-row'
    if (key !== '') {
      const keyEl = document.createElement('span')
      keyEl.className = 'jt-key'
      keyEl.textContent = JSON.stringify(key)
      const colon = document.createElement('span')
      colon.className = 'jt-colon'
      colon.textContent = ': '
      row.appendChild(keyEl)
      row.appendChild(colon)
      if (annotate) {
        const note = keyAnnotation(key, value, parentKey)
        if (note) {
          const tag = document.createElement('span')
          tag.className = 'jt-key-annot'
          tag.textContent = note
          row.appendChild(tag)
        }
      }
    }
    const kind = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value
    if ((kind === 'object' || kind === 'array') && value !== null) {
      const isArray = Array.isArray(value)
      const entries = Object.keys(value)
      const summary = isArray ? `[${entries.length}]` : `{${entries.length}}`
      row.classList.add('collapsible')
      const toggle = document.createElement('span')
      toggle.className = 'jt-toggle'
      toggle.textContent = '▸'
      const valueEl = document.createElement('span')
      valueEl.className = 'jt-collapsed'
      valueEl.textContent = summary
      row.appendChild(toggle)
      row.appendChild(valueEl)
      if (annotate) {
        const tag = valueAnnotation(value, key, parentKey, depth)
        if (tag) row.appendChild(tag)
      }
      // 惰性渲染：展开时才生成子节点
      const body = document.createElement('div')
      body.className = 'jt-node'
      body.hidden = true
      let rendered = false
      const ensureRendered = () => {
        if (rendered) return
        rendered = true
        for (const childKey of entries) {
          body.appendChild(renderNode(value[childKey], childKey, key, depth + 1, annotate, expandAll, false))
        }
      }
      const expanded = isRoot ? true : expandAll
      if (expanded) { body.hidden = false; ensureRendered(); toggle.textContent = '▾' }
      row.addEventListener('click', () => {
        body.hidden = !body.hidden
        toggle.textContent = body.hidden ? '▸' : '▾'
        if (!body.hidden) ensureRendered()
      })
      container.appendChild(row)
      container.appendChild(body)
    } else {
      const valueEl = document.createElement('span')
      valueEl.className = `jt-${kind}`
      valueEl.textContent = JSON.stringify(value)
      row.appendChild(valueEl)
      if (annotate) {
        const tag = valueAnnotation(value, key, parentKey, depth)
        if (tag) row.appendChild(tag)
      }
      container.appendChild(row)
    }
    return container
  }

  // 键注解：属性 key / 变量 ID / 已知字段名
  function keyAnnotation(key, value, parentKey) {
    const meta = state.meta
    if (!meta) return null
    const attrName = meta.attributes.get(key)
    if (attrName && attrName !== key) return `属性：${attrName}`
    // 变量 ID 作为键（如 global.save 的 variables）→ 中文变量名
    if (typeof key === 'string' && key.length === 16 && GUID_RE.test(key)) {
      const varName = meta.variables.get(key)
      if (varName && varName !== key) return `变量：${varName}`
    }
    // 已知字段名（值注解已处理时间类的键除外，避免重复）
    if (key === 'playTime' || key === 'timestamp') return null
    const known = KNOWN_KEYS[key]
    if (known) return known
    return null
  }

  // 值注解：GUID → 资产/队伍/变量/本地化；时间戳；playTime；截图
  function valueAnnotation(value, key, parentKey, depth) {
    const meta = state.meta
    if (!meta) return null
    if (typeof value === 'string') {
      if (value.length === 16 && GUID_RE.test(value)) {
        const hit = meta.guidType.get(value)
        if (hit) {
          const kind = hit.typeName
          const img = hit.type === 'images' ? `<img class="annot-img" data-img-guid="${value}" alt="" />` : ''
          return makeTag(img, kind, hit.display, value)
        }
        const teamName = meta.teams.get(value)
        if (teamName) return makeTag('', '队伍', teamName, value)
        const varName = meta.variables.get(value)
        if (varName) return makeTag('', '变量', varName, value)
        const locName = meta.localization.get(value)
        if (locName) return makeTag('', '本地化', locName, value)
      }
      if (value.startsWith('data:image/')) {
        // 树内直接显示 base64 解码后的图片缩略图
        const div = document.createElement('span')
        div.className = 'jt-annot'
        div.innerHTML = `<img class="annot-shot" src="${value}" alt="截图" /><span class="annot-name">截图 dataURL ${formatSize(value.length)}</span>`
        return div
      }
      return null
    }
    if (key === 'timestamp' && typeof value === 'number' && value > 100000000000) {
      return makeTag('', '时间', formatDate(value), '')
    }
    if (key === 'playTime' && typeof value === 'number') {
      return makeTag('', '游玩时间', formatPlayTime(value), '')
    }
    return null
  }

  function makeTag(imgHtml, kind, name, id) {
    const div = document.createElement('span')
    div.className = 'jt-annot'
    div.innerHTML = `${imgHtml}<span class="annot-kind">${escapeHtml(kind)}</span><span class="annot-name">${escapeHtml(name)}</span>${id ? `<span class="annot-id">${escapeHtml(id)}</span>` : ''}`
    return div
  }

  // 异步加载图片注解（portrait/icon/图片资产 GUID → 工程图片文件），并行加载 + 缓存
  const imageCache = new Map()
  async function hydrateImages(root) {
    const holders = root.querySelectorAll('.jt-annot img.annot-img[data-img-guid]')
    if (holders.length === 0) return
    const tasks = []
    for (const img of holders) {
      tasks.push((async () => {
        const guid = img.dataset.imgGuid
        const meta = state.meta
        const path = meta.images.get(guid)
        if (!path) { img.style.display = 'none'; return }
        if (imageCache.has(guid)) { img.src = imageCache.get(guid); return }
        try {
          const blob = state.root
            ? await (await getHandle(state.root, path)).getFile()
            : (state.virtual[path] || null)
          if (!blob) { img.style.display = 'none'; return }
          const url = URL.createObjectURL(blob)
          imageCache.set(guid, url)
          img.src = url
        } catch (error) {
          console.warn('图片加载失败', path, error)
          img.style.display = 'none'
        }
      })())
    }
    await Promise.allSettled(tasks)
  }

  // ---------- 搜索（源码视图定位 + 计数 + 上下跳转） ----------
  function runSearch() {
    const text = els.sourceText.value
    const query = els.searchInput.value.trim()
    state.searchMatches = []
    state.searchIndex = -1
    if (!query || !text) { els.searchCount.textContent = ''; return }
    const matches = []
    let index = 0
    while (true) {
      const found = text.indexOf(query, index)
      if (found === -1) break
      matches.push(found)
      index = found + query.length
    }
    state.searchMatches = matches
    if (matches.length > 0) {
      state.searchIndex = 0
      jumpToSearchMatch()
    }
    els.searchCount.textContent = matches.length > 0 ? `1/${matches.length}` : '0'
  }

  function jumpToSearchMatch() {
    const { searchMatches, searchIndex } = state
    if (searchMatches.length === 0 || searchIndex < 0) return
    const textarea = els.sourceText
    const pos = searchMatches[searchIndex]
    textarea.focus()
    textarea.setSelectionRange(pos, pos + els.searchInput.value.trim().length)
    textarea.scrollTop = Math.max(0, (pos / textarea.value.length) * (textarea.scrollHeight - textarea.clientHeight) - 60)
    els.searchCount.textContent = `${searchIndex + 1}/${searchMatches.length}`
  }

  function stepSearch(delta) {
    if (state.searchMatches.length === 0) return
    state.searchIndex = (state.searchIndex + delta + state.searchMatches.length) % state.searchMatches.length
    jumpToSearchMatch()
  }

  // ---------- 编辑 ----------
  function startEditing() {
    const sel = state.selected
    if (!sel) return
    if (sel.parseError) { toast('该文件 JSON 已损坏，无法编辑（可先修复后再试）', 'error'); return }
    setViewMode('edit')
    els.btnSource.disabled = true
    setStatus(`编辑 ${sel.name} · 保存前自动备份到 Lootsmith Backups`)
  }

  function cancelEditing() {
    setViewMode('tree')
    els.btnSource.disabled = false
    setStatus('已取消编辑')
  }

  async function saveEdit() {
    const sel = state.selected
    if (!sel || state.viewMode !== 'edit') return
    let json
    try {
      json = JSON.parse(els.editText.value)
    } catch (error) {
      toast(`JSON 语法错误，未保存：${error.message}`, 'error')
      return
    }
    const writable = Boolean(state.root)
    const verb = writable ? '写回' : '下载'
    if (!window.confirm(`确定${verb} Save/${sel.name} 吗？\n\n建议先关闭游戏窗口，否则游戏下次保存可能覆盖本次修改。\n${writable ? '写入前会自动备份到 Lootsmith Backups。' : '当前为只读导入模式，将下载修改后的 JSON 文件。'}`)) return
    const compact = JSON.stringify(json)
    if (writable) {
      try {
        await backupFile(`Save/${sel.name}`, sel.name)
        const handle = await getHandle(state.root, `Save/${sel.name}`)
        const writableStream = await handle.createWritable()
        await writableStream.write(compact)
        await writableStream.close()
        toast(`已保存 Save/${sel.name}（自动备份完成）`, 'success')
      } catch (error) {
        console.warn(error)
        toast('保存失败：' + error.message, 'error')
        return
      }
    } else {
      const blob = new Blob([compact], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = sel.name
      a.click()
      URL.revokeObjectURL(url)
      toast('已生成修改副本（导入模式不支持写回）', 'success')
    }
    sel.json = json
    sel.text = compact
    cancelEditing()
    renderFileInfo()
    renderMetaPreview()
    renderViewer()
    refreshPollSnapshot()
  }

  async function backupFile(path, name) {
    const root = state.root
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    let dir = root
    for (const part of ['Lootsmith Backups', stamp]) {
      dir = await dir.getDirectoryHandle(part, { create: true })
    }
    const current = await readText(root, path)
    const backupName = name.replace(/[\/\\]/g, '__')
    const file = await dir.getFileHandle(backupName, { create: true })
    const writable = await file.createWritable()
    await writable.write(current)
    await writable.close()
  }

  // ---------- 复制 ----------
  async function copyJson() {
    const sel = state.selected
    if (!sel) return
    let text = sel.text
    if (state.viewMode === 'edit') text = els.editText.value
    else if (state.viewMode === 'source') text = els.sourceText.value
    try {
      await navigator.clipboard.writeText(text)
      toast('已复制到剪贴板', 'success')
    } catch {
      toast('复制失败（浏览器未授权剪贴板）', 'error')
    }
  }

  // ---------- 刷新与轮询 ----------
  async function refresh() {
    if (state.viewMode === 'edit') { toast('编辑模式下已暂停自动刷新', ''); return }
    await listSaveFiles()
    renderSaveList()
    if (state.selected) {
      const current = state.saveEntries.find((e) => e.name === state.selected.name)
      if (current && (current.size !== state.selected.size || current.lastModified !== state.selected.lastModified)) {
        setStatus(`检测到 ${current.name} 变化，重新读取…`)
        await selectSaveFile(current.name)
      } else if (!current) {
        state.selected = null
        els.viewer.innerHTML = '<div class="empty-state">文件已被删除。</div>'
        els.fileInfo.classList.add('hidden')
        els.metaPreview.classList.add('hidden')
      }
    }
    setStatus(`已刷新（${state.rootName} · Save 目录 ${state.saveEntries.length} 个文件）`)
  }

  function refreshPollSnapshot() {
    state.pollSnapshot.clear()
    for (const entry of state.saveEntries) state.pollSnapshot.set(entry.name, `${entry.size}:${entry.lastModified}`)
  }
  function startPolling() {
    stopPolling()
    refreshPollSnapshot()
    state.pollTimer = setInterval(async () => {
      if (document.hidden || state.viewMode === 'edit' || !state.root) return
      try {
        await listSaveFiles()
        let changed = false
        for (const entry of state.saveEntries) {
          const key = `${entry.size}:${entry.lastModified}`
          if (state.pollSnapshot.get(entry.name) !== key) { changed = true; break }
        }
        if (changed) { await refresh(); refreshPollSnapshot() }
      } catch {}
    }, 5000)
  }
  function stopPolling() {
    if (state.pollTimer) { clearInterval(state.pollTimer); state.pollTimer = null }
  }

  // ---------- 事件绑定 ----------
  els.pickProject.addEventListener('click', pickProject)
  els.restoreProject.addEventListener('click', restoreLastProject)
  els.btnRefresh.addEventListener('click', refresh)
  els.btnCopy.addEventListener('click', copyJson)
  els.btnEdit.addEventListener('click', startEditing)
  els.btnSave.addEventListener('click', saveEdit)
  els.btnCancelEdit.addEventListener('click', cancelEditing)
  els.btnSource.addEventListener('click', () => {
    if (!state.selected || state.selected.parseError) return
    setViewMode(state.viewMode === 'source' ? 'tree' : 'source')
  })
  els.searchInput.addEventListener('input', () => {
    if (state.viewMode !== 'source' && state.selected && !state.selected.parseError) setViewMode('source')
    runSearch()
  })
  els.searchInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); stepSearch(event.shiftKey ? -1 : 1) }
  })
  els.searchPrev.addEventListener('click', () => stepSearch(-1))
  els.searchNext.addEventListener('click', () => stepSearch(1))
  els.folderFallback.addEventListener('change', () => {
    if (els.folderFallback.files && els.folderFallback.files.length) pickFallback(els.folderFallback.files)
  })
  els.chkAnnotate.addEventListener('change', () => { if (state.selected && !state.selected.parseError && state.viewMode === 'tree') renderViewer() })
  els.chkExpand.addEventListener('change', () => { if (state.selected && !state.selected.parseError && state.viewMode === 'tree') renderViewer() })

  // ---------- 启动 ----------
  async function init() {
    els.btnSource.disabled = true
    els.btnEdit.disabled = true
    els.btnCopy.disabled = true
    // 联动：自动尝试加载其他工具记住的工程位置
    let remembered = null
    try { remembered = await setting('last-project-handle') } catch {}
    if (remembered) {
      let permission = 'prompt'
      try { permission = await remembered.queryPermission({ mode: 'readwrite' }) } catch {}
      if (permission === 'granted') {
        try {
          await setupRoot(remembered)
          return
        } catch (error) {
          console.warn(error)
          toast('自动加载上次工程失败：' + error.message, 'error')
        }
      } else {
        els.restoreProject.classList.remove('hidden')
        els.projectState.textContent = '检测到上次工程（需授权）'
        return
      }
    }
    els.projectState.textContent = '尚未选择游戏工程'
  }

  init().catch((error) => {
    console.error(error)
    setStatus('初始化失败：' + error.message)
  })
})()
