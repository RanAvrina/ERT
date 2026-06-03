import { randomUUID } from 'node:crypto'
import { env } from '../config/env.js'
import { supabaseAdmin } from '../lib/supabase.js'

const ATTACHMENTS_BUCKET = 'ert-attachments'

type UploadableAttachment = {
  id?: string
  name: string
  type: string
  size: number
  url: string
}

let bucketReadyPromise: Promise<void> | null = null
const bucketPublicPrefix = `${env.SUPABASE_URL}/storage/v1/object/public/${ATTACHMENTS_BUCKET}/`

function sanitizePathSegment(value: string) {
  const normalized = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 120)

  if (normalized) {
    return normalized
  }

  return value
    .trim()
    .replace(/\.[^.]+$/, '')
    .replace(/\s+/g, '-')
    .replace(/[^A-Za-z0-9._-]+/g, '')
    .slice(0, 40) || 'file'
}

function parseDataUrl(dataUrl: string) {
  const matches = dataUrl.match(/^data:([^;,]+)?(?:;charset=[^;,]+)?(;base64)?,(.*)$/s)
  if (!matches) {
    throw new Error('Invalid attachment payload.')
  }

  const mimeType = matches[1] || 'application/octet-stream'
  const isBase64 = Boolean(matches[2])
  const payload = matches[3] || ''
  const buffer = isBase64
    ? Buffer.from(payload, 'base64')
    : Buffer.from(decodeURIComponent(payload), 'utf8')

  return { mimeType, buffer }
}

async function ensureAttachmentsBucket() {
  if (bucketReadyPromise) return bucketReadyPromise

  bucketReadyPromise = (async () => {
    const { data, error } = await supabaseAdmin.storage.getBucket(ATTACHMENTS_BUCKET)
    if (!error && data) return

    const { error: createError } = await supabaseAdmin.storage.createBucket(ATTACHMENTS_BUCKET, {
      public: true,
    })

    if (createError && createError.message.toLowerCase() !== 'the resource already exists') {
      throw new Error(`Failed to create attachments bucket: ${createError.message}`)
    }
  })().catch((error) => {
    bucketReadyPromise = null
    throw error
  })

  return bucketReadyPromise
}

async function uploadAttachment(
  apartmentId: number,
  scope: string,
  attachment: UploadableAttachment,
) {
  const { mimeType, buffer } = parseDataUrl(attachment.url)
  await ensureAttachmentsBucket()

  const path = [
    `apartment-${apartmentId}`,
    sanitizePathSegment(scope),
    `${randomUUID()}-${sanitizePathSegment(attachment.name)}`,
  ].join('/')

  const { error } = await supabaseAdmin.storage.from(ATTACHMENTS_BUCKET).upload(path, buffer, {
    contentType: attachment.type || mimeType,
    upsert: false,
  })

  if (error) {
    throw new Error(`Failed to upload attachment: ${error.message}`)
  }

  const {
    data: { publicUrl },
  } = supabaseAdmin.storage.from(ATTACHMENTS_BUCKET).getPublicUrl(path)

  return {
    ...attachment,
    id: attachment.id ?? randomUUID(),
    type: attachment.type || mimeType,
    size: attachment.size || buffer.byteLength,
    url: publicUrl,
  }
}

export async function normalizeAttachmentsForStorage(
  apartmentId: number,
  scope: string,
  attachments: UploadableAttachment[] | undefined,
) {
  if (!attachments?.length) return attachments ?? []

  return Promise.all(
    attachments.map((attachment) => {
      if (!attachment.url.startsWith('data:')) {
        return Promise.resolve({
          ...attachment,
          id: attachment.id ?? randomUUID(),
        })
      }

      return uploadAttachment(apartmentId, scope, attachment)
    }),
  )
}

function getStoragePathFromUrl(url: string) {
  if (!url.startsWith(bucketPublicPrefix)) {
    return null
  }

  const rawPath = url.slice(bucketPublicPrefix.length)
  if (!rawPath) return null

  try {
    return decodeURIComponent(rawPath)
  } catch {
    return rawPath
  }
}

export async function deleteStoredAttachments(urls: string[]) {
  const paths = [...new Set(urls.map(getStoragePathFromUrl).filter((path): path is string => Boolean(path)))]
  if (!paths.length) return

  await ensureAttachmentsBucket()
  const { error } = await supabaseAdmin.storage.from(ATTACHMENTS_BUCKET).remove(paths)
  if (error) {
    throw new Error(`Failed to delete attachment files: ${error.message}`)
  }
}
