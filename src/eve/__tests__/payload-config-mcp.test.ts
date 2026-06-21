import { describe, expect, it } from 'vitest'

// Static check: verify that the key MCP configuration values are present.
// We cannot import payload.config.ts directly (it triggers DB connection),
// so we read the source and assert on its text content.
import { readFileSync } from 'fs'
import { resolve } from 'path'

const configSource = readFileSync(resolve(process.cwd(), 'src/payload.config.ts'), 'utf-8')

describe('payload.config.ts MCP configuration', () => {
  it('imports generateImageTool', () => {
    expect(configSource).toContain("import { generateImageTool } from './eve/generate-image-tool'")
  })

  it('registers generateImage in mcpPlugin tools', () => {
    expect(configSource).toContain('generateImage: generateImageTool')
  })

  it('enables media find and getCollectionSchema (only create/update/delete are false)', () => {
    // The media block must NOT have find:false or getCollectionSchema:false
    // Check the block has the right shape
    expect(configSource).toContain("tools: { create: false, update: false, delete: false }")
    // Ensure find:false is no longer present in the media block
    const mediaBlockStart = configSource.indexOf("media: {")
    const mediaBlockEnd = configSource.indexOf('},', mediaBlockStart)
    const mediaBlock = configSource.slice(mediaBlockStart, mediaBlockEnd)
    expect(mediaBlock).not.toContain('find: false')
    expect(mediaBlock).not.toContain('getCollectionSchema: false')
  })

  it('does NOT expose media create/update/delete via MCP', () => {
    expect(configSource).toContain('create: false')
    expect(configSource).toContain('update: false')
    expect(configSource).toContain('delete: false')
  })
})

describe('payload.config.ts Unsplash tool registration', () => {
  it('imports searchPhotosTool from unsplash-search-tool', () => {
    expect(configSource).toContain("from './eve/unsplash-search-tool'")
    expect(configSource).toContain('searchPhotosTool')
  })

  it('imports addPhotoToMediaTool from unsplash-add-tool', () => {
    expect(configSource).toContain("from './eve/unsplash-add-tool'")
    expect(configSource).toContain('addPhotoToMediaTool')
  })

  it('registers searchPhotos and addPhotoToMedia gated on UNSPLASH_ACCESS_KEY', () => {
    expect(configSource).toContain('UNSPLASH_ACCESS_KEY')
    expect(configSource).toContain('searchPhotos: searchPhotosTool')
    expect(configSource).toContain('addPhotoToMedia: addPhotoToMediaTool')
  })
})

const mediaSource = readFileSync(resolve(process.cwd(), 'src/collections/Media.ts'), 'utf-8')

describe('Media collection credit fields', () => {
  it('has an optional credit text field', () => {
    expect(mediaSource).toContain("name: 'credit'")
    expect(mediaSource).toContain("type: 'text'")
  })
  it('has an optional creditUrl text field', () => {
    expect(mediaSource).toContain("name: 'creditUrl'")
  })
  it('credit and creditUrl are not required', () => {
    // Neither field should have required:true
    const creditIdx = mediaSource.indexOf("name: 'credit'")
    const creditBlock = mediaSource.slice(creditIdx, creditIdx + 120)
    expect(creditBlock).not.toContain('required: true')
  })
})
