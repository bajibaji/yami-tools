/**
 * YA TOOLS · 脚本转换台 (JS -> TS) 交互逻辑
 */

(function () {
  'use strict';

  // 默认内嵌示例（来自 D:\new-game\DANJUAN TOOLS\JS\根据角色相对坐标的距离排序.2061c85d76d05240.js）
  const SAMPLE_CODE = `/*
@plugin #plugin
@version 1.0
@author yahzj
@link 
@desc #desc

@option targetVariable {'local', 'global'}
@alias #targetVariable {#variable-local, #variable-global}

@string localVariable
@alias #localVariable
@cond targetVariable {'local'}

@variable globalVariable
@alias #globalVariable
@cond targetVariable {'global'}


@variable-number RangeX
@alias #RangeX
@default 0

@variable-number RangeY
@alias #RangeY
@default 0

@boolean sort
@alias #sort
@default true

@lang zh
#plugin 根据相对坐标的距离排序
#desc 获取角色文件属性相关指令
#targetVariable 目标变量
#variable-local 本地变量
#variable-global 全局变量
#localVariable 本地变量
#globalVariable 本地变量
#localActorKey 角色变量
#globalActorKey 角色变量
#RangeX X坐标
#RangeY Y坐标
#sort 是否升序排序

*/

export default class sortActorRange {
  call() {
    let actorList
    switch (this.targetVariable) {
      case 'local':
        actorList = Event.attributes[this.localVariable]
        break
      case 'global':
        actorList = Variable.get(this.globalVariable)
        break
    }
    if(this.sort){
      actorList.sort((a, b) => Math.abs(a.x - this.RangeX) + Math.abs(a.y - this.RangeY) - Math.abs(b.x - this.RangeX) - Math.abs(b.y - this.RangeY))
    }else{
      actorList.sort((a, b) => Math.abs(b.x - this.RangeX) + Math.abs(b.y - this.RangeY) - Math.abs(a.x - this.RangeX) - Math.abs(a.y - this.RangeY))
    }
  }
}
`;

  const state = {
    currentFilename: '根据角色相对坐标的距离排序.2061c85d76d05240.js',
    batchFiles: [], // [{ name, content, tsCode }]
    activeBatchIndex: -1
  };

  // DOM 元素
  const dom = {
    sourceCode: document.getElementById('source-code'),
    targetCode: document.getElementById('target-code'),
    sourceFilename: document.getElementById('source-filename'),
    targetFilename: document.getElementById('target-filename'),
    sourceStats: document.getElementById('source-stats'),
    targetStats: document.getElementById('target-stats'),
    selectScriptType: document.getElementById('select-script-type'),
    btnConvert: document.getElementById('btn-convert'),
    btnCopyTs: document.getElementById('btn-copy-ts'),
    btnDownloadTs: document.getElementById('btn-download-ts'),
    btnLoadSample: document.getElementById('btn-load-sample'),
    btnPickFile: document.getElementById('btn-pick-file'),
    btnPickDir: document.getElementById('btn-pick-dir'),
    btnClear: document.getElementById('btn-clear'),
    fileInput: document.getElementById('file-input'),
    dirInput: document.getElementById('dir-input'),
    sourceWrapper: document.getElementById('source-wrapper'),
    dropOverlay: document.getElementById('drop-overlay'),
    metaSummary: document.getElementById('meta-summary'),
    diagnosticsList: document.getElementById('diagnostics-list'),
    statusText: document.getElementById('status-text'),
    toastRegion: document.getElementById('toast-region'),
    batchDrawer: document.getElementById('batch-drawer'),
    batchList: document.getElementById('batch-list'),
    batchCount: document.getElementById('batch-count'),
    btnBatchExport: document.getElementById('btn-batch-export'),
    btnCloseBatch: document.getElementById('btn-close-batch')
  };

  // Toast 提示
  function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    dom.toastRegion.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      toast.style.transition = 'all 0.2s ease';
      setTimeout(() => toast.remove(), 200);
    }, 2800);
  }

  // 格式化输出文件名
  function getTargetFilename(sourceName) {
    if (!sourceName) return 'script.ts';
    if (sourceName.endsWith('.js')) {
      return sourceName.slice(0, -3) + '.ts';
    }
    return sourceName + '.ts';
  }

  // 更新统计标签
  function updateStats() {
    const sLines = dom.sourceCode.value ? dom.sourceCode.value.split('\n').length : 0;
    const tLines = dom.targetCode.value ? dom.targetCode.value.split('\n').length : 0;
    dom.sourceStats.textContent = `${sLines} 行 · ${dom.sourceCode.value.length} 字符`;
    dom.targetStats.textContent = `${tLines} 行 · ${dom.targetCode.value.length} 字符`;
  }

  // 执行转换
  function runConvert() {
    const jsCode = dom.sourceCode.value.trim();
    if (!jsCode) {
      dom.targetCode.value = '';
      dom.metaSummary.innerHTML = '<div class="empty-hint">暂多元数据信息</div>';
      dom.diagnosticsList.innerHTML = '<div class="empty-hint">等待输入代码</div>';
      updateStats();
      dom.statusText.textContent = '就绪';
      return;
    }

    try {
      const forceType = dom.selectScriptType.value === 'auto' ? null : dom.selectScriptType.value;
      const result = window.ScriptConverter.convertJsToTs(jsCode, { forceScriptType: forceType });

      dom.targetCode.value = result.tsCode;
      dom.targetFilename.textContent = getTargetFilename(state.currentFilename);

      // 渲染元数据摘要
      renderMetaSummary(result.meta);

      // 渲染诊断流水线
      renderDiagnostics(result);

      updateStats();
      dom.statusText.textContent = `转换完成 · 泛型: Script<${result.scriptType}> · 生成 ${result.meta.parameters ? result.meta.parameters.length : 0} 个接口属性`;
    } catch (err) {
      console.error(err);
      showToast(`转换失败: ${err.message}`, 'error');
      dom.diagnosticsList.innerHTML = `<div class="diagnostic-item warning"><span class="diagnostic-icon">⚠️</span><span>解析错误: ${err.message}</span></div>`;
    }
  }

  // 渲染元数据面板
  function renderMetaSummary(meta) {
    if (!meta || !meta.hasMeta) {
      dom.metaSummary.innerHTML = '<div class="empty-hint">未检测到 /* @plugin */ 元数据注释</div>';
      return;
    }

    const pluginName = (meta.langMap?.zh && meta.langMap.zh.plugin) ? meta.langMap.zh.plugin : (meta.overview.plugin || '未命名插件');
    const paramCount = meta.parameters ? meta.parameters.length : 0;

    let html = `
      <div class="meta-row"><span class="meta-key">插件/指令名:</span><span class="meta-val">${pluginName}</span></div>
      <div class="meta-row"><span class="meta-key">作者 / 版本:</span><span class="meta-val">${meta.overview.author || '未知'} (v${meta.overview.version || '1.0'})</span></div>
      <div class="meta-row"><span class="meta-key">参数总数:</span><span class="meta-val">${paramCount} 个</span></div>
    `;

    if (paramCount > 0) {
      html += `<div class="param-chips">`;
      for (const p of meta.parameters) {
        html += `<span class="param-chip" title="${p.tag}: ${p.key}">${p.key}</span>`;
      }
      html += `</div>`;
    }

    dom.metaSummary.innerHTML = html;
  }

  // 渲染诊断流水线
  function renderDiagnostics(result) {
    let html = '';

    // 泛型识别
    html += `<div class="diagnostic-item success"><span class="diagnostic-icon">✓</span><span>形态: <strong>Script&lt;${result.scriptType}&gt;</strong></span></div>`;

    // 变更记录
    if (result.changes && result.changes.length > 0) {
      for (const c of result.changes) {
        html += `<div class="diagnostic-item info"><span class="diagnostic-icon">ℹ</span><span>${c.description}</span></div>`;
      }
    }

    // 诊断告警
    if (result.diagnostics && result.diagnostics.length > 0) {
      for (const d of result.diagnostics) {
        const cls = d.type === 'warning' ? 'warning' : 'info';
        const icon = d.type === 'warning' ? '⚠️' : 'ℹ';
        html += `<div class="diagnostic-item ${cls}"><span class="diagnostic-icon">${icon}</span><span>${d.message}</span></div>`;
      }
    }

    dom.diagnosticsList.innerHTML = html || '<div class="empty-hint">无可列出项</div>';
  }

  // 防抖自动转换
  let debounceTimer = null;
  dom.sourceCode.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(runConvert, 150);
  });

  dom.selectScriptType.addEventListener('change', runConvert);
  dom.btnConvert.addEventListener('click', runConvert);

  // 加载示例代码
  dom.btnLoadSample.addEventListener('click', () => {
    state.currentFilename = '根据角色相对坐标的距离排序.2061c85d76d05240.js';
    dom.sourceFilename.textContent = state.currentFilename;
    dom.sourceCode.value = SAMPLE_CODE;
    runConvert();
    showToast('已载入示例老 JS 代码', 'success');
  });

  // 清空
  dom.btnClear.addEventListener('click', () => {
    state.currentFilename = '未命名脚本.js';
    dom.sourceFilename.textContent = state.currentFilename;
    dom.targetFilename.textContent = '转换结果';
    dom.sourceCode.value = '';
    dom.targetCode.value = '';
    dom.metaSummary.innerHTML = '<div class="empty-hint">暂多元数据信息</div>';
    dom.diagnosticsList.innerHTML = '<div class="empty-hint">就绪</div>';
    updateStats();
    dom.statusText.textContent = '已清空';
  });

  // 复制 TS 代码
  dom.btnCopyTs.addEventListener('click', async () => {
    const tsCode = dom.targetCode.value;
    if (!tsCode) {
      showToast('暂无可复制的 TS 代码', 'warning');
      return;
    }
    try {
      await navigator.clipboard.writeText(tsCode);
      showToast('已复制 TS 代码到剪贴板', 'success');
    } catch {
      // 降级复制
      dom.targetCode.select();
      document.execCommand('copy');
      showToast('已复制 TS 代码到剪贴板', 'success');
    }
  });

  // 下载单个 .ts 文件
  dom.btnDownloadTs.addEventListener('click', () => {
    const tsCode = dom.targetCode.value;
    if (!tsCode) {
      showToast('暂无可下载的 TS 代码', 'warning');
      return;
    }
    const outName = getTargetFilename(state.currentFilename);
    const blob = new Blob([tsCode], { type: 'text/typescript;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = outName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast(`已下载 ${outName}`, 'success');
  });

  // 文件选择与批量处理
  dom.btnPickFile.addEventListener('click', () => dom.fileInput.click());
  dom.btnPickDir.addEventListener('click', () => dom.dirInput.click());

  async function loadFiles(fileList) {
    const files = Array.from(fileList).filter((f) => f.name.endsWith('.js'));
    if (files.length === 0) {
      showToast('所选文件列表中没有 .js 文件', 'warning');
      return;
    }

    state.batchFiles = [];
    for (const file of files) {
      const content = await file.text();
      state.batchFiles.push({
        name: file.name,
        content
      });
    }

    if (state.batchFiles.length === 1) {
      // 单文件模式
      const single = state.batchFiles[0];
      state.currentFilename = single.name;
      dom.sourceFilename.textContent = single.name;
      dom.sourceCode.value = single.content;
      dom.batchDrawer.classList.add('hidden');
      runConvert();
      showToast(`已加载 ${single.name}`, 'success');
    } else {
      // 批量模式
      dom.batchDrawer.classList.remove('hidden');
      dom.batchCount.textContent = state.batchFiles.length;
      renderBatchList();
      selectBatchFile(0);
      showToast(`已批量加载 ${state.batchFiles.length} 个 .js 文件`, 'success');
    }
  }

  function renderBatchList() {
    dom.batchList.innerHTML = '';
    state.batchFiles.forEach((file, index) => {
      const item = document.createElement('div');
      item.className = `batch-item ${index === state.activeBatchIndex ? 'active' : ''}`;
      item.textContent = file.name;
      item.addEventListener('click', () => selectBatchFile(index));
      dom.batchList.appendChild(item);
    });
  }

  function selectBatchFile(index) {
    if (index < 0 || index >= state.batchFiles.length) return;
    state.activeBatchIndex = index;
    const file = state.batchFiles[index];
    state.currentFilename = file.name;
    dom.sourceFilename.textContent = file.name;
    dom.sourceCode.value = file.content;
    renderBatchList();
    runConvert();
  }

  dom.btnCloseBatch.addEventListener('click', () => {
    dom.batchDrawer.classList.add('hidden');
  });

  // 批量导出所有 TS 文件
  dom.btnBatchExport.addEventListener('click', () => {
    if (state.batchFiles.length === 0) return;

    let exported = 0;
    for (const file of state.batchFiles) {
      const result = window.ScriptConverter.convertJsToTs(file.content);
      const outName = getTargetFilename(file.name);
      const blob = new Blob([result.tsCode], { type: 'text/typescript;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = outName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      exported++;
    }
    showToast(`已批量导出 ${exported} 个 .ts 脚本文件`, 'success');
  });

  dom.fileInput.addEventListener('change', (e) => {
    if (e.target.files && e.target.files.length > 0) {
      loadFiles(e.target.files);
    }
  });

  dom.dirInput.addEventListener('change', (e) => {
    if (e.target.files && e.target.files.length > 0) {
      loadFiles(e.target.files);
    }
  });

  // 拖拽支持
  dom.sourceWrapper.addEventListener('dragover', (e) => {
    e.preventDefault();
    dom.dropOverlay.classList.remove('hidden');
  });

  dom.sourceWrapper.addEventListener('dragleave', (e) => {
    if (!dom.sourceWrapper.contains(e.relatedTarget)) {
      dom.dropOverlay.classList.add('hidden');
    }
  });

  dom.sourceWrapper.addEventListener('drop', (e) => {
    e.preventDefault();
    dom.dropOverlay.classList.add('hidden');
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      loadFiles(e.dataTransfer.files);
    }
  });

  // 初始加载示例
  state.currentFilename = '根据角色相对坐标的距离排序.2061c85d76d05240.js';
  dom.sourceFilename.textContent = state.currentFilename;
  dom.sourceCode.value = SAMPLE_CODE;
  runConvert();
})();
