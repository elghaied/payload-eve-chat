import type { MCPPluginConfig } from '@payloadcms/plugin-mcp'

/**
 * plugin-mcp is OPT-OUT: every collection is reachable through every built-in tool unless that
 * tool is set to `false`, and new Payload releases add new built-ins (4.0 beta added
 * countDocuments, findDistinct, duplicateDocument, ...). A hand-written list of names goes stale
 * silently and re-exposes a collection we meant to hide.
 *
 * plugin-mcp doesn't export its built-in name union, so derive it from the config type: the
 * collection tools map is `{ [custom: string]: ... } & { [builtin]?: ... }` — dropping the string
 * index signature leaves exactly the built-in names.
 */
type CollectionToolsMap = NonNullable<
  NonNullable<NonNullable<MCPPluginConfig['collections']>['tasks']>['tools']
>
type BuiltinCollectionTool = keyof {
  [K in keyof CollectionToolsMap as string extends K ? never : K]: true
}

/**
 * Every built-in collection tool turned off — use as `tools` for a collection that must not be
 * reachable over MCP at all. `satisfies` makes typecheck FAIL when a Payload upgrade adds (or
 * removes) a built-in, so the list can't silently fall behind.
 */
export const ALL_COLLECTION_TOOLS_OFF = {
  count: false,
  countVersions: false,
  create: false,
  delete: false,
  duplicate: false,
  find: false,
  findDistinct: false,
  findVersionByID: false,
  findVersions: false,
  getCollectionSchema: false,
  getUploadInstructions: false,
  restoreVersion: false,
  update: false,
} as const satisfies Record<BuiltinCollectionTool, false>
