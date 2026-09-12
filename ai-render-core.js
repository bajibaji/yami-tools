/**
 * ai-render-core.js — 流式渲染的纯逻辑核心（浏览器全局 + Node 可 require，便于单测）
 *
 * 为什么单独拆出来：
 *   对话是逐 token 推送的。旧实现每来一个片段就把「全文」重新赋给 textContent、
 *   并同步把滚动条拉到底——这是 O(n^2) 的字符串拷贝加同步重排，
 *   思考越长、历史越多，主线程被拖得越死，最后整页卡住不动。
 *   这里把三件事拆成可测的纯逻辑：
 *     ① 帧合并调度：一帧只渲染一次，片段再多也只写一次 DOM；
 *     ② 增量文本缓冲：新片段只追加，不再重设全文；
 *     ③ 单行预览与历史窗口的取值规则。
 */
(function (root, factory) {
  const api = factory();
  // 两边都要挂，不能二选一：Electron 渲染进程里 module 与 window 同时存在，
  // 只走 CommonJS 分支的话 window.YamiAiRenderCore 永远是 undefined，
  // 依赖它的前端就一个字都渲染不出来（实测踩过）。
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  if (root) root.YamiAiRenderCore = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /**
   * 帧合并调度器：同一帧内的多次 schedule 只会在下一帧执行一次。
   * raf 可注入，方便在没有 requestAnimationFrame 的环境（Node 单测）里替换。
   */
  function createScheduler(raf) {
    const request = raf || (typeof requestAnimationFrame === 'function'
      ? requestAnimationFrame
      : function (fn) { return setTimeout(fn, 16); });
    let queued = false;
    let runs = 0;
    function schedule(fn) {
      if (queued) return false;
      queued = true;
      request(function () {
        queued = false;
        runs++;
        try { fn(); } catch (e) { /* 单次渲染失败不该打断整条流 */ }
      });
      return true;
    }
    return {
      schedule,
      isPending: function () { return queued; },
      runs: function () { return runs; }
    };
  }

  /**
   * 增量文本缓冲：append 只做拼接，不产生全文副本。
   * 同时按需维护「最后一行」，供单行预览使用——预览不该每次都去 split 全文。
   */
  function createTextBuffer() {
    let text = '';
    let tail = '';
    let tailDirty = true;
    return {
      append: function (chunk) {
        if (!chunk) return;
        text += chunk;
        // 只在新片段里出现换行时才需要重算最后一行
        if (chunk.indexOf('\n') !== -1) tailDirty = true;
        else tail += chunk;
        return text.length;
      },
      toString: function () { return text; },
      length: function () { return text.length; },
      lastLine: function (max) {
        if (tailDirty) {
          const lines = text.split('\n');
          tail = '';
          for (let i = lines.length - 1; i >= 0; i--) {
            if (lines[i].trim()) { tail = lines[i]; break; }
          }
          tailDirty = false;
        }
        const limit = max || 160;
        return tail.length > limit ? tail.slice(-limit) : tail;
      },
      reset: function () { text = ''; tail = ''; tailDirty = true; }
    };
  }

  /**
   * 是否该自动跟到底部：只有用户本来就在底部附近时才跟随，
   * 用户往上翻看历史时不该被强行拽回去（旧实现每帧都强制拉到底）。
   */
  function shouldStickToBottom(metrics, threshold) {
    if (!metrics) return true;
    const distance = Number(metrics.scrollHeight || 0) - Number(metrics.scrollTop || 0) - Number(metrics.clientHeight || 0);
    return !(distance > (threshold == null ? 80 : threshold));
  }

  /**
   * 滚动跟随状态机（纯逻辑，便于单测）。
   *
   * 判据必须来自「用户意图」，不能是「此刻离底部多远」：内容一追加 scrollHeight 就变大，
   * 追加完再算距离，老老实实待在底部的用户也会被判成"翻上去看历史了"；
   * 阈值给大了更糟——用户刚上滚一点仍算在底部，于是每来一段新内容就被拽回去一次。
   * 所以这里把状态单独拎出来：滚动事件喂 onScroll，滚轮上滚喂 onUserScrollUp，
   * 追加内容后问 onAppend，只有返回 'scroll' 才真的去滚。
   */
  function createFollowState(threshold) {
    const state = {
      follow: true,     // 是否跟随最新内容
      pending: false,   // 暂停跟随期间，下方是否又长了新内容
      nearBottom: function (metrics) { return shouldStickToBottom(metrics, threshold); },
      onScroll: function (metrics) {
        state.follow = shouldStickToBottom(metrics, threshold);
        if (state.follow) state.pending = false;
        return state.follow;
      },
      onUserScrollUp: function () { state.follow = false; return state.follow; },
      onAppend: function () {
        if (state.follow) { state.pending = false; return 'scroll'; }
        state.pending = true;
        return 'hold';
      },
      force: function () { state.follow = true; state.pending = false; return 'scroll'; }
    };
    return state;
  }

  /**
   * 单行预览取哪一行：显示**最后一行**——用户想知道的是它此刻在想什么，而不是几分钟前的开场白。
   * 末尾过长时保留最新那段（从尾部截）；最后一行太短（一个词、一个工具名）就往前并上一行，
   * 凑成一句读得懂的。
   */
  function previewLine(text, options) {
    const opts = options || {};
    const limit = opts.limit || 160;
    const minChars = opts.minChars || 16;
    const lines = String(text == null ? '' : text).split('\n')
      .map(function (line) { return line.trim(); })
      .filter(Boolean);
    if (!lines.length) return '';
    let line = lines[lines.length - 1];
    let index = lines.length - 2;
    while (line.length < minChars && index >= 0) { line = lines[index] + ' ' + line; index--; }
    return line.length > limit ? '…' + line.slice(-(limit - 1)) : line;
  }

  /**
   * 历史消息窗口：只渲染最近 limit 条，更早的用一行提示代替。
   * 会话长了以后，几千个 DOM 节点会让每次滚动和插入都变慢。
   */
  function historyWindow(messages, limit) {
    const list = Array.isArray(messages) ? messages : [];
    const max = limit || 60;
    if (list.length <= max) return { shown: list.slice(), hiddenCount: 0 };
    return { shown: list.slice(list.length - max), hiddenCount: list.length - max };
  }

  /**
   * 思考分段状态机：一个用户回合里的多轮推理各成一段。
   * 判据只有两条 —— 中间发生过工具调用，或者正文已经开始（调用方在那些时刻调 seal()）；
   * 同一轮的连续增量不换段。以前整回合只有一块，多轮推理糊成一堵墙，用户看到的就是
   * "只有一个思考窗口"。放这里是为了能单测（DOM 那一层只负责建块与换缓冲）。
   */
  function createThinkingSegments() {
    let round = 0;
    let sealed = true;   // true = 下一条思考增量要开新段
    return {
      /** 收到一条思考增量：要开新段就返回**新段号**（>=1），同一段内继续追加返回 0 */
      accept: function () {
        if (!sealed) return 0;
        sealed = false;
        round += 1;
        return round;
      },
      /** 封段（工具调用 / 正文开始 / 回合结束）：本次真的从"开着"变成"封上"才返回 true */
      seal: function () {
        if (sealed) return false;
        sealed = true;
        return true;
      },
      round: function () { return round; },
      sealed: function () { return sealed; },
      reset: function () { round = 0; sealed = true; }
    };
  }

  /**
   * 轮次过程汇总标题：过程区头部（实时）与收起后的控制条共用同一套口径，
   * 免得"实时一个说法、收起后另一个说法"。三项全为 0 时给「已思考」，
   * 不留一个空标题在那里（调用方传 empty: '' 可以关掉这个兜底）。
   */
  function processFoldTitle(info) {
    const source = info || {};
    const seconds = Math.max(0, Math.round(Number(source.seconds) || 0));
    const rounds = Math.max(0, Math.round(Number(source.rounds) || 0));
    const steps = Math.max(0, Math.round(Number(source.steps) || 0));
    const parts = [];
    if (seconds > 0) parts.push('思考 ' + seconds + ' 秒');
    if (rounds > 1) parts.push(rounds + ' 段');
    if (steps > 0) parts.push(steps + ' 步');
    if (!parts.length) return source.empty === undefined ? '已思考' : String(source.empty);
    return parts.join(' · ');
  }

  /**
   * 轮次结束要不要把过程收起来（纯判据，DOM 那一层只负责执行）。
   * 三条任一不满足就不收：
   *   ① 标准模式：过程行始终可见（用户明确选了"我都要看"）；
   *   ② 没有最终正文：整轮只有过程证据（被打断/只调了工具），收起等于把仅有的信息藏了；
   *   ③ 键盘焦点还在过程里：收起会把焦点成员藏掉，先留焦点再谈整洁。
   */
  function turnProcessFold(options) {
    const source = options || {};
    const mode = source.mode === 'standard' ? 'standard' : 'compact';
    const rounds = Math.max(0, Math.round(Number(source.rounds) || 0));
    const steps = Math.max(0, Math.round(Number(source.steps) || 0));
    const seconds = Math.max(0, Math.round(Number(source.seconds) || 0));
    const fold = mode === 'compact' && !!source.hasAnswer && !source.focusInside && (rounds > 0 || steps > 0);
    return { fold: fold, title: processFoldTitle({ seconds: seconds, rounds: rounds, steps: steps }) };
  }

  /** token 数缩写：13.5k / 1.2M，行内不铺长数字 */
  function shortTokens(n) {
    const value = Math.max(0, Number(n) || 0);
    if (value >= 1000000) return (value / 1000000).toFixed(1) + 'M';
    if (value >= 1000) return (value / 1000).toFixed(1) + 'k';
    return String(Math.round(value));
  }

  /**
   * 每轮用量行：**记账不全就整行不显示**（宁可不出行，也不把部分总量冒充完整结果）。
   * complete 由宿主判定（本轮每一次模型调用都报告了 usage 才算全）。
   */
  function formatTurnUsage(usage) {
    const source = usage || {};
    const calls = Math.max(0, Math.round(Number(source.calls) || 0));
    const prompt = Math.max(0, Number(source.promptTokens) || 0);
    const completion = Math.max(0, Number(source.completionTokens) || 0);
    const cached = Math.max(0, Number(source.cachedTokens) || 0);
    const cost = Math.max(0, Number(source.cost) || 0);
    const total = prompt + completion;
    if (source.complete !== true || calls <= 0 || total <= 0) return { show: false, text: '', detail: '' };
    return {
      show: true,
      text: '本轮 ' + calls + ' 次调用 · ' + shortTokens(total) + ' tokens' + (cost > 0 ? ' · 约 ' + cost.toFixed(4) + ' 元' : ''),
      detail: '输入 ' + prompt + ' tokens（缓存命中 ' + cached + '）· 输出 ' + completion + ' tokens' + (cost > 0 ? ' · 估算花费 ' + cost.toFixed(4) + ' 元' : '')
    };
  }

  return {
    createScheduler: createScheduler,
    createTextBuffer: createTextBuffer,
    createFollowState: createFollowState,
    shouldStickToBottom: shouldStickToBottom,
    previewLine: previewLine,
    historyWindow: historyWindow,
    createThinkingSegments: createThinkingSegments,
    processFoldTitle: processFoldTitle,
    turnProcessFold: turnProcessFold,
    shortTokens: shortTokens,
    formatTurnUsage: formatTurnUsage
  };
});
