import { defineHook } from "eve/hooks";
import { logToolResult } from "../../../../../lib/log-tool-result";

export default defineHook({ events: { "action.result": logToolResult } });
