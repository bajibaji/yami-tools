/**
 * Yami 脚本转换器核心引擎 (JS -> TS)
 * 支持将旧版 Yami RPG Maker JS 脚本转换为符合现代规范的 TypeScript 插件/指令脚本。
 * 兼容 Node.js 与现代浏览器环境。
 */

(function (global) {
  'use strict';

  /**
   * 标签到 TypeScript 类型的映射规则
   */
  const TAG_TYPE_MAP = {
    'string': 'string',
    'file': 'string',
    'color': 'string',
    'keycode': 'string',
    'sound': 'string',
    'font': 'string',
    'scene': 'string',
    'ui': 'string',
    'event': 'string',
    'dialog': 'string',
    'easing': 'string',
    'team': 'string',
    'attribute': 'string',
    'attribute-key': 'string',
    'attribute-group': 'string',
    'enum': 'string',
    'enum-value': 'string',
    'enum-group': 'string',
    'number': 'number',
    'variable-number': 'number',
    'boolean': 'boolean',
    'variable': 'string',
    'variable-getter': 'any',
    'variable-setter': 'VariableSetter',
    'actor-getter': 'Actor',
    'skill-getter': 'Skill',
    'state-getter': 'State',
    'equipment-getter': 'Equipment',
    'item-getter': 'Item',
    'element-getter': 'UIElement',
    'position-getter': '{ x: number, y: number }',
    'actor': 'string',
    'region': 'string',
    'light': 'string',
    'animation': 'string',
    'particle': 'string',
    'parallax': 'string',
    'tilemap': 'string',
    'element': 'string',
    'element-id': 'string',
    'number[]': 'number[]',
    'string[]': 'string[]',
    'boolean[]': 'boolean[]',
    'group[]': 'any[]'
  };

  /**
   * 解析 JS 文件头部的 /* @plugin ... *\/ 元数据注释
   * @param {string} code 源代码
   * @returns {object} 解析结果
   */
  function parsePluginMeta(code) {
    const metaSelector = /\/\*\s*@plugin\s[\s\S]+?(?=\*\/)/;
    const match = code.match(metaSelector);
    if (!match) {
      return {
        hasMeta: false,
        rawMeta: '',
        parameters: [],
        overview: {},
        langMap: {},
        warnings: ['未在文件头部找到 /* @plugin ... */ 元数据注释块']
      };
    }

    const rawMeta = match[0];
    const lines = rawMeta.split('\n');
    const parameters = [];
    const overview = {
      plugin: '',
      version: '1.0',
      author: '',
      link: '',
      desc: ''
    };
    const langMap = {};
    const warnings = [];

    let currentParam = null;
    let currentLang = null;

    for (let line of lines) {
      line = line.trim().replace(/^\/\*\s*|\s*\*\/$/g, '').trim();
      if (!line) continue;

      if (line.startsWith('@lang')) {
        const parts = line.split(/\s+/);
        currentLang = parts[1] || 'zh';
        if (!langMap[currentLang]) langMap[currentLang] = {};
        currentParam = null;
        continue;
      }

      if (line.startsWith('#')) {
        if (currentLang) {
          const spaceIdx = line.indexOf(' ');
          if (spaceIdx > 0) {
            const key = line.slice(1, spaceIdx).trim();
            const val = line.slice(spaceIdx + 1).trim();
            langMap[currentLang][key] = val;
          }
        }
        continue;
      }

      if (line.startsWith('@')) {
        const firstSpace = line.indexOf(' ');
        const tag = firstSpace === -1 ? line.slice(1) : line.slice(1, firstSpace);
        const rest = firstSpace === -1 ? '' : line.slice(firstSpace + 1).trim();

        // 概览标签
        if (['plugin', 'version', 'author', 'link', 'desc'].includes(tag) && !currentParam) {
          overview[tag] = rest;
          continue;
        }

        // 参数类型标签
        if (tag === 'option') {
          // @option key {'opt1', 'opt2'}
          const optMatch = rest.match(/^([a-zA-Z0-9_\-$]+)\s*(\{[\s\S]*\})?/);
          if (optMatch) {
            const key = optMatch[1];
            let options = [];
            if (optMatch[2]) {
              const rawOpts = optMatch[2].replace(/^\{|\}$/g, '');
              options = rawOpts.split(',').map(s => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
            }
            currentParam = {
              key,
              tag: 'option',
              type: 'option',
              options,
              alias: '',
              desc: '',
              defaultVal: options[0] ? `'${options[0]}'` : undefined,
              cond: null
            };
            parameters.push(currentParam);
          }
          continue;
        }

        // 基础与复杂类型参数
        if (TAG_TYPE_MAP[tag]) {
          const keyMatch = rest.match(/^([a-zA-Z0-9_\-$]+)/);
          if (keyMatch) {
            const key = keyMatch[1];
            currentParam = {
              key,
              tag,
              type: TAG_TYPE_MAP[tag],
              options: [],
              alias: '',
              desc: '',
              defaultVal: undefined,
              cond: null,
              isGetter: tag.endsWith('-getter'),
              isSetter: tag.endsWith('-setter')
            };
            parameters.push(currentParam);
          }
          continue;
        }

        // 修饰标签（作用于当前参数）
        if (currentParam) {
          if (tag === 'alias') {
            currentParam.alias = rest;
          } else if (tag === 'desc') {
            currentParam.desc = rest;
          } else if (tag === 'default') {
            currentParam.defaultVal = rest;
          } else if (tag === 'cond') {
            currentParam.cond = rest;
          } else if (tag === 'filter') {
            currentParam.filter = rest;
          } else if (tag === 'clamp') {
            currentParam.clamp = rest;
          } else if (tag === 'decimals') {
            currentParam.decimals = rest;
          }
        } else {
          if (tag === 'param' || tag === 'name') {
            warnings.push(`检测到过时的 JSDoc 标签 @${tag}，Yami 引擎不支持该标签，应使用具体类型标签声明`);
          }
        }
      }
    }

    return {
      hasMeta: true,
      rawMeta,
      parameters,
      overview,
      langMap,
      warnings
    };
  }

  /**
   * 推导参数对应的 TypeScript 类型字符串
   * @param {object} param 参数定义对象
   * @returns {string} TS 类型字符串
   */
  function inferTsType(param) {
    if (param.tag === 'option') {
      if (param.options && param.options.length > 0) {
        return param.options.map(o => `'${o}'`).join(' | ');
      }
      return 'string';
    }

    if (param.tag === 'variable-setter') {
      return 'VariableSetter';
    }

    if (TAG_TYPE_MAP[param.tag]) {
      return TAG_TYPE_MAP[param.tag];
    }

    return 'any';
  }

  /**
   * 自动推导脚本应该实现的 Script<T> 泛型接口
   * @param {string} code 源代码
   * @param {object} meta 元数据解析结果
   * @returns {string} 泛型参数名称，例如 'Command', 'Plugin', 'Trigger'
   */
  function inferScriptType(code, meta) {
    // 检查方法与上下文特征
    if (/call\s*\([^)]*\)\s*\{/.test(code)) {
      return 'Command';
    }
    if (/onHitActor\s*\(/.test(code) || /onStart\s*\(\s*trigger\s*:\s*Trigger\s*\)/.test(code) || /instanceof\s+Trigger\b/.test(code) || /trigger\.(x|y|caster|destroy)/.test(code)) {
      return 'Trigger';
    }
    if (/instanceof\s+ImageElement\b/.test(code) || /this\.imageElement\b/.test(code)) {
      return 'ImageElement';
    }
    if (/instanceof\s+SceneLight\b/.test(code) || /constructor\s*\(\s*light\s*\)/.test(code)) {
      return 'SceneLight';
    }
    if (/onSkillCast\s*\(/.test(code) || /onSkillAdd\s*\(/.test(code)) {
      return 'Skill';
    }
    if (/onStateAdd\s*\(/.test(code)) {
      return 'State';
    }
    if (/onEquipmentAdd\s*\(/.test(code)) {
      return 'Equipment';
    }
    if (/onItemUse\s*\(/.test(code)) {
      return 'Item';
    }
    if (/onSelect\s*\(/.test(code) || /onDeselect\s*\(/.test(code)) {
      return 'ButtonElement';
    }
    if (/onInput\s*\(/.test(code)) {
      return 'TextBoxElement';
    }
    if (/onStart\s*\(/.test(code) || /onBeforeLoad\s*\(/.test(code) || /onBeforeSave\s*\(/.test(code) || /onStartup\s*\(/.test(code)) {
      return 'Plugin';
    }

    // 默认回退
    return 'Command';
  }

  /**
   * 将 JS 代码转换为符合 Yami TS 规范的 TypeScript 代码
   * @param {string} jsCode JS 源代码
   * @param {object} options 转换选项
   * @returns {object} { tsCode, meta, diagnostics, changes }
   */
  function convertJsToTs(jsCode, options = {}) {
    const diagnostics = [];
    const changes = [];

    // 1. 解析元数据
    const meta = parsePluginMeta(jsCode);
    if (meta.warnings && meta.warnings.length > 0) {
      diagnostics.push(...meta.warnings.map(w => ({ type: 'warning', message: w })));
    }

    // 2. 推导脚本泛型类型
    const scriptType = options.forceScriptType || inferScriptType(jsCode, meta);
    changes.push({
      type: 'script-type',
      description: `识别脚本泛型形态为 Script<${scriptType}>`
    });

    // 3. 构建接口属性代码块
    const metaParamKeys = new Set();
    let propertiesCode = '';
    if (meta.parameters && meta.parameters.length > 0) {
      const propLines = [];
      for (const p of meta.parameters) {
        metaParamKeys.add(p.key);
        const tsType = inferTsType(p);
        const isOptional = p.isSetter || p.isGetter || p.tag.startsWith('actor-') || p.tag.startsWith('skill-') || p.tag.startsWith('state-') || p.tag.startsWith('item-') || p.tag.startsWith('equipment-') || p.tag.startsWith('element-');
        const modifier = isOptional ? '?' : '!';
        propLines.push(`  ${p.key}${modifier}: ${tsType}`);
      }
      propertiesCode = `  // 接口属性\n${propLines.join('\n')}\n`;
      changes.push({
        type: 'properties',
        description: `注入 ${meta.parameters.length} 个接口属性声明`
      });
    }

    let codeWithoutMeta = jsCode;
    let metaHeader = '';

    if (meta.hasMeta) {
      const metaEndIdx = jsCode.indexOf(meta.rawMeta) + meta.rawMeta.length;
      metaHeader = jsCode.slice(0, metaEndIdx) + '\n';
      codeWithoutMeta = jsCode.slice(metaEndIdx);
    }

    // 4. 处理老旧 JS 中的行尾伪类型注释 (如 `caster //:object` 或 `numbers //:array`)
    const pseudoTypeMap = {
      number: 'number',
      boolean: 'boolean',
      string: 'string',
      array: 'any[]',
      object: 'any',
      function: 'Function'
    };

    let body = codeWithoutMeta.replace(/^([ \t]*)([a-zA-Z0-9_$]+)[ \t]*\/\/:([a-zA-Z0-9_$]+)[ \t]*;?$/gm, (match, indent, name, type) => {
      if (metaParamKeys.has(name)) {
        // 如果已经是接口参数，避免重复声明，直接移除
        return '';
      }
      const tsT = pseudoTypeMap[type] || 'any';
      return `${indent}${name}?: ${tsT}`;
    });

    // 5. 转换类声明
    const classRegex = /export\s+default\s+class\s+([a-zA-Z0-9_$]+)(\s+extends\s+[a-zA-Z0-9_$.]+)?\s*\{/;
    const classMatch = body.match(classRegex);

    if (classMatch) {
      const className = classMatch[1];
      const newClassHeader = `export default class ${className} implements Script<${scriptType}> {`;
      body = body.replace(classRegex, `${newClassHeader}\n${propertiesCode}`);
      changes.push({
        type: 'class-header',
        description: `类声明增加 implements Script<${scriptType}>`
      });
    } else {
      // 匹配普通 class ClassName {
      const simpleClassRegex = /class\s+([a-zA-Z0-9_$]+)\s*\{/;
      const simpleMatch = body.match(simpleClassRegex);
      if (simpleMatch) {
        const className = simpleMatch[1];
        const newClassHeader = `export default class ${className} implements Script<${scriptType}> {`;
        body = body.replace(simpleClassRegex, `${newClassHeader}\n${propertiesCode}`);
        changes.push({
          type: 'class-header',
          description: `类声明升级为 export default class ${className} implements Script<${scriptType}>`
        });
      }
    }

    // 6. 替换老旧运行时 API
    const apiReplacements = [
      { pattern: /\bEvent\.attributes\b/g, to: 'CurrentEvent.attributes', desc: 'Event.attributes -> CurrentEvent.attributes' },
      { pattern: /\bEvent\.triggerActor\b/g, to: 'CurrentEvent.triggerActor', desc: 'Event.triggerActor -> CurrentEvent.triggerActor' },
      { pattern: /\bEvent\.casterActor\b/g, to: 'CurrentEvent.casterActor', desc: 'Event.casterActor -> CurrentEvent.casterActor' },
      { pattern: /\bEvent\.targetActor\b/g, to: 'CurrentEvent.targetActor', desc: 'Event.targetActor -> CurrentEvent.targetActor' },
      { pattern: /\bEvent\.pause\(\)/g, to: 'CurrentEvent.pause()', desc: 'Event.pause() -> CurrentEvent.pause()' },
      { pattern: /\bEvent\.continue\(\)/g, to: 'CurrentEvent.continue()', desc: 'Event.continue() -> CurrentEvent.continue()' },
    ];

    for (const r of apiReplacements) {
      if (body.match(r.pattern)) {
        body = body.replace(r.pattern, r.to);
        changes.push({
          type: 'api-upgrade',
          description: `API 现代化: ${r.desc}`
        });
      }
    }

    // 6. 检查并纠正 getter 属性的括号调用（如 this.actor() -> this.actor）
    if (meta.parameters) {
      for (const p of meta.parameters) {
        if (p.isGetter) {
          const getterCallRegex = new RegExp(`\\bthis\\.${p.key}\\(\\)`, 'g');
          if (body.match(getterCallRegex)) {
            body = body.replace(getterCallRegex, `this.${p.key}`);
            changes.push({
              type: 'getter-fix',
              description: `消除 getter 参数函数调用: this.${p.key}() -> this.${p.key}`
            });
            diagnostics.push({
              type: 'info',
              message: `检测到 getter 参数 ${p.key} 被作为函数调用，现代引擎已预求值注入属性，已自动修正为属性读取`
            });
          }
        }
      }
    }

    // 7. 规范方法签名与返回值
    if (scriptType === 'Command') {
      // 规范 call() 签名
      const callRegex = /\bcall\s*\(([^)]*)\)\s*\{/;
      const callMatch = body.match(callRegex);
      if (callMatch) {
        const params = callMatch[1].trim();
        const typedParams = params ? (params.includes(':') ? params : `${params}: any`) : '';
        body = body.replace(callRegex, `call(${typedParams}): void | boolean {`);
        changes.push({
          type: 'signature',
          description: '补充 call() 方法返回值类型 void | boolean'
        });
      }
    }

    // 8. 针对 actorList.sort / Array.sort 等常见排序列补充安全的参数类型
    body = body.replace(/\.sort\(\s*\(\s*([a-zA-Z0-9_$]+)\s*,\s*([a-zA-Z0-9_$]+)\s*\)\s*=>/g, '.sort(($1: any, $2: any) =>');

    // 9. 拼装最终 TS 代码
    const tsCode = (metaHeader + body).trim() + '\n';

    return {
      tsCode,
      meta,
      scriptType,
      diagnostics,
      changes
    };
  }

  // 导出
  const ScriptConverter = {
    parsePluginMeta,
    inferTsType,
    inferScriptType,
    convertJsToTs,
    TAG_TYPE_MAP
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = ScriptConverter;
  } else {
    global.ScriptConverter = ScriptConverter;
  }
})(typeof window !== 'undefined' ? window : globalThis);
