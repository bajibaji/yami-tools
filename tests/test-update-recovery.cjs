const fs = require('fs')
const path = require('path')
const os = require('os')
const vm = require('vm')

// 中转文件全部落在系统临时目录（tests/ 里不留运行产物）
const WORK_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'yami-recovery-cases-'))

let passed = 0, failed = 0
function check(name, ok, detail) {
  const extra = detail === undefined ? '' : '  [' + detail + ']'
  if (ok) { passed++; console.log('  PASS  ' + name + extra) } else { failed++; console.error('  FAIL  ' + name + extra) }
}

/* 造一个「更新写坏了」的插件目录 */
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'yami-recover-'))
const ENTRIES = ['manifest.json', 'probe-core.js', 'ai-render-core.js', 'hud-overlay.js', 'ai-agent.js']
// 旧版本备份（内容 = OLD）
for (const rel of ENTRIES) {
  const bak = path.join(DIR, '_backup', 'previous', rel)
  fs.mkdirSync(path.dirname(bak), { recursive: true })
  fs.writeFileSync(bak, 'OLD ' + rel)
}
// 被写坏的新版本（模拟只写了前两个文件就崩了）
fs.writeFileSync(path.join(DIR, 'manifest.json'), '{ 坏掉的 JSON')
fs.writeFileSync(path.join(DIR, 'probe-core.js'), 'BROKEN')
// 更新器留下的「进行中」标记
fs.writeFileSync(path.join(DIR, '.yami-update-in-progress.json'), JSON.stringify({ previousVersion: '1.9.2', nextVersion: '1.9.3' }))

/* 从 bootstrap.js 抽出恢复逻辑，在受控环境里跑 */
const bootstrapSrc = fs.readFileSync(path.join(__dirname, '..', 'bootstrap.js'), 'utf8')
function extract(startMark, endMark) {
  const i = bootstrapSrc.indexOf(startMark)
  const j = bootstrapSrc.indexOf(endMark, i)
  if (i < 0 || j < 0) throw new Error('抽不到: ' + startMark)
  return bootstrapSrc.slice(i, j)
}
const markerLiteral = (bootstrapSrc.match(/const UPDATE_MARKER = '[^']+';/) || [''])[0].replace('const UPDATE_MARKER = ', '')
const filesLiteral = (bootstrapSrc.match(/const FILES = \[[^\]]+\];/) || [''])[0].replace('const FILES = ', '')
const pieces = [
  'const UPDATE_MARKER = ' + markerLiteral + ';',
  extract('  function nodeModules()', '  async function recoverFromInterruptedUpdate'),
  extract('  async function recoverFromInterruptedUpdate', '  function loadScript')
].join('\n')

/* candidateBases 用桩替掉：直接指向测试目录 */
const stub = [
  'function candidateBases() { return [' + JSON.stringify('file:///' + DIR.replace(/\\/g, '/') + '/') + ']; }',
  'const FILES = ' + filesLiteral + ';',
  'const BACKUP_DIR = \'_backup/previous\';',
  'const RECOVERY_ENTRY = [\'manifest.json\'].concat(FILES);',
  'function nodeModules() { return { fs: require("fs"), path: require("path"), zlib: require("zlib") }; }',
  'const document = { getElementById: () => null, createElement: () => ({ setAttribute(){}, remove(){}, style:{} }), body: { appendChild(){} }, addEventListener(){} };',
  'const setTimeout = () => {};'
].join('\n')

const code = stub + '\n' + pieces + '\nmodule.exports = { recoverFromInterruptedUpdate, resolvePluginDir: resolvePluginDir, nodeModules: nodeModules };'
fs.writeFileSync(path.join(WORK_DIR, 'recover-extract.cjs'), code)
let extractSrc = fs.readFileSync(path.join(WORK_DIR, 'recover-extract.cjs'), 'utf8')
extractSrc = extractSrc.replace(/function candidateBases\(\) \{ return \[[^\]]+\]; \}/, 'function candidateBases() { return [' + JSON.stringify('file:///' + DIR.replace(/\\/g, '/') + '/') + ']; }')
fs.writeFileSync(path.join(WORK_DIR, 'recover-extract.cjs'), extractSrc)
const extractPath = path.join(WORK_DIR, 'recover-extract.cjs')
delete require.cache[require.resolve(extractPath)]
const api = require(extractPath)

