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
import type { User } from './payload-types'

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
    mcpPlugin({
      collections: {
        posts: {
          description:
            'Blog posts. Use find to list/read, create to add, update to edit. Fields: title, content, status (draft|published), author.',
          enabled: { find: true, create: true, update: true },
        },
        tasks: {
          description:
            'To-do tasks. Use find to list/read, create to add, update to edit. Fields: title, done (boolean), priority (low|medium|high), dueDate.',
          enabled: { find: true, create: true, update: true },
        },
      },
      // In development, bypass API key auth so the endpoint is accessible without credentials.
      ...(process.env.NODE_ENV === 'development' && {
        overrideAuth: async () => ({
          posts: { find: true, create: true, update: true },
          tasks: { find: true, create: true, update: true },
          user: { collection: 'users', email: 'dev@local', id: 'dev' } as unknown as User,
        }),
      }),
    }),
  ],
})
