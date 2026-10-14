'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const http = require('node:http')
const { spawn } = require('node:child_process')
const { contextKey, resolveTarget, checkTarget } = require('../runtime/yami-mcp/modules/ai-workflow')
const { ChangeSets } = require('../runtime/yami-mcp/modules/change-set')

const ROOT = path.resolve(__dirname, '..')
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'yami-workflow-'))
const a = 'Assets/A.abcdef1234567890.actor'
const b = 'Assets/B.bcdef12345678901.actor'
const read = rel => fs.readFileSync(path.join(temp, rel), 'utf8')
const write = (rel, text) => { fs.mkdirSync(path.dirname(path.join(temp, rel)), { recursive: true }); fs.writeFileSync(path.join(temp, rel), text) }
const resource = JSON.stringify({ sprites: [], attributes: [], events: [] })
let editorContext = { schemaVersion: 2, projectRoot: temp, contextRevision: 1, environment: 'editor', page: '角色', activeFile: { path: b, name: 'B' }, selectedFiles: [{ path: a, name: 'A' }, { path: b, name: 'B' }], selectedFile: { path: a }, hasPendingInput: false }
const children = []
const servers = []
let count = 0
function pass(label) { count++; console.log('PASS ' + label) }

async function listen(handler) {
  const server = http.createServer(handler)
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  servers.push(server)
  return server.address().port
}

function request(port, route, body, token = '') {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body))
    const req = http.request({ hostname: '127.0.0.1', port, path: route, method: payload ? 'POST' : 'GET', headers: { 'x-yami-agent-token': token, ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {}) } }, res => {
      let raw = ''
      res.on('data', chunk => { raw += chunk })
      res.on('end', () => {
        try {
          if (route.endsWith('/stream')) resolve(raw.split('\n\n').filter(block => block.startsWith('data:')).map(block => JSON.parse(block.slice(5))))
          else resolve(JSON.parse(raw))
        } catch (error) { reject(error) }
      })
    })
    req.on('error', reject)
    req.end(payload)
  })
}

function mcp(env) {
  const child = spawn(process.execPath, [path.join(ROOT, 'runtime/yami-mcp/server.js'), '--root', temp], { windowsHide: true, env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'] })
  children.push(child)
  let seq = 0
  let buffer = ''
  const pending = new Map()
  child.stdout.on('data', data => {
    buffer += data
    let newline
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const message = JSON.parse(buffer.slice(0, newline)); buffer = buffer.slice(newline + 1)
      const item = pending.get(message.id)
      if (item) { pending.delete(message.id); clearTimeout(item.timer); item.resolve(message) }
    }
  })
  return async (name, args) => {
    const id = ++seq
    const result = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('MCP timeout: ' + name)), 15000)
      pending.set(id, { resolve, timer })
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } }) + '\n')
    })
    return JSON.parse(result.result.content[0].text)
  }
}

async function main() {
  write(a, resource); write(b, resource)
  write('Data/config.json', '{}'); write('Data/plugins.json', '[]'); write('Data/commands.json', '[]')
  write('Data/variables.json', '[]')
  write('game.yamirpg', '{}')
  write('tsconfig.json', '{}')
  write('Script/types.d.ts', 'interface Script<T = unknown> {}\ninterface GameSaveData {}\ninterface PluginSaveDefine {}\n')
  write('compiler.cjs', "const fs=require('fs');const path=require('path');const file=path.join(process.cwd(),'Script/test.ts');if(fs.existsSync(file)&&fs.readFileSync(file,'utf8').includes('BROKEN')){console.log('Script/test.ts(1,1): error TS1109: invalid');process.exit(1)}")
  const context = { ...editorContext, selectedFiles: [{ path: a, name: 'A' }] }
  assert.deepEqual(resolveTarget('改这个技能', context).paths, [a]); pass('单选定位，不冒充当前打开文件')
  assert.equal(resolveTarget('改这个', editorContext).needsAlignment, true); pass('多选不默认第一项')
  assert.deepEqual(resolveTarget('这几个都改', editorContext).paths, [a, b]); pass('多选明确全部时保留完整目标')
  assert.deepEqual(resolveTarget('改当前打开的文件', context).paths, [b]); pass('正在编辑文件独立于资源树选择')
  assert.deepEqual(resolveTarget('改这个', editorContext, [b]).paths, [b]); pass('明确路径优先')
  const instance = { ...context, selectedObject: { kind: 'scene-instance', presetId: 'abcdef1234567890', name: 'Hero', instanceFile: { path: 'Assets/Map.abc1234567890123.scene' }, sourceFile: { path: a } } }
  assert.equal(resolveTarget('这个角色强一点', instance).needsAlignment, true)
  assert.deepEqual(resolveTarget('把这个角色往右移动', instance).paths, ['Assets/Map.abc1234567890123.scene']); pass('区分场景实例和源定义')
  assert.equal(resolveTarget('改这个', { presence: { kind: 'region', label: '检视器', vague: true } }).needsAlignment, true); pass('区域不能推导写入目标')
  assert.equal(contextKey({ ...context, presence: { label: 'A' } }), contextKey({ ...context, presence: { label: 'B' } })); pass('鼠标移动不改变冻结目标身份')
  assert.ok(checkTarget(resolveTarget('改这个', context), 'patch_resource', { path: b })); pass('拦截超出冻结目标的修改')
  const skillPath = 'Assets/Skill.abc1234567891234.skill'
  const skillContext = { ...instance, selectedFiles: [{ name: '落雷', path: skillPath, type: 'skill' }] }
  assert.deepEqual(resolveTarget('把我选中的这个技能攻击力改成 50', skillContext).paths, [skillPath]); pass('明确技能需求不被残留场景角色选择抢走')
  assert.equal(resolveTarget('修改选中的这个技能', { ...instance, selectedFiles: [] }).needsAlignment, true); pass('选中对象类型与用户需求冲突时对齐，不改错类型')
  const uiTarget = resolveTarget('修改这个按钮', { selectedObject: { kind: 'ui-node', presetId: 'abc1234567890001', instanceFile: { path: 'Assets/ui.abc1234567890123.ui' } } })
  const expanded = { ...uiTarget, paths: uiTarget.paths.concat('Script/helper.ts') }
  assert.equal(checkTarget(expanded, 'edit_script', { path: 'Script/helper.ts' }), ''); pass('单节点任务批准的关联脚本不被错误限制为节点修改')

  const editorPort = await listen((req, res) => {
    const send = body => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(body)) }
    if (req.url === '/context') return send({ ok: true, context: editorContext, summary: 'selected A' })
    if (req.url === '/whoami') return send({ ok: true, projectRoot: temp })
    if (req.url === '/token') return send({ ok: true, bridgeToken: 'fixture' })
    let raw = ''
    req.on('data', chunk => { raw += chunk })
    req.on('end', () => send({ ok: true, action: JSON.parse(raw || '{}').action, dirty: false }))
  })
  let verifiedAfterWrite = false
  const runtimePort = await listen((req, res) => {
    const send = data => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(data)) }
    if (req.url === '/context') return send({ ok: true, context: { environment: 'playtest', projectRoot: temp, page: '试玩', scene: 'Test', contextRevision: 1 } })
    if (req.url === '/token') return send({ ok: true, bridgeToken: 'fixture' })
    if (req.url === '/diagnose') return send({ summary: {}, performance: { frameP95Ms: 16 }, errors: [], stuckEvents: [] })
    req.on('data', () => {})
    req.on('end', () => {
      verifiedAfterWrite = JSON.parse(read(a)).verification === 1
      send({ ok: true })
    })
  })
  const env = { YAMI_EDITOR_BRIDGE_PORT: String(editorPort), YAMI_RUNTIME_BRIDGE_PORT: String(runtimePort), YAMI_TSC_JS: path.join(temp, 'compiler.cjs'), YAMI_MCP_GUARDED: '1', YAMI_MCP_REQUIRE_CHANGE_SET: '1' }
  const tool = mcp(env)
  const prepare = ops => tool('prepare_change_set', { operations: ops })
  const commit = set => tool('commit_change_set', { changeSetId: set.changeSetId, confirmationToken: set.confirmationToken })
  const patch = (rel, value) => ({ name: 'patch_resource', args: { path: rel, patch: { value }, dryRun: false } })
  const guarded = await tool('patch_resource', { path: a, patch: { value: 9 }, dryRun: false })
  assert.equal(guarded.ok, false); assert.equal(read(a), resource); pass('MCP 受限模式不能绕过确认写盘')
  let set = await prepare([patch(a, 1), patch(b, 2)])
  assert.equal(set.ok, true, set.error); assert.equal(set.files.length, 2); assert.equal(read(a), resource); assert.equal(read(b), resource); pass('整组预览零写盘')
  assert.equal((await commit(set)).ok, true); assert.equal(JSON.parse(read(a)).value, 1); assert.equal(JSON.parse(read(b)).value, 2); pass('一次确认提交全部冻结内容')
  const changelog = await tool('project_changelog', {})
  if (changelog.summary) assert.equal(changelog.summary.compileChecked, 0)
  assert.equal((await commit(set)).ok, false); pass('确认令牌不能重放')
  set = await prepare([patch(a, 3), patch(b, 4)])
  write(b, JSON.stringify({ sprites: [], attributes: [], value: 'human' }))
  assert.equal((await commit(set)).ok, false); assert.equal(JSON.parse(read(a)).value, 1); assert.equal(JSON.parse(read(b)).value, 'human'); pass('任一哈希冲突时整组不写入')
  set = await prepare([patch(a, 5), patch(a, 6)])
  assert.equal(set.files.length, 1); assert.equal((await commit(set)).ok, true); assert.equal(JSON.parse(read(a)).value, 6); pass('同文件多处修改聚合为一个最终差异')
  set = await prepare([patch(a, 55)])
  const draftRead = await tool('read_change_set', { changeSetId: set.changeSetId, path: a })
  assert.equal(draftRead.staged, true); assert.equal(draftRead.content.value, 55); assert.equal(JSON.parse(read(a)).value, 6); pass('读取草案版本不读取旧磁盘版本，也不写盘')
  const full = await tool('read_change_set', { changeSetId: set.changeSetId, path: a, fullDiff: true })
  assert.ok(full.diff.includes('55')); pass('完整差异读取来自冻结草案')
  const newVariable = await prepare([{ name: 'upsert_database_item', args: { table: 'variables', item: { name: 'score', value: 0 } } }])
  assert.equal(newVariable.ok, true, newVariable.error)
  const recalculated = await prepare(newVariable.operations.concat(patch(a, 77)))
  assert.equal(recalculated.ok, true, recalculated.error)
  assert.equal(recalculated.previews[0].preview.id, newVariable.previews[0].preview.id); pass('草案追加和恢复时首次生成的数据条目 ID 保持一致')
  write('Script/test.ts', 'const ok = 1')
  const beforeA = read(a)
  set = await prepare([patch(a, 7), { name: 'edit_script', args: { path: 'Script/test.ts', oldText: 'const ok = 1', newText: 'BROKEN' } }])
  assert.equal(set.ok, true, set.error)
  const failed = await commit(set)
  assert.equal(failed.ok, false); assert.equal(failed.rollback.ok, true); assert.equal(read(a), beforeA); assert.equal(read('Script/test.ts'), 'const ok = 1'); pass('编译失败整组回滚，而非只恢复脚本')
  set = await prepare([{ name: 'upsert_database_item', args: { table: 'config', item: { gameId: 'new' } } }])
  assert.ok(set.files[0].diff.includes('gameId')); assert.equal((await commit(set)).ok, true); pass('数据表提供完整精确差异')
  const recovery = new ChangeSets(temp)
  const journal = { id: 'fixture', status: 'committing', files: [{ path: a, before: beforeA, after: resource, applied: false }] }
  write(a, resource)
  write('.yami-mcp-backups/transactions/fixture.json', JSON.stringify(journal))
  assert.equal(recovery.recover()[0].ok, true); assert.equal(read(a), beforeA); pass('进程中断恢复未完成事务')
  const ui = 'Assets/UI.abc1234567890123.ui'
  const nodeA = 'abc1234567890001', nodeB = 'abc1234567890002'
  write(ui, JSON.stringify({ width: 800, height: 600, nodes: [{ class: 'text', name: 'same', presetId: nodeA, content: 'A' }, { class: 'text', name: 'same', presetId: nodeB, content: 'B' }] }))
  set = await prepare([{ name: 'patch_resource', args: { path: ui, presetId: nodeB, patch: { content: 'changed' } } }])
  assert.equal(set.ok, true, set.error); assert.equal((await commit(set)).ok, true)
  assert.equal(JSON.parse(read(ui)).nodes[0].content, 'A'); assert.equal(JSON.parse(read(ui)).nodes[1].content, 'changed'); pass('同名 UI 节点用 presetId 精确修改')
  set = await prepare([{ name: 'patch_resource', args: { path: ui, presetId: 'missing', patch: { content: 'wrong' } } }])
  assert.equal(set.ok, false); pass('不存在节点拒绝修改')
  const created = 'Assets/Plugin.abcdef1234567888.ts'
  set = await prepare([{ name: 'create_script', args: { path: created, type: 'plugin', className: 'Example', nameZh: 'Test' } }])
  assert.equal(set.ok, true, set.error); assert.ok(set.files.some(file => file.path === 'Data/plugins.json'))
  const createdResult = await commit(set)
  assert.equal(createdResult.ok, true, JSON.stringify(createdResult)); assert.ok(JSON.parse(read('Data/plugins.json')).some(item => item.id === 'abcdef1234567888')); pass('新建脚本注册表也纳入确认和事务')
  const deletedBefore = read(b)
  set = await prepare([{ name: 'delete_resource', args: { path: b } }]); assert.equal(set.ok, true, set.error)
  const deletion = await commit(set); assert.equal(deletion.ok, true); assert.ok(!fs.existsSync(path.join(temp, b)))
  set = await prepare([{ name: 'restore_backup', args: { path: b, backup: deletion.files[0].backup } }]); assert.equal(set.ok, true, set.error)
  assert.equal((await commit(set)).ok, true); assert.equal(read(b), deletedBefore); pass('删除的文件可以从本次备份恢复')
  const beforeCancel = read(a)
  set = await prepare([patch(a, 88)])
  await tool('cancel_change_set', { changeSetId: set.changeSetId }); assert.equal((await commit(set)).ok, false); assert.equal(read(a), beforeCancel); pass('取消草案不写入')
  const transaction = new ChangeSets(temp)
  const local = await transaction.prepare([patch(a, 99)], async () => ({ ok: true, __writes: [{ path: a, content: resource }] }))
  let cancelled = false
  const stopped = await transaction.commit(local.changeSetId, local.confirmationToken, { validate: async () => { cancelled = true; return { ok: true } }, cancelled: () => cancelled })
  assert.equal(stopped.ok, false); assert.equal(stopped.rollback.ok, true); assert.equal(read(a), beforeCancel); pass('提交期间取消会等整组回滚')

  const captured = []
  let modelMode = 'patch'
  let repairCount = 0
  const modelPort = await listen((req, res) => {
    let raw = ''
    req.on('data', chunk => { raw += chunk })
    req.on('end', () => {
      const body = JSON.parse(raw); captured.push(body)
      const messages = body.messages
      const user = messages.map(message => message.role).lastIndexOf('user')
      const tools = messages.slice(user + 1).filter(message => message.role === 'tool')
      let message
      if (modelMode === 'verify') {
        const committed = messages.some(item => item.__hostNote && (item.content || '').startsWith('（宿主变更集真实结果：')) || messages.some(item => (item.content || '').startsWith('（宿主变更集真实结果：'))
        const toolCall = (name, args) => ({ role: 'assistant', content: '处理中', tool_calls: [{ id: 'verify-' + captured.length, type: 'function', function: { name, arguments: JSON.stringify(args) } }] })
        if (committed) message = tools.length ? { role: 'assistant', content: '试玩验证已完成' } : toolCall('playtest_smoke', { sequence: 'ok', settleMs: 200 })
        else if (!tools.length) message = toolCall('read_resource', { path: a })
        else if (tools.length === 1) message = toolCall('patch_resource', { path: a, patch: { verification: 1 }, dryRun: false })
        else message = { role: 'assistant', content: '草案待确认' }
      } else if (modelMode === 'repair') {
        const repairAsked = messages.some(item => /编译器原始输出/.test(item.content || ''))
        if (!tools.length) message = { role: 'assistant', content: '读取脚本', tool_calls: [{ id: 'repair-read-' + repairCount, type: 'function', function: { name: 'read_script', arguments: JSON.stringify({ path: 'Script/test.ts' }) } }] }
        else if (tools.length === 1) message = { role: 'assistant', content: '准备脚本', tool_calls: [{ id: 'repair-edit-' + repairCount++, type: 'function', function: { name: 'edit_script', arguments: JSON.stringify({ path: 'Script/test.ts', oldText: 'const ok = 1', newText: repairAsked ? 'const ok = 2' : 'BROKEN', dryRun: false }) } }] }
        else message = { role: 'assistant', content: '草案已准备' }
      } else if (!tools.length) message = { role: 'assistant', content: '读取目标', tool_calls: [a, b].map((rel, i) => ({ id: 'read' + i, type: 'function', function: { name: 'read_resource', arguments: JSON.stringify({ path: rel }) } })) }
      else if (tools.length === 2) message = { role: 'assistant', content: '准备修改草案', tool_calls: [a, b].map((rel, i) => ({ id: 'write' + i, type: 'function', function: { name: 'patch_resource', arguments: JSON.stringify({ path: rel, patch: { host: i }, dryRun: false }) } })) }
      else message = { role: 'assistant', content: '两处草案已准备' }
      res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ choices: [{ message }] }))
    })
  })
  const token = 'fixture-token'
  const hostEnv = { ...process.env, ...env, YAMI_AI_PORT: '0', YAMI_AI_TOKEN: token, YAMI_PROJECT_ROOT: temp, YAMI_AI_CONFIG_DIR: path.join(temp, 'config'), YAMI_AI_SESSION_DIR: path.join(temp, 'sessions') }
  let host = spawn(process.execPath, [path.join(ROOT, 'ai-host.js')], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: hostEnv })
  children.push(host)
  let hostPort
  for (let i = 0; i < 60; i++) {
    try { hostPort = Number(read('config/agent-port')); if ((await request(hostPort, '/status', undefined, token)).ok) break } catch {}
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  assert.ok(hostPort)
  await request(hostPort, '/config', { endpoint: 'http://127.0.0.1:' + modelPort, model: 'fake', thinkingMode: 'disabled' }, token)
  const capture = await request(hostPort, '/capture', { page: 'editor' }, token)
  const originalQueueContext = editorContext
  editorContext = { ...editorContext, contextRevision: 99, selectedFiles: [{ path: b, name: 'B' }] }
  const queued = await request(hostPort, '/chat', { sessionId: 'queued', message: '把这些选中的角色都改一下', captureId: capture.captureId }, token)
  assert.equal(queued.status, 'approval', JSON.stringify(queued)); assert.deepEqual(queued.approval.frozenTarget.paths, [a, b]); pass('排队消息按发送时快照定位，出队不换目标')
  await request(hostPort, '/reject', { sessionId: 'queued' }, token)
  editorContext = originalQueueContext
  const first = read(a), second = read(b)
  const events = await request(hostPort, '/chat/stream', { sessionId: 'fixture', message: '把这几个选中的角色都改一下', pageContext: { page: 'editor', summary: '伪造错误目标' } }, token)
  const result = events.find(event => event.type === 'result')
  assert.equal(result.status, 'approval', JSON.stringify(result))
  assert.equal(result.approval.files.length, 2); assert.equal(read(a), first); assert.equal(read(b), second); pass('宿主选中仍需确认，多文件只有一张确认')
  const system = captured[0].messages[0].content
  assert.ok(system.includes('contextRevision')); assert.ok(!system.includes('伪造错误目标')); pass('实际模型请求使用桥接结构化快照')
  const names = captured[0].tools.map(item => item.function.name)
  for (const name of ['cdp_eval', 'interact_editor', 'click_element', 'commit_change_set', 'write_script']) assert.ok(!names.includes(name))
  pass('模型不能获取执行旁路与确认令牌工具')
  editorContext = { ...editorContext, contextRevision: 2, selectedFiles: [{ path: b, name: 'B' }] }
  const stale = await request(hostPort, '/approve', { sessionId: 'fixture', changeSetId: result.approval.changeSetId }, token)
  assert.equal(stale.status, 'approval'); assert.ok(stale.approval.contextConflict); assert.equal(read(a), first); pass('确认前切换目标先对齐，不静默换目标')
  const approved = await request(hostPort, '/approve', { sessionId: 'fixture', changeSetId: stale.approval.changeSetId, confirmFrozenTarget: true }, token)
  assert.equal(approved.ok, true, JSON.stringify(approved)); assert.equal(JSON.parse(read(a)).host, 0); assert.equal(JSON.parse(read(b)).host, 1); pass('再次明确确认仍修改冻结的原目标')
  const undo = await request(hostPort, '/backup-undo', { sessionId: 'fixture', path: a }, token)
  assert.equal(undo.ok, true, JSON.stringify(undo)); assert.equal(read(a), first); pass('宿主撤销使用本对话备份并走事务')
  const alignment = await request(hostPort, '/chat', { sessionId: 'align', message: '改这个' }, token)
  assert.equal(alignment.status, 'alignment'); assert.ok(alignment.alignment.summary.includes(a)); pass('模型超出冻结范围时先确认关联文件')
  editorContext = { ...editorContext, contextRevision: 3, selectedFiles: [{ path: a, name: 'A' }, { path: b, name: 'B' }] }
  const multiple = await request(hostPort, '/chat', { sessionId: 'multi', message: '改这个' }, token)
  assert.equal(multiple.status, 'alignment'); assert.ok(multiple.alignment.id); pass('真实宿主多选先对齐')
  const selected = await request(hostPort, '/align', { sessionId: 'multi', alignmentId: multiple.alignment.id, answers: ['@' + a] }, token)
  assert.ok(['approval', 'alignment'].includes(selected.status), JSON.stringify(selected)); pass('对齐结果绑定原始需求而非当前鼠标')
  modelMode = 'repair'
  const repair = await request(hostPort, '/chat', { sessionId: 'repair', message: '修复 @Script/test.ts' }, token)
  assert.equal(repair.status, 'approval', JSON.stringify(repair)); assert.equal(read('Script/test.ts'), 'const ok = 1')
  const fix = await request(hostPort, '/approve', { sessionId: 'repair', changeSetId: repair.approval.changeSetId }, token)
  assert.equal(fix.status, 'approval', JSON.stringify(fix)); assert.equal(read('Script/test.ts'), 'const ok = 1')
  assert.ok(captured.some(body => body.messages.some(item => /编译器原始输出/.test(item.content || '')))); pass('编译失败先整组回滚，再生成修复草案而非自动写入')
  const repaired = await request(hostPort, '/approve', { sessionId: 'repair', changeSetId: fix.approval.changeSetId }, token)
  assert.equal(repaired.ok, true, JSON.stringify(repaired)); assert.equal(read('Script/test.ts'), 'const ok = 2'); pass('修复草案再次确认后通过编译并写入')
  modelMode = 'patch'
  const restartDraft = await request(hostPort, '/chat', { sessionId: 'restart', message: '修改 @' + a + ' 和 @' + b }, token)
  assert.equal(restartDraft.status, 'approval', JSON.stringify(restartDraft))
  host.kill(); await new Promise(resolve => host.once('exit', resolve))
  host = spawn(process.execPath, [path.join(ROOT, 'ai-host.js')], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: hostEnv }); children.push(host)
  for (let i = 0; i < 60; i++) {
    try { hostPort = Number(read('config/agent-port')); if ((await request(hostPort, '/status', undefined, token)).ok) break } catch {}
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  const restored = await request(hostPort, '/session/load', { sessionId: 'restart' }, token)
  assert.equal(restored.pending.tool, 'commit_change_set'); assert.equal(restored.pending.files.length, 1)
  const refreshed = await request(hostPort, '/approve', { sessionId: 'restart', changeSetId: restored.pending.changeSetId }, token)
  assert.equal(refreshed.status, 'approval', JSON.stringify(refreshed)); assert.notEqual(refreshed.approval.changeSetId, restored.pending.changeSetId); pass('重启恢复草案先重新预览，不重用旧令牌写入')
  await request(hostPort, '/reject', { sessionId: 'restart' }, token)
  modelMode = 'verify'
  const verifyDraft = await request(hostPort, '/chat', { sessionId: 'verify', message: '修改 @' + a + ' 并执行试玩冒烟' }, token)
  assert.equal(verifyDraft.status, 'approval', JSON.stringify(verifyDraft))
  const verifyGate = await request(hostPort, '/approve', { sessionId: 'verify', changeSetId: verifyDraft.approval.changeSetId }, token)
  assert.equal(verifyGate.status, 'approval', JSON.stringify(verifyGate)); assert.equal(verifyGate.approval.tool, 'playtest_smoke')
  assert.equal(JSON.parse(read(a)).verification, 1); assert.equal(verifiedAfterWrite, false); pass('试玩动作在整组写入后另行确认，不用草案冒充验证')
  const verified = await request(hostPort, '/approve', { sessionId: 'verify' }, token)
  assert.equal(verified.status, 'done', JSON.stringify(verified)); assert.equal(verifiedAfterWrite, true)
  assert.equal(verified.validation.playtest.performed, true); assert.ok(verified.validation.resources); pass('试玩审批续跑保留真实资源校验与试玩结论')
  console.log('AI workflow: ' + count + ' checks passed')
}

main().catch(error => { console.error(error); process.exitCode = 1 }).finally(async () => {
  for (const child of children) {
    if (child.exitCode !== null || child.signalCode !== null) continue
    await new Promise(resolve => { child.once('exit', resolve); child.kill() })
  }
  for (const server of servers) await new Promise(resolve => server.close(resolve))
  assert.ok(path.resolve(temp).startsWith(path.resolve(os.tmpdir()) + path.sep))
  fs.rmSync(temp, { recursive: true, force: true })
})
