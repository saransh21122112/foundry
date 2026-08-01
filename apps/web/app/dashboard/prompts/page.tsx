import { Suspense } from "react";
import { AGENT_PROMPTS } from "./agents";
import { readAgentPrompt } from "./actions";
import { PromptsBoard } from "./PromptsBoard";

/**
 * Server component, same shape as app/dashboard/run/page.tsx: resolves the
 * selected agent server-side (a direct function call, no HTTP hop) so the
 * textarea has real content in the first response.
 */
export default async function PromptsPage({
  searchParams,
}: {
  searchParams: Promise<{ agent?: string }>;
}) {
  const { agent } = await searchParams;
  const selectedId = AGENT_PROMPTS.some((a) => a.id === agent) ? (agent as string) : "root";
  const initialContent = await readAgentPrompt(selectedId);

  return (
    <Suspense fallback={null}>
      <PromptsBoard agents={AGENT_PROMPTS} selectedId={selectedId} initialContent={initialContent} />
    </Suspense>
  );
}