async function main() {
console.log('')
console.log('########## bootstrap 的更新恢复 ##########')
check('恢复逻辑在 bootstrap 里（注释与实现都就位）', /recoverFromInterruptedUpdate/.test(bootstrapSrc) && /UPDATE_MARKER/.test(bootstrapSrc))

const notice = await api.recoverFromInterruptedUpdate()
check('检测到未完成的更新并给出提示', /没有正常完成/.test(String(notice)), String(notice).slice(0, 60))
const restoredAll = ENTRIES.every(rel => fs.readFileSync(path.join(DIR, rel), 'utf8') === 'OLD ' + rel)
check('五个入口文件全部回退成旧版本', restoredAll, ENTRIES.map(rel => fs.readFileSync(path.join(DIR, rel), 'utf8').slice(0, 12)).join(' | '))
check('回退后删掉「进行中」标记，不会反复回退', !fs.existsSync(path.join(DIR, '.yami-update-in-progress.json')))
check('第二次调用不再回退（标记已清）', (await api.recoverFromInterruptedUpdate()) === '')

/* 备份不全时必须什么都不动 */
const DIR2 = fs.mkdtempSync(path.join(os.tmpdir(), 'yami-recover2-'))
fs.writeFileSync(path.join(DIR2, 'manifest.json'), 'GOOD')
fs.writeFileSync(path.join(DIR2, '.yami-update-in-progress.json'), '{}')
fs.mkdirSync(path.join(DIR2, '_backup', 'previous'), { recursive: true })
// 只补 4 个（故意缺 ai-agent.js）：备份不齐时不允许回退
for (const rel of ['manifest.json', 'probe-core.js', 'ai-render-core.js', 'hud-overlay.js']) {
  const bak = path.join(DIR2, '_backup', 'previous', rel)
  fs.mkdirSync(path.dirname(bak), { recursive: true })
  fs.writeFileSync(bak, 'OLD2 ' + rel)
}
const bootstrapSrc2 = bootstrapSrc.replace('function candidateBases() {', 'function candidateBases() { return [' + JSON.stringify('file:///' + DIR2.replace(/\\/g, '/') + '/') + ']; function _unused() {')
const code2 = stub.replace(/function candidateBases\(\) \{ return \[[^\]]+\]; \}/, 'function candidateBases() { return [' + JSON.stringify('file:///' + DIR2.replace(/\\/g, '/') + '/') + ']; }') + '\n' + pieces + '\nmodule.exports = { recoverFromInterruptedUpdate };'
const extractPath2 = path.join(WORK_DIR, 'recover-extract2.cjs')
fs.writeFileSync(extractPath2, code2)
delete require.cache[require.resolve(extractPath2)]
const api2 = require(extractPath2)
const notice2 = await api2.recoverFromInterruptedUpdate()
check('备份不齐时不报假成功（提示为空、标记留着）', notice2 === '', 'notice=' + JSON.stringify(String(notice2).slice(0, 30)))
check('备份不齐时保留标记，留着下次再试', fs.existsSync(path.join(DIR2, '.yami-update-in-progress.json')))

console.log('')
console.log('########## 更新恢复: ' + passed + ' PASS / ' + failed + ' FAIL ##########')
cleanup()
process.exit(failed ? 1 : 0)
}

/* 抽出来跑用的中转文件与夹具目录都写进系统临时目录，跑完删掉（别在 tests/ 里留垃圾） */
function cleanup() {
  try { fs.rmSync(WORK_DIR, { recursive: true, force: true }) } catch (e) {}
}
process.on('exit', cleanup)

main().catch(e => { console.error(e); cleanup(); process.exit(1) })
