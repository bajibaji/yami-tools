'use strict'
/**
 * 引擎 RLE 编解码的等价实现（照 §9.2 与 codec.ts 逐行移植）
 *
 * 为什么要有这个模块：`.scene` 的 `terrains` 与 tilemap 的 `code` 是引擎 Codec 算出来的压缩串
 * （编辑器 `Project/Script/codec/codec.ts`：encodeTiles :110 / encodeTerrains :215，
 *  解码 decodeTiles :158 / decodeTerrains :262，变长整数 encodeClone :362 / decodeClone :374）。
 * 以前 MCP 只做一件事：**拦"被写短"**（写短了地图直接读不出来），但没法真正编解码 ——
 * 于是 AI 想改一块地形只能整段替换，风险极高。现在能真解码、真编码、真校验。
 *
 * 移植时的三个关键点（都不是猜的）：
 *   ① 字节都是 ASCII 安全字符：数值 + 35 后写入；clone 编码每 5 位一组，最高位为"还有后续"标志。
 *   ② 地形的两字节形式**不需要专门的解码分支**：编码器写 125(=`76+49`) 再写 `count-49+76`，
 *      解码器按"空白段各加一次"自然拼回 count（重复段同理：75 表示 25 个，再跟一段）。
 *   ③ 解码器必须校验"字节用尽且元素填满"，引擎对不上会抛 RangeError —— 我们照抄这个判据，
 *      坏文件在体检阶段就能被抓出来，而不是等引擎加载时炸。
 */

/** 把数值序列编成变长整数（引擎 encodeClone） */
function encodeClone(array, index, count) {
  const bits = Math.ceil(Math.log2(count + 1))
  const bytes = Math.ceil(bits / 5)
  for (let i = 0; i < bytes; i++) {
    const n = bytes - i - 1
    const head = n !== 0 ? 1 : 0
    const code = (head << 5) | ((count >> (n * 5)) & 0b011111)
    array[index++] = code + 35
  }
  return index
}

/** 读变长整数（引擎 decodeClone），返回 { index, count } */
function decodeClone(array, index) {
  let count = 0
  let code
  do {
    code = array[index++] - 35
    count = (count << 5) | (code & 0b011111)
  } while (code & 0b100000)
  return { index, count }
}

function writeBytes(bytes) {
  return Buffer.from(bytes).toString('utf8')
}
function readBytes(code) {
  return Array.from(Buffer.from(String(code), 'utf8'))
}

/** 图块数组 → RLE 串（引擎 encodeTiles） */
function encodeTiles(tiles) {
  const bytes = []
  let bi = 0
  let ti = 0
  const length = tiles.length
  while (ti < length) {
    if (tiles[ti] === 0) {
      let blank = 1
      ti += 1
      while (tiles[ti] === 0) { blank++; ti++ }
      if (blank <= 16) bytes[bi++] = blank + 109
      else { bytes[bi++] = 126; bi = encodeClone(bytes, bi, blank) }
    } else if (tiles[ti] === tiles[ti - 1]) {
      let clone = 1
      ti += 1
      while (tiles[ti] === tiles[ti - 1]) { clone++; ti++ }
      if (clone <= 10) bytes[bi++] = clone + 98
      else { bytes[bi++] = 109; bi = encodeClone(bytes, bi, clone) }
    } else {
      const tile = tiles[ti]
      bytes[bi] = (tile >> 26) + 35
      bytes[bi + 1] = ((tile >> 20) & 0b111111) + 35
      bytes[bi + 2] = ((tile >> 14) & 0b111111) + 35
      bytes[bi + 3] = ((tile >> 8) & 0b111111) + 35
      bytes[bi + 4] = (tile & 0b111111) + 35
      bi += 5
      ti += 1
    }
  }
  return writeBytes(bytes.slice(0, bi))
}

