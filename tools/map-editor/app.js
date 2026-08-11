/* 地图编辑器 v0.6.0 - 10x10 生产工作台 */
'use strict'

const ROWS = 10
const COLS = 10
const GUID_RE = /^[a-f0-9]{16}$/i
const LEVEL_RE = /^\s*(\d+)\s*[-~～]\s*(\d+)\s*$/
const SHEET_DEFINITIONS = [
  { key: '名称', field: 'name' },
  { key: '等级', field: 'level' },
  { key: '图标', field: 'icon' },
  { key: '通行', field: 'pass' },
  { key: '刷怪', field: 'spawn' },
]
const ICON_TYPES = [
  { value: -1, label: '空地' },
  { value: 0, label: '哨所' },
  { value: 1, label: '平原' },
  { value: 2, label: '林地' },
  { value: 3, label: '沙漠' },
  { value: 4, label: '水域' },
  { value: 5, label: '山地' },
  { value: 6, label: '废墟' },
  { value: 7, label: '海岸' },
  { value: 100, label: '王城' },
  { value: 101, label: '城市' },
  { value: 102, label: '村落/岛屿' },
]

function emptyCell() {
  return {
    name: '',
    icon: -1,
    Passability: { down: false, right: false },
    monsters: [],
  }
}

function newBlankGrid() {
  return Array.from({ length: ROWS }, () => Array.from({ length: COLS }, emptyCell))
}

function cloneValue(value) {
  return typeof structuredClone === 'function'
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value))
}

function coordKey(r, c) {
  return `${r}:${c}`
}

function rectangleCoords(from, to) {
  const coords = []
  const minR = Math.min(from.r, to.r)
  const maxR = Math.max(from.r, to.r)
  const minC = Math.min(from.c, to.c)
  const maxC = Math.max(from.c, to.c)
  for (let r = minR; r <= maxR; r++) {
    for (let c = minC; c <= maxC; c++) coords.push({ r, c })
  }
  return coords
}

function validateGrid(grid) {
  const issues = []
  const issue = (message, r = null, c = null) => issues.push({ severity: 'error', message, r, c })
  if (!Array.isArray(grid)) {
    issue('根节点必须是数组')
    return issues
  }
  if (grid.length !== ROWS) issue(`行数必须为 ${ROWS}，实际 ${grid.length}`)
  for (let r = 0; r < ROWS; r++) {
    const row = grid[r]
    if (!Array.isArray(row)) {
      issue(`第 ${r + 1} 行必须是数组`, r, null)
      continue
    }
    if (row.length !== COLS) issue(`第 ${r + 1} 行列数必须为 ${COLS}，实际 ${row.length}`, r, null)
    for (let c = 0; c < COLS; c++) {
      const cell = row[c]
      if (!cell || typeof cell !== 'object' || Array.isArray(cell)) {
        issue('单元格必须是对象', r, c)
        continue
      }
      if (typeof cell.name !== 'string') issue('name 必须是字符串', r, c)
      if (!Number.isInteger(cell.icon)) issue('icon 必须是整数', r, c)
      const pass = cell.Passability
      if (!pass || typeof pass !== 'object' || typeof pass.down !== 'boolean' || typeof pass.right !== 'boolean') {
        issue('Passability 必须包含布尔 down/right', r, c)
      }
      if (cell.levelRange !== undefined && cell.levelRange !== null) {
        const range = cell.levelRange
        if (!Number.isInteger(range.min) || range.min < 1 || !Number.isInteger(range.max) || range.max < range.min) {
          issue('levelRange 必须是正整数且 min <= max', r, c)
        }
      }
      if (!Array.isArray(cell.monsters)) {
        issue('monsters 必须是数组', r, c)
        continue
      }
      const seen = new Set()
      for (const monster of cell.monsters) {
        if (!monster || typeof monster !== 'object' || Array.isArray(monster)) {
          issue('monsters 元素必须是对象', r, c)
          continue
        }
        const id = typeof monster.id === 'string' ? monster.id : String(monster.id ?? '')
        if (!GUID_RE.test(id)) issue(`怪物 id 必须是 16 位十六进制：${id || '空'}`, r, c)
        if (!Number.isInteger(monster.lvMin) || monster.lvMin < 1) issue(`怪物 ${id || '空 ID'} 的 lvMin 必须为正整数`, r, c)
        if (!Number.isInteger(monster.lvMax) || monster.lvMax < monster.lvMin) issue(`怪物 ${id || '空 ID'} 的 lvMax 必须 >= lvMin`, r, c)
        if (typeof monster.weight !== 'number' || !Number.isFinite(monster.weight) || monster.weight <= 0) issue(`怪物 ${id || '空 ID'} 的 weight 必须 > 0`, r, c)
        const normalizedId = id.toLowerCase()
        if (seen.has(normalizedId)) issue(`怪物 id 重复：${id}`, r, c)
        seen.add(normalizedId)
      }
    }
  }
  return issues
}

function parsePassability(value, at, errors) {
  if (value === null || value === undefined || value === '') return { down: false, right: false }
  const text = String(value).trim()
  if (/^[01],[01]$/.test(text)) {
    const [right, down] = text.split(',').map(Number)
    return { right: right === 1, down: down === 1 }
  }
  errors.push(`${at} 通行状态必须是 0,0 / 0,1 / 1,0 / 1,1，实际：${text}`)
  return { down: false, right: false }
}

function parseLevelRange(value, at, errors) {
  if (value === null || value === undefined || value === '' || value === 0) return null
  if (typeof value === 'number') {
    if (Number.isInteger(value) && value > 0) return { min: value, max: value }
    errors.push(`${at} 等级必须是正整数或区间`)
    return null
  }
  const match = typeof value === 'string' ? LEVEL_RE.exec(value) : null
  if (match) {
    const min = Number(match[1])
    const max = Number(match[2])
    if (min >= 1 && max >= min) return { min, max }
  }
  errors.push(`${at} 等级区间格式无法解析：${String(value)}`)
  return null
}

const MapEditorCore = {
  ROWS,
  COLS,
  emptyCell,
  newBlankGrid,
  cloneValue,
  rectangleCoords,
  validateGrid,
  parsePassability,
}
globalThis.MapEditorCore = MapEditorCore

if (typeof document !== 'undefined') initializeMapEditor()

