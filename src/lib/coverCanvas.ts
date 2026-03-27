/** 3:4 封面合成，输出 JPEG Blob（与产品规格一致：1080×1440） */
export function generateCoverPreview(imageFile: File, overlayText: string): Promise<Blob | null> {
  return new Promise((resolve) => {
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      resolve(null)
      return
    }
    const objectUrl = URL.createObjectURL(imageFile)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(objectUrl)
      const targetRatio = 3 / 4
      const imgRatio = img.width / img.height
      let sx = 0
      let sy = 0
      let sw = img.width
      let sh = img.height
      if (imgRatio > targetRatio) {
        sw = img.height * targetRatio
        sx = (img.width - sw) / 2
      } else {
        sh = img.width / targetRatio
        sy = (img.height - sh) / 2
      }
      canvas.width = 1080
      canvas.height = 1440
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, 1080, 1440)

      const gradient = ctx.createLinearGradient(0, 1200, 0, 1440)
      gradient.addColorStop(0, 'rgba(0,0,0,0)')
      gradient.addColorStop(1, 'rgba(0,0,0,0.6)')
      ctx.fillStyle = gradient
      ctx.fillRect(0, 1200, 1080, 240)

      const text = overlayText.trim() || ' '
      const fontSize = text.length > 10 ? 48 : 64
      ctx.font = `bold ${fontSize}px "PingFang SC", "Microsoft YaHei", sans-serif`
      ctx.fillStyle = 'white'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      const maxW = 1000
      ctx.fillText(text, 540, 1380, maxW)

      canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.92)
    }
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      resolve(null)
    }
    img.src = objectUrl
  })
}

export function revokeCoverObjectUrl(url: string) {
  try {
    URL.revokeObjectURL(url)
  } catch {
    // ignore
  }
}
