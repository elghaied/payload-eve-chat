// Vercel-native posture: the agent does not run arbitrary code/shell. Eve's default
// `bash` tool executes inside a sandbox (docker/microsandbox/just-bash locally), which is
// not part of this app's capability surface. Disable it. See
// docs/superpowers/notes/eve-tools-findings.md §2. Re-enable only alongside a Vercel Sandbox
// backend (agent/sandbox/sandbox.ts) if intentional code-exec is ever in scope.
import { disableTool } from "eve/tools";

export default disableTool();
