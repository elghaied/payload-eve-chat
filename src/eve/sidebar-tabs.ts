import type { SidebarTab } from 'payload'

/**
 * Custom admin sidebar tabs. The "Eve chat" tab shows conversation history in
 * the sidebar panel; the chat itself stays at the /admin/eve view. Component
 * paths are resolved by admin.importMap (baseDir: src), like views.eve.
 *
 * Collections remains the default tab (no isDefaultActive here).
 */
export const customSidebarTabs: SidebarTab[] = [
  {
    slug: 'eve-chat',
    label: 'Eve chat',
    components: {
      Icon: '/components/eve/EveChatTabIcon#EveChatTabIcon',
      Content: '/components/eve/EveChatTab#EveChatTab',
    },
  },
]
