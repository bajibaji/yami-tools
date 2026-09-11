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
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.YamiAiRenderCore = factory();
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
   * 历史消息窗口：只渲染最近 limit 条，更早的用一行提示代替。
   * 会话长了以后，几千个 DOM 节点会让每次滚动和插入都变慢。
   */
  function historyWindow(messages, limit) {
    const list = Array.isArray(messages) ? messages : [];
    const max = limit || 60;
    if (list.length <= max) return { shown: list.slice(), hiddenCount: 0 };
    return { shown: list.slice(list.length - max), hiddenCount: list.length - max };
  }

  return {
    createScheduler: createScheduler,
    createTextBuffer: createTextBuffer,
    shouldStickToBottom: shouldStickToBottom,
    historyWindow: historyWindow
  };
});
