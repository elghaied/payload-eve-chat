import { mongooseAdapter } from '@payloadcms/db-mongodb'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { mcpPlugin } from '@payloadcms/plugin-mcp'
import { vercelBlobStorage } from '@payloadcms/storage-vercel-blob'
import path from 'path'
import { buildConfig } from 'payload'
import { fileURLToPath } from 'url'
import sharp from 'sharp'

import { Users } from './collections/Users'
import { Media } from './collections/Media'
import { Posts } from './collections/demo/Posts'
import { Tasks } from './collections/demo/Tasks'
import { Conversations } from './collections/Conversations'
import { createDocumentFromMarkdownTool } from './eve/markdown-tool'
import { generateImageTool } from './eve/generate-image-tool'
import { searchPhotosTool } from './eve/unsplash-search-tool'
import { addPhotosToMediaTool } from './eve/unsplash-add-multi-tool'
import { customSidebarTabs } from './eve/sidebar-tabs'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

export default buildConfig({
  admin: {
    user: Users.slug,
    importMap: {
      baseDir: path.resolve(dirname),
    },
    components: {
      sidebar: {
        tabs: customSidebarTabs,
      },
      views: {
        eve: {
          Component: '/components/eve/EveView#EveView',
          path: '/eve',
        },
      },
    },
  },
  collections: [Users, Media, Posts, Tasks, Conversations],
  editor: lexicalEditor(),
  secret: process.env.PAYLOAD_SECRET || '',
  typescript: {
    outputFile: path.resolve(dirname, 'payload-types.ts'),
  },
  db: mongooseAdapter({
    // Local dev: DATABASE_URL (a local mongod). On Vercel, the MongoDB Atlas marketplace
    // integration injects the connection string under a name you pick when connecting the
    // resource — commonly MONGODB_URI (or a prefixed variant). Accept the common names so the
    // deploy works whether or not the integration used DATABASE_URL. Verify the exact name in
    // Vercel → Project → Settings → Environment Variables; if it's something else, either add a
    // DATABASE_URL there or tell us the name to add to this list.
    url:
      process.env.DATABASE_URL ||
      process.env.MONGODB_URI ||
      process.env.MONGODB_URL ||
      process.env.MONGO_URL ||
      '',
  }),
  sharp,
  // Media storage adapters (Payload v4 takes these in a top-level `storage` array, NOT in
  // `plugins`). The token is auto-injected by Vercel when a Blob store is linked to the project
  // (BLOB_READ_WRITE_TOKEN). When the token is unset (local dev), the adapter disables itself and
  // Payload falls back to local disk (the gitignored /media directory). We register it
  // unconditionally with alwaysInsertFields so the Media schema stays identical across dev and
  // prod whether or not Blob is active.
  storage: [
    vercelBlobStorage({
      enabled: Boolean(process.env.BLOB_READ_WRITE_TOKEN),
      collections: { media: true },
      token: process.env.BLOB_READ_WRITE_TOKEN,
      alwaysInsertFields: true,
    }),
  ],
  plugins: [
    // v4 plugin-mcp uses an OPT-OUT model: every collection is exposed through the
    // built-in CRUD tools (find/create/update/delete/getCollectionSchema) by default.
    // We expose only posts and tasks (read/write, no delete) and explicitly disable
    // every tool on the collections that must not be reachable over MCP.
    mcpPlugin({
      collections: {
        posts: {
          description:
            'Blog posts. Use findDocuments to list/read and updateDocument to edit. To CREATE a post, use createDocumentFromMarkdown (the body is a rich-text field, written as Markdown). Fields: title, content (rich text), status (draft|published), author.',
          // Generic create is disabled: the content field is rich text (Lexical),
          // so posts are created via createDocumentFromMarkdown, which converts Markdown.
          tools: { create: false, delete: false },
        },
        tasks: {
          description:
            'To-do tasks. Use find to list/read, create to add, update to edit. Fields: title, done (boolean), priority (low|medium|high), dueDate.',
          tools: { delete: false },
        },
        // Lock down everything not part of the demo surface.
        users: {
          tools: { find: false, create: false, update: false, delete: false, getCollectionSchema: false },
        },
        media: {
          description:
            'Uploaded images. Use findDocuments to list existing images for reuse. ' +
            'To generate a new image, use the generateImage tool instead.',
          // find + getCollectionSchema remain enabled (default on) so the agent can
          // browse and reuse existing uploads. Generic create/update/delete are off:
          // image creation goes through the generateImage tool which enforces the
          // gateway → Buffer → Media.create path with correct mimetype and alt text.
          tools: { create: false, update: false, delete: false },
        },
        conversations: {
          tools: { find: false, create: false, update: false, delete: false, getCollectionSchema: false },
        },
      },
      // Cross-cutting custom tools. createDocumentFromMarkdown converts Markdown ->
      // Lexical server-side so the agent can populate rich-text fields (e.g. a
      // post body) without ever handling Lexical JSON. Reusable for any Lexical
      // collection — see ALLOWED_COLLECTIONS in src/eve/markdown-tool.ts.
      tools: {
        createDocumentFromMarkdown: createDocumentFromMarkdownTool,
        generateImage: generateImageTool,
        // A SINGLE Unsplash→Media tool (addPhotosToMedia, accepts one or more photos).
        // We deliberately do NOT also register a near-identical singular tool: Eve
        // discovers MCP tools by fuzzy name/description match and will reuse whichever
        // similar tool it already discovered, so two look-alike tools made it call the
        // single-add tool N times instead of the batch tool once.
        ...(process.env.UNSPLASH_ACCESS_KEY
          ? {
              searchPhotos: searchPhotosTool,
              addPhotosToMedia: addPhotosToMediaTool,
            }
          : {}),
      },
      // In development, bypass API key auth so the endpoint is reachable without
      // credentials. Grant exactly the items the plugin registered (i.e. the enabled
      // tools above) and run as the first admin user. Gated to development only.
      ...(process.env.NODE_ENV === 'development' && {
        overrideAuth: async ({ req, pluginConfig }) => {
          const { docs } = await req.payload.find({
            collection: 'users',
            limit: 1,
            depth: 0,
            overrideAccess: true,
          })
          return {
            items: pluginConfig.items,
            overrideAccess: true,
            user: docs[0] ?? null,
          }
        },
      }),
    }),
  ],
})
