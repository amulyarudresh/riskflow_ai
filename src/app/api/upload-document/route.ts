import { createClient } from '@/utils/supabase/server'
import { NextResponse } from 'next/server'
import { createGeminiEmbedding } from '@/utils/ai/gemini'

const SUPPORTED_REFERENCE_FILE_EXTENSIONS = ['txt', 'md', 'markdown', 'csv', 'json']
const MAX_REFERENCE_FILE_SIZE_BYTES = 10 * 1024 * 1024
const MAX_CHUNK_CHAR_LENGTH = 1400
const CHUNK_OVERLAP_CHAR_LENGTH = 200
const MAX_CHUNKS_PER_DOCUMENT = 120

function getFileExtension(fileName: string): string | null {
  const extension = fileName.split('.').pop()?.toLowerCase()
  return extension ?? null
}

function splitTextIntoChunks(text: string): string[] {
  const normalized = text.replace(/\r\n/g, '\n').trim()
  if (!normalized) return []

  const chunks: string[] = []
  let start = 0

  while (start < normalized.length && chunks.length < MAX_CHUNKS_PER_DOCUMENT) {
    let end = Math.min(start + MAX_CHUNK_CHAR_LENGTH, normalized.length)

    if (end < normalized.length) {
      const minBreakpoint = start + Math.floor(MAX_CHUNK_CHAR_LENGTH * 0.55)
      const breakpoints = [
        normalized.lastIndexOf('\n\n', end),
        normalized.lastIndexOf('. ', end),
        normalized.lastIndexOf(' ', end),
      ].filter((index) => index >= minBreakpoint)

      if (breakpoints.length > 0) {
        end = Math.max(...breakpoints) + 1
      }
    }

    if (end <= start) {
      end = Math.min(start + MAX_CHUNK_CHAR_LENGTH, normalized.length)
    }

    const chunk = normalized.slice(start, end).trim()
    if (chunk.length > 0) {
      chunks.push(chunk)
    }

    if (end >= normalized.length) break
    start = Math.max(0, end - CHUNK_OVERLAP_CHAR_LENGTH)
  }

  return chunks
}

export async function POST(req: Request) {
  try {
    const supabase = await createClient()

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const formData = await req.formData()
    const rawTitle = formData.get('title')
    const rawContent = formData.get('content')
    const rawFile = formData.get('file')
    const title = typeof rawTitle === 'string' ? rawTitle.trim() : ''
    const contentFromForm = typeof rawContent === 'string' ? rawContent.trim() : ''
    const file = rawFile instanceof File && rawFile.size > 0 ? rawFile : null

    if (!title) {
      return NextResponse.json({ error: 'Title is required' }, { status: 400 })
    }

    if (!contentFromForm && !file) {
      return NextResponse.json({ error: 'Provide document content or upload a file' }, { status: 400 })
    }

    let content = contentFromForm
    if (file) {
      const extension = getFileExtension(file.name)
      if (!extension || !SUPPORTED_REFERENCE_FILE_EXTENSIONS.includes(extension)) {
        return NextResponse.json(
          { error: 'Unsupported file type. Use .txt, .md, .markdown, .csv, or .json' },
          { status: 400 }
        )
      }

      if (file.size > MAX_REFERENCE_FILE_SIZE_BYTES) {
        return NextResponse.json({ error: 'Reference file must be 10 MB or less' }, { status: 400 })
      }

      const fileContent = (await file.text()).trim()
      if (!fileContent && !contentFromForm) {
        return NextResponse.json({ error: 'Uploaded file is empty' }, { status: 400 })
      }

      if (fileContent) {
        content = contentFromForm ? `${contentFromForm}\n\n${fileContent}` : fileContent
      }
    }

    // Generate document-level embedding (nullable when no key is configured)
    const embedding = await createGeminiEmbedding(content)

    // Insert source document
    const { data: document, error: documentError } = await supabase
      .from('documents')
      .insert({
        title,
        content,
        embedding, // Nullable when no Gemini key is configured
        metadata: {
          source: 'dashboard_upload',
          uploaded_by: user.id,
          embedding_provider: embedding ? 'gemini' : null,
          file_name: file?.name ?? null,
          has_manual_content: contentFromForm.length > 0,
        },
      })
      .select()
      .single()

    if (documentError) {
      console.error(documentError)
      throw new Error(documentError.message)
    }

    // Store chunk-level embeddings for similarity retrieval.
    const chunks = splitTextIntoChunks(content)
    const chunkRows = await Promise.all(
      chunks.map(async (chunk, index) => ({
        document_id: document.id,
        chunk_index: index,
        content: chunk,
        embedding: await createGeminiEmbedding(chunk),
        metadata: {
          uploaded_by: user.id,
          source_document_id: document.id,
          source_document_title: title,
        },
      }))
    )

    if (chunkRows.length > 0) {
      const { error: chunkInsertError } = await supabase.from('document_chunks').insert(chunkRows)
      if (chunkInsertError) {
        await supabase.from('documents').delete().eq('id', document.id)
        throw new Error(`Failed to create document chunks: ${chunkInsertError.message}`)
      }
    }

    return NextResponse.json(
      { success: true, document, chunks_indexed: chunkRows.length },
      { status: 200 }
    )
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal Server Error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
