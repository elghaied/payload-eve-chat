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

  it('imports addPhotosToMediaTool (the single batch tool) from unsplash-add-multi-tool', () => {
    expect(configSource).toContain("from './eve/unsplash-add-multi-tool'")
    expect(configSource).toContain('addPhotosToMediaTool')
  })

  it('registers searchPhotos and addPhotosToMedia gated on UNSPLASH_ACCESS_KEY', () => {
    expect(configSource).toContain('UNSPLASH_ACCESS_KEY')
    expect(configSource).toContain('searchPhotos: searchPhotosTool')
    expect(configSource).toContain('addPhotosToMedia: addPhotosToMediaTool')
  })

  it('does NOT register a separate single-photo addPhotoToMedia tool (consolidated into the batch tool)', () => {
    expect(configSource).not.toContain('addPhotoToMedia: addPhotoToMediaTool')
    expect(configSource).not.toContain('addPhotoToMediaTool')
  })
})

describe('payload.config.ts sidebar tab registration', () => {
  it('imports customSidebarTabs from sidebar-tabs', () => {
    expect(configSource).toContain("from './eve/sidebar-tabs'")
    expect(configSource).toContain('customSidebarTabs')
  })

  it('registers the sidebar tabs under admin.components.sidebar', () => {
    expect(configSource).toContain('sidebar:')
    expect(configSource).toContain('tabs: customSidebarTabs')
  })

  it('no longer registers the standalone Eve nav link', () => {
    expect(configSource).not.toContain('afterNavLinks')
    expect(configSource).not.toContain('EveNavLink')
  })
})

describe('payload.config.ts media storage + database url', () => {
  it('registers the Vercel Blob adapter in the top-level storage array (not plugins)', () => {
    expect(configSource).toContain("from '@payloadcms/storage-vercel-blob'")
    expect(configSource).toContain('storage: [')
    expect(configSource).toContain('vercelBlobStorage(')
    expect(configSource).toContain('token: process.env.BLOB_READ_WRITE_TOKEN')
  })

  it('keeps the Media schema consistent across environments (alwaysInsertFields)', () => {
    expect(configSource).toContain('alwaysInsertFields: true')
  })

  it('falls back across common MongoDB env var names for the Vercel Atlas integration', () => {
    expect(configSource).toContain('process.env.DATABASE_URL')
    expect(configSource).toContain('process.env.MONGODB_URI')
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
