// 缩略图解码缩放 Worker（透明背景居中适配）
self.onmessage = async (e) => {
  const { key, file, size } = e.data || {}
  try {
    const bmp = await createImageBitmap(file)
    const cv = new OffscreenCanvas(size, size)
    const ctx = cv.getContext('2d')
    const scale = Math.min(size / bmp.width, size / bmp.height)
    const w = Math.max(1, Math.round(bmp.width * scale))
    const h = Math.max(1, Math.round(bmp.height * scale))
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(bmp, (size - w) / 2, (size - h) / 2, w, h)
    bmp.close && bmp.close()
    const blob = await cv.convertToBlob({ type: 'image/webp', quality: 0.8 })
    self.postMessage({ key, blob, ok: true })
  } catch (err) {
    self.postMessage({ key, ok: false, error: String(err) })
  }
}
