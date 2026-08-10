(() => {
  'use strict'

  const DROP_ATTRIBUTE_ID = '4cb407bd71929620'
  const SUPPORTED = new Set(['.item', '.equip', '.actor'])
  const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp'])
  const BACKUP_DIRECTORY = 'Lootsmith Backups'
  const state = {
    rootHandle: null,
    lastRootHandle: null,
    fallbackMode: false,
    allFiles: [],
    roles: [],
    items: [],
    equipments: [],
    definitions: new Map(),
    semanticIds: new Map(),
    localization: new Map(),
    imageHandles: new Map(),
    imageBitmaps: new Map(),
    selectedRole: null,
    catalogType: 'item',
    catalogSearch: '',
    roleSearch: '',
    selectedResource: null,
    drafts: new Map(),
    pending: new Set(),
    errors: [],
  }

  const $ = (selector) => document.querySelector(selector)
  const $$ = (selector) => [...document.querySelectorAll(selector)]
  const els = {
    welcome: $('#welcome'), workspace: $('#workspace'), pickProject: $('#pick-project'), welcomePick: $('#welcome-pick'), fallback: $('#folder-fallback'),
    restoreLast: $('#restore-last'), lastProjectName: $('#last-project-name'),
    projectState: $('#project-state'), saveAll: $('#save-all'), pendingCount: $('#pending-count'), roleSearch: $('#role-search'), roleList: $('#role-list'), roleCount: $('#role-count'),
    scanStatus: $('#scan-status'), rescan: $('#rescan'), noRole: $('#no-role'), roleEditor: $('#role-editor'), roleName: $('#role-name'), rolePath: $('#role-path'), roleGuid: $('#role-guid'), roleAvatar: $('#role-avatar'), roleSlotState: $('#role-slot-state'),
    saveCurrent: $('#save-current'), dropCount: $('#drop-count'), dirtyLabel: $('#dirty-label'), dropList: $('#drop-list'), dropEmpty: $('#drop-empty'), catalogSearch: $('#catalog-search'), catalogList: $('#catalog-list'), catalogEmpty: $('#catalog-empty'),
    itemCountLabel: $('#item-count-label'), equipCountLabel: $('#equip-count-label'), itemTabCount: $('#item-tab-count'), equipmentTabCount: $('#equipment-tab-count'), composer: $('#selection-composer'), clearSelection: $('#clear-selection'), selectedType: $('#selected-resource-type'), selectedName: $('#selected-resource-name'), quantity: $('#quantity'), quantityMinus: $('#quantity-minus'), quantityPlus: $('#quantity-plus'), insertDrop: $('#insert-drop'), toastRegion: $('#toast-region'),
  }

  const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]))
  const normalizePath = (value) => String(value || '').replace(/\\/g, '/')
  const basename = (value) => normalizePath(value).split('/').pop() || ''
  const extension = (value) => { const match = basename(value).match(/\.[^.]+$/); return match ? match[0].toLowerCase() : '' }

  function fileGuid(name) {
    const match = basename(name).match(/\.([0-9a-f]{16})\.[^.]+$/i)
    return match ? match[1] : ''
  }

  function resourceGuid(name) {
    return fileGuid(name)
  }

  function resourceName(name, guid) {
    const base = basename(name)
    const pattern = guid ? new RegExp(`\\.${guid}\\.(?:item|equip|actor)$`, 'i') : /\.(?:item|equip|actor)$/i
    const clean = base.replace(pattern, '')
    return clean || base
  }

  function walkDefinitions(node) {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) { node.forEach(walkDefinitions); return }
    if (typeof node.id === 'string' && typeof node.key === 'string' && typeof node.name === 'string') {
      state.definitions.set(node.id, { key: node.key, name: node.name })
      if (!state.semanticIds.has(node.key)) state.semanticIds.set(node.key, new Set())
      state.semanticIds.get(node.key).add(node.id)
    }
    Object.values(node).forEach(walkDefinitions)
  }

  function walkLocalization(node) {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) { node.forEach(walkLocalization); return }
    if (typeof node.id === 'string' && node.contents && typeof node.contents === 'object') {
      const chinese = node.contents['zh-CN'] || node.contents.zh || node.name
      if (typeof chinese === 'string' && chinese.trim()) state.localization.set(node.id, chinese.trim())
    }
    Object.values(node).forEach(walkLocalization)
  }

  function localizationIds(value) {
    if (typeof value !== 'string') return []
    return [...value.matchAll(/<ref:([0-9a-f]{16})>/gi)].map((match) => match[1])
  }

  function localizedName(value, fallback) {
    if (typeof value !== 'string' || !value.trim()) return fallback
    const ids = localizationIds(value)
    if (!ids.length) return value.trim()
    const resolved = ids.map((id) => state.localization.get(id)).filter(Boolean).join('')
    return resolved || fallback
  }

  function getValue(data, semanticKey) {
    if (!data || typeof data !== 'object') return undefined
    if (Object.prototype.hasOwnProperty.call(data, semanticKey)) return data[semanticKey]
    const ids = state.semanticIds.get(semanticKey)
    for (const attr of Array.isArray(data.attributes) ? data.attributes : []) {
      if (!attr || typeof attr !== 'object') continue
      if (attr.key === semanticKey || (ids && ids.has(attr.key))) return attr.value
    }
    return undefined
  }

  function findDropSlot(data) {
    if (!data || typeof data !== 'object') return null
    if (Object.prototype.hasOwnProperty.call(data, 'loopList')) return { kind: 'root', key: 'loopList', value: data.loopList }
    const attributes = Array.isArray(data.attributes) ? data.attributes : []
    const index = attributes.findIndex((attr) => attr && (attr.key === DROP_ATTRIBUTE_ID || attr.key === 'loopList' || state.definitions.get(attr.key)?.key === 'loopList'))
    if (index >= 0) return { kind: 'attribute', index, value: attributes[index].value }
    return null
  }

  function decodeJson(value) {
    let current = value
    for (let i = 0; i < 3 && typeof current === 'string'; i += 1) {
      const text = current.trim()
      if (!text) return []
      try { current = JSON.parse(text) } catch { return [] }
    }
    return current
  }

  function entryType(raw) {
    if (Array.isArray(raw)) return raw[0]?.type || (raw[0] === 'equipment' ? 'equipment' : 'item')
    const type = raw?.type || raw?.kind || raw?.category || raw?.resourceType || raw?.itemType
    if (!type && typeof raw?.equipmentId === 'string' && raw.equipmentId) return 'equipment'
    return ['equipment', 'equip', '装备'].includes(String(type).toLowerCase()) ? 'equipment' : 'item'
  }

  function entryId(raw, type) {
    if (Array.isArray(raw)) return raw.find((value) => typeof value === 'string' && /^[0-9a-f]{16}$/i.test(value)) || raw[1] || ''
    return raw?.[type === 'equipment' ? 'equipmentId' : 'itemId'] || raw?.id || raw?.guid || raw?.key || raw?.resourceId || ''
  }

  function entryQuantity(raw) {
    if (Array.isArray(raw)) return Number(raw.find((value) => typeof value === 'number') ?? raw[2] ?? 1) || 1
    return Math.max(1, Number(raw?.quantity ?? raw?.count ?? raw?.amount ?? raw?.num ?? raw?.number ?? 1) || 1)
  }

  function normalizeEntry(raw, index) {
    const type = entryType(raw)
    return { key: `${type}-${entryId(raw, type)}-${index}`, type, id: String(entryId(raw, type) || ''), quantity: entryQuantity(raw), raw }
  }

  function parseDropList(value) {
    const decoded = decodeJson(value)
    const list = Array.isArray(decoded) ? decoded : Array.isArray(decoded?.list) ? decoded.list : Array.isArray(decoded?.items) ? decoded.items : []
    return list.map(normalizeEntry).filter((entry) => entry.id)
  }

  function serializeDropList(entries) {
    return JSON.stringify(entries.map((entry) => ({ type: entry.type, id: entry.id, quantity: Math.max(1, Number(entry.quantity) || 1) })))
  }

  function dropSlotLabel(role, entries) {
    if (!role.dropSlot) return '未找到属性，将在保存时创建'
    return `${entries.length} 条记录 · ${role.dropSlot.kind === 'root' ? '对象属性 loopList' : 'attributes / loopList'}`
  }

  function makeRecord(file, data, kind) {
    const guid = resourceGuid(file.name)
    const attrName = getValue(data, 'name')
    const fallbackName = resourceName(file.name, guid)
    const localizationId = localizationIds(attrName)[0] || ''
    const imageGuid = kind === 'actor' ? (data.portrait || data.sprites?.find((sprite) => sprite?.image)?.image || '') : (data.icon || '')
    const clip = Array.isArray(data.clip) && data.clip.length >= 4 ? data.clip.slice(0, 4).map(Number) : null
    return { ...file, data, kind, guid, rawName: attrName, localizationId, name: localizedName(attrName, fallbackName), imageGuid, clip, label: normalizePath(file.path) }
  }

  function inheritMetadata(record, recordMap, seen = new Set()) {
    if (!record?.data?.inherit || seen.has(record.guid)) return record
    seen.add(record.guid)
    const parent = recordMap.get(record.data.inherit)
    if (!parent) return record
    inheritMetadata(parent, recordMap, seen)
    if (!record.imageGuid && parent.imageGuid) record.imageGuid = parent.imageGuid
    if (!record.clip && parent.clip) record.clip = [...parent.clip]
    return record
  }

  function previewMarkup(resource, fallback) {
    if (!resource?.imageGuid || !state.imageHandles.has(resource.imageGuid)) return `<span class="resource-preview-fallback">${escapeHtml(fallback)}</span>`
    const clip = resource.clip?.join(',') || ''
    return `<span class="resource-preview" data-image-guid="${resource.imageGuid}" data-image-clip="${clip}"><canvas width="80" height="80"></canvas><span class="resource-preview-fallback">${escapeHtml(fallback)}</span></span>`
  }

  async function loadImageBitmap(guid) {
    if (state.imageBitmaps.has(guid)) return state.imageBitmaps.get(guid)
    const promise = (async () => {
      const handle = state.imageHandles.get(guid)
      if (!handle) return null
      const file = handle.getFile ? await handle.getFile() : handle
      return createImageBitmap(file)
    })()
    state.imageBitmaps.set(guid, promise)
    return promise
  }

  async function paintPreview(node) {
    if (!node || node.dataset.hydrated === 'true') return
    node.dataset.hydrated = 'true'
    const canvas = node.querySelector('canvas')
    if (!canvas) return
    try {
      const bitmap = await loadImageBitmap(node.dataset.imageGuid)
      if (!bitmap) return
      const values = (node.dataset.imageClip || '').split(',').map(Number)
      let [sx, sy, sw, sh] = values
      if (values.length < 4 || !values.every(Number.isFinite) || sw <= 0 || sh <= 0 || sx < 0 || sy < 0 || sx + sw > bitmap.width || sy + sh > bitmap.height) {
        sx = 0; sy = 0; sw = bitmap.width; sh = bitmap.height
      }
      const context = canvas.getContext('2d')
      context.clearRect(0, 0, canvas.width, canvas.height)
      context.imageSmoothingEnabled = false
      const scale = Math.min(canvas.width / sw, canvas.height / sh)
      const width = sw * scale
      const height = sh * scale
      context.drawImage(bitmap, sx, sy, sw, sh, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height)
      node.classList.add('loaded')
    } catch {
      node.dataset.hydrated = 'error'
    }
  }

  function hydratePreviews(container = document) {
    container.querySelectorAll('.resource-preview:not([data-hydrated="true"])').forEach((node) => paintPreview(node))
  }

  async function readText(fileHandle) { return fileHandle.getFile ? fileHandle.getFile().then((file) => file.text()) : fileHandle.text() }

  async function readJsonHandle(handle) {
    try { return JSON.parse(await readText(handle)) } catch { return null }
  }

  async function findNestedHandle(root, pathParts) {
    let current = root
    for (const part of pathParts) {
      try { current = await current.getDirectoryHandle(part) } catch { return null }
    }
    return current
  }

  function openSettingsDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('loot-smith-settings', 1)
      request.onupgradeneeded = () => request.result.createObjectStore('settings')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  }

  async function readSetting(key) {
    const database = await openSettingsDatabase()
    return new Promise((resolve, reject) => {
      const request = database.transaction('settings', 'readonly').objectStore('settings').get(key)
      request.onsuccess = () => { database.close(); resolve(request.result) }
      request.onerror = () => { database.close(); reject(request.error) }
    })
  }

  async function writeSetting(key, value) {
    const database = await openSettingsDatabase()
    return new Promise((resolve, reject) => {
      const transaction = database.transaction('settings', 'readwrite')
      transaction.objectStore('settings').put(value, key)
      transaction.oncomplete = () => { database.close(); resolve() }
      transaction.onerror = () => { database.close(); reject(transaction.error) }
    })
  }

  async function rememberRootHandle(handle) {
    state.lastRootHandle = handle
    els.lastProjectName.textContent = handle.name
    els.restoreLast.classList.remove('hidden')
    try { await writeSetting('last-project-handle', handle) } catch {}
  }

  async function loadRememberedProject() {
    if (!window.showDirectoryPicker || !window.indexedDB) return
    try {
      const handle = await readSetting('last-project-handle')
      if (!handle) return
      state.lastRootHandle = handle
      els.lastProjectName.textContent = handle.name
      els.restoreLast.classList.remove('hidden')
      const permission = await handle.queryPermission?.({ mode: 'readwrite' })
      if (permission === 'granted') {
        state.rootHandle = handle
        await scanProject()
      }
    } catch {}
  }

  async function restoreRememberedProject() {
    const handle = state.lastRootHandle
    if (!handle) return
    try {
      let permission = await handle.queryPermission?.({ mode: 'readwrite' })
      if (permission !== 'granted') permission = await handle.requestPermission?.({ mode: 'readwrite' })
      if (permission !== 'granted') throw new Error('未获得工程目录的读写权限')
      state.rootHandle = handle
      await scanProject()
    } catch (error) {
      showToast('加载上次工程失败', error.message, 'error')
    }
  }

  async function readProjectMetadata(root, fallbackFiles = []) {
    state.definitions.clear(); state.semanticIds.clear(); state.localization.clear()
    let attributes = null
    let localization = null
    if (root) {
      const dataDir = await findNestedHandle(root, ['Data'])
      if (dataDir) {
        try { attributes = await readJsonHandle(await dataDir.getFileHandle('attribute.json')) } catch {}
        try { localization = await readJsonHandle(await dataDir.getFileHandle('localization.json')) } catch {}
      }
    } else {
      const attributeFile = fallbackFiles.find((file) => /(^|\/)Data\/attribute\.json$/i.test(normalizePath(file.webkitRelativePath || file.name)) || file.name.toLowerCase() === 'attribute.json')
      const localizationFile = fallbackFiles.find((file) => /(^|\/)Data\/localization\.json$/i.test(normalizePath(file.webkitRelativePath || file.name)) || file.name.toLowerCase() === 'localization.json')
      if (attributeFile) { try { attributes = JSON.parse(await attributeFile.text()) } catch {} }
      if (localizationFile) { try { localization = JSON.parse(await localizationFile.text()) } catch {} }
    }
    if (attributes) walkDefinitions(attributes)
    if (localization) walkLocalization(localization)
  }

  async function scanDirectoryHandle(dir, relative = '', output = []) {
    for await (const [name, handle] of dir.entries()) {
      if (handle.kind === 'directory') {
        if (['.git', 'node_modules', 'Dist', 'Save', BACKUP_DIRECTORY].includes(name)) continue
        await scanDirectoryHandle(handle, `${relative}${name}/`, output)
        continue
      }
      const ext = extension(name)
      if (IMAGE_EXTENSIONS.has(ext)) {
        const guid = fileGuid(name)
        if (guid && !state.imageHandles.has(guid)) state.imageHandles.set(guid, handle)
        continue
      }
      if (!SUPPORTED.has(ext)) continue
      const path = `${relative}${name}`
      const raw = await readText(handle)
      let data = null
      try { data = JSON.parse(raw) } catch (error) { state.errors.push(`${path}: JSON 解析失败`) }
      if (data) output.push({ name, path, handle, raw, data, ext })
    }
    return output
  }

  async function scanFallback(files) {
    const output = []
    for (const file of files) {
      const ext = extension(file.name)
      if (IMAGE_EXTENSIONS.has(ext)) {
        const guid = fileGuid(file.name)
        if (guid && !state.imageHandles.has(guid)) state.imageHandles.set(guid, file)
        continue
      }
      if (!SUPPORTED.has(ext)) continue
      const raw = await file.text(); let data = null
      try { data = JSON.parse(raw) } catch { state.errors.push(`${file.webkitRelativePath}: JSON 解析失败`) }
      if (data) output.push({ name: file.name, path: normalizePath(file.webkitRelativePath || file.name), file, raw, data, ext })
    }
    return output
  }

  async function scanProject({ rootHandle = state.rootHandle, files = null } = {}) {
    state.errors = []; state.drafts.clear(); state.pending.clear(); state.selectedResource = null
    const lastRolePath = rootHandle ? localStorage.getItem(`loot-smith-last-role:${rootHandle.name}`) : ''
    state.selectedRole = null
    state.imageHandles.clear()
    for (const bitmapPromise of state.imageBitmaps.values()) bitmapPromise.then((bitmap) => bitmap?.close?.()).catch(() => {})
    state.imageBitmaps.clear()
    setScanStatus('正在读取资源…')
    const all = rootHandle ? await scanDirectoryHandle(rootHandle) : await scanFallback(files || [])
    state.allFiles = all
    await readProjectMetadata(rootHandle, files || [])
    state.roles = all.filter((file) => file.ext === '.actor').map((file) => {
      const dropSlot = findDropSlot(file.data)
      const parsed = dropSlot ? parseDropList(dropSlot.value) : []
      return { ...makeRecord(file, file.data, 'actor'), dropSlot, originalEntries: parsed, entries: parsed.map((entry) => ({ ...entry })) }
    }).sort(sortRecords)
    state.items = all.filter((file) => file.ext === '.item').map((file) => makeRecord(file, file.data, 'item')).sort(sortRecords)
    state.equipments = all.filter((file) => file.ext === '.equip').map((file) => makeRecord(file, file.data, 'equipment')).sort(sortRecords)
    const recordMap = new Map([...state.roles, ...state.items, ...state.equipments].map((record) => [record.guid, record]))
    ;[...state.roles, ...state.items, ...state.equipments].forEach((record) => inheritMetadata(record, recordMap))
    state.fallbackMode = !rootHandle
    if (rootHandle) await rememberRootHandle(rootHandle)
    renderWorkspace()
    if (lastRolePath && state.roles.some((role) => role.path === lastRolePath)) selectRole(lastRolePath)
    setScanStatus(state.errors.length ? `扫描完成 · ${state.errors.length} 个文件异常` : `扫描完成 · ${all.length} 个资源`)
    showToast('扫描完成', `角色 ${state.roles.length} · 物品 ${state.items.length} · 装备 ${state.equipments.length}`, state.errors.length ? 'error' : 'success')
  }

  function sortRecords(a, b) { return a.name.localeCompare(b.name, 'zh-CN', { numeric: true }) || a.path.localeCompare(b.path) }
  function setScanStatus(text) { els.scanStatus.textContent = text }
  function currentEntries() { return state.selectedRole ? state.selectedRole.entries : [] }
  function isDirty(role) { return role && state.pending.has(role.path) }
  function markDirty(role) { state.pending.add(role.path); updatePendingUi(); renderRoleList(); renderRoleEditor() }

  function renderWorkspace() {
    els.welcome.classList.add('hidden'); els.workspace.classList.remove('hidden')
    els.projectState.textContent = state.rootHandle ? `工程 · ${state.rootHandle.name}` : '导入预览（不可直接写回）'
    els.projectState.classList.remove('muted')
    els.roleCount.textContent = state.roles.length
    els.itemCountLabel.textContent = `${state.items.length} 物品`; els.equipCountLabel.textContent = `${state.equipments.length} 装备`
    els.itemTabCount.textContent = state.items.length; els.equipmentTabCount.textContent = state.equipments.length
    renderRoleList(); renderCatalog(); updatePendingUi()
    if (state.roles.length && !state.selectedRole) selectRole(state.roles[0].path)
    else renderRoleEditor()
  }

  function renderRoleList() {
    const query = state.roleSearch.trim().toLowerCase()
    const roles = state.roles.filter((role) => !query || `${role.name} ${role.localizationId} ${role.path} ${role.guid}`.toLowerCase().includes(query))
    els.roleList.innerHTML = roles.length ? roles.map((role) => `<div class="role-row ${state.selectedRole?.path === role.path ? 'selected' : ''}" data-role-path="${escapeHtml(role.path)}"><div class="role-avatar-small">${previewMarkup(role, '✦')}</div><div class="role-row-info"><div class="role-row-name">${escapeHtml(role.name)}</div><div class="role-row-path">${escapeHtml(role.localizationId ? `本地化 ${role.localizationId}` : role.path)}</div></div><span class="role-row-status ${isDirty(role) ? 'dirty' : ''}"></span></div>`).join('') : '<div class="list-message">没有匹配的角色</div>'
    $$('.role-row').forEach((row) => row.addEventListener('click', () => selectRole(row.dataset.rolePath)))
    hydratePreviews(els.roleList)
  }

  function selectRole(path) {
    state.selectedRole = state.roles.find((role) => role.path === path) || null
    if (state.rootHandle && state.selectedRole) localStorage.setItem(`loot-smith-last-role:${state.rootHandle.name}`, state.selectedRole.path)
    state.selectedResource = null; els.catalogSearch.value = ''; state.catalogSearch = ''
    renderRoleList(); renderRoleEditor(); renderCatalog(); renderComposer()
  }

  function renderRoleEditor() {
    if (!state.selectedRole) { els.noRole.classList.remove('hidden'); els.roleEditor.classList.add('hidden'); return }
    els.noRole.classList.add('hidden'); els.roleEditor.classList.remove('hidden')
    const role = state.selectedRole; const entries = currentEntries()
    els.roleName.textContent = role.name; els.rolePath.textContent = role.path; els.roleGuid.textContent = role.guid ? `GUID ${role.guid}` : '文件名未包含标准 GUID'
    els.roleSlotState.textContent = `${role.localizationId ? `本地化 ${role.localizationId} · ` : ''}${dropSlotLabel(role, entries)}`; els.roleAvatar.innerHTML = previewMarkup(role, role.name.slice(0, 1) || '✦'); els.dropCount.textContent = entries.length
    els.dirtyLabel.classList.toggle('hidden', !isDirty(role)); els.saveCurrent.disabled = !state.rootHandle && !state.fallbackMode
    els.dropList.innerHTML = entries.length ? entries.map((entry, index) => renderDropRow(entry, index)).join('') : ''
    els.dropEmpty.classList.toggle('hidden', entries.length > 0)
    $$('.remove-drop').forEach((button) => button.addEventListener('click', () => removeDrop(Number(button.dataset.index))))
    hydratePreviews(els.roleEditor)
  }

  function resourceForEntry(entry) { return (entry.type === 'equipment' ? state.equipments : state.items).find((resource) => resource.guid === entry.id) }
  function renderDropRow(entry, index) {
    const resource = resourceForEntry(entry); const displayName = resource?.name || entry.id || '未知资源'; const typeLabel = entry.type === 'equipment' ? '装备' : '物品'
    return `<div class="drop-row"><div class="resource-icon ${entry.type}">${previewMarkup(resource, entry.type === 'equipment' ? '◇' : '◆')}</div><div class="drop-row-info"><div class="drop-row-name">${escapeHtml(displayName)}</div><div class="drop-row-sub">${typeLabel}${resource?.localizationId ? ` · 本地化 ${escapeHtml(resource.localizationId)}` : ''} · ${escapeHtml(entry.id)}</div></div><div class="quantity-badge"><b>${escapeHtml(entry.quantity)}</b><span>数量</span></div><button class="remove-drop" data-index="${index}" type="button" aria-label="移除掉落物">×</button></div>`
  }

  function renderCatalog() {
    const source = state.catalogType === 'item' ? state.items : state.equipments
    const query = state.catalogSearch.trim().toLowerCase()
    const list = source.filter((resource) => !query || `${resource.name} ${resource.localizationId} ${resource.path} ${resource.guid}`.toLowerCase().includes(query))
    els.catalogList.innerHTML = list.length ? list.map((resource) => `<div class="catalog-row ${state.selectedResource?.guid === resource.guid ? 'selected' : ''}" data-resource-guid="${escapeHtml(resource.guid)}"><div class="resource-icon ${resource.kind}">${previewMarkup(resource, resource.kind === 'equipment' ? '◇' : '◆')}</div><div class="catalog-row-info"><div class="catalog-row-name">${escapeHtml(resource.name)}</div><div class="catalog-row-sub">${resource.localizationId ? `本地化 ${escapeHtml(resource.localizationId)} · ` : ''}${escapeHtml(resource.guid || '无 GUID')}</div></div><div class="catalog-row-action">${state.selectedResource?.guid === resource.guid ? '✓' : '＋'}</div></div>`).join('') : ''
    els.catalogEmpty.classList.toggle('hidden', list.length > 0)
    $$('.catalog-row').forEach((row) => row.addEventListener('click', () => selectResource(row.dataset.resourceGuid)))
    hydratePreviews(els.catalogList)
  }

  function selectResource(guid) {
    const source = state.catalogType === 'item' ? state.items : state.equipments
    state.selectedResource = source.find((resource) => resource.guid === guid) || null
    renderCatalog(); renderComposer()
  }

  function renderComposer() {
    const resource = state.selectedResource
    els.composer.classList.toggle('hidden', !resource)
    if (!resource) return
    els.selectedType.textContent = resource.kind === 'equipment' ? '装备' : '物品'; els.selectedType.className = `resource-type ${resource.kind}`; els.selectedName.textContent = resource.name; els.quantity.value = '1'
  }

  function removeDrop(index) {
    if (!state.selectedRole || !currentEntries()[index]) return
    currentEntries().splice(index, 1); markDirty(state.selectedRole); showToast('已移除', '点击“保存当前角色”后写回文件', 'success')
  }

  function insertDrop() {
    if (!state.selectedRole || !state.selectedResource) return
    const quantity = Math.max(1, Math.min(1000000000, Math.floor(Number(els.quantity.value) || 1)))
    state.selectedRole.entries.push({ key: `${state.selectedResource.kind}-${state.selectedResource.guid}-${Date.now()}`, type: state.selectedResource.kind, id: state.selectedResource.guid, quantity, raw: null })
    markDirty(state.selectedRole); showToast('已加入掉落列表', `${state.selectedResource.name} × ${quantity} · 尚未保存`, 'success')
  }

  function updatePendingUi() { els.pendingCount.textContent = state.pending.size; els.saveAll.disabled = state.pending.size === 0; }

  function updateRoleData(role) {
    const serialized = serializeDropList(role.entries)
    if (role.dropSlot?.kind === 'root') role.data.loopList = serialized
    else if (role.dropSlot?.kind === 'attribute') role.data.attributes[role.dropSlot.index].value = serialized
    else {
      if (!Array.isArray(role.data.attributes)) role.data.attributes = []
      role.data.attributes.push({ key: DROP_ATTRIBUTE_ID, value: serialized })
      role.dropSlot = { kind: 'attribute', index: role.data.attributes.length - 1, value: serialized }
    }
    return JSON.stringify(role.data, null, 2) + '\n'
  }

  function backupTimestamp() {
    const date = new Date()
    const two = (value) => String(value).padStart(2, '0')
    return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}_${two(date.getHours())}-${two(date.getMinutes())}-${two(date.getSeconds())}-${String(date.getMilliseconds()).padStart(3, '0')}`
  }

  async function writeTextHandle(handle, text) {
    const writable = await handle.createWritable()
    await writable.write(text)
    await writable.close()
  }

  async function createBackupBatch(roles) {
    if (!state.rootHandle) return null
    const currentTexts = new Map()
    for (const role of roles) {
      const current = await readText(role.handle)
      if (current !== role.raw) throw new Error(`${role.name} 已被外部修改。请重新扫描后再保存，当前更改未写入。`)
      currentTexts.set(role.path, current)
    }
    const timestamp = backupTimestamp()
    const backupRoot = await state.rootHandle.getDirectoryHandle(BACKUP_DIRECTORY, { create: true })
    const batchDirectory = await backupRoot.getDirectoryHandle(timestamp, { create: true })
    const manifest = { createdAt: new Date().toISOString(), project: state.rootHandle.name, files: [] }
    for (const role of roles) {
      const backupName = `${role.guid || 'actor'}_${basename(role.path)}`.replace(/[<>:"/\\|?*]/g, '_')
      const backupHandle = await batchDirectory.getFileHandle(backupName, { create: true })
      const originalText = currentTexts.get(role.path)
      await writeTextHandle(backupHandle, originalText)
      const verified = await readText(backupHandle)
      if (verified !== originalText) throw new Error(`${role.name} 的备份校验失败，已取消写入原文件`)
      manifest.files.push({ originalPath: role.path, backupFile: backupName, guid: role.guid })
    }
    const manifestHandle = await batchDirectory.getFileHandle('manifest.json', { create: true })
    await writeTextHandle(manifestHandle, JSON.stringify(manifest, null, 2) + '\n')
    return {
      timestamp,
      directory: `${BACKUP_DIRECTORY}/${timestamp}`,
      originalTexts: currentTexts,
      draftEntries: new Map(roles.map((role) => [role.path, role.entries.map((entry) => ({ ...entry }))])),
    }
  }

  async function rollbackRoles(roles, originalTexts, draftEntries) {
    const failures = []
    for (const role of roles) {
      try {
        const originalText = originalTexts.get(role.path)
        if (typeof originalText !== 'string') continue
        await writeTextHandle(role.handle, originalText)
        role.raw = originalText
        role.data = JSON.parse(originalText)
        role.dropSlot = findDropSlot(role.data)
        const restored = role.dropSlot ? parseDropList(role.dropSlot.value) : []
        role.originalEntries = restored.map((entry) => ({ ...entry }))
        role.entries = (draftEntries?.get(role.path) || restored).map((entry) => ({ ...entry }))
        state.pending.add(role.path)
      } catch {
        failures.push(role.name)
      }
    }
    updatePendingUi(); renderRoleList(); renderRoleEditor()
    if (failures.length) throw new Error(`写入失败且以下角色回滚失败：${failures.join('、')}。请从备份目录手动恢复。`)
  }

  async function writeRole(role, backupComplete = false) {
    if (state.rootHandle && !backupComplete) await createBackupBatch([role])
    const text = updateRoleData(role)
    if (state.rootHandle && role.handle?.createWritable) {
      await writeTextHandle(role.handle, text)
    } else if (role.file) {
      const blob = new Blob([text], { type: 'application/json;charset=utf-8' }); const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = basename(role.path); anchor.click(); URL.revokeObjectURL(url)
    } else throw new Error('当前文件不可写')
    role.raw = text
    role.originalEntries = role.entries.map((entry) => ({ ...entry })); state.pending.delete(role.path); updatePendingUi(); renderRoleList(); renderRoleEditor()
  }

  async function saveCurrent() {
    if (!state.selectedRole || !isDirty(state.selectedRole)) return
    let backup = null
    try {
      backup = state.rootHandle ? await createBackupBatch([state.selectedRole]) : null
      await writeRole(state.selectedRole, Boolean(backup))
      showToast('保存成功', `${state.selectedRole.name} 已写回${backup ? ` · 备份：${backup.directory}` : ' · 原文件未被覆盖，已下载修改副本'}`, 'success')
    } catch (error) {
      if (backup) {
        try { await rollbackRoles([state.selectedRole], backup.originalTexts, backup.draftEntries); showToast('保存失败，已自动回滚', `${error.message} · 用户编辑仍保留为未保存状态`, 'error') }
        catch (rollbackError) { showToast('保存与回滚均失败', rollbackError.message, 'error') }
      } else showToast('保存失败，原文件未修改', error.message, 'error')
    }
  }

  async function saveAll() {
    const roles = state.roles.filter((role) => state.pending.has(role.path)); if (!roles.length) return
    if (state.fallbackMode) { for (const role of roles) { try { await writeRole(role) } catch (error) { showToast('保存失败', error.message, 'error'); return } }; showToast('已导出更改', `原工程未被覆盖，已下载 ${roles.length} 个修改副本`, 'success'); return }
    let backup = null
    const attempted = []
    try {
      backup = await createBackupBatch(roles)
      for (const role of roles) { attempted.push(role); await writeRole(role, true) }
      showToast('全部保存成功', `已写回 ${roles.length} 个角色文件 · 备份：${backup.directory}`, 'success')
    } catch (error) {
      if (backup && attempted.length) {
        try { await rollbackRoles(attempted, backup.originalTexts, backup.draftEntries); showToast('保存失败，已自动回滚', `${error.message} · 用户编辑仍保留为未保存状态`, 'error') }
        catch (rollbackError) { showToast('保存与回滚均失败', rollbackError.message, 'error') }
      } else showToast('保存失败，原文件未修改', error.message, 'error')
    }
  }

  function showToast(title, detail, type = 'success') {
    const toast = document.createElement('div'); toast.className = `toast ${type}`; toast.innerHTML = `<div class="toast-title">${escapeHtml(title)}</div><div class="toast-detail">${escapeHtml(detail)}</div>`; els.toastRegion.appendChild(toast); setTimeout(() => toast.remove(), 3600)
  }

  function bindEvents() {
    const pickProject = async () => {
      if (!window.showDirectoryPicker) { els.fallback.click(); return }
      try { state.rootHandle = await window.showDirectoryPicker({ mode: 'readwrite' }); await scanProject() } catch (error) { if (error?.name !== 'AbortError') showToast('选择工程失败', error.message, 'error') }
    }
    els.pickProject.addEventListener('click', pickProject); els.welcomePick.addEventListener('click', pickProject); els.rescan.addEventListener('click', () => state.rootHandle ? scanProject() : els.fallback.click())
    els.restoreLast.addEventListener('click', restoreRememberedProject)
    els.fallback.addEventListener('change', (event) => { const files = [...event.target.files]; if (files.length) scanProject({ rootHandle: null, files }) })
    els.saveCurrent.addEventListener('click', saveCurrent); els.saveAll.addEventListener('click', saveAll); els.insertDrop.addEventListener('click', insertDrop)
    els.clearSelection.addEventListener('click', () => { state.selectedResource = null; renderCatalog(); renderComposer() })
    els.roleSearch.addEventListener('input', (event) => { state.roleSearch = event.target.value; renderRoleList() }); els.catalogSearch.addEventListener('input', (event) => { state.catalogSearch = event.target.value; renderCatalog() })
    $$('.catalog-tab').forEach((tab) => tab.addEventListener('click', () => { state.catalogType = tab.dataset.catalog; state.selectedResource = null; $$('.catalog-tab').forEach((node) => node.classList.toggle('active', node === tab)); renderCatalog(); renderComposer() }))
    els.quantityMinus.addEventListener('click', () => { els.quantity.value = Math.max(1, Number(els.quantity.value || 1) - 1) }); els.quantityPlus.addEventListener('click', () => { els.quantity.value = Math.min(1000000000, Number(els.quantity.value || 1) + 1) })
    document.addEventListener('keydown', (event) => { if (event.key === '/' && document.activeElement?.tagName !== 'INPUT') { event.preventDefault(); (state.selectedRole ? els.catalogSearch : els.roleSearch).focus() } })
  }

  bindEvents()
  loadRememberedProject()
})()
