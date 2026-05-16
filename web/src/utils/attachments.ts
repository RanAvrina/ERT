function dataUrlToBlob(dataUrl: string) {
  const matches = dataUrl.match(/^data:([^;,]+)?(?:;charset=[^;,]+)?(;base64)?,(.*)$/s)
  if (!matches) {
    throw new Error('Invalid data URL.')
  }

  const mimeType = matches[1] || 'application/octet-stream'
  const isBase64 = Boolean(matches[2])
  const payload = matches[3] || ''

  if (isBase64) {
    const binary = atob(payload)
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index)
    }
    return new Blob([bytes], { type: mimeType })
  }

  return new Blob([decodeURIComponent(payload)], { type: mimeType })
}

function triggerDownload(url: string, filename: string) {
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.target = '_blank'
  anchor.rel = 'noreferrer'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
}

export function openAttachment(url: string, filename: string) {
  if (!url) {
    throw new Error('Attachment URL is missing.')
  }

  if (url.startsWith('data:')) {
    const blob = dataUrlToBlob(url)
    const objectUrl = URL.createObjectURL(blob)
    const popup = window.open(objectUrl, '_blank', 'noopener,noreferrer')

    if (!popup) {
      triggerDownload(objectUrl, filename)
    }

    window.setTimeout(() => {
      URL.revokeObjectURL(objectUrl)
    }, 60_000)
    return
  }

  const popup = window.open(url, '_blank', 'noopener,noreferrer')
  if (!popup) {
    triggerDownload(url, filename)
  }
}
