import { mongooseAdapter } from '@payloadcms/db-mongodb'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { mcpPlugin } from '@payloadcms/plugin-mcp'
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
import { addPhotoToMediaTool } from './eve/unsplash-add-tool'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

export default buildConfig({
  admin: {
    user: Users.slug,
    importMap: {
      baseDir: path.resolve(dirname),
    },
    components: {
      afterNavLinks: ['/components/eve/EveNavLink#EveNavLink'],
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
    url: process.env.DATABASE_URL || '',
  }),
  sharp,
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
        ...(process.env.UNSPLASH_ACCESS_KEY
          ? { searchPhotos: searchPhotosTool, addPhotoToMedia: addPhotoToMediaTool }
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
