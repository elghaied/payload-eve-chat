// Disabled: sandbox filesystem grep. The agent operates on Payload data via MCP, not a
// sandbox FS. See docs/superpowers/notes/eve-tools-findings.md §2.
import { disableTool } from "eve/tools";

export default disableTool();