/** RLE 串 → 图块数组（引擎 decodeTiles）；对不上就抛 RangeError */
function decodeTiles(code, width, height) {
  const bytes = readBytes(code)
  const bytesLength = bytes.length
  const tiles = new Array(width * height).fill(0)
  const tilesLength = tiles.length
  let bi = 0
  let ti = 0
  while (bi < bytesLength) {
    const cur = bytes[bi]
    if (cur <= 98) {
      tiles[ti] = ((bytes[bi] - 35) << 26) + ((bytes[bi + 1] - 35) << 20) + ((bytes[bi + 2] - 35) << 14) + ((bytes[bi + 3] - 35) << 8) + (bytes[bi + 4] - 35)
      ti += 1
      bi += 5
    } else if (cur <= 109) {
      if (cur !== 109) {
        const copy = tiles[ti - 1]
        const end = ti + cur - 98
        while (ti < end) tiles[ti++] = copy
        bi += 1
      } else {
        const got = decodeClone(bytes, ++bi)
        const copy = tiles[ti - 1]
        const end = ti + got.count
        while (ti < end) tiles[ti++] = copy
        bi = got.index
      }
    } else if (cur !== 126) {
      ti += cur - 109
      bi += 1
    } else {
      const got = decodeClone(bytes, ++bi)
      ti += got.count
      bi = got.index
    }
  }
  if (bi !== bytesLength || ti !== tilesLength) {
    throw new RangeError('瓦片压缩串解不开：字节 ' + bi + '/' + bytesLength + '，元素 ' + ti + '/' + tilesLength)
  }
  return tiles
}

/** 地形数组 → RLE 串（引擎 encodeTerrains） */
function encodeTerrains(terrains) {
  const bytes = []
  let bi = 0
  let ti = 0
  const length = terrains.length
  while (ti < length) {
    if (terrains[ti] === 0) {
      let blank = 1
      ti += 1
      while (terrains[ti] === 0) { blank++; ti++ }
      if (blank <= 49) bytes[bi++] = blank + 76
      else if (blank <= 98) { bytes[bi++] = 125; bytes[bi++] = blank - 49 + 76 }
      else { bytes[bi++] = 126; bi = encodeClone(bytes, bi, blank) }
    } else if (terrains[ti] === terrains[ti - 1] && terrains[ti] === terrains[ti + 1]) {
      let clone = 2
      ti += 2
      while (terrains[ti] === terrains[ti - 1]) { clone++; ti++ }
      if (clone <= 25) bytes[bi++] = clone + 50
      else if (clone <= 50) { bytes[bi++] = 75; bytes[bi++] = clone - 25 + 50 }
      else { bytes[bi++] = 76; bi = encodeClone(bytes, bi, clone) }
    } else {
      bytes[bi++] = terrains[ti++] + 35
    }
  }
  return writeBytes(bytes.slice(0, bi))
}

/** RLE 串 → 地形数组（引擎 decodeTerrains）；对不上就抛 RangeError */
function decodeTerrains(code, width, height) {
  const bytes = readBytes(code)
  const bytesLength = bytes.length
  const terrains = new Array(width * height).fill(0)
  const terrainsLength = terrains.length
  let bi = 0
  let ti = 0
  while (bi < bytesLength) {
    const cur = bytes[bi]
    if (cur <= 50) {
      terrains[ti] = cur - 35
      ti += 1
      bi += 1
    } else if (cur <= 76) {
      if (cur !== 76) {
        const copy = terrains[ti - 1]
        const end = ti + cur - 50
        while (ti < end) terrains[ti++] = copy
        bi += 1
      } else {
        const got = decodeClone(bytes, ++bi)
        const copy = terrains[ti - 1]
        const end = ti + got.count
        while (ti < end) terrains[ti++] = copy
        bi = got.index
      }
    } else if (cur !== 126) {
      ti += cur - 76
      bi += 1
    } else {
      const got = decodeClone(bytes, ++bi)
      ti += got.count
      bi = got.index
    }
  }
  if (bi !== bytesLength || ti !== terrainsLength) {
    throw new RangeError('地形压缩串解不开：字节 ' + bi + '/' + bytesLength + '，元素 ' + ti + '/' + terrainsLength)
  }
  return terrains
}

/** 体检用：解码 + 原样重编码必须一致（写成非规范串、或长度对不上，都会在这里露出来） */
function verifyTiles(code, width, height) {
  const tiles = decodeTiles(code, width, height)
  const again = decodeTiles(encodeTiles(tiles), width, height)
  for (let i = 0; i < tiles.length; i++) {
    if (tiles[i] !== again[i]) return { ok: false, error: '重编码后第 ' + i + ' 个图块对不上' }
  }
  return { ok: true, tiles }
}

function verifyTerrains(code, width, height) {
  const terrains = decodeTerrains(code, width, height)
  const again = decodeTerrains(encodeTerrains(terrains), width, height)
  for (let i = 0; i < terrains.length; i++) {
    if (terrains[i] !== again[i]) return { ok: false, error: '重编码后第 ' + i + ' 个地形对不上' }
  }
  return { ok: true, terrains }
}

module.exports = { encodeTiles, decodeTiles, encodeTerrains, decodeTerrains, verifyTiles, verifyTerrains, encodeClone, decodeClone }
