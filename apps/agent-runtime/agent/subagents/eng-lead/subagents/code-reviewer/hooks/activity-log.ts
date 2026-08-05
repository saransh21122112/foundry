import { defineHook } from "eve/hooks";
import { logToolResult, logSubagentDelegation } from "../../../../../lib/log-tool-result";

export default defineHook({
  events: { "action.result": logToolResult, "subagent.called": logSubagentDelegation },
});
