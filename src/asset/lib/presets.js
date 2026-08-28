// 5 个卖家包的识别预设 + 通用回退；可被用户在规则编辑器里覆盖
export const BUILTIN_PRESETS = [
  {
    id: 'untied',
    label: 'unTied Games',
    match: 'untied|super pixel',
    fps: 15,
    gifFirst: false,
    sheetMeta: 'txt',     // spritesheet.txt 按 'path = x y w h'
    sheetByDir: true,     // 目录名含 spritesheet/sheet 的 PNG 视为整图
    numericPool: false,
    previewGifPattern: 'preview|预览|sample|cover|thumb'
  },
  {
    id: 'pozac',
    label: 'POZAC',
    match: 'pozac|beat',
    fps: 15,
    gifFirst: false,
    sheetMeta: 'none',
    sheetByDir: false,
    numericPool: false,
    previewGifPattern: 'preview|预览|sample|cover|thumb'
  },
  {
    id: 'paimon',
    label: 'Paimon',
    match: 'paimon|acid|vfx|battle vfx|water|fire effect|ice effect|thunder|smoke|wind effect|holy vfx|dark vfx|earth effect|buff|separated',
    fps: 15,
    gifFirst: false,
    sheetMeta: 'auto',
    sheetByDir: true,
    vfxPack: true,        // 特效包标记：每个带有 VFX/编号的 PNG 均为独立精灵表
    numericPool: false,
    previewGifPattern: 'preview|预览|sample|cover|thumb'
  },
  {
    id: 'soggy',
    label: 'SoggySocks',
    match: 'soggy',
    fps: 15,
    gifFirst: false,      // PNG sheet 作为主素材，同名 gif 绑定为动图预览
    sheetMeta: 'auto',
    sheetByDir: false,
    numericPool: false,
    previewGifPattern: 'preview|预览|sample|cover|thumb'
  },
  {
    id: 'bdragon',
    label: 'BDragon1727',
    match: 'bdragon|1727|750',
    fps: 15,
    gifFirst: false,
    sheetMeta: 'none',
    sheetByDir: false,
    numericPool: false,
    stripSheet: true,     // 每个 PNG = 64px 网格动画合集：行=颜色变体，列=帧序列
    previewGifPattern: 'preview|预览|sample|cover|thumb'
  },
  {
    id: 'generic',
    label: '通用（新包）',
    match: '',
    fps: 15,
    gifFirst: false,
    sheetMeta: 'auto',
    sheetByDir: true,
    numericPool: false,
    previewGifPattern: 'preview|预览|sample|cover|thumb'
  }
]

export function findBuiltin (pack) {
  if (!pack) return null
  for (const p of BUILTIN_PRESETS) {
    if (p.match && new RegExp(p.match, 'i').test(pack)) {
      return p
    }
  }
  return null
}

export function presetFor (pack, profiles) {
  const custom = profiles?.[pack]
  if (custom) return { ...BUILTIN_PRESETS.find(p => p.id === 'generic'), ...custom, id: custom.id || 'custom' }
  return findBuiltin(pack) || BUILTIN_PRESETS.find(p => p.id === 'generic')
}

export function packNameOf (rel) {
  const i = rel.indexOf('/')
  return i === -1 ? '(根目录)' : rel.slice(0, i)
}