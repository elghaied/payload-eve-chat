import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import type { FileUIPart } from 'ai'
import { AttachmentPreview } from './AttachmentPreview'

afterEach(cleanup)

function imageFile(overrides: Partial<FileUIPart> = {}): FileUIPart {
  return {
    type: 'file',
    mediaType: 'image/jpeg',
    url: 'data:image/jpeg;base64,/9j/4AAQ==',
    filename: 'photo.jpg',
    ...overrides,
  }
}

function pdfFile(overrides: Partial<FileUIPart> = {}): FileUIPart {
  return {
    type: 'file',
    mediaType: 'application/pdf',
    url: 'data:application/pdf;base64,JVBERi0=',
    filename: 'report.pdf',
    ...overrides,
  }
}

describe('AttachmentPreview', () => {
  it('renders an <img> for image files with correct src and alt', () => {
    const { container } = render(<AttachmentPreview file={imageFile()} />)
    const img = container.querySelector('img')
    expect(img).toBeTruthy()
    expect(img!.getAttribute('src')).toBe('data:image/jpeg;base64,/9j/4AAQ==')
    expect(img!.getAttribute('alt')).toBe('photo.jpg')
  })

  it('renders a chip (no <img>) for PDF files', () => {
    const { container } = render(<AttachmentPreview file={pdfFile()} />)
    expect(container.querySelector('img')).toBeNull()
    expect(container.textContent).toContain('report.pdf')
  })

  it('uses fallback alt text when filename is absent', () => {
    const { container } = render(<AttachmentPreview file={imageFile({ filename: undefined })} />)
    const img = container.querySelector('img')
    expect(img!.getAttribute('alt')).toBe('attachment')
  })

  it('renders an X button when onRemove is provided', () => {
    const { container } = render(
      <AttachmentPreview file={imageFile()} onRemove={() => {}} />,
    )
    const btn = container.querySelector('button[aria-label="Remove attachment"]')
    expect(btn).toBeTruthy()
  })

  it('does NOT render an X button when onRemove is absent', () => {
    const { container } = render(<AttachmentPreview file={imageFile()} />)
    const btn = container.querySelector('button[aria-label="Remove attachment"]')
    expect(btn).toBeNull()
  })

  it('calls onRemove with the file when X button is clicked', () => {
    const onRemove = vi.fn()
    const file = imageFile()
    const { container } = render(<AttachmentPreview file={file} onRemove={onRemove} />)
    const btn = container.querySelector('button[aria-label="Remove attachment"]') as HTMLButtonElement
    btn.click()
    expect(onRemove).toHaveBeenCalledWith(file)
  })

  it('renders a chip with filename for PDF in post-send preview (no onRemove)', () => {
    const { container } = render(<AttachmentPreview file={pdfFile()} />)
    expect(container.textContent).toContain('report.pdf')
    expect(container.querySelector('button')).toBeNull()
  })
})
