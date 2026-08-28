/**
 * 脚本转换器自动化回归与自检脚本 (self-check.js)
 * 运行方式: node tools/script-converter/self-check.js
 */

const fs = require('fs');
const path = require('path');
const ScriptConverter = require('./converter-core.js');

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ 测试断言失败: ${message}`);
    process.exit(1);
  }
}

console.log('🚀 开始执行 脚本转换器 (JS -> TS) 回归自检...');

// 1. 测试用例 1: 真实老 JS 文件 (根据角色相对坐标的距离排序.2061c85d76d05240.js)
const sampleJsPath = 'D:\\new-game\\DANJUAN TOOLS\\JS\\根据角色相对坐标的距离排序.2061c85d76d05240.js';
let sampleJsContent = '';
if (fs.existsSync(sampleJsPath)) {
  sampleJsContent = fs.readFileSync(sampleJsPath, 'utf8');
} else {
  // 如果路径不存在，使用内嵌的完整相同内容
  sampleJsContent = `/*
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
}

const res1 = ScriptConverter.convertJsToTs(sampleJsContent);
console.log('--- 测试 1 转换结果预览 ---');
console.log(res1.tsCode);

assert(res1.scriptType === 'Command', '应正确推断为 Command 指令类型');
assert(res1.tsCode.includes('implements Script<Command>'), '类应实现 implements Script<Command>');
assert(res1.tsCode.includes("targetVariable!: 'local' | 'global'"), '应生成联合类型 targetVariable!: \'local\' | \'global\'');
assert(res1.tsCode.includes('localVariable!: string'), '应生成 localVariable!: string');
assert(res1.tsCode.includes('globalVariable!: string'), '应生成 globalVariable!: string');
assert(res1.tsCode.includes('RangeX!: number'), '应生成 RangeX!: number');
assert(res1.tsCode.includes('RangeY!: number'), '应生成 RangeY!: number');
assert(res1.tsCode.includes('sort!: boolean'), '应生成 sort!: boolean');
assert(res1.tsCode.includes('CurrentEvent.attributes'), '老旧 API Event.attributes 应升级为 CurrentEvent.attributes');
assert(!/\bEvent\.attributes\b/.test(res1.tsCode), '不应再包含独立 Event.attributes');
assert(res1.tsCode.includes('call(): void | boolean'), 'call() 签名应补充返回值类型');
console.log('✅ 测试 1 通过: 真实老指令 JS 成功转为标准 TS 指令');

// 2. 测试用例 2: 全局插件脚本 (包含 getter、setter 和生命周期钩子)
const pluginJs = `/*
@plugin #plugin
@version 1.0
@author test
@desc #desc

@actor-getter actor
@alias #actor

@variable-setter result
@alias #result

@lang zh
#plugin 测试插件
#desc 描述
#actor 角色
#result 结果
*/

export default class TestPlugin {
  onStart() {
    const target = this.actor()
    const second = this.actor()
    this.result.set(true)
  }
}
`;

const res2 = ScriptConverter.convertJsToTs(pluginJs);
assert(res2.scriptType === 'Plugin', '应正确推断为 Plugin 插件类型');
assert(res2.tsCode.includes('implements Script<Plugin>'), '类应实现 implements Script<Plugin>');
assert(res2.tsCode.includes('actor?: Actor'), '应包含 actor?: Actor');
assert(res2.tsCode.includes('result?: VariableSetter'), '应包含 result?: VariableSetter');
assert(res2.tsCode.includes('const target = this.actor'), 'getter 括号调用 this.actor() 应被修正为 this.actor');
assert(res2.tsCode.includes('const second = this.actor'), '第二次 getter 括号调用也应被修正为 this.actor');
assert(!res2.tsCode.includes('this.actor()'), '不应再有任何 this.actor() 函数调用');
console.log('✅ 测试 2 通过: 全局插件与 Getter/Setter 自动校准与类型推导');

// 3. 测试用例 3: 触发器脚本
const triggerJs = `/*
@plugin #plugin
@number speed
@alias #speed
*/
export default class TriggerMove {
  onHitActor(event) {
    console.log(event)
  }
}
`;
const res3 = ScriptConverter.convertJsToTs(triggerJs);
assert(res3.scriptType === 'Trigger', '应推断为 Trigger 类型');
assert(res3.tsCode.includes('implements Script<Trigger>'), '类应实现 implements Script<Trigger>');
assert(res3.tsCode.includes('speed!: number'), '应声明 speed!: number');
console.log('✅ 测试 3 通过: 触发器与组件脚本泛型');

console.log('\n🎉 所有自检用例全部通过！');
