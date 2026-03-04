export type ReviewExportRow = {
  question: string
  answer: string
  citation: string
}

function escapeCsvCell(value: string): string {
  const normalized = value.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  if (/[,"\n]/.test(normalized)) {
    return `"${normalized.replace(/"/g, '""')}"`
  }
  return normalized
}

export function buildReviewCsv(rows: ReviewExportRow[]): string {
  const header = ['Question', 'Answer', 'Citation']
  const lines = [header.map(escapeCsvCell).join(',')]

  rows.forEach((row) => {
    lines.push([
      escapeCsvCell(row.question),
      escapeCsvCell(row.answer),
      escapeCsvCell(row.citation),
    ].join(','))
  })

  return lines.join('\n')
}

function sanitizeFileName(input: string): string {
  const cleaned = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_\s]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')

  return cleaned || 'questionnaire-review'
}

export function exportReviewRowsToCsv(rows: ReviewExportRow[], fileBaseName: string): void {
  const csv = buildReviewCsv(rows)
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' })
  const fileName = `${sanitizeFileName(fileBaseName)}.csv`

  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

function extractFileNameFromDisposition(disposition: string | null): string | null {
  if (!disposition) return null

  const utf8Match = disposition.match(/filename\\*=UTF-8''([^;]+)/i)
  if (utf8Match?.[1]) {
    return decodeURIComponent(utf8Match[1].trim().replace(/^\"|\"$/g, ''))
  }

  const simpleMatch = disposition.match(/filename=([^;]+)/i)
  if (!simpleMatch?.[1]) return null
  return simpleMatch[1].trim().replace(/^\"|\"$/g, '')
}

export async function downloadExportFile(url: string, fallbackFileName: string): Promise<void> {
  const response = await fetch(url, {
    method: 'GET',
    cache: 'no-store',
  })

  if (!response.ok) {
    let message = 'Failed to export file.'
    try {
      const payload = (await response.json()) as { error?: string }
      if (payload?.error) message = payload.error
    } catch {
      // no-op
    }
    throw new Error(message)
  }

  const blob = await response.blob()
  const contentDisposition = response.headers.get('Content-Disposition')
  const fileName = extractFileNameFromDisposition(contentDisposition) || fallbackFileName

  const blobUrl = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = blobUrl
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(blobUrl)
}