function initializeMapEditor() {
  const els = Object.fromEntries([
    'map-grid', 'map-summary', 'sheet-mapping', 'selection-label', 'grid-zoom', 'zoom-output',
    'diagnostic-toggle', 'diagnostic-count', 'diagnostic-list', 'cell-form', 'cell-coord', 'inspector-title',
    'status-source', 'status-selection', 'status-validation', 'document-label', 'dirty-label', 'dirty-dot',
    'btn-new', 'btn-import-json', 'btn-import-excel', 'btn-download', 'btn-undo', 'btn-redo',
    'btn-select-all', 'btn-clear-cells', 'btn-copy', 'btn-paste', 'btn-primary-only', 'btn-json',
    'btn-close-json', 'file-input', 'json-modal', 'json-preview', 'drop-overlay', 'toast-region', 'icon-legend',
  ].map((id) => [camelId(id), document.getElementById(id)]))

  const state = {
    grid: newBlankGrid(),
    source: '新建空白',
    sourceType: 'new',
    selected: new Set([coordKey(0, 0)]),
    primary: { r: 0, c: 0 },
    anchor: { r: 0, c: 0 },
    warnings: [],
    sheetMap: [],
    history: [],
    future: [],
    clipboard: null,
    cleanSnapshot: '',
    issues: [],
    diagnosticsOpen: true,
    dragDepth: 0,
  }
  state.cleanSnapshot = snapshotGrid()

  function camelId(id) {
    return id.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())
  }

  function snapshotGrid(grid = state.grid) {
    return JSON.stringify(grid)
  }

  function isDirty() {
    return snapshotGrid() !== state.cleanSnapshot
  }

  function selectedCoords() {
    return [...state.selected]
      .map((key) => {
        const [r, c] = key.split(':').map(Number)
        return { r, c }
      })
      .sort((a, b) => a.r - b.r || a.c - b.c)
  }

  function selectOnly(r, c) {
    state.selected = new Set([coordKey(r, c)])
    state.primary = { r, c }
    state.anchor = { r, c }
    renderAll()
  }

  function handleCellSelection(r, c, event = {}) {
    const key = coordKey(r, c)
    if (event.shiftKey) {
      state.selected = new Set(rectangleCoords(state.anchor, { r, c }).map((coord) => coordKey(coord.r, coord.c)))
    } else if (event.ctrlKey || event.metaKey) {
      if (state.selected.has(key) && state.selected.size > 1) state.selected.delete(key)
      else state.selected.add(key)
      state.anchor = { r, c }
    } else {
      state.selected = new Set([key])
      state.anchor = { r, c }
    }
    state.primary = { r, c }
    renderAll()
  }

  function selectRow(r) {
    state.selected = new Set(Array.from({ length: COLS }, (_, c) => coordKey(r, c)))
    state.primary = { r, c: 0 }
    state.anchor = { ...state.primary }
    renderAll()
  }

  function selectColumn(c) {
    state.selected = new Set(Array.from({ length: ROWS }, (_, r) => coordKey(r, c)))
    state.primary = { r: 0, c }
    state.anchor = { ...state.primary }
    renderAll()
  }

  function selectAll() {
    state.selected = new Set(rectangleCoords({ r: 0, c: 0 }, { r: ROWS - 1, c: COLS - 1 }).map(({ r, c }) => coordKey(r, c)))
    state.primary = { r: 0, c: 0 }
    state.anchor = { ...state.primary }
    renderAll()
  }

  function pushHistory(before, label) {
    if (snapshotGrid() === JSON.stringify(before)) return
    state.history.push({ grid: before, label })
    if (state.history.length > 100) state.history.shift()
    state.future = []
  }

  function commit(label, mutate) {
    const before = cloneValue(state.grid)
    mutate()
    pushHistory(before, label)
    renderAll()
  }

  function undo() {
    const entry = state.history.pop()
    if (!entry) return
    state.future.push({ grid: cloneValue(state.grid), label: entry.label })
    state.grid = entry.grid
    renderAll()
    toast(`已撤销：${entry.label}`)
  }

  function redo() {
    const entry = state.future.pop()
    if (!entry) return
    state.history.push({ grid: cloneValue(state.grid), label: entry.label })
    state.grid = entry.grid
    renderAll()
    toast(`已重做：${entry.label}`)
  }

  function renderAll() {
    state.issues = validateGrid(state.grid)
    renderGrid()
    renderInspector()
    renderSummary()
    renderMappings()
    renderDiagnostics()
    renderDocumentState()
    renderHistoryState()
    if (!els.jsonModal.classList.contains('hidden')) els.jsonPreview.textContent = serializeGrid()
  }

  function refreshDraft() {
    state.issues = validateGrid(state.grid)
    renderGrid()
    renderSummary()
    renderDiagnostics()
    renderDocumentState()
    renderHistoryState()
    if (!els.jsonModal.classList.contains('hidden')) els.jsonPreview.textContent = serializeGrid()
  }

  function iconClass(icon) {
    return ICON_TYPES.some((entry) => entry.value === icon) ? `icon--${icon === -1 ? 'n1' : icon}` : 'icon--other'
  }

  function iconLabel(icon) {
    return ICON_TYPES.find((entry) => entry.value === icon)?.label || '自定义'
  }

  function renderGrid() {
    const invalid = new Set(state.issues.filter((entry) => entry.r !== null && entry.c !== null).map((entry) => coordKey(entry.r, entry.c)))
    const fragment = document.createDocumentFragment()
    const corner = document.createElement('button')
    corner.className = 'grid-corner axis-button'
    corner.type = 'button'
    corner.textContent = '全'
    corner.title = '选择全部格子'
    corner.addEventListener('click', selectAll)
    fragment.appendChild(corner)
    for (let c = 0; c < COLS; c++) {
      const button = document.createElement('button')
      button.className = `axis-button${state.selected.size === ROWS && selectedCoords().every((coord) => coord.c === c) ? ' selected' : ''}`
      button.type = 'button'
      button.textContent = String(c + 1)
      button.title = `选择第 ${c + 1} 列`
      button.addEventListener('click', () => selectColumn(c))
      fragment.appendChild(button)
    }
    for (let r = 0; r < ROWS; r++) {
      const rowButton = document.createElement('button')
      rowButton.className = `axis-button${state.selected.size === COLS && selectedCoords().every((coord) => coord.r === r) ? ' selected' : ''}`
      rowButton.type = 'button'
      rowButton.textContent = String(r + 1)
      rowButton.title = `选择第 ${r + 1} 行`
      rowButton.addEventListener('click', () => selectRow(r))
      fragment.appendChild(rowButton)
      for (let c = 0; c < COLS; c++) fragment.appendChild(createCellElement(r, c, invalid))
    }
    els.mapGrid.replaceChildren(fragment)
  }

  function createCellElement(r, c, invalid) {
    const cell = state.grid[r][c]
    const key = coordKey(r, c)
    const button = document.createElement('button')
    const selected = state.selected.has(key)
    const primary = state.primary.r === r && state.primary.c === c
    button.className = `map-cell ${iconClass(cell.icon)}${selected ? ' selected' : ''}${primary ? ' primary' : ''}${invalid.has(key) ? ' invalid' : ''}`
    button.type = 'button'
    button.dataset.r = r
    button.dataset.c = c
    button.setAttribute('role', 'gridcell')
    button.setAttribute('aria-selected', String(selected))
    button.innerHTML = `
      <span class="cell-name">${escapeHtml(cell.name || '')}</span>
      <span class="cell-icon">${cell.icon}</span>
      ${cell.monsters.length ? `<span class="cell-monster">${cell.monsters.length}</span>` : ''}
      ${cell.levelRange ? `<span class="cell-level">${escapeHtml(shortLevel(cell.levelRange))}</span>` : ''}
      <span class="cell-edge edge-right${cell.Passability.right ? ' on' : ''}"></span>
      <span class="cell-edge edge-down${cell.Passability.down ? ' on' : ''}"></span>`
    button.title = cellTooltip(cell, r, c)
    button.addEventListener('click', (event) => handleCellSelection(r, c, event))
    return button
  }

  function shortLevel(range) {
    return range.min === range.max ? `Lv${range.min}` : `${range.min}-${range.max}`
  }

  function cellTooltip(cell, r, c) {
    const monsters = cell.monsters.length
      ? cell.monsters.map((monster) => `${monster.id} · Lv${monster.lvMin}-${monster.lvMax} · 权重 ${monster.weight}`).join('\n')
      : '无刷怪'
    return `${cell.name || '空地'} · R${r + 1} C${c + 1}\n图标 ${cell.icon}（${iconLabel(cell.icon)}）\n右:${cell.Passability.right ? '通' : '断'} 下:${cell.Passability.down ? '通' : '断'}\n${monsters}`
  }

  function renderSummary() {
    const cells = state.grid.flat()
    const named = cells.filter((cell) => cell.name).length
    const monsterCount = cells.reduce((sum, cell) => sum + cell.monsters.length, 0)
    const usedIcons = new Set(cells.map((cell) => cell.icon)).size
    els.mapSummary.innerHTML = `
      <span class="summary-pill"><strong>${named}</strong> 地点</span>
      <span class="summary-pill"><strong>${monsterCount}</strong> 怪物项</span>
      <span class="summary-pill"><strong>${usedIcons}</strong> 图标值</span>`
  }

  function renderMappings() {
    if (state.sheetMap.length) {
      els.sheetMapping.innerHTML = state.sheetMap.map((entry) => `<span class="mapping-chip">${escapeHtml(entry.key)}<strong>→ ${escapeHtml(entry.name)}</strong></span>`).join('')
      return
    }
    els.sheetMapping.innerHTML = `<span class="mapping-chip">来源<strong>${escapeHtml(state.sourceType === 'json' ? 'JSON 二维数组' : '内存空白地图')}</strong></span>`
  }

  function renderLegend() {
    els.iconLegend.innerHTML = ICON_TYPES.map((entry) => `
      <span class="legend-chip" title="图标 ${entry.value} · ${escapeHtml(entry.label)}">
        <span class="legend-swatch ${iconClass(entry.value)}"></span>${entry.value} ${escapeHtml(entry.label)}
      </span>`).join('')
  }

  function renderInspector() {
    const coords = selectedCoords()
    const cell = state.grid[state.primary.r][state.primary.c]
    els.cellCoord.textContent = coords.length === 1 ? `R${state.primary.r + 1} · C${state.primary.c + 1}` : `${coords.length} 格`
    els.inspectorTitle.textContent = coords.length === 1 ? (cell.name || '格属性') : '批量编辑'
    els.btnPaste.disabled = !state.clipboard
    els.btnPrimaryOnly.disabled = coords.length === 1
    els.cellForm.innerHTML = coords.length === 1 ? singleCellForm(cell) : batchCellForm(coords, cell)
    if (coords.length === 1) bindSingleCellForm()
    else bindBatchCellForm()
  }

  function iconPicker(active, batch = false) {
    const attr = batch ? 'data-batch-icon' : 'data-icon'
    return `<div class="icon-picker">${ICON_TYPES.map((entry) => `
      <button type="button" class="icon-chip ${iconClass(entry.value)}${active === entry.value ? ' active' : ''}" ${attr}="${entry.value}" title="${entry.value} · ${escapeHtml(entry.label)}">${entry.value}</button>`).join('')}</div>`
  }

  function singleCellForm(cell) {
    const range = cell.levelRange || { min: '', max: '' }
    return `
      <label class="field">
        <span class="field-label-line"><span class="field-label">地点名称</span><span class="field-hint">最多 40 字符</span></span>
        <input id="field-name" type="text" maxlength="40" value="${escapeHtml(cell.name)}" autocomplete="off" />
      </label>
      <section class="form-section">
        <div class="form-section-title"><span>地形图标</span><span class="field-hint">当前 ${cell.icon} · ${escapeHtml(iconLabel(cell.icon))}</span></div>
        ${iconPicker(cell.icon)}
        <label class="mini-field"><span>自定义整数值</span><input id="field-icon" type="number" step="1" value="${cell.icon}" /></label>
      </section>
      <section class="form-section">
        <div class="form-section-title">地图连线</div>
        <div class="toggle-grid">
          <label class="toggle-card"><span>向右通行</span><input id="field-right" type="checkbox"${cell.Passability.right ? ' checked' : ''} /><span class="toggle-track"></span></label>
          <label class="toggle-card"><span>向下通行</span><input id="field-down" type="checkbox"${cell.Passability.down ? ' checked' : ''} /><span class="toggle-track"></span></label>
        </div>
      </section>
      <section class="form-section">
        <div class="form-section-title"><span>地点等级</span><button id="btn-clear-level" class="text-button" type="button">移除区间</button></div>
        <div class="two-column">
          <label class="mini-field"><span>最低等级</span><input id="field-level-min" type="number" min="1" step="1" value="${range.min}" placeholder="留空" /></label>
          <label class="mini-field"><span>最高等级</span><input id="field-level-max" type="number" min="1" step="1" value="${range.max}" placeholder="留空" /></label>
        </div>
        <div id="level-error" class="field-error">${levelError(cell.levelRange)}</div>
      </section>
      <section class="form-section">
        <div class="form-section-title"><span>刷怪列表</span><span class="field-hint">${cell.monsters.length} 条</span></div>
        <div class="monster-list">${cell.monsters.map(monsterCard).join('')}</div>
        <button id="btn-add-monster" class="add-button" type="button">＋ 添加怪物</button>
      </section>`
  }

  function monsterCard(monster, index) {
    const idInvalid = !GUID_RE.test(monster.id)
    const rangeInvalid = !Number.isInteger(monster.lvMin) || monster.lvMin < 1 || !Number.isInteger(monster.lvMax) || monster.lvMax < monster.lvMin
    const weightInvalid = typeof monster.weight !== 'number' || !Number.isFinite(monster.weight) || monster.weight <= 0
    return `<div class="monster-card" data-monster-index="${index}">
      <div class="monster-card-head">
        <input class="monster-id${idInvalid ? ' invalid' : ''}" type="text" maxlength="16" value="${escapeHtml(monster.id)}" placeholder="16 位 Actor GUID" autocomplete="off" />
        <button class="remove-button" type="button" title="删除怪物" aria-label="删除怪物">×</button>
      </div>
      <div class="three-column monster-values">
        <label class="mini-field"><span>最低等级</span><input class="monster-min${rangeInvalid ? ' invalid' : ''}" type="number" min="1" step="1" value="${monster.lvMin}" /></label>
        <label class="mini-field"><span>最高等级</span><input class="monster-max${rangeInvalid ? ' invalid' : ''}" type="number" min="1" step="1" value="${monster.lvMax}" /></label>
        <label class="mini-field"><span>出现权重</span><input class="monster-weight${weightInvalid ? ' invalid' : ''}" type="number" min="0.01" step="0.1" value="${monster.weight}" /></label>
      </div>
      <div class="field-error">${idInvalid ? 'GUID 必须是 16 位十六进制' : rangeInvalid ? '等级必须为正整数且最低不高于最高' : weightInvalid ? '权重必须大于 0' : ''}</div>
    </div>`
  }

  function levelError(range) {
    if (!range) return ''
    return Number.isInteger(range.min) && range.min >= 1 && Number.isInteger(range.max) && range.max >= range.min
      ? ''
      : '最低/最高等级必须同时填写，且最低不高于最高'
  }

  function batchCellForm(coords, primaryCell) {
    return `
      <div class="batch-intro">主格 R${state.primary.r + 1} C${state.primary.c + 1} · 批量目标 ${coords.length} 格</div>
      <section class="form-section">
        <div class="form-section-title">批量设置图标</div>
        ${iconPicker(null, true)}
      </section>
      <section class="form-section">
        <div class="form-section-title">批量设置连线</div>
        <div class="two-column">
          <label class="mini-field"><span>向右</span><select id="batch-right"><option value="keep">保持原值</option><option value="true">全部开启</option><option value="false">全部关闭</option></select></label>
          <label class="mini-field"><span>向下</span><select id="batch-down"><option value="keep">保持原值</option><option value="true">全部开启</option><option value="false">全部关闭</option></select></label>
        </div>
        <button id="btn-apply-pass" class="button button-secondary" type="button">应用连线</button>
      </section>
      <section class="form-section">
        <div class="form-section-title">批量设置等级</div>
        <div class="two-column">
          <label class="mini-field"><span>最低等级</span><input id="batch-level-min" type="number" min="1" step="1" value="${primaryCell.levelRange?.min ?? ''}" placeholder="最低" /></label>
          <label class="mini-field"><span>最高等级</span><input id="batch-level-max" type="number" min="1" step="1" value="${primaryCell.levelRange?.max ?? ''}" placeholder="最高" /></label>
        </div>
        <div class="batch-actions">
          <button id="btn-apply-level" class="button button-secondary" type="button">应用等级</button>
          <button id="btn-remove-levels" class="button button-secondary" type="button">移除等级</button>
        </div>
      </section>
      <section class="form-section">
        <div class="form-section-title">批量内容</div>
        <div class="batch-actions">
          <button id="btn-copy-monsters" class="button button-secondary" type="button">复制主格刷怪</button>
          <button id="btn-clear-monsters" class="button button-secondary" type="button">清空刷怪</button>
          <button id="btn-clear-names" class="button button-secondary" type="button">清空名称</button>
          <button id="btn-overwrite-cells" class="button button-primary" type="button">用主格完整覆盖</button>
        </div>
      </section>`
  }

  function bindSingleCellForm() {
    const { r, c } = state.primary
    bindDraftInput(els.cellForm.querySelector('#field-name'), '修改地点名称', (value) => { state.grid[r][c].name = value })
    bindDraftInput(els.cellForm.querySelector('#field-icon'), '修改图标', (value) => { state.grid[r][c].icon = integerOrBlank(value) })
    const iconInput = els.cellForm.querySelector('#field-icon')
    iconInput.addEventListener('input', () => iconInput.classList.toggle('invalid', !Number.isInteger(state.grid[r][c].icon)))
    for (const button of els.cellForm.querySelectorAll('[data-icon]')) {
      button.addEventListener('click', () => commit('修改图标', () => { state.grid[r][c].icon = Number(button.dataset.icon) }))
    }
    els.cellForm.querySelector('#field-right').addEventListener('change', (event) => commit('修改向右通行', () => { state.grid[r][c].Passability.right = event.target.checked }))
    els.cellForm.querySelector('#field-down').addEventListener('change', (event) => commit('修改向下通行', () => { state.grid[r][c].Passability.down = event.target.checked }))
    const minInput = els.cellForm.querySelector('#field-level-min')
    const maxInput = els.cellForm.querySelector('#field-level-max')
    bindDraftPair(minInput, maxInput, '修改地点等级', () => {
      const min = integerOrBlank(minInput.value)
      const max = integerOrBlank(maxInput.value)
      if (min === '' && max === '') delete state.grid[r][c].levelRange
      else state.grid[r][c].levelRange = { min, max }
    })
    const refreshLevelFeedback = () => {
      const error = levelError(state.grid[r][c].levelRange)
      minInput.classList.toggle('invalid', Boolean(error))
      maxInput.classList.toggle('invalid', Boolean(error))
      els.cellForm.querySelector('#level-error').textContent = error
    }
    minInput.addEventListener('input', refreshLevelFeedback)
    maxInput.addEventListener('input', refreshLevelFeedback)
    els.cellForm.querySelector('#btn-clear-level').addEventListener('click', () => commit('移除地点等级', () => { delete state.grid[r][c].levelRange }))
    els.cellForm.querySelector('#btn-add-monster').addEventListener('click', () => commit('添加怪物', () => {
      const range = state.grid[r][c].levelRange
      state.grid[r][c].monsters.push({ id: '', lvMin: validPositive(range?.min) ? range.min : 1, lvMax: validPositive(range?.max) ? range.max : 1, weight: 1 })
    }))
    for (const card of els.cellForm.querySelectorAll('[data-monster-index]')) bindMonsterCard(card, r, c)
  }

  function bindMonsterCard(card, r, c) {
    const index = Number(card.dataset.monsterIndex)
    bindDraftInput(card.querySelector('.monster-id'), '修改怪物 GUID', (value) => { state.grid[r][c].monsters[index].id = value.trim().toLowerCase() })
    bindDraftInput(card.querySelector('.monster-min'), '修改怪物最低等级', (value) => { state.grid[r][c].monsters[index].lvMin = integerOrBlank(value) })
    bindDraftInput(card.querySelector('.monster-max'), '修改怪物最高等级', (value) => { state.grid[r][c].monsters[index].lvMax = integerOrBlank(value) })
    bindDraftInput(card.querySelector('.monster-weight'), '修改怪物权重', (value) => { state.grid[r][c].monsters[index].weight = numberOrBlank(value) })
    const refreshFeedback = () => {
      const monster = state.grid[r][c].monsters[index]
      const idInvalid = !GUID_RE.test(monster.id)
      const rangeInvalid = !Number.isInteger(monster.lvMin) || monster.lvMin < 1 || !Number.isInteger(monster.lvMax) || monster.lvMax < monster.lvMin
      const weightInvalid = typeof monster.weight !== 'number' || !Number.isFinite(monster.weight) || monster.weight <= 0
      card.querySelector('.monster-id').classList.toggle('invalid', idInvalid)
      card.querySelector('.monster-min').classList.toggle('invalid', rangeInvalid)
      card.querySelector('.monster-max').classList.toggle('invalid', rangeInvalid)
      card.querySelector('.monster-weight').classList.toggle('invalid', weightInvalid)
      card.querySelector('.field-error').textContent = idInvalid
        ? 'GUID 必须是 16 位十六进制'
        : rangeInvalid
          ? '等级必须为正整数且最低不高于最高'
          : weightInvalid
            ? '权重必须大于 0'
            : ''
    }
    for (const input of card.querySelectorAll('input')) input.addEventListener('input', refreshFeedback)
    card.querySelector('.remove-button').addEventListener('click', () => commit('删除怪物', () => { state.grid[r][c].monsters.splice(index, 1) }))
  }

  function bindDraftInput(input, label, apply) {
    let before = null
    let recorded = false
    input.addEventListener('focus', () => { before = cloneValue(state.grid) })
    input.addEventListener('input', () => {
      if (!before) before = cloneValue(state.grid)
      apply(input.value)
      if (!recorded) {
        pushHistory(before, label)
        recorded = true
      }
      refreshDraft()
    })
    input.addEventListener('change', () => {
      before = null
      recorded = false
      refreshDraft()
    })
  }

  function bindDraftPair(first, second, label, apply) {
    let before = null
    let recorded = false
    const focus = () => { if (!before) before = cloneValue(state.grid) }
    const input = () => {
      focus()
      apply()
      if (!recorded) {
        pushHistory(before, label)
        recorded = true
      }
      refreshDraft()
    }
    const change = () => {
      before = null
      recorded = false
      refreshDraft()
    }
    for (const element of [first, second]) {
      element.addEventListener('focus', focus)
      element.addEventListener('input', input)
      element.addEventListener('change', change)
    }
  }

  function bindBatchCellForm() {
    for (const button of els.cellForm.querySelectorAll('[data-batch-icon]')) {
      button.addEventListener('click', () => applySelected('批量设置图标', (cell) => { cell.icon = Number(button.dataset.batchIcon) }))
    }
    els.cellForm.querySelector('#btn-apply-pass').addEventListener('click', () => {
      const right = els.cellForm.querySelector('#batch-right').value
      const down = els.cellForm.querySelector('#batch-down').value
      if (right === 'keep' && down === 'keep') return toast('没有需要应用的连线变化')
      applySelected('批量设置连线', (cell) => {
        if (right !== 'keep') cell.Passability.right = right === 'true'
        if (down !== 'keep') cell.Passability.down = down === 'true'
      })
    })
    els.cellForm.querySelector('#btn-apply-level').addEventListener('click', () => {
      const min = Number(els.cellForm.querySelector('#batch-level-min').value)
      const max = Number(els.cellForm.querySelector('#batch-level-max').value)
      if (!Number.isInteger(min) || min < 1 || !Number.isInteger(max) || max < min) return toast('等级必须为正整数且最低不高于最高', 'error')
      applySelected('批量设置等级', (cell) => { cell.levelRange = { min, max } })
    })
    els.cellForm.querySelector('#btn-remove-levels').addEventListener('click', () => applySelected('批量移除等级', (cell) => { delete cell.levelRange }))
    els.cellForm.querySelector('#btn-copy-monsters').addEventListener('click', () => {
      const monsters = cloneValue(state.grid[state.primary.r][state.primary.c].monsters)
      applySelected('批量复制刷怪', (cell) => { cell.monsters = cloneValue(monsters) })
    })
    els.cellForm.querySelector('#btn-clear-monsters').addEventListener('click', () => applySelected('批量清空刷怪', (cell) => { cell.monsters = [] }))
    els.cellForm.querySelector('#btn-clear-names').addEventListener('click', () => applySelected('批量清空名称', (cell) => { cell.name = '' }))
    els.cellForm.querySelector('#btn-overwrite-cells').addEventListener('click', () => {
      const primary = cloneValue(state.grid[state.primary.r][state.primary.c])
      applySelected('用主格完整覆盖', (cell, coord) => {
        if (coord.r === state.primary.r && coord.c === state.primary.c) return
        Object.keys(cell).forEach((key) => delete cell[key])
        Object.assign(cell, cloneValue(primary))
      })
    })
  }

  function applySelected(label, apply) {
    commit(label, () => selectedCoords().forEach((coord) => apply(state.grid[coord.r][coord.c], coord)))
  }

  function integerOrBlank(value) {
    return value === '' ? '' : Number(value)
  }

  function numberOrBlank(value) {
    return value === '' ? '' : Number(value)
  }

  function validPositive(value) {
    return Number.isInteger(value) && value >= 1
  }

  function renderDiagnostics() {
    const entries = [
      ...state.issues,
      ...state.warnings.map((message) => ({ severity: 'warning', message, r: null, c: null })),
    ]
    const errorCount = state.issues.length
    const warningCount = state.warnings.length
    const label = errorCount ? `${errorCount} 个错误` : warningCount ? `${warningCount} 个提醒` : '0 个问题'
    els.diagnosticCount.textContent = label
    els.diagnosticCount.className = `diagnostic-count ${errorCount ? 'error' : warningCount ? 'warning' : 'valid'}`
    els.diagnosticToggle.setAttribute('aria-expanded', String(state.diagnosticsOpen))
    els.diagnosticList.classList.toggle('hidden', !state.diagnosticsOpen)
    if (!entries.length) {
      els.diagnosticList.innerHTML = '<div class="diagnostic-empty">当前 10 × 10 数据通过全部校验。</div>'
      return
    }
    els.diagnosticList.innerHTML = entries.slice(0, 50).map((entry, index) => `
      <button class="diagnostic-item ${entry.severity}" type="button" data-diagnostic-index="${index}"${entry.r === null ? ' disabled' : ''}>
        <span class="diagnostic-loc">${entry.r === null ? entry.severity === 'warning' ? '提醒' : '全局' : `R${entry.r + 1} C${entry.c === null ? '-' : entry.c + 1}`}</span>
        <span>${escapeHtml(entry.message)}</span>
      </button>`).join('')
    for (const button of els.diagnosticList.querySelectorAll('[data-diagnostic-index]')) {
      button.addEventListener('click', () => {
        const entry = entries[Number(button.dataset.diagnosticIndex)]
        if (entry.r !== null && entry.c !== null) {
          selectOnly(entry.r, entry.c)
          document.querySelector(`.map-cell[data-r="${entry.r}"][data-c="${entry.c}"]`)?.focus()
        }
      })
    }
  }

  function renderDocumentState() {
    const dirty = isDirty()
    const selectionText = `已选择 ${state.selected.size} 格`
    els.documentLabel.textContent = state.source
    els.dirtyLabel.textContent = dirty ? '未导出' : '已同步'
    els.dirtyDot.classList.toggle('dirty', dirty)
    els.selectionLabel.textContent = selectionText
    els.statusSource.textContent = `${state.source} · 10 × 10`
    els.statusSelection.textContent = selectionText
    els.statusValidation.textContent = state.issues.length ? `${state.issues.length} 个错误` : '数据有效'
    els.statusValidation.className = `status-validation ${state.issues.length ? 'error' : 'valid'}`
    els.btnDownload.disabled = state.issues.length > 0
  }

  function renderHistoryState() {
    els.btnUndo.disabled = state.history.length === 0
    els.btnRedo.disabled = state.future.length === 0
    els.btnUndo.title = state.history.length ? `撤销：${state.history.at(-1).label}` : '撤销'
    els.btnRedo.title = state.future.length ? `重做：${state.future.at(-1).label}` : '重做'
  }

  function serializeGrid() {
    return JSON.stringify(state.grid, null, 2)
  }

  function copySelection() {
    const coords = selectedCoords()
    const minR = Math.min(...coords.map((coord) => coord.r))
    const minC = Math.min(...coords.map((coord) => coord.c))
    state.clipboard = {
      cells: coords.map((coord) => ({ dr: coord.r - minR, dc: coord.c - minC, cell: cloneValue(state.grid[coord.r][coord.c]) })),
    }
    renderInspector()
    toast(`已复制 ${coords.length} 格`)
  }

  function pasteSelection() {
    if (!state.clipboard) return
    const source = state.clipboard.cells
    const targets = selectedCoords()
    const pasted = []
    commit(`粘贴 ${source.length} 格`, () => {
      if (source.length === 1) {
        for (const target of targets) {
          state.grid[target.r][target.c] = cloneValue(source[0].cell)
          pasted.push(target)
        }
      } else if (targets.length === 1) {
        for (const item of source) {
          const r = state.primary.r + item.dr
          const c = state.primary.c + item.dc
          if (r < ROWS && c < COLS) {
            state.grid[r][c] = cloneValue(item.cell)
            pasted.push({ r, c })
          }
        }
      } else if (targets.length === source.length) {
        targets.forEach((target, index) => {
          state.grid[target.r][target.c] = cloneValue(source[index].cell)
          pasted.push(target)
        })
      } else {
        toast('多格粘贴需要选择一个起点，或选择相同数量的目标格', 'error')
      }
    })
    if (pasted.length) {
      state.selected = new Set(pasted.map((coord) => coordKey(coord.r, coord.c)))
      state.primary = pasted[0]
      state.anchor = pasted[0]
      renderAll()
    }
  }

  function clearSelected() {
    applySelected(`清空 ${state.selected.size} 格`, (cell, coord) => { state.grid[coord.r][coord.c] = emptyCell() })
  }

  function loadGrid(grid, options = {}) {
    state.grid = cloneValue(grid)
    state.source = options.source || '未命名地图'
    state.sourceType = options.sourceType || 'json'
    state.warnings = options.warnings || []
    state.sheetMap = options.sheetMap || []
    state.selected = new Set([coordKey(0, 0)])
    state.primary = { r: 0, c: 0 }
    state.anchor = { r: 0, c: 0 }
    state.history = []
    state.future = []
    state.cleanSnapshot = snapshotGrid()
    renderAll()
  }

  function confirmDiscard() {
    return !isDirty() || window.confirm('当前地图有尚未导出的修改。继续会覆盖这些修改，确定吗？')
  }

  function findSheet(workbook, keyword) {
    return workbook.worksheets.find((sheet) => sheet?.name?.includes(keyword)) || null
  }

  function sheetToArray(sheet) {
    const rows = []
    sheet.eachRow({ includeEmpty: true }, (row) => {
      const values = []
      row.eachCell({ includeEmpty: true }, (cell) => values.push(cell.value === undefined ? null : cell.value))
      rows.push(values)
    })
    return rows
  }

  function isBlank(value) {
    return value === null || value === undefined || value === ''
  }

  function normalize10x10(rows, sheetName, warnings, errors) {
    const maxColumns = Math.max(...rows.map((row) => row.length), 0)
    const normalized = Array.from({ length: ROWS }, () => Array(COLS).fill(null))
    for (let r = 0; r < rows.length; r++) {
      for (let c = 0; c < (rows[r] || []).length; c++) {
        const value = rows[r][c]
        if (r >= ROWS || c >= COLS) {
          if (!isBlank(value)) errors.push(`${sheetName}表第 ${r + 1} 行第 ${c + 1} 列存在真实值，超出 10×10 范围`)
        } else normalized[r][c] = value
      }
    }
    if (rows.length > ROWS || maxColumns > COLS) warnings.push(`检测到 ${sheetName}表格式残留：${rows.length}×${maxColumns}，已安全标准化为 10×10。`)
    return normalized
  }

  function checkedCellValue(value, at, errors) {
    if (value === null || value === undefined) return null
    if (value instanceof Date) {
      errors.push(`${at} 禁止导入日期单元格`)
      return null
    }
    if (typeof value === 'object') {
      if (value.formula !== undefined) errors.push(`${at} 禁止导入公式单元格`)
      else if (value.richText !== undefined) errors.push(`${at} 禁止导入富文本单元格`)
      else if (value.error !== undefined) errors.push(`${at} 禁止导入错误值单元格`)
      else if (value.hyperlink !== undefined) errors.push(`${at} 禁止导入超链接单元格`)
      else errors.push(`${at} 不支持的单元格值类型`)
      return null
    }
    return value
  }

  function parseSpawns(value, levelRange, at, errors) {
    if (isBlank(value) || String(value).trim() === '-') return []
    const monsters = []
    for (const part of String(value).split(',')) {
      const id = part.trim().toLowerCase()
      if (!GUID_RE.test(id)) {
        errors.push(`${at} 刷怪 GUID 必须是 16 位十六进制：${id}`)
        continue
      }
      monsters.push({ id, lvMin: levelRange?.min || 1, lvMax: levelRange?.max || 1, weight: 1 })
    }
    return monsters
  }

  async function importExcel(file) {
    const errors = []
    const warnings = []
    try {
      if (!globalThis.ExcelJS) throw new Error('ExcelJS 未成功加载')
      const workbook = new ExcelJS.Workbook()
      await workbook.xlsx.load(await file.arrayBuffer())
      const sheets = {}
      const sheetMap = []
      for (const definition of SHEET_DEFINITIONS) {
        const sheet = findSheet(workbook, definition.key)
        if (!sheet) errors.push(`找不到包含“${definition.key}”的工作表`)
        else {
          sheets[definition.field] = sheet
          sheetMap.push({ key: definition.key, name: sheet.name })
        }
      }
      if (errors.length) return { ok: false, errors, warnings }
      const arrays = {}
      for (const definition of SHEET_DEFINITIONS) {
        arrays[definition.field] = normalize10x10(sheetToArray(sheets[definition.field]), definition.key, warnings, errors)
      }
      const grid = newBlankGrid()
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          const at = `R${r + 1} C${c + 1}`
          const name = checkedCellValue(arrays.name[r][c], `${at} 名称表`, errors)
          const levelValue = checkedCellValue(arrays.level[r][c], `${at} 等级表`, errors)
          const icon = checkedCellValue(arrays.icon[r][c], `${at} 图标表`, errors)
          const pass = checkedCellValue(arrays.pass[r][c], `${at} 通行表`, errors)
          const spawn = checkedCellValue(arrays.spawn[r][c], `${at} 刷怪表`, errors)
          const cell = emptyCell()
          if (!isBlank(name) && typeof name !== 'string') errors.push(`${at} 名称必须是字符串或空`)
          else cell.name = name || ''
          if (!isBlank(icon)) {
            if (Number.isInteger(icon)) cell.icon = icon
            else errors.push(`${at} 图标必须是整数：${String(icon)}`)
          }
          const levelRange = parseLevelRange(levelValue, at, errors)
          if (levelRange) cell.levelRange = levelRange
          cell.Passability = parsePassability(pass, at, errors)
          cell.monsters = parseSpawns(spawn, levelRange, at, errors)
          grid[r][c] = cell
        }
      }
      const schemaIssues = validateGrid(grid)
      errors.push(...schemaIssues.map((entry) => `${entry.r === null ? '' : `R${entry.r + 1} C${entry.c + 1} `}${entry.message}`))
      return errors.length
        ? { ok: false, errors, warnings }
        : { ok: true, grid, source: file.name, sourceType: 'excel', warnings, sheetMap }
    } catch (error) {
      return { ok: false, errors: [`读取 Excel 失败：${error.message || error}`], warnings }
    }
  }

  async function importJson(file) {
    try {
      const grid = JSON.parse(await file.text())
      const issues = validateGrid(grid)
      if (issues.length) return { ok: false, errors: issues.map((entry) => `${entry.r === null ? '' : `R${entry.r + 1} C${entry.c + 1} `}${entry.message}`), warnings: [] }
      return { ok: true, grid, source: file.name, sourceType: 'json', warnings: [], sheetMap: [] }
    } catch (error) {
      return { ok: false, errors: [`JSON 解析失败：${error.message}`], warnings: [] }
    }
  }

  async function handleFile(file) {
    if (!file) return
    if (!/\.(xlsx|json)$/i.test(file.name)) return toast(`不支持 ${file.name}，仅可导入 .xlsx / .json`, 'error')
    if (!confirmDiscard()) return
    toast(`正在读取 ${file.name}…`)
    const result = /\.xlsx$/i.test(file.name) ? await importExcel(file) : await importJson(file)
    if (!result.ok) {
      state.warnings = result.warnings || []
      showImportErrors(result.errors)
      return
    }
    loadGrid(result.grid, result)
    toast(`已导入 ${file.name}`)
  }

  function showImportErrors(errors) {
    toast(`导入失败：${errors[0]}${errors.length > 1 ? `（另有 ${errors.length - 1} 项）` : ''}`, 'error')
    state.warnings = [...errors.map((message) => `导入错误：${message}`), ...state.warnings]
    renderDiagnostics()
  }

  function downloadJson() {
    state.issues = validateGrid(state.grid)
    if (state.issues.length) {
      renderAll()
      return toast('当前数据存在校验错误，已阻止导出', 'error')
    }
    const blob = new Blob([serializeGrid()], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = '地图格.json'
    document.body.appendChild(link)
    link.click()
    link.remove()
    setTimeout(() => URL.revokeObjectURL(url), 0)
    state.cleanSnapshot = snapshotGrid()
    renderDocumentState()
    toast('已生成 地图格.json')
  }

  function openJsonModal() {
    els.jsonPreview.textContent = serializeGrid()
    els.jsonModal.classList.remove('hidden')
    els.jsonModal.setAttribute('aria-hidden', 'false')
    els.btnCloseJson.focus()
  }

  function closeJsonModal() {
    els.jsonModal.classList.add('hidden')
    els.jsonModal.setAttribute('aria-hidden', 'true')
    els.btnJson.focus()
  }

  function toast(message, type = 'info') {
    const element = document.createElement('div')
    element.className = `toast ${type}`
    element.textContent = message
    els.toastRegion.appendChild(element)
    setTimeout(() => element.remove(), 2800)
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]))
  }

  function isEditingTarget(target) {
    return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement
  }

  function moveSelection(dr, dc, extend) {
    const next = {
      r: Math.max(0, Math.min(ROWS - 1, state.primary.r + dr)),
      c: Math.max(0, Math.min(COLS - 1, state.primary.c + dc)),
    }
    if (extend) state.selected = new Set(rectangleCoords(state.anchor, next).map((coord) => coordKey(coord.r, coord.c)))
    else {
      state.selected = new Set([coordKey(next.r, next.c)])
      state.anchor = { ...next }
    }
    state.primary = next
    renderAll()
    document.querySelector(`.map-cell[data-r="${next.r}"][data-c="${next.c}"]`)?.focus()
  }

  els.btnNew.addEventListener('click', () => {
    if (confirmDiscard()) loadGrid(newBlankGrid(), { source: '新建空白', sourceType: 'new' })
  })
  els.btnImportExcel.addEventListener('click', () => { els.fileInput.accept = '.xlsx'; els.fileInput.click() })
  els.btnImportJson.addEventListener('click', () => { els.fileInput.accept = '.json'; els.fileInput.click() })
  els.fileInput.addEventListener('change', () => {
    const file = els.fileInput.files?.[0]
    els.fileInput.value = ''
    handleFile(file)
  })
  els.btnDownload.addEventListener('click', downloadJson)
  els.btnUndo.addEventListener('click', undo)
  els.btnRedo.addEventListener('click', redo)
  els.btnSelectAll.addEventListener('click', selectAll)
  els.btnClearCells.addEventListener('click', clearSelected)
  els.btnCopy.addEventListener('click', copySelection)
  els.btnPaste.addEventListener('click', pasteSelection)
  els.btnPrimaryOnly.addEventListener('click', () => selectOnly(state.primary.r, state.primary.c))
  els.btnJson.addEventListener('click', openJsonModal)
  els.btnCloseJson.addEventListener('click', closeJsonModal)
  els.jsonModal.addEventListener('click', (event) => { if (event.target === els.jsonModal) closeJsonModal() })
  els.diagnosticToggle.addEventListener('click', () => {
    state.diagnosticsOpen = !state.diagnosticsOpen
    renderDiagnostics()
  })
  els.gridZoom.addEventListener('input', () => {
    document.documentElement.style.setProperty('--cell-size', `${els.gridZoom.value}px`)
    els.zoomOutput.textContent = els.gridZoom.value
  })

  document.addEventListener('keydown', (event) => {
    const modifier = event.ctrlKey || event.metaKey
    if (event.key === 'Escape' && !els.jsonModal.classList.contains('hidden')) return closeJsonModal()
    if (isEditingTarget(event.target)) return
    if (modifier && event.key.toLowerCase() === 'z') {
      event.preventDefault()
      event.shiftKey ? redo() : undo()
    } else if (modifier && event.key.toLowerCase() === 'y') {
      event.preventDefault(); redo()
    } else if (modifier && event.key.toLowerCase() === 'c') {
      event.preventDefault(); copySelection()
    } else if (modifier && event.key.toLowerCase() === 'v') {
      event.preventDefault(); pasteSelection()
    } else if (modifier && event.key.toLowerCase() === 'a') {
      event.preventDefault(); selectAll()
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault(); clearSelected()
    } else if (event.key === 'Escape') {
      selectOnly(state.primary.r, state.primary.c)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault(); moveSelection(-1, 0, event.shiftKey)
    } else if (event.key === 'ArrowDown') {
      event.preventDefault(); moveSelection(1, 0, event.shiftKey)
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault(); moveSelection(0, -1, event.shiftKey)
    } else if (event.key === 'ArrowRight') {
      event.preventDefault(); moveSelection(0, 1, event.shiftKey)
    }
  })

  document.addEventListener('dragenter', (event) => {
    event.preventDefault()
    state.dragDepth++
    els.dropOverlay.classList.remove('hidden')
  })
  document.addEventListener('dragover', (event) => event.preventDefault())
  document.addEventListener('dragleave', (event) => {
    event.preventDefault()
    state.dragDepth = Math.max(0, state.dragDepth - 1)
    if (!state.dragDepth) els.dropOverlay.classList.add('hidden')
  })
  document.addEventListener('drop', (event) => {
    event.preventDefault()
    state.dragDepth = 0
    els.dropOverlay.classList.add('hidden')
    handleFile(event.dataTransfer?.files?.[0])
  })
  window.addEventListener('beforeunload', (event) => {
    if (!isDirty()) return
    event.preventDefault()
    event.returnValue = ''
  })

  renderLegend()
  renderAll()
}
