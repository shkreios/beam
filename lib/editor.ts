import { browserEnv } from '@/env/browser'
import { api } from '@/server/utils/api'
import DOMPurify from 'isomorphic-dompurify'
import { marked } from 'marked'
import toast from 'react-hot-toast'
import { Cursor } from 'textarea-markdown-editor'

export function markdownToHtml(markdown: string) {
  return DOMPurify.sanitize(marked.parse(markdown, { breaks: true }))
}

function replacePlaceholder(
  cursor: Cursor,
  placeholder: string,
  replaceWith: string
) {
  cursor.setValue(cursor.value.replace(placeholder, replaceWith))
}

export function uploadImageCommandHandler(
  textareaEl: HTMLTextAreaElement,
  files: File[],
  utils: ReturnType<(typeof api)['useContext']>
) {
  const cursor = new Cursor(textareaEl)
  const currentLineNumber = cursor.position.line

  files.forEach(async (file, idx) => {
    const placeholder = `![Uploading ${file.name}...]()`

    cursor.replaceLine(currentLineNumber.lineNumber, placeholder)

    try {
      const { uploadImage } = await (browserEnv.NEXT_PUBLIC_STORAGE_PROVIDER ===
      's3'
        ? import('@/lib/s3')
        : import('@/lib/cloudinary'))
      const uploadedImage = await uploadImage(file, utils)

      replacePlaceholder(
        cursor,
        placeholder,
        `<img width="${
          uploadedImage.dpi && uploadedImage.dpi >= 144
            ? Math.round(uploadedImage.width / 2)
            : uploadedImage.width
        }" alt="${uploadedImage.originalFilename}" src="${uploadedImage.url}">`
      )
    } catch (error: any) {
      console.log(error)
      replacePlaceholder(cursor, placeholder, '')
      toast.error(`Error uploading image: ${error.message}`)
    }
  })
}

export function getSuggestionData(textareaEl: HTMLTextAreaElement): {
  keystrokeTriggered: boolean
  triggerIdx: number
  type: 'mention' | 'emoji'
  query: string
} {
  const positionIndex = textareaEl.selectionStart
  const textBeforeCaret = textareaEl.value.slice(0, positionIndex)

  const tokens = textBeforeCaret.split(/\s/)
  const lastToken = tokens[tokens.length - 1]

  const triggerIdx = textBeforeCaret.endsWith(lastToken)
    ? textBeforeCaret.length - lastToken.length
    : -1

  const maybeTrigger = textBeforeCaret[triggerIdx]
  const mentionKeystrokeTriggered = maybeTrigger === '@'
  const emojiKeystrokeTriggered = maybeTrigger === ':'
  const keystrokeTriggered =
    mentionKeystrokeTriggered || emojiKeystrokeTriggered
  const type = mentionKeystrokeTriggered ? 'mention' : 'emoji'

  const query = textBeforeCaret.slice(triggerIdx + 1)

  return {
    keystrokeTriggered,
    triggerIdx,
    type,
    query,
  }
}
