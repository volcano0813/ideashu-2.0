/**
 * Resize + JPEG compress in-browser for localStorage-safe data URLs (~≤1MB target).
 */
export async function fileToCompressedDataUrl(
  file: File,
  maxEdge = 1600,
  quality = 0.82,
): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new Error('请选择图片文件')
  }

  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(url)
      let w = img.naturalWidth
      let h = img.naturalHeight
      if (w <= 0 || h <= 0) {
        reject(new Error('无法读取图片尺寸'))
        return
      }
      if (w > maxEdge || h > maxEdge) {
        if (w > h) {
          h = Math.round((h * maxEdge) / w)
          w = maxEdge
        } else {
          w = Math.round((w * maxEdge) / h)
          h = maxEdge
        }
      }
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        reject(new Error('画布不可用'))
        return
      }
      ctx.drawImage(img, 0, 0, w, h)
      let q = quality
      let dataUrl = canvas.toDataURL('image/jpeg', q)
      const maxChars = 1_100_000
      while (dataUrl.length > maxChars && q > 0.42) {
        q -= 0.06
        dataUrl = canvas.toDataURL('image/jpeg', q)
      }
      resolve(dataUrl)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('图片加载失败'))
    }
    img.src = url
  })
}

/**
 * 写入 localStorage 前将封面地址转为可持久化形式：
 * - `blob:` 仅当前页会话有效，刷新后失效 → 转为压缩后的 data URL
 * - `data:` / `http(s):` 原样返回
 */
export async function persistableImageUrl(url: string | undefined): Promise<string | undefined> {
  if (!url) return undefined
  if (url.startsWith('data:')) return url
  if (url.startsWith('http://') || url.startsWith('https://')) return url
  if (url.startsWith('blob:')) {
    try {
      const res = await fetch(url)
      const blob = await res.blob()
      const type = blob.type && blob.type.startsWith('image/') ? blob.type : 'image/jpeg'
      const file = new File([blob], 'cover.jpg', { type })
      return await fileToCompressedDataUrl(file)
    } catch {
      return undefined
    }
  }
  return url
}
