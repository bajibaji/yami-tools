(() => {
  'use strict'

  const DROP_ATTRIBUTE_ID = '4cb407bd71929620'
  const DROP_COMMAND_ID = '249c9c9d4de177c9'
  const DROP_EVENT_TYPE = 'c2ba6c4f90edd668'
  const RESOURCE_DRAG_MIME = 'application/x-lootsmith-resource'
  // 固定写入顺序：人物属性先重建 attributes 数组，再写 loopList，最后写角色事件。
  // 重建数组会改变 loopList 的索引，因此 actorAttributes 必须排在 attribute 之前。
  const WRITE_MODE_ORDER = ['actorAttributes', 'attribute', 'event']
  const ACTOR_ATTRIBUTE_TYPES = new Set(['number', 'string', 'enum', 'boolean'])
  const SUPPORTED = new Set(['.item', '.equip', '.actor'])
  const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp'])
  const BACKUP_DIRECTORY = 'Lootsmith Backups'
  const state = {
    rootHandle: null,
    lastRootHandle: null,
    fallbackMode: false,
    allFiles: [],
    roles: [],
    roleMap: new Map(),
    dropCommandId: DROP_COMMAND_ID,
    dropEventType: DROP_EVENT_TYPE,
    items: [],
    equipments: [],
    definitions: new Map(),
    semanticIds: new Map(),
    localization: new Map(),
    actorAttributeDefinitions: new Map(),
    actorAttributeTree: [],
    enumGroups: new Map(),
    imageHandles: new Map(),
    imageBitmaps: new Map(),
    selectedRole: null,
    workspaceMode: 'drop',
    storageMode: 'attribute',
    catalogType: 'item',
    catalogSearch: '',
    roleSearch: '',
    selectedResource: null,
    composerModalOpen: false,
    dragDepth: 0,
    quantityMode: 'fixed',
    editingIndex: null,
    actorAttributeSearch: '',
    actorAttributeFilter: 'all',
    attributeAddOpen: false,
    selectedAddDefinitionId: null,
    unknownAttributesExpanded: false,
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
    saveCurrent: $('#save-current'), dropCount: $('#drop-count'), dirtyLabel: $('#dirty-label'), dropPanel: $('#drop-panel'), dropList: $('#drop-list'), dropEmpty: $('#drop-empty'), storageModeNote: $('#storage-mode-note'), catalogSearch: $('#catalog-search'), catalogList: $('#catalog-list'), catalogEmpty: $('#catalog-empty'),
    itemCountLabel: $('#item-count-label'), equipCountLabel: $('#equip-count-label'), itemTabCount: $('#item-tab-count'), equipmentTabCount: $('#equipment-tab-count'), composer: $('#selection-composer'), clearSelection: $('#clear-selection'), selectedType: $('#selected-resource-type'), selectedName: $('#selected-resource-name'), itemQuantityConfig: $('#item-quantity-config'), equipmentQuantityNote: $('#equipment-quantity-note'), fixedQuantityRow: $('#fixed-quantity-row'), rangeQuantityRow: $('#range-quantity-row'), fixedQuantity: $('#fixed-quantity'), minQuantity: $('#min-quantity'), maxQuantity: $('#max-quantity'), dropRateSlider: $('#drop-rate-slider'), dropRatePercent: $('#drop-rate-percent'), dropRateOutput: $('#drop-rate-output'), dropRateRaw: $('#drop-rate-raw'), cancelEdit: $('#cancel-edit'), insertDrop: $('#insert-drop'), toastRegion: $('#toast-region'),
    composerAnchor: $('#selection-composer-anchor'), composerModal: $('#drop-composer-modal'), composerModalContent: $('#drop-composer-modal-content'), closeComposerModalButton: $('#close-drop-composer'),
    dropEditorView: $('#drop-editor-view'), actorAttributeEditorView: $('#actor-attribute-editor-view'),
    workspaceModeButtons: () => $$('.workspace-mode-button'),
    attributeSummary: $('#attribute-summary'), attributeSearch: $('#attribute-search'), attributeFilters: $('#attribute-filters'), attributeList: $('#attribute-list'), addActorAttribute: $('#add-actor-attribute'),
    attributeAddModal: $('#attribute-add-modal'), attributeAddSearch: $('#attribute-add-search'), attributeAddList: $('#attribute-add-list'), attributeAddDetail: $('#attribute-add-detail'), attributeAddInfo: $('#attribute-add-info'), attributeAddValueRow: $('#attribute-add-value-row'), attributeAddConfirm: $('#attribute-add-confirm'), closeAttributeAdd: $('#close-attribute-add'),
  }

  const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]))
  const cloneJson = (value) => (typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value)))
  const deepEqual = (a, b) => JSON.stringify(a) === JSON.stringify(b)
  const normalizePath = (value) => String(value || '').replace(/\\/g, '/')
  const basename = (value) => normalizePath(value).split('/').pop() || ''
  const extension = (value) => { const match = basename(value).match(/\.[^.]+$/); return match ? match[0].toLowerCase() : '' }

  function isLoopListKey(key) {
    return key === DROP_ATTRIBUTE_ID || key === 'loopList' || state.definitions.get(key)?.key === 'loopList'
  }

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

  function flattenActorAttributeTree(nodes, folderPath, folderIds, output) {
    for (const node of Array.isArray(nodes) ? nodes : []) {
      if (!node || typeof node !== 'object' || typeof node.id !== 'string') continue
      if (node.class === 'folder' || Array.isArray(node.children)) {
        const name = typeof node.name === 'string' && node.name.trim() ? node.name : node.id
        flattenActorAttributeTree(node.children, [...folderPath, name], [...folderIds, node.id], output)
        output.push({ kind: 'folder', id: node.id, name, path: [...folderPath, name], folderIds: [...folderIds, node.id] })
        continue
      }
      if (typeof node.key !== 'string' || !node.key) continue
      // 非四类类型不进角色属性定义：出现在 attributes 中时按未知属性只读保留，
      // 避免把对象/数组等原始值降级成可编辑字符串造成数据破坏。
      if (!ACTOR_ATTRIBUTE_TYPES.has(node.type)) continue
      output.push({
        kind: 'leaf',
        id: node.id,
        key: node.key,
        type: node.type,
        name: typeof node.name === 'string' && node.name.trim() ? node.name : node.key,
        enumId: typeof node.enum === 'string' ? node.enum : '',
        note: typeof node.note === 'string' ? node.note : '',
        path: [...folderPath],
        folderIds: [...folderIds],
      })
    }
  }

  // 只解析 settings.actor 对应的角色属性分组，其它对象类型的属性定义不进入角色属性索引。
  function parseActorAttributeDefinitions(attributeJson) {
    state.actorAttributeDefinitions.clear()
    state.actorAttributeTree = []
    if (!attributeJson || typeof attributeJson !== 'object') return
    const actorFolderId = attributeJson.settings?.actor || ''
    const keys = Array.isArray(attributeJson.keys) ? attributeJson.keys : []
    const output = []
    flattenActorAttributeTree(keys, [], [], output)
    state.actorAttributeTree = output
    for (const item of output) {
      if (item.kind !== 'leaf') continue
      if (actorFolderId && !item.folderIds.includes(actorFolderId)) continue
      state.actorAttributeDefinitions.set(item.id, {
        id: item.id,
        key: item.key,
        type: item.type,
        name: item.name,
        enumId: item.enumId,
        note: item.note,
        folderPath: item.path,
      })
    }
  }

  function collectEnumItems(nodes, output = []) {
    for (const child of Array.isArray(nodes) ? nodes : []) {
      if (!child || typeof child !== 'object' || typeof child.id !== 'string') continue
      if (Array.isArray(child.children) && child.children.length) collectEnumItems(child.children, output)
      else output.push({ id: child.id, value: child.value, name: child.name, note: child.note || '' })
    }
    return output
  }

  // 只解析被角色属性引用的枚举组；枚举写回文件的是叶子 id，而不是 value。
  function parseEnumerationGroups(enumerationJson) {
    state.enumGroups.clear()
    if (!enumerationJson || typeof enumerationJson !== 'object') return
    const wanted = new Set([...state.actorAttributeDefinitions.values()].map((definition) => definition.enumId).filter(Boolean))
    if (!wanted.size) return
    const walk = (node) => {
      if (!node || typeof node !== 'object') return
      if (Array.isArray(node)) { node.forEach(walk); return }
      if (typeof node.id === 'string' && Array.isArray(node.children) && wanted.has(node.id)) {
        const items = collectEnumItems(node.children)
        if (items.length) {
          state.enumGroups.set(node.id, { id: node.id, name: typeof node.name === 'string' ? node.name : node.id, items })
          return
        }
      }
      Object.values(node).forEach(walk)
    }
    walk(enumerationJson)
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

  function clampInteger(value, fallback = 1) {
    return Math.max(1, Math.min(1000000000, Math.floor(Number(value) || fallback)))
  }

  function clampRate(value, fallback = 1) {
    let rate = Number(value)
    if (!Number.isFinite(rate)) rate = fallback
    if (rate > 1 && rate <= 100) rate /= 100
    return Math.max(0, Math.min(1, Number(rate.toFixed(6))))
  }

  function normalizeEntry(raw, index, disabled = false) {
    const type = entryType(raw)
    const legacyQuantity = raw?.quantity ?? raw?.count ?? raw?.amount ?? raw?.num ?? raw?.number ?? 1
    const min = type === 'equipment' ? 1 : clampInteger(raw?.min ?? legacyQuantity)
    const max = type === 'equipment' ? 1 : clampInteger(raw?.max ?? legacyQuantity, min)
    return {
      key: `${type}-${entryId(raw, type)}-${index}`,
      type,
      id: String(entryId(raw, type) || ''),
      min: Math.min(min, max),
      max: Math.max(min, max),
      dropRate: clampRate(raw?.dropRate ?? raw?.rate ?? raw?.chance, 1),
      // 禁用状态只由角色事件指令的显式参数传入。
      // 属性字符串不能使用禁用状态，且不能把 Array.prototype.map 的第三个参数误当成 disabled。
      disabled: Boolean(disabled),
      raw,
    }
  }

  function parseDropList(value) {
    const decoded = decodeJson(value)
    const list = Array.isArray(decoded) ? decoded : Array.isArray(decoded?.list) ? decoded.list : Array.isArray(decoded?.items) ? decoded.items : []
    // 不要直接传 normalizeEntry：Array#map 会把原数组作为第三个参数，
    // 而 normalizeEntry 的第三个参数正好是 disabled，导致属性条目全部变成“已禁用”。
    return list.map((raw, index) => normalizeEntry(raw, index, false)).filter((entry) => entry.id)
  }

  function serializeDropList(entries) {
    return JSON.stringify(entries.map((entry) => ({
      type: entry.type,
      id: entry.id,
      quantity: entry.min === entry.max ? clampInteger(entry.min) : clampInteger(entry.min),
      min: entry.type === 'equipment' ? 1 : clampInteger(entry.min),
      max: entry.type === 'equipment' ? 1 : clampInteger(entry.max),
      dropRate: clampRate(entry.dropRate),
    })))
  }

  function isDropCommand(command) {
    return command && String(command.id || '').replace(/^!/, '') === state.dropCommandId
  }

  function findDropEvent(data) {
    const events = Array.isArray(data?.events) ? data.events : []
    const index = events.findIndex((event) => event?.type === state.dropEventType)
    return index >= 0 ? { index, event: events[index] } : null
  }

  function parseEventEntries(event) {
    return (Array.isArray(event?.commands) ? event.commands : [])
      .filter(isDropCommand)
      .map((command, index) => normalizeEntry(command.params || {}, index, String(command.id).startsWith('!')))
      .filter((entry) => entry.id)
  }

  function findInheritedStore(role, roleMap, mode, seen = new Set()) {
    if (!role || seen.has(role.guid)) return null
    seen.add(role.guid)
    const ownSlot = mode === 'attribute' ? findDropSlot(role.data) : findDropEvent(role.data)
    if (ownSlot) return { sourceRole: role, sourceSlot: ownSlot, inherited: false }
    const parent = roleMap.get(role.data?.inherit)
    if (!parent) return null
    const inherited = findInheritedStore(parent, roleMap, mode, seen)
    return inherited ? { ...inherited, inherited: true } : null
  }

  function initializeRoleStores(role, roleMap) {
    const attributeSource = findInheritedStore(role, roleMap, 'attribute')
    const eventSource = findInheritedStore(role, roleMap, 'event')
    const attributeEntries = attributeSource ? parseDropList(attributeSource.sourceSlot.value) : []
    const eventEntries = eventSource ? parseEventEntries(eventSource.sourceSlot.event) : []
    // 人物属性草稿：覆盖角色 data.attributes 的全部本地条目（含未知属性和 loopList）。
    // 每条保留 raw 原始对象，保存时未知字段不会被丢弃。
    const actorAttributeEntries = []
    for (const [index, attr] of (Array.isArray(role.data.attributes) ? role.data.attributes : []).entries()) {
      if (!attr || typeof attr !== 'object') continue
      actorAttributeEntries.push({ key: attr.key, value: cloneJson(attr.value), raw: cloneJson(attr), localIndex: index })
    }
    role.stores = {
      attribute: {
        mode: 'attribute',
        ownSlot: findDropSlot(role.data),
        sourceRole: attributeSource?.sourceRole || null,
        sourceSlot: attributeSource?.sourceSlot || null,
        inherited: Boolean(attributeSource?.inherited),
        entries: attributeEntries.map((entry) => ({ ...entry })),
        originalEntries: attributeEntries.map((entry) => ({ ...entry })),
      },
      event: {
        mode: 'event',
        ownSlot: findDropEvent(role.data),
        sourceRole: eventSource?.sourceRole || null,
        sourceSlot: eventSource?.sourceSlot || null,
        inherited: Boolean(eventSource?.inherited),
        entries: eventEntries.map((entry) => ({ ...entry })),
        originalEntries: eventEntries.map((entry) => ({ ...entry })),
      },
      actorAttributes: {
        mode: 'actorAttributes',
        entries: actorAttributeEntries,
        originalEntries: cloneJson(actorAttributeEntries),
      },
    }
    role.dirtyModes = new Set()
  }

  // 解析当前角色的有效属性：先递归父角色（继承），再用当前角色本地值覆盖。
  // depth=0 表示当前角色本地；depth>=1 表示从第 depth 层父角色继承。
  // 用 seen 防止循环继承。未知属性同样参与解析并保留。
  function resolveEffectiveActorAttributes(role, roleMap, seen = new Set()) {
    const result = new Map()
    if (!role || seen.has(role.guid)) return result
    seen.add(role.guid)
    const parent = role.data?.inherit ? roleMap.get(role.data.inherit) : null
    if (parent) {
      for (const [key, info] of resolveEffectiveActorAttributes(parent, roleMap, seen)) {
        result.set(key, { ...info, depth: info.depth + 1 })
      }
    }
    for (const attr of Array.isArray(role.data?.attributes) ? role.data.attributes : []) {
      if (!attr || typeof attr !== 'object' || typeof attr.key !== 'string') continue
      result.set(attr.key, {
        key: attr.key,
        value: cloneJson(attr.value),
        definition: state.actorAttributeDefinitions.get(attr.key) || null,
        sourceRole: role,
        inherited: false,
        depth: 0,
      })
    }
    return result
  }

  function dropSlotLabel(role, store) {
    if (!store?.sourceSlot) return state.storageMode === 'event' ? '将新建“掉落物品”角色事件' : '将新建 loopList 属性'
    const source = store.inherited ? `继承自 ${store.sourceRole?.name || store.sourceRole?.guid}` : '当前角色本地数据'
    const location = state.storageMode === 'event' ? `角色事件 ${state.dropEventType}` : (store.sourceSlot.kind === 'root' ? '对象属性 loopList' : 'attributes / loopList')
    return `${source} · ${location}`
  }

  function makeRecord(file, data, kind) {
    const guid = resourceGuid(file.name)
    const attrName = getValue(data, 'name')
    const fallbackName = resourceName(file.name, guid)
    const localizationId = localizationIds(attrName)[0] || ''
    const imageGuid = kind === 'actor' ? (data.portrait || data.sprites?.find((sprite) => sprite?.image)?.image || '') : (data.icon || '')
    const clip = Array.isArray(data.clip) && data.clip.length >= 4 ? data.clip.slice(0, 4).map(Number) : null
    return { ...file, data, kind, guid, rawName: attrName, localizationId, name: localizedName(attrName, fallbackName), imageGuid, clip, edited: false, label: normalizePath(file.path) }
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
    const clip = resource?.clip?.join(',') || ''
    if (!resource?.imageGuid || !state.imageHandles.has(resource.imageGuid)) {
      return `<span class="resource-preview resource-preview-missing" aria-hidden="true"><span class="resource-preview-fallback">${escapeHtml(fallback)}</span></span>`
    }
    return `<span class="resource-preview" data-image-guid="${escapeHtml(resource.imageGuid)}" data-image-clip="${escapeHtml(clip)}"><canvas width="80" height="80"></canvas><span class="resource-preview-fallback">${escapeHtml(fallback)}</span></span>`
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
    state.definitions.clear(); state.semanticIds.clear(); state.localization.clear(); state.dropCommandId = DROP_COMMAND_ID; state.dropEventType = DROP_EVENT_TYPE
    state.actorAttributeDefinitions.clear(); state.actorAttributeTree = []; state.enumGroups.clear()
    let attributes = null
    let localization = null
    let enumeration = null
    let commands = null
    if (root) {
      const dataDir = await findNestedHandle(root, ['Data'])
      if (dataDir) {
        try { attributes = await readJsonHandle(await dataDir.getFileHandle('attribute.json')) } catch {}
        try { localization = await readJsonHandle(await dataDir.getFileHandle('localization.json')) } catch {}
        try { enumeration = await readJsonHandle(await dataDir.getFileHandle('enumeration.json')) } catch {}
        try { commands = await readJsonHandle(await dataDir.getFileHandle('commands.json')) } catch {}
      }
    } else {
      const attributeFile = fallbackFiles.find((file) => /(^|\/)Data\/attribute\.json$/i.test(normalizePath(file.webkitRelativePath || file.name)) || file.name.toLowerCase() === 'attribute.json')
      const localizationFile = fallbackFiles.find((file) => /(^|\/)Data\/localization\.json$/i.test(normalizePath(file.webkitRelativePath || file.name)) || file.name.toLowerCase() === 'localization.json')
      const enumerationFile = fallbackFiles.find((file) => /(^|\/)Data\/enumeration\.json$/i.test(normalizePath(file.webkitRelativePath || file.name)) || file.name.toLowerCase() === 'enumeration.json')
      const commandsFile = fallbackFiles.find((file) => /(^|\/)Data\/commands\.json$/i.test(normalizePath(file.webkitRelativePath || file.name)) || file.name.toLowerCase() === 'commands.json')
      if (attributeFile) { try { attributes = JSON.parse(await attributeFile.text()) } catch {} }
      if (localizationFile) { try { localization = JSON.parse(await localizationFile.text()) } catch {} }
      if (enumerationFile) { try { enumeration = JSON.parse(await enumerationFile.text()) } catch {} }
      if (commandsFile) { try { commands = JSON.parse(await commandsFile.text()) } catch {} }
    }
    if (attributes) { walkDefinitions(attributes); parseActorAttributeDefinitions(attributes) }
    if (localization) walkLocalization(localization)
    if (enumeration) parseEnumerationGroups(enumeration)
    const findByName = (node, predicate) => {
      if (!node || typeof node !== 'object') return null
      if (Array.isArray(node)) { for (const value of node) { const found = findByName(value, predicate); if (found) return found } return null }
      if (predicate(node)) return node.id || null
      for (const value of Object.values(node)) { const found = findByName(value, predicate); if (found) return found }
      return null
    }
    state.dropEventType = findByName(enumeration, (node) => node.name === '掉落物品' && node.value === 'drop') || DROP_EVENT_TYPE
    state.dropCommandId = findByName(commands, (node) => node.keywords === 'dropItem') || DROP_COMMAND_ID
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
    // 重新扫描后必须回到掉落编辑模式；人物属性模式不持久化。
    state.workspaceMode = 'drop'
    state.actorAttributeSearch = ''; state.actorAttributeFilter = 'all'; state.selectedAddDefinitionId = null; state.unknownAttributesExpanded = false
    const lastRolePath = rootHandle ? localStorage.getItem(`loot-smith-last-role:${rootHandle.name}`) : ''
    state.selectedRole = null
    state.imageHandles.clear()
    for (const bitmapPromise of state.imageBitmaps.values()) bitmapPromise.then((bitmap) => bitmap?.close?.()).catch(() => {})
    state.imageBitmaps.clear()
    setScanStatus('正在读取资源…')
    const all = rootHandle ? await scanDirectoryHandle(rootHandle) : await scanFallback(files || [])
    state.allFiles = all
    await readProjectMetadata(rootHandle, files || [])
    state.roles = all.filter((file) => file.ext === '.actor').map((file) => makeRecord(file, file.data, 'actor')).sort(sortRecords)
    state.items = all.filter((file) => file.ext === '.item').map((file) => makeRecord(file, file.data, 'item')).sort(sortRecords)
    state.equipments = all.filter((file) => file.ext === '.equip').map((file) => makeRecord(file, file.data, 'equipment')).sort(sortRecords)
    const recordMap = new Map([...state.roles, ...state.items, ...state.equipments].map((record) => [record.guid, record]))
    ;[...state.roles, ...state.items, ...state.equipments].forEach((record) => inheritMetadata(record, recordMap))
    state.roleMap = new Map(state.roles.map((role) => [role.guid, role]))
    state.roles.forEach((role) => initializeRoleStores(role, state.roleMap))
    state.fallbackMode = !rootHandle
    if (rootHandle) await rememberRootHandle(rootHandle)
    renderWorkspace()
    if (lastRolePath && state.roles.some((role) => role.path === lastRolePath)) selectRole(lastRolePath)
    setScanStatus(state.errors.length ? `扫描完成 · ${state.errors.length} 个文件异常` : `扫描完成 · ${all.length} 个资源`)
    showToast('扫描完成', `角色 ${state.roles.length} · 物品 ${state.items.length} · 装备 ${state.equipments.length}`, state.errors.length ? 'error' : 'success')
  }

  function sortRecords(a, b) { return a.name.localeCompare(b.name, 'zh-CN', { numeric: true }) || a.path.localeCompare(b.path) }
  function setScanStatus(text) { els.scanStatus.textContent = text }
  function currentStore() { return state.selectedRole?.stores?.[state.storageMode] || null }
  function currentEntries() { return currentStore()?.entries || [] }
  function isDirty(role) { return role && state.pending.has(role.path) }
  function markDirty(role, mode = state.storageMode) { role.edited = true; role.dirtyModes.add(mode); state.pending.add(role.path); updatePendingUi(); renderRoleList(); renderRoleEditor() }

  // 用稳定深比较判断某个模式的草稿是否与原始值一致；恢复原值后应调用它重新计算脏状态。
  function syncRoleDirtyState(role, mode) {
    const store = role.stores?.[mode]
    if (!store) return
    const changed = !deepEqual(store.entries, store.originalEntries)
    if (changed) role.dirtyModes.add(mode)
    else role.dirtyModes.delete(mode)
    role.edited = role.edited || changed
    if (role.dirtyModes.size) state.pending.add(role.path)
    else state.pending.delete(role.path)
    updatePendingUi(); renderRoleList()
  }

  function actorAttributeEntryModified(store, entry) {
    const original = store.originalEntries.find((item) => item.key === entry.key)
    if (!original) return true
    return !deepEqual(original.value, entry.value)
  }

  function defaultValueForDefinition(definition) {
    switch (definition?.type) {
      case 'number': return 0
      case 'boolean': return false
      case 'enum': return ''
      default: return ''
    }
  }

  function commitActorAttributeValue(role, index, value) {
    const entry = role.stores.actorAttributes.entries[index]
    if (!entry) return
    entry.value = cloneJson(value)
    entry.raw = { ...cloneJson(entry.raw || {}), key: entry.key, value: cloneJson(value) }
    syncRoleDirtyState(role, 'actorAttributes')
    renderActorAttributeEditor()
  }

  function removeActorAttribute(index) {
    const role = state.selectedRole
    const store = role?.stores?.actorAttributes
    const entry = store?.entries[index]
    if (!role || !store || !entry) return
    if (isLoopListKey(entry.key)) { showToast('无法删除', 'loopList 由掉落编辑器管理，请前往掉落编辑', 'error'); return }
    const definition = state.actorAttributeDefinitions.get(entry.key)
    const name = definition?.name || entry.key || '无 ID 属性'
    const confirmMessage = definition
      ? `确定从 ${role.name} 删除属性“${name}”（${definition.key} · ${entry.key}）？保存后将从文件中移除。`
      : `确定删除未知属性 ${entry.key || '（无 ID）'}？此属性不在当前属性定义中，删除后无法通过本工具恢复。`
    if (!window.confirm(confirmMessage)) return
    store.entries.splice(index, 1)
    syncRoleDirtyState(role, 'actorAttributes')
    renderActorAttributeEditor()
    showToast('已删除', `属性“${name}”将在保存后从 ${role.name} 移除`, 'success')
  }

  function revertActorAttribute(index) {
    const role = state.selectedRole
    const store = role?.stores?.actorAttributes
    const entry = store?.entries[index]
    if (!role || !store || !entry) return
    if (isLoopListKey(entry.key)) { showToast('无法恢复', 'loopList 由掉落编辑器管理', 'error'); return }
    const original = store.originalEntries.find((item) => item.key === entry.key)
    if (original) store.entries[index] = cloneJson(original)
    else store.entries.splice(index, 1)
    syncRoleDirtyState(role, 'actorAttributes')
    renderActorAttributeEditor()
    showToast('已恢复原值', '属性已还原为原始值', 'success')
  }

  function createLocalOverride(key) {
    const role = state.selectedRole
    if (!role) return
    if (isLoopListKey(key)) { showToast('无法创建覆盖', 'loopList 由掉落编辑器管理', 'error'); return }
    const definition = state.actorAttributeDefinitions.get(key)
    const effective = resolveEffectiveActorAttributes(role, state.roleMap)
    const info = effective.get(key)
    if (!definition) { showToast('无法创建覆盖', '未知属性不能创建本地覆盖', 'error'); return }
    if (role.stores.actorAttributes.entries.some((entry) => entry.key === key)) { showToast('已存在本地值', '该属性当前角色已有本地值，请直接编辑', 'error'); return }
    const value = cloneJson(info ? info.value : defaultValueForDefinition(definition))
    role.stores.actorAttributes.entries.push({ key, value, raw: { key, value: cloneJson(value) }, localIndex: -1 })
    syncRoleDirtyState(role, 'actorAttributes')
    renderActorAttributeEditor()
    showToast('已创建本地覆盖', `“${definition.name}”将在保存后写入 ${role.name}，父角色未修改`, 'success')
  }

  function addActorAttribute(definition, value) {
    const role = state.selectedRole
    if (!role || !definition) return false
    const store = role.stores.actorAttributes
    if (store.entries.some((entry) => entry.key === definition.id)) return false
    store.entries.push({ key: definition.id, value: cloneJson(value), raw: { key: definition.id, value: cloneJson(value) }, localIndex: -1 })
    syncRoleDirtyState(role, 'actorAttributes')
    renderActorAttributeEditor()
    return true
  }

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
    els.roleList.innerHTML = roles.length ? roles.map((role) => {
      const edited = Boolean(role.edited || isDirty(role))
      return `<div class="role-row ${state.selectedRole?.path === role.path ? 'selected' : ''} ${edited ? 'edited-role' : ''}" data-role-path="${escapeHtml(role.path)}" title="${edited ? '此角色已编辑' : ''}"><div class="role-avatar-small">${previewMarkup(role, '✦')}</div><div class="role-row-info"><div class="role-row-name">${escapeHtml(role.name)}</div><div class="role-row-path">${escapeHtml(role.localizationId ? `本地化 ${role.localizationId}` : role.path)}</div></div><span class="role-row-status ${isDirty(role) ? 'dirty' : ''} ${edited ? 'edited' : ''}"></span></div>`
    }).join('') : '<div class="list-message">没有匹配的角色</div>'
    $$('.role-row').forEach((row) => row.addEventListener('click', () => selectRole(row.dataset.rolePath)))
    hydratePreviews(els.roleList)
  }

  function selectRole(path) {
    state.selectedRole = state.roles.find((role) => role.path === path) || null
    if (state.rootHandle && state.selectedRole) localStorage.setItem(`loot-smith-last-role:${state.rootHandle.name}`, state.selectedRole.path)
    closeComposerModal({ clear: false })
    state.selectedResource = null; state.editingIndex = null; els.catalogSearch.value = ''; state.catalogSearch = ''
    renderRoleList(); renderRoleEditor(); renderCatalog(); renderComposer()
  }

  function selectStorageMode(mode) {
    if (!['attribute', 'event'].includes(mode) || state.storageMode === mode) return
    closeComposerModal()
    state.storageMode = mode
    state.selectedResource = null
    state.editingIndex = null
    $$('.storage-mode-button').forEach((button) => button.classList.toggle('active', button.dataset.storageMode === mode))
    renderRoleEditor(); renderCatalog(); renderComposer()
  }

  function renderWorkspaceModeSwitch() {
    els.workspaceModeButtons().forEach((button) => button.classList.toggle('active', button.dataset.workspaceMode === state.workspaceMode))
  }

  function setWorkspaceMode(mode) {
    if (!['drop', 'actor-attributes'].includes(mode) || state.workspaceMode === mode) return
    state.workspaceMode = mode
    renderRoleEditor()
  }

  function renderRoleEditor() {
    if (!state.selectedRole) { els.noRole.classList.remove('hidden'); els.roleEditor.classList.add('hidden'); return }
    els.noRole.classList.add('hidden'); els.roleEditor.classList.remove('hidden')
    const role = state.selectedRole; const store = currentStore()
    els.roleName.textContent = role.name; els.rolePath.textContent = role.path; els.roleGuid.textContent = role.guid ? `GUID ${role.guid}` : '文件名未包含标准 GUID'
    const attributeMode = state.workspaceMode === 'actor-attributes'
    els.roleSlotState.textContent = attributeMode
      ? `${role.localizationId ? `本地化 ${role.localizationId} · ` : ''}人物属性 · 写入 attributes 数组`
      : `${role.localizationId ? `本地化 ${role.localizationId} · ` : ''}${dropSlotLabel(role, store)}`
    els.roleAvatar.innerHTML = previewMarkup(role, role.name.slice(0, 1) || '✦')
    els.dirtyLabel.classList.toggle('hidden', !isDirty(role)); els.saveCurrent.disabled = !state.rootHandle && !state.fallbackMode
    renderWorkspaceModeSwitch()
    els.dropEditorView.classList.toggle('hidden', attributeMode)
    els.actorAttributeEditorView.classList.toggle('hidden', !attributeMode)
    if (attributeMode) renderActorAttributeEditor()
    else renderDropEditor()
    hydratePreviews(els.roleEditor)
  }

  function renderDropEditor() {
    const role = state.selectedRole; const store = currentStore(); const entries = currentEntries()
    els.dropCount.textContent = entries.length
    els.storageModeNote.textContent = state.storageMode === 'event'
      ? '保存时写入角色的“掉落物品”事件指令；装备固定 1 件，物品使用 min/max。'
      : '保存时写入 loopList 字符串；包含 min、max 与 dropRate，需由读取该属性的游戏逻辑支持。'
    els.dropList.innerHTML = entries.length ? entries.map((entry, index) => renderDropRow(entry, index)).join('') : ''
    els.dropEmpty.classList.toggle('hidden', entries.length > 0)
    $$('.remove-drop').forEach((button) => button.addEventListener('click', () => removeDrop(Number(button.dataset.index))))
    $$('.edit-drop').forEach((button) => button.addEventListener('click', () => editDrop(Number(button.dataset.index))))
    $$('.toggle-drop').forEach((button) => button.addEventListener('click', () => toggleDrop(Number(button.dataset.index))))
  }

  // ---- 人物属性编辑视图 ----

  function actorAttributeViewRows() {
    const role = state.selectedRole
    const store = role.stores.actorAttributes
    const effective = resolveEffectiveActorAttributes(role, state.roleMap)
    const localKeys = new Set(store.entries.map((entry) => entry.key))
    const rows = []
    for (const [index, entry] of store.entries.entries()) {
      rows.push({
        kind: 'local',
        entry,
        index,
        definition: state.actorAttributeDefinitions.get(entry.key) || null,
        modified: actorAttributeEntryModified(store, entry),
        protected: isLoopListKey(entry.key),
      })
    }
    for (const [key, info] of effective) {
      if (info.depth === 0 || localKeys.has(key)) continue
      rows.push({ kind: 'inherited', key, value: info.value, definition: info.definition, sourceRole: info.sourceRole })
    }
    return rows
  }

  function actorAttributeRowSearchText(row) {
    const definition = row.definition
    const entry = row.entry || {}
    const valueText = typeof entry.value === 'string' ? entry.value : (typeof row.value === 'string' ? row.value : JSON.stringify(entry.value ?? row.value ?? ''))
    return `${definition?.name || ''} ${definition?.key || ''} ${definition?.id || entry.key || ''} ${(definition?.folderPath || []).join('/')} ${definition?.note || ''} ${valueText}`.toLowerCase()
  }

  function renderActorAttributeEditor() {
    const view = els.actorAttributeEditorView
    if (!view || !state.selectedRole) return
    const role = state.selectedRole
    try {
      const store = role.stores.actorAttributes
      const rows = actorAttributeViewRows()
      const query = state.actorAttributeSearch.trim().toLowerCase()
      const filter = state.actorAttributeFilter
      const localRows = rows.filter((row) => row.kind === 'local')
      const inheritedRows = rows.filter((row) => row.kind === 'inherited')
      const unknownCount = localRows.filter((row) => !row.definition).length + inheritedRows.filter((row) => !row.definition).length
      // 与添加弹窗候选保持一致（已排除本地已有与受保护的 loopList）。
      const addableCount = addableActorAttributeDefinitions().length
      els.attributeSummary.textContent = `本地 ${localRows.length} · 继承 ${inheritedRows.length} · 可添加 ${addableCount} · 未知 ${unknownCount}`
      if (els.attributeSearch && els.attributeSearch.value !== state.actorAttributeSearch) els.attributeSearch.value = state.actorAttributeSearch
      const filtered = rows.filter((row) => {
        if (filter === 'local' && row.kind !== 'local') return false
        if (filter === 'inherited' && row.kind !== 'inherited') return false
        if (filter === 'modified' && !(row.kind === 'local' && row.modified)) return false
        if (filter === 'unknown' && row.definition) return false
        if (query && !actorAttributeRowSearchText(row).includes(query)) return false
        return true
      })
      // 未知属性（不在定义中）默认折叠成一行，减少视觉噪音；搜索或“未知”筛选时自动展开。
      const knownRows = filtered.filter((row) => row.definition)
      const unknownRows = filtered.filter((row) => !row.definition)
      if (!filtered.length) {
        els.attributeList.innerHTML = '<div class="list-message">没有匹配的属性</div>'
      } else {
        els.attributeList.innerHTML = knownRows.map((row) => renderActorAttributeRow(row)).join('') + (unknownRows.length ? renderUnknownAttributeCollapse(unknownRows) : '')
      }
    } catch (error) {
      // 错误边界：单个异常属性不能导致整个页面不可用。
      els.attributeList.innerHTML = `<div class="list-message">属性列表渲染失败：${escapeHtml(error.message)}</div>`
    }
  }

  function enumOptionLabel(item) {
    return `${item.name || item.value || item.id} · ${item.value ?? ''} · ${item.id}`
  }

  function renderActorAttributeRow(row) {
    if (row.kind === 'inherited') return renderInheritedAttributeRow(row)
    const { entry, index, definition, modified, protected: isProtected } = row
    if (isProtected) return renderProtectedAttributeRow(entry, index)
    if (!definition) return renderUnknownAttributeRow(entry, index, modified)
    const badges = `<span class="type-badge type-${definition.type}">${definition.type}</span><span class="origin-badge local">本地</span>${modified ? '<span class="origin-badge modified">已修改</span>' : ''}`
    const group = (definition.folderPath || []).join(' / ')
    const sub = `${definition.key}${group ? ` · ${group}` : ''}`
    const fullSub = `${definition.key} · ${definition.id}${group ? ` · ${group}` : ''}`
    const control = renderAttributeControl(entry, index, definition)
    const actions = modified
      ? `<button class="attribute-action" data-attr-action="revert" data-attr-index="${index}" type="button" title="恢复原值">↺ 恢复原值</button>`
      : ''
    return `<div class="attribute-row local-row"><div class="attribute-row-info"><div class="attribute-row-title"><span class="attribute-row-name">${escapeHtml(definition.name)}</span>${badges}</div><div class="attribute-row-sub" title="${escapeHtml(fullSub)}">${escapeHtml(sub)}</div></div><div class="attribute-row-control">${control}</div><div class="attribute-row-actions">${actions}<button class="attribute-action danger" data-attr-action="remove" data-attr-index="${index}" type="button" title="删除此本地属性">删除</button></div></div>`
  }

  function renderAttributeControl(entry, index, definition) {
    if (definition.type === 'number') {
      return `<input class="attribute-input number" type="number" step="any" data-attr-input="value" data-attr-index="${index}" value="${escapeHtml(String(entry.value))}" />`
    }
    if (definition.type === 'boolean') {
      return `<label class="attribute-boolean"><input type="checkbox" data-attr-input="value" data-attr-index="${index}" ${entry.value ? 'checked' : ''} /><span>${entry.value ? '启用' : '关闭'}</span></label>`
    }
    if (definition.type === 'enum') {
      const group = state.enumGroups.get(definition.enumId)
      const options = []
      if (group) {
        const known = group.items.some((item) => item.id === entry.value)
        if (!known && entry.value) options.push(`<option value="${escapeHtml(entry.value)}" selected>未知枚举值 · ${escapeHtml(entry.value)}（保持原值）</option>`)
        options.push(`<option value="" ${!known || entry.value === '' ? 'selected' : ''}>（不设置）</option>`)
        for (const item of group.items) options.push(`<option value="${escapeHtml(item.id)}" ${entry.value === item.id ? 'selected' : ''}>${escapeHtml(enumOptionLabel(item))}</option>`)
      } else {
        options.push(`<option value="${escapeHtml(String(entry.value ?? ''))}" selected>${escapeHtml(String(entry.value ?? '')) || '（无枚举定义）'}</option>`)
      }
      return `<select class="attribute-input enum" data-attr-input="value" data-attr-index="${index}">${options.join('')}</select>`
    }
    return `<textarea class="attribute-input string" rows="2" data-attr-input="value" data-attr-index="${index}">${escapeHtml(String(entry.value ?? ''))}</textarea>`
  }

  function renderUnknownAttributeCollapse(rows) {
    const expanded = state.unknownAttributesExpanded || state.actorAttributeFilter === 'unknown' || Boolean(state.actorAttributeSearch.trim())
    return `<div class="attribute-collapse${expanded ? ' expanded' : ''}"><button class="attribute-collapse-toggle" type="button" data-attr-action="toggle-unknown" title="展开/收起未知属性"><span class="collapse-arrow">${expanded ? '▾' : '▸'}</span><span>未知属性（不在当前 attribute.json 定义中，只读保留）</span><span class="collapse-count">${rows.length} 条</span></button><div class="attribute-collapse-body${expanded ? '' : ' hidden'}">${rows.map((row) => renderActorAttributeRow(row)).join('')}</div></div>`
  }

  function renderUnknownAttributeRow(entry, index, modified) {
    const raw = JSON.stringify(entry.value)
    const preview = raw.length > 60 ? `${escapeHtml(raw.slice(0, 60))}…` : escapeHtml(raw)
    return `<div class="attribute-row local-row unknown-row"><div class="attribute-row-info"><div class="attribute-row-title"><span class="attribute-row-name">未知属性</span><span class="type-badge type-unknown">unknown</span><span class="origin-badge unknown">未知</span>${modified ? '<span class="origin-badge modified">已修改</span>' : ''}</div><div class="attribute-row-sub" title="${escapeHtml(entry.key || '无 ID')}">${escapeHtml(entry.key || '无 ID')}</div></div><div class="attribute-row-control"><div class="attribute-raw-value" title="原始值 ${escapeHtml(raw)}">${preview}</div></div><div class="attribute-row-actions"><button class="attribute-action danger" data-attr-action="remove" data-attr-index="${index}" type="button" title="删除未知属性（二次确认）">删除</button></div></div>`
  }

  function renderProtectedAttributeRow(entry, index) {
    const text = typeof entry.value === 'string' && entry.value ? entry.value : ''
    const preview = text ? `${escapeHtml(text.slice(0, 80))}${text.length > 80 ? '…' : ''}` : '（空）'
    return `<div class="attribute-row protected-row"><div class="attribute-row-info"><div class="attribute-row-title"><span class="attribute-row-name">掉落列表</span><span class="type-badge type-string">string</span><span class="origin-badge protected">由掉落编辑器管理</span></div><div class="attribute-row-sub">loopList · ${DROP_ATTRIBUTE_ID}</div></div><div class="attribute-row-control"><div class="attribute-raw-value" title="${escapeHtml(text)}">${preview}</div></div><div class="attribute-row-actions"><button class="attribute-action" data-attr-action="goto-drop" type="button">前往掉落编辑 →</button></div></div>`
  }

  function renderInheritedValueText(definition, value) {
    if (definition.type === 'boolean') return value ? 'true（启用）' : 'false（关闭）'
    if (definition.type === 'enum') {
      const group = state.enumGroups.get(definition.enumId)
      const item = group?.items.find((entry) => entry.id === value)
      if (item) return `${escapeHtml(item.name || item.value || item.id)} · ${escapeHtml(item.value ?? '')} · ${escapeHtml(item.id)}`
      return value ? `未知枚举值 · ${escapeHtml(String(value))}（保持原值）` : '（空）'
    }
    return escapeHtml(String(value ?? '')) || '（空）'
  }

  function renderInheritedAttributeRow(row) {
    const definition = row.definition
    const sourceName = row.sourceRole?.name || row.sourceRole?.guid || '父角色'
    // 继承的 loopList 同样受保护：禁止创建本地覆盖，只能由掉落编辑器管理。
    if (isLoopListKey(row.key)) {
      const text = typeof row.value === 'string' && row.value ? row.value : ''
      const preview = text ? `${escapeHtml(text.slice(0, 80))}${text.length > 80 ? '…' : ''}` : '（空）'
      return `<div class="attribute-row protected-row inherited-row"><div class="attribute-row-info"><div class="attribute-row-title"><span class="attribute-row-name">掉落列表</span><span class="type-badge type-string">string</span><span class="origin-badge inherited">继承自 ${escapeHtml(sourceName)}</span><span class="origin-badge protected">由掉落编辑器管理</span></div><div class="attribute-row-sub">loopList · ${DROP_ATTRIBUTE_ID}</div></div><div class="attribute-row-control"><div class="attribute-raw-value" title="${escapeHtml(text)}">${preview}</div></div><div class="attribute-row-actions"><button class="attribute-action" data-attr-action="goto-drop" type="button">前往掉落编辑 →</button></div></div>`
    }
    if (!definition) {
      const raw = JSON.stringify(row.value)
      const preview = raw.length > 60 ? `${escapeHtml(raw.slice(0, 60))}…` : escapeHtml(raw)
      return `<div class="attribute-row unknown-row"><div class="attribute-row-info"><div class="attribute-row-title"><span class="attribute-row-name">未知属性</span><span class="type-badge type-unknown">unknown</span><span class="origin-badge inherited">继承自 ${escapeHtml(sourceName)}</span></div><div class="attribute-row-sub" title="${escapeHtml(row.key || '无 ID')}">${escapeHtml(row.key || '无 ID')}</div></div><div class="attribute-row-control"><div class="attribute-raw-value" title="原始值 ${escapeHtml(raw)}">${preview}</div></div><div class="attribute-row-actions"></div></div>`
    }
    const badges = `<span class="type-badge type-${definition.type}">${definition.type}</span><span class="origin-badge inherited">继承自 ${escapeHtml(sourceName)}</span>`
    const group = (definition.folderPath || []).join(' / ')
    const sub = `${definition.key}${group ? ` · ${group}` : ''}`
    const fullSub = `${definition.key} · ${definition.id}${group ? ` · ${group}` : ''}`
    return `<div class="attribute-row inherited-row"><div class="attribute-row-info"><div class="attribute-row-title"><span class="attribute-row-name">${escapeHtml(definition.name)}</span>${badges}</div><div class="attribute-row-sub" title="${escapeHtml(fullSub)}">${escapeHtml(sub)}</div></div><div class="attribute-row-control"><div class="attribute-inherited-value" title="只读 · 创建本地覆盖后才会写入当前角色，父角色不被修改。">${renderInheritedValueText(definition, row.value)}</div></div><div class="attribute-row-actions"><button class="attribute-action" data-attr-action="override" data-attr-key="${escapeHtml(row.key)}" type="button">创建本地覆盖</button></div></div>`
  }

  // ---- 添加人物属性弹窗 ----

  function addableActorAttributeDefinitions() {
    const role = state.selectedRole
    if (!role) return []
    const localKeys = new Set(role.stores.actorAttributes.entries.map((entry) => entry.key))
    // loopList 由掉落编辑器管理，禁止手动添加。
    return [...state.actorAttributeDefinitions.values()].filter((definition) => !localKeys.has(definition.id) && !isLoopListKey(definition.id))
  }

  function openAttributeAddModal() {
    const role = state.selectedRole
    if (!role || !els.attributeAddModal) return
    state.attributeAddOpen = true
    els.attributeAddModal.classList.remove('hidden')
    els.attributeAddModal.setAttribute('aria-hidden', 'false')
    els.attributeAddSearch.value = ''
    state.selectedAddDefinitionId = null
    renderAttributeAddList()
    els.attributeAddDetail.classList.add('hidden')
    els.attributeAddSearch.focus()
  }

  function closeAttributeAddModal() {
    if (!els.attributeAddModal) return
    state.attributeAddOpen = false
    els.attributeAddModal.classList.add('hidden')
    els.attributeAddModal.setAttribute('aria-hidden', 'true')
    els.attributeAddDetail.classList.add('hidden')
  }

  function renderAttributeAddList() {
    if (!els.attributeAddList) return
    const query = els.attributeAddSearch.value.trim().toLowerCase()
    const candidates = addableActorAttributeDefinitions().filter((definition) => !query || `${definition.name} ${definition.key} ${definition.id} ${(definition.folderPath || []).join('/')} ${definition.note}`.toLowerCase().includes(query))
    if (!candidates.length) {
      els.attributeAddList.innerHTML = '<div class="list-message">没有可添加的属性（当前角色已拥有全部角色属性定义）</div>'
      return
    }
    els.attributeAddList.innerHTML = candidates.map((definition) => {
      const selected = state.selectedAddDefinitionId === definition.id
      return `<div class="attribute-add-row ${selected ? 'selected' : ''}" data-add-def-id="${escapeHtml(definition.id)}"><div class="attribute-add-row-name">${escapeHtml(definition.name)}<span class="type-badge type-${definition.type}">${definition.type}</span></div><div class="attribute-add-row-sub">${escapeHtml(definition.key)} · ${escapeHtml(definition.id)} · ${escapeHtml((definition.folderPath || []).join(' / '))}</div></div>`
    }).join('')
    $$('.attribute-add-row').forEach((row) => row.addEventListener('click', () => {
      state.selectedAddDefinitionId = row.dataset.addDefId
      renderAttributeAddList()
      renderAttributeAddDetail()
    }))
  }

  function renderAttributeAddDetail() {
    const definition = state.actorAttributeDefinitions.get(state.selectedAddDefinitionId || '')
    if (!definition || !els.attributeAddDetail) { els.attributeAddDetail?.classList.add('hidden'); return }
    els.attributeAddDetail.classList.remove('hidden')
    const effective = resolveEffectiveActorAttributes(state.selectedRole, state.roleMap)
    const inherited = effective.get(definition.id)
    const isOverride = Boolean(inherited)
    const defaultValue = inherited ? cloneJson(inherited.value) : defaultValueForDefinition(definition)
    els.attributeAddInfo.innerHTML = `<div class="attribute-add-info-name">${escapeHtml(definition.name)}${isOverride ? '<span class="origin-badge inherited">将创建本地覆盖</span>' : ''}</div><div class="attribute-add-info-sub">${escapeHtml(definition.key)} · ${escapeHtml(definition.id)} · ${escapeHtml((definition.folderPath || []).join(' / '))}</div><div class="attribute-add-info-type">类型 ${escapeHtml(definition.type)}${definition.note ? ` · 说明：${escapeHtml(definition.note)}` : ''}</div>${isOverride ? `<div class="attribute-add-info-inherit">当前为继承值（${escapeHtml(inherited.sourceRole?.name || inherited.sourceRole?.guid || '父角色')}），添加后将写入当前角色本地，父角色不被修改。</div>` : ''}`
    els.attributeAddValueRow.innerHTML = renderAttributeAddValueControl(definition, defaultValue)
    els.attributeAddConfirm.innerHTML = isOverride ? '创建本地覆盖 <span>→</span>' : '添加到当前角色 <span>→</span>'
  }

  function renderAttributeAddValueControl(definition, defaultValue) {
    if (definition.type === 'number') {
      return `<label class="attribute-add-value-label">初始值<input class="attribute-input number" type="number" step="any" id="attribute-add-value" value="${escapeHtml(String(defaultValue))}" /></label>`
    }
    if (definition.type === 'boolean') {
      return `<label class="attribute-boolean"><input type="checkbox" id="attribute-add-value" ${defaultValue ? 'checked' : ''} /><span>启用（写回 true）</span></label>`
    }
    if (definition.type === 'enum') {
      const group = state.enumGroups.get(definition.enumId)
      let options = '<option value="">请选择枚举值…</option>'
      if (group) {
        const selected = group.items.some((item) => item.id === defaultValue) ? defaultValue : ''
        for (const item of group.items) options += `<option value="${escapeHtml(item.id)}" ${selected === item.id ? 'selected' : ''}>${escapeHtml(enumOptionLabel(item))}</option>`
      } else {
        options += `<option value="${escapeHtml(String(defaultValue ?? ''))}" selected>${escapeHtml(String(defaultValue ?? '')) || '（无枚举定义）'}</option>`
      }
      return `<label class="attribute-add-value-label">初始值<select class="attribute-input enum" id="attribute-add-value">${options}</select><small>写入文件的是枚举项 ID</small></label>`
    }
    return `<label class="attribute-add-value-label">初始值<input class="attribute-input string" type="text" id="attribute-add-value" value="${escapeHtml(String(defaultValue ?? ''))}" /></label>`
  }

  function confirmAttributeAdd() {
    const role = state.selectedRole
    const definition = state.actorAttributeDefinitions.get(state.selectedAddDefinitionId || '')
    if (!role || !definition) return
    const input = $('#attribute-add-value')
    let value = input ? input.value : ''
    if (definition.type === 'number') {
      const raw = String(value).trim()
      const numeric = Number(value)
      if (raw === '' || !Number.isFinite(numeric)) { showToast('数值无效', '请输入有效的数字（允许 0、负数和小数）', 'error'); return }
      value = numeric
    } else if (definition.type === 'boolean') {
      value = Boolean(input && input.checked)
    } else if (definition.type === 'enum') {
      const group = state.enumGroups.get(definition.enumId)
      if (group && !value) { showToast('请选择枚举值', '枚举属性必须选择定义中的一个枚举项', 'error'); return }
    }
    if (addActorAttribute(definition, value)) {
      showToast('已添加', `属性“${definition.name}”已加入 ${role.name} 草稿，保存后写回`, 'success')
      closeAttributeAddModal()
      state.selectedAddDefinitionId = null
    } else {
      showToast('无法添加', '该属性当前角色已有本地值，请直接编辑现有行', 'error')
    }
  }

  function resourceForEntry(entry) { return (entry.type === 'equipment' ? state.equipments : state.items).find((resource) => resource.guid === entry.id) }
  function formatPercent(rate) {
    const percent = clampRate(rate) * 100
    return `${Number(percent.toFixed(4))}%`
  }

  function quantityLabel(entry) {
    if (entry.type === 'equipment') return '固定 1 件'
    return entry.min === entry.max ? `固定 ${entry.min} 件` : `${entry.min}–${entry.max} 件`
  }

  function renderDropRow(entry, index) {
    const resource = resourceForEntry(entry); const displayName = resource?.name || entry.id || '未知资源'; const typeLabel = entry.type === 'equipment' ? '装备' : '物品'
    const eventMode = state.storageMode === 'event'
    const disabled = eventMode && entry.disabled
    const toggle = eventMode ? `<button class="toggle-drop ${disabled ? 'is-disabled' : ''}" data-index="${index}" type="button" aria-label="${disabled ? '启用掉落物' : '禁用掉落物'}" title="${disabled ? '启用掉落物' : '禁用掉落物'}">${disabled ? '◌' : '●'}</button>` : ''
    return `<div class="drop-row ${eventMode ? 'event-row' : 'attribute-row'} ${disabled ? 'disabled-entry' : ''}"><div class="resource-icon ${entry.type}">${previewMarkup(resource, entry.type === 'equipment' ? '◇' : '◆')}</div><div class="drop-row-info"><div class="drop-row-name">${escapeHtml(displayName)}${disabled ? '<span class="disabled-chip">已禁用</span>' : ''}</div><div class="drop-row-sub">${typeLabel}${resource?.localizationId ? ` · 本地化 ${escapeHtml(resource.localizationId)}` : ''} · ${escapeHtml(entry.id)}</div></div><div class="drop-metrics"><span>${escapeHtml(quantityLabel(entry))}</span><b>${escapeHtml(formatPercent(entry.dropRate))}</b></div>${toggle}<button class="edit-drop" data-index="${index}" type="button" aria-label="编辑掉落物">✎</button><button class="remove-drop" data-index="${index}" type="button" aria-label="移除掉落物">×</button></div>`
  }

  function renderCatalog() {
    const source = state.catalogType === 'item' ? state.items : state.equipments
    const query = state.catalogSearch.trim().toLowerCase()
    const list = source.filter((resource) => !query || `${resource.name} ${resource.localizationId} ${resource.path} ${resource.guid}`.toLowerCase().includes(query))
    els.catalogList.innerHTML = list.length ? list.map((resource) => `<div class="catalog-row ${state.selectedResource?.guid === resource.guid ? 'selected' : ''}" data-resource-guid="${escapeHtml(resource.guid)}" data-resource-type="${escapeHtml(resource.kind)}" draggable="true" aria-grabbed="false" title="拖到掉落列表进行配置，或点击后手动插入"><div class="resource-icon ${resource.kind}">${previewMarkup(resource, resource.kind === 'equipment' ? '◇' : '◆')}</div><div class="catalog-row-info"><div class="catalog-row-name">${escapeHtml(resource.name)}</div><div class="catalog-row-sub">${resource.localizationId ? `本地化 ${escapeHtml(resource.localizationId)} · ` : ''}${escapeHtml(resource.guid || '无 GUID')}</div></div><div class="catalog-row-action">${state.selectedResource?.guid === resource.guid ? '✓' : '＋'}</div></div>`).join('') : ''
    els.catalogEmpty.classList.toggle('hidden', list.length > 0)
    $$('.catalog-row').forEach((row) => {
      row.addEventListener('click', () => selectResource(row.dataset.resourceGuid, row.dataset.resourceType))
      row.addEventListener('dragstart', (event) => startResourceDrag(event, row))
      row.addEventListener('dragend', () => finishResourceDrag(row))
    })
    hydratePreviews(els.catalogList)
  }

  function selectResource(guid, type = state.catalogType) {
    if (type === 'item' || type === 'equipment') state.catalogType = type
    const source = state.catalogType === 'item' ? state.items : state.equipments
    state.selectedResource = source.find((resource) => resource.guid === guid) || null
    state.editingIndex = null
    $$('.catalog-tab').forEach((tab) => tab.classList.toggle('active', tab.dataset.catalog === state.catalogType))
    resetComposerFields()
    renderCatalog(); renderComposer()
  }

  function hasResourceDrag(event) {
    return Array.from(event.dataTransfer?.types || []).includes(RESOURCE_DRAG_MIME)
  }

  function dragPayload(event) {
    if (!hasResourceDrag(event)) return null
    try {
      const payload = JSON.parse(event.dataTransfer.getData(RESOURCE_DRAG_MIME))
      if (!payload || !['item', 'equipment'].includes(payload.type) || typeof payload.guid !== 'string') return null
      return payload
    } catch { return null }
  }

  function startResourceDrag(event, row) {
    const payload = { guid: row.dataset.resourceGuid, type: row.dataset.resourceType }
    event.dataTransfer.effectAllowed = 'copy'
    event.dataTransfer.setData(RESOURCE_DRAG_MIME, JSON.stringify(payload))
    event.dataTransfer.setData('text/plain', payload.guid)
    row.classList.add('dragging')
    row.setAttribute('aria-grabbed', 'true')
  }

  function finishResourceDrag(row) {
    row.classList.remove('dragging')
    row.setAttribute('aria-grabbed', 'false')
    state.dragDepth = 0
    els.dropPanel?.classList.remove('drop-target-active')
  }

  function openComposerModal() {
    if (!state.selectedResource || !state.selectedRole || !els.composerModal || !els.composerModalContent) return
    state.composerModalOpen = true
    els.composerModalContent.appendChild(els.composer)
    els.composerModal.classList.remove('hidden')
    els.composerModal.setAttribute('aria-hidden', 'false')
    renderComposer()
    window.requestAnimationFrame(() => {
      const focusTarget = state.selectedResource?.kind === 'equipment'
        ? els.dropRatePercent
        : (state.quantityMode === 'range' ? els.minQuantity : els.fixedQuantity)
      focusTarget?.focus()
    })
  }

  function closeComposerModal({ clear = true } = {}) {
    if (!els.composerModal) return
    state.composerModalOpen = false
    if (els.composerAnchor && els.composer.parentElement !== els.composerAnchor) els.composerAnchor.appendChild(els.composer)
    els.composerModal.classList.add('hidden')
    els.composerModal.setAttribute('aria-hidden', 'true')
    if (clear) {
      state.selectedResource = null
      state.editingIndex = null
      renderCatalog()
    }
    renderComposer()
  }

  function handleDropOnDropList(event) {
    const payload = dragPayload(event)
    if (!payload) return
    event.preventDefault()
    event.stopPropagation()
    state.dragDepth = 0
    els.dropPanel?.classList.remove('drop-target-active')
    const source = payload.type === 'equipment' ? state.equipments : state.items
    if (!state.selectedRole) {
      showToast('请先选择角色', '选择角色后再把物品拖入掉落列表', 'error')
      return
    }
    if (!source.some((resource) => resource.guid === payload.guid)) {
      showToast('资源不存在', '拖入的物品或装备不属于当前工程', 'error')
      return
    }
    selectResource(payload.guid, payload.type)
    openComposerModal()
  }

  function bindDropTarget() {
    if (!els.dropPanel) return
    const isResourceEvent = hasResourceDrag
    els.dropPanel.addEventListener('dragenter', (event) => {
      if (!isResourceEvent(event)) return
      event.preventDefault()
      state.dragDepth += 1
      els.dropPanel.classList.add('drop-target-active')
    })
    els.dropPanel.addEventListener('dragover', (event) => {
      if (!isResourceEvent(event)) return
      event.preventDefault()
      event.dataTransfer.dropEffect = 'copy'
      els.dropPanel.classList.add('drop-target-active')
    })
    els.dropPanel.addEventListener('dragleave', (event) => {
      if (!isResourceEvent(event)) return
      state.dragDepth = Math.max(0, state.dragDepth - 1)
      if (!state.dragDepth) els.dropPanel.classList.remove('drop-target-active')
    })
    els.dropPanel.addEventListener('drop', handleDropOnDropList)
  }

  function setQuantityMode(mode) {
    state.quantityMode = mode === 'range' ? 'range' : 'fixed'
    $$('.quantity-mode-button').forEach((button) => button.classList.toggle('active', button.dataset.quantityMode === state.quantityMode))
    els.fixedQuantityRow.classList.toggle('hidden', state.quantityMode !== 'fixed')
    els.rangeQuantityRow.classList.toggle('hidden', state.quantityMode !== 'range')
  }

  function setDropRatePercent(value) {
    const percent = Math.max(0, Math.min(100, Number(value) || 0))
    const display = Number(percent.toFixed(4))
    els.dropRateSlider.value = String(display)
    els.dropRatePercent.value = String(display)
    els.dropRateOutput.textContent = `${display}%`
    els.dropRateRaw.textContent = `写入：dropRate = ${clampRate(display / 100)}`
  }

  function resetComposerFields(entry = null) {
    const resource = entry ? resourceForEntry(entry) : state.selectedResource
    if (entry && resource) state.selectedResource = resource
    const min = entry?.min || 1
    const max = entry?.max || min
    els.fixedQuantity.value = String(min)
    els.minQuantity.value = String(min)
    els.maxQuantity.value = String(max)
    setQuantityMode(entry && min !== max ? 'range' : 'fixed')
    setDropRatePercent((entry?.dropRate ?? 1) * 100)
  }

  function renderComposer() {
    const resource = state.selectedResource
    els.composer.classList.toggle('hidden', !resource)
    if (!resource) return
    const equipment = resource.kind === 'equipment'
    els.selectedType.textContent = equipment ? '装备' : '物品'; els.selectedType.className = `resource-type ${resource.kind}`; els.selectedName.textContent = resource.name
    els.itemQuantityConfig.classList.toggle('hidden', equipment)
    els.equipmentQuantityNote.classList.toggle('hidden', !equipment)
    els.cancelEdit.classList.toggle('hidden', state.editingIndex === null)
    els.insertDrop.innerHTML = state.editingIndex === null ? '插入掉落物 <span>→</span>' : '保存条目修改 <span>✓</span>'
  }

  function removeDrop(index) {
    if (!state.selectedRole || !currentEntries()[index]) return
    currentEntries().splice(index, 1); markDirty(state.selectedRole); showToast('已移除', '点击“保存当前角色”后写回文件', 'success')
  }

  function toggleDrop(index) {
    if (state.storageMode !== 'event' || !state.selectedRole || !currentEntries()[index]) return
    const entry = currentEntries()[index]
    entry.disabled = !entry.disabled
    markDirty(state.selectedRole, 'event')
    showToast(entry.disabled ? '掉落已禁用' : '掉落已启用', `${resourceForEntry(entry)?.name || entry.id} · 保存后写入 ${entry.disabled ? `!${state.dropCommandId}` : state.dropCommandId}`, 'success')
  }

  function editDrop(index) {
    const entry = currentEntries()[index]
    if (!entry) return
    const resource = resourceForEntry(entry)
    if (!resource) { showToast('无法编辑', `工程中找不到资源 ${entry.id}`, 'error'); return }
    state.catalogType = entry.type
    state.selectedResource = resource
    state.editingIndex = index
    $$('.catalog-tab').forEach((tab) => tab.classList.toggle('active', tab.dataset.catalog === state.catalogType))
    resetComposerFields(entry)
    renderCatalog(); renderComposer()
  }

  function clearComposer() {
    if (state.composerModalOpen) {
      closeComposerModal()
      return
    }
    state.selectedResource = null
    state.editingIndex = null
    renderCatalog(); renderComposer()
  }

  function insertDrop() {
    if (!state.selectedRole || !state.selectedResource) return
    const equipment = state.selectedResource.kind === 'equipment'
    let min = 1
    let max = 1
    if (!equipment) {
      if (state.quantityMode === 'fixed') min = max = clampInteger(els.fixedQuantity.value)
      else {
        min = clampInteger(els.minQuantity.value)
        max = clampInteger(els.maxQuantity.value, min)
        if (min > max) { showToast('数量范围无效', '最小数量不能大于最大数量', 'error'); return }
      }
    }
    const existing = state.editingIndex === null ? null : currentEntries()[state.editingIndex]
    const entry = {
      key: existing?.key || `${state.selectedResource.kind}-${state.selectedResource.guid}-${Date.now()}`,
      type: state.selectedResource.kind,
      id: state.selectedResource.guid,
      min,
      max,
      dropRate: clampRate(Number(els.dropRatePercent.value) / 100),
      disabled: state.storageMode === 'event' && Boolean(existing?.disabled),
      raw: existing?.raw || null,
    }
    if (state.editingIndex === null) currentEntries().push(entry)
    else currentEntries()[state.editingIndex] = entry
    const action = state.editingIndex === null ? '已加入掉落列表' : '已更新掉落条目'
    markDirty(state.selectedRole)
    showToast(action, `${state.selectedResource.name} · ${quantityLabel(entry)} · ${formatPercent(entry.dropRate)} · 尚未保存`, 'success')
    clearComposer()
  }

  function updatePendingUi() { els.pendingCount.textContent = state.pending.size; els.saveAll.disabled = state.pending.size === 0; }

  function makeDropCommand(entry) {
    const existingParams = entry.raw && typeof entry.raw === 'object'
      ? { ...entry.raw }
      : { actor: 'trigger', localActorKey: '', globalActorKey: '' }
    return {
      id: entry.disabled ? `!${state.dropCommandId}` : state.dropCommandId,
      params: {
        ...existingParams,
        type: entry.type,
        itemId: entry.type === 'item' ? entry.id : '',
        equipmentId: entry.type === 'equipment' ? entry.id : '',
        min: entry.type === 'equipment' ? 1 : clampInteger(entry.min),
        max: entry.type === 'equipment' ? 1 : clampInteger(entry.max, entry.min),
        dropRate: clampRate(entry.dropRate),
      },
    }
  }

  function ensureAttributeStore(role) {
    const store = role.stores.attribute
    if (!store.ownSlot) {
      if (!Array.isArray(role.data.attributes)) role.data.attributes = []
      const newAttr = { key: DROP_ATTRIBUTE_ID, value: '' }
      role.data.attributes.push(newAttr)
      store.ownSlot = { kind: 'attribute', index: role.data.attributes.length - 1, value: '' }
      store.inherited = false
      store.sourceRole = role
      store.sourceSlot = store.ownSlot
      // 同步到人物属性草稿：否则保存人物属性时重建 attributes 数组会丢掉这个新建的 loopList 槽位。
      const actorStore = role.stores.actorAttributes
      if (actorStore && !actorStore.entries.some((entry) => entry.key === DROP_ATTRIBUTE_ID)) {
        actorStore.entries.push({ key: DROP_ATTRIBUTE_ID, value: '', raw: cloneJson(newAttr), localIndex: role.data.attributes.length - 1 })
      }
    }
    return store
  }

  function ensureEventStore(role) {
    const store = role.stores.event
    if (!store.ownSlot) {
      let event
      if (store.sourceSlot?.event) event = JSON.parse(JSON.stringify(store.sourceSlot.event))
      else event = { type: state.dropEventType, enabled: true, commands: [] }
      role.data.events = Array.isArray(role.data.events) ? role.data.events : []
      role.data.events.push(event)
      store.ownSlot = { index: role.data.events.length - 1, event }
      store.inherited = false
      store.sourceRole = role
      store.sourceSlot = store.ownSlot
    }
    return store
  }

  function updateAttributeStore(role) {
    const store = ensureAttributeStore(role)
    const serialized = serializeDropList(store.entries)
    if (store.ownSlot.kind === 'root') role.data.loopList = serialized
    else role.data.attributes[store.ownSlot.index].value = serialized
    store.ownSlot.value = serialized
    return serialized
  }

  function updateEventStore(role) {
    const store = ensureEventStore(role)
    const event = store.ownSlot.event
    const commands = Array.isArray(event.commands) ? event.commands : []
    const dropCommands = store.entries.map(makeDropCommand)
    const nextCommands = []
    let inserted = false
    for (const command of commands) {
      if (isDropCommand(command)) {
        if (!inserted) { nextCommands.push(...dropCommands); inserted = true }
      } else nextCommands.push(command)
    }
    if (!inserted) nextCommands.push(...dropCommands)
    event.commands = nextCommands
    event.type = state.dropEventType
    event.enabled = event.enabled !== false
    store.ownSlot.event = event
    return event
  }

  function updateActorAttributeStore(role) {
    const store = role.stores.actorAttributes
    // loopList 的值始终以掉落草稿为准：掉落编辑器的 ownSlot.value 反映最新序列化结果。
    // 人物属性草稿中 loopList 条目保持只读，保存时不会用旧值覆盖新掉落的修改。
    const dropValue = role.stores.attribute?.ownSlot?.value
    if (dropValue !== undefined) {
      for (const entry of store.entries) {
        if (isLoopListKey(entry.key)) {
          entry.value = dropValue
          entry.raw = { ...cloneJson(entry.raw || {}), key: entry.key, value: dropValue }
        }
      }
    }
    role.data.attributes = store.entries.map((entry) => ({
      ...(entry.raw && typeof entry.raw === 'object' ? cloneJson(entry.raw) : {}),
      key: entry.key,
      value: cloneJson(entry.value),
    }))
    // 数组长度和索引可能改变，必须刷新掉落属性槽位，避免 loopList 索引错位。
    role.stores.attribute.ownSlot = findDropSlot(role.data)
    return JSON.stringify(role.data, null, 2) + '\n'
  }

  function updateRoleData(role, mode = state.storageMode) {
    switch (mode) {
      case 'actorAttributes':
        return updateActorAttributeStore(role)
      case 'attribute':
        return updateAttributeStore(role)
      case 'event':
        return updateEventStore(role)
      default:
        throw new Error(`未知写入模式：${mode}`)
    }
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
      const backupName = `${role.guid || 'actor'}_${basename(role.path)}.bak`.replace(/[<>:"/\\|?*]/g, '_')
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
      dirtyModes: new Map(roles.map((role) => [role.path, new Set(role.dirtyModes)])),
      draftEntries: new Map(roles.map((role) => [role.path, {
        attribute: role.stores.attribute.entries.map((entry) => cloneJson(entry)),
        event: role.stores.event.entries.map((entry) => cloneJson(entry)),
        actorAttributes: role.stores.actorAttributes.entries.map((entry) => cloneJson(entry)),
        dirtyModes: [...role.dirtyModes],
      }])),
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
        initializeRoleStores(role, state.roleMap)
        const drafts = draftEntries?.get(role.path)
        if (drafts) {
          // 只把用户未保存草稿挂回 entries；originalEntries 保持 initializeRoleStores
          // 基于恢复后文件重建的状态，这样“恢复原值”仍可还原到文件状态。
          for (const mode of ['attribute', 'event', 'actorAttributes']) {
            if (!Array.isArray(drafts[mode])) continue
            role.stores[mode].entries = drafts[mode].map((entry) => cloneJson(entry))
          }
        }
        role.dirtyModes = new Set(backupModesForRole(draftEntries, role.path))
        state.pending.add(role.path)
      } catch {
        failures.push(role.name)
      }
    }
    updatePendingUi(); renderRoleList(); renderRoleEditor()
    if (failures.length) throw new Error(`写入失败且以下角色回滚失败：${failures.join('、')}。请从备份目录手动恢复。`)
  }

  function backupModesForRole(draftEntries, path) {
    const value = draftEntries?.get(path)
    return value?.dirtyModes || []
  }

  async function writeRoleModes(role, modes, backupComplete = false) {
    // 固定写入顺序：actorAttributes 重建 attributes 数组后，attribute 用最新掉落草稿覆盖 loopList，最后写事件。
    const normalizedModes = WRITE_MODE_ORDER.filter((mode) => modes.includes(mode) && role.stores[mode])
    if (!normalizedModes.length) return
    if (state.rootHandle && !backupComplete) await createBackupBatch([role])
    for (const mode of normalizedModes) updateRoleData(role, mode)
    const text = JSON.stringify(role.data, null, 2) + '\n'
    if (state.rootHandle && role.handle?.createWritable) {
      await writeTextHandle(role.handle, text)
    } else if (role.file) {
      const blob = new Blob([text], { type: 'application/json;charset=utf-8' }); const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = basename(role.path); anchor.click(); URL.revokeObjectURL(url)
    } else throw new Error('当前文件不可写')
    role.raw = text
    for (const mode of normalizedModes) {
      role.stores[mode].originalEntries = role.stores[mode].entries.map((entry) => cloneJson(entry))
      role.dirtyModes.delete(mode)
    }
    if (!role.dirtyModes.size) state.pending.delete(role.path)
    updatePendingUi(); renderRoleList(); renderRoleEditor()
  }

  async function saveCurrent() {
    if (!state.selectedRole || !isDirty(state.selectedRole)) return
    let backup = null
    try {
      backup = state.rootHandle ? await createBackupBatch([state.selectedRole]) : null
      await writeRoleModes(state.selectedRole, [...state.selectedRole.dirtyModes], Boolean(backup))
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
    if (state.fallbackMode) {
      for (const role of roles) {
        try { await writeRoleModes(role, [...role.dirtyModes]) }
        catch (error) { showToast('保存失败', error.message, 'error'); return }
      }
      showToast('已导出更改', `原工程未被覆盖，已下载 ${roles.length} 个修改副本`, 'success'); return
    }
    let backup = null
    const attempted = []
    try {
      backup = await createBackupBatch(roles)
      for (const role of roles) {
        attempted.push(role)
        await writeRoleModes(role, [...role.dirtyModes], true)
      }
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
    els.clearSelection.addEventListener('click', clearComposer); els.cancelEdit.addEventListener('click', clearComposer)
    els.closeComposerModalButton?.addEventListener('click', () => closeComposerModal())
    els.composerModal?.addEventListener('click', (event) => { if (event.target === els.composerModal) closeComposerModal() })
    els.roleSearch.addEventListener('input', (event) => { state.roleSearch = event.target.value; renderRoleList() }); els.catalogSearch.addEventListener('input', (event) => { state.catalogSearch = event.target.value; renderCatalog() })
    $$('.catalog-tab').forEach((tab) => tab.addEventListener('click', () => { closeComposerModal(); state.catalogType = tab.dataset.catalog; state.selectedResource = null; $$('.catalog-tab').forEach((node) => node.classList.toggle('active', node === tab)); renderCatalog(); renderComposer() }))
    $$('.storage-mode-button').forEach((button) => button.addEventListener('click', () => selectStorageMode(button.dataset.storageMode)))
    $$('.quantity-mode-button').forEach((button) => button.addEventListener('click', () => setQuantityMode(button.dataset.quantityMode)))
    els.dropRateSlider.addEventListener('input', (event) => setDropRatePercent(event.target.value))
    els.dropRatePercent.addEventListener('input', (event) => setDropRatePercent(event.target.value))
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && state.composerModalOpen) { event.preventDefault(); closeComposerModal(); return }
      if (event.key === 'Escape' && state.attributeAddOpen) { event.preventDefault(); closeAttributeAddModal(); return }
      if (event.key === '/' && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
        event.preventDefault();
        const target = state.workspaceMode === 'actor-attributes' ? (state.attributeAddOpen ? els.attributeAddSearch : els.attributeSearch) : (state.selectedRole ? els.catalogSearch : els.roleSearch)
        target?.focus()
      }
    })
    bindDropTarget()
    els.workspaceModeButtons().forEach((button) => button.addEventListener('click', () => setWorkspaceMode(button.dataset.workspaceMode)))
    els.attributeSearch?.addEventListener('input', (event) => { state.actorAttributeSearch = event.target.value; renderActorAttributeEditor() })
    els.attributeFilters?.addEventListener('click', (event) => {
      const button = event.target.closest('[data-filter]')
      if (!button) return
      state.actorAttributeFilter = button.dataset.filter
      $$('.attribute-filter').forEach((node) => node.classList.toggle('active', node === button))
      renderActorAttributeEditor()
    })
    els.attributeList?.addEventListener('click', (event) => {
      const button = event.target.closest('[data-attr-action]')
      if (!button) return
      const action = button.dataset.attrAction
      if (action === 'remove') removeActorAttribute(Number(button.dataset.attrIndex))
      else if (action === 'revert') revertActorAttribute(Number(button.dataset.attrIndex))
      else if (action === 'override') createLocalOverride(button.dataset.attrKey)
      else if (action === 'goto-drop') setWorkspaceMode('drop')
      else if (action === 'toggle-unknown') { state.unknownAttributesExpanded = !state.unknownAttributesExpanded; renderActorAttributeEditor() }
    })
    els.attributeList?.addEventListener('change', (event) => {
      const input = event.target.closest('[data-attr-input]')
      if (!input || !state.selectedRole) return
      const index = Number(input.dataset.attrIndex)
      const entry = state.selectedRole.stores.actorAttributes.entries[index]
      if (!entry) return
      const definition = state.actorAttributeDefinitions.get(entry.key)
      if (definition?.type === 'number') {
        const raw = String(input.value).trim()
        const numeric = Number(input.value)
        if (raw === '' || !Number.isFinite(numeric)) {
          showToast('数值无效', '不允许空值、NaN 或 Infinity，已恢复原值', 'error')
          renderActorAttributeEditor()
          return
        }
        commitActorAttributeValue(state.selectedRole, index, numeric)
        return
      }
      if (input.type === 'checkbox') commitActorAttributeValue(state.selectedRole, index, input.checked)
      else commitActorAttributeValue(state.selectedRole, index, input.value)
    })
    els.addActorAttribute?.addEventListener('click', openAttributeAddModal)
    els.closeAttributeAdd?.addEventListener('click', closeAttributeAddModal)
    els.attributeAddModal?.addEventListener('click', (event) => { if (event.target === els.attributeAddModal) closeAttributeAddModal() })
    els.attributeAddSearch?.addEventListener('input', () => { state.selectedAddDefinitionId = null; renderAttributeAddList(); els.attributeAddDetail.classList.add('hidden') })
    els.attributeAddConfirm?.addEventListener('click', confirmAttributeAdd)
  }

  bindEvents()
  loadRememberedProject()
})()
