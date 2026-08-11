/*
@plugin 地图JSON读取
@version 1.1
@author yahzj
@link
@desc
读取“地图格.json”（root 二维数组 10×10，格式见 小工具合集与地图编辑器方案.txt 第四章），
完整校验通过后一次性写入目标全局变量；校验失败不写入任何数据（避免地图半更新）。

路径操作符（与 Excel操作 指令一致）：
$ ：指向当前 Assets 文件夹
% ：指向当前工程项目文件夹
也可以使用 GUID

兼容环境：
- 编辑器/Electron：fs.readFileSync
- 发布浏览器环境：fetch(工程相对路径)

@string filePath
@alias 文件路径
@desc 地图格 JSON 文件路径（建议：$UI/地图/地图格数据.<GUID>.json）

@file globalVariable
@filter global
@alias 目标全局变量
@desc 地图格数据将写入该全局变量（值：10×10 二维数组）

@variable-setter resultVariable
@alias 结果变量
@desc 写入结果：true 成功 / false 失败（可留空）

@lang zh
#plugin 地图JSON读取
#desc 读取地图格 JSON 并写入全局变量（校验通过才写入）
#filePath 文件路径
#globalVariable 目标全局变量
#resultVariable 结果变量
*/

// @ts-ignore
const fs = (() => {
	try {
		return require("fs");
	} catch {
		return null;
	}
})();

export default class MapJsonReader implements Script<Command> {
	// 接口属性
	filePath!: string;
	globalVariable!: string;
	resultVariable?: VariableSetter;

	transformPath(text: string) {
		const normalize = (value: string) => value.replace(/\\/g, "/");
		let relativePath = text;
		if (text.startsWith("$")) {
			relativePath = "Assets/" + text.slice(1).replace(/^\/+/, "");
		} else if (text.startsWith("%")) {
			relativePath = text.slice(1).replace(/^\/+/, "");
		} else if (/^[a-f0-9]{16}$/i.test(text)) {
			const guidPath = Loader.getPathByGUID(text);
			if (guidPath) relativePath = guidPath;
		}
		relativePath = normalize(relativePath);
		return fs ? normalize(Loader.route(relativePath)) : relativePath;
	}

	async readJson(filePath: string): Promise<any> {
		const p = this.transformPath(filePath);
		if (fs) {
			return JSON.parse(fs.readFileSync(p, "utf8"));
		}
		const resp = await fetch(p);
		if (!resp.ok) {
			throw new Error(`HTTP ${resp.status}`);
		}
		return await resp.json();
	}

	validate(data: any): string[] {
		const errors: string[] = [];
		if (!Array.isArray(data)) return ["根节点必须是数组"];
		if (data.length !== 10) return [`行数必须为 10，实际 ${data.length}`];
		for (let r = 0; r < 10; r++) {
			const row = data[r];
			if (!Array.isArray(row) || row.length !== 10) {
				errors.push(`第 ${r + 1} 行列数必须为 10`);
				continue;
			}
			for (let c = 0; c < 10; c++) {
				const cell = row[c];
				const at = `(${r + 1},${c + 1})`;
				if (!cell || typeof cell !== "object" || Array.isArray(cell)) {
					errors.push(`${at} 单元格必须是对象`);
					continue;
				}
				if (typeof cell.name !== "string") errors.push(`${at} name 必须是字符串`);
				if (!Number.isInteger(cell.icon)) errors.push(`${at} icon 必须是整数`);
				const p = cell.Passability;
				if (!p || typeof p.down !== "boolean" || typeof p.right !== "boolean") {
					errors.push(`${at} Passability 必须包含布尔 down/right`);
				}
				if (cell.levelRange !== undefined && cell.levelRange !== null) {
					const lr = cell.levelRange;
					if (!Number.isInteger(lr.min) || lr.min < 1 || !Number.isInteger(lr.max) || lr.max < lr.min) {
						errors.push(`${at} levelRange 必须是正整数且 min<=max`);
					}
				}
				if (!Array.isArray(cell.monsters)) {
					errors.push(`${at} monsters 必须是数组`);
					continue;
				}
				const seen = new Set();
				for (const m of cell.monsters) {
					if (!m || typeof m !== "object" || Array.isArray(m)) {
						errors.push(`${at} monsters 元素必须是对象`);
						continue;
					}
					if (!/^[a-f0-9]{16}$/i.test(m.id)) errors.push(`${at} 怪物 id 必须是 16 位十六进制：${m.id}`);
					if (!Number.isInteger(m.lvMin) || m.lvMin < 1) errors.push(`${at} 怪物 ${m.id} lvMin 必须为 >=1 整数`);
					if (!Number.isInteger(m.lvMax) || m.lvMax < m.lvMin) errors.push(`${at} 怪物 ${m.id} lvMax 必须 >= lvMin`);
					if (typeof m.weight !== "number" || !(m.weight > 0)) errors.push(`${at} 怪物 ${m.id} weight 必须 > 0`);
					const normalizedId = typeof m.id === "string" ? m.id.toLowerCase() : m.id;
					if (seen.has(normalizedId)) errors.push(`${at} 怪物 id 重复：${m.id}`);
					seen.add(normalizedId);
				}
			}
		}
		return errors;
	}

	call() {
		const host = CurrentEvent;
		const filePath = this.filePath;
		const globalVariable = this.globalVariable;
		const resultVariable = this.resultVariable;
		host.pause();
		const load = async () => {
			try {
				const data = await this.readJson(filePath);
				const errors = this.validate(data);
				if (errors.length === 0) {
					Variable.set(globalVariable, data);
					console.log("地图JSON读取：写入成功", globalVariable);
					resultVariable?.set(true);
				} else {
					console.warn("地图JSON读取：数据校验失败，未写入变量", errors.slice(0, 5));
					resultVariable?.set(false);
				}
			} catch (error) {
				console.warn("地图JSON读取失败", error);
				resultVariable?.set(false);
			} finally {
				host.continue();
			}
		};
		load();
		return false;
	}
}
