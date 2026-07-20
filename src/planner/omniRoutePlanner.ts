import { HEKA_PLANNER_SYSTEM_PROMPT } from "./plannerPrompt";
import { plannerJsonSchema, plannerOutputSchema, type PlannerOutput } from "./plannerSchema";

const endpoint = (import.meta.env.VITE_OMNIROUTE_BASE_URL ?? "http://localhost:20128/v1").replace(/\/$/, "");
// `auto` can fan out across unavailable community providers and exceed the
// desktop planner's timeout. This no-auth OpenCode model has been verified to
// return OmniRoute JSON-schema output; deployments can still override it.
const model = import.meta.env.VITE_OMNIROUTE_MODEL ?? "oc/big-pickle";
const apiKey = import.meta.env.VITE_OMNIROUTE_API_KEY ?? "";

export class PlannerRequestError extends Error { constructor(message: string) { super(message); this.name = "PlannerRequestError"; } }

type ChatCompletion = { choices?: Array<{ message?: { content?: string | null } }>; error?: { message?: string } };

async function requestPlan(question: string, repair?: string): Promise<PlannerOutput> {
  const controller = new AbortController(); const timeout = window.setTimeout(() => controller.abort(), 25_000);
  try {
    const response = await fetch(`${endpoint}/chat/completions`, { method: "POST", signal: controller.signal, headers: { "Content-Type": "application/json", ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) }, body: JSON.stringify({ model, temperature: 0.1, response_format: { type: "json_schema", json_schema: plannerJsonSchema }, messages: [{ role: "system", content: HEKA_PLANNER_SYSTEM_PROMPT }, { role: "user", content: repair ? `Original question: ${question}\n\nThe previous response failed validation: ${repair}\nReturn a corrected JSON object only.` : question }] }) });
    const payload = await response.json().catch(() => { throw new PlannerRequestError("OmniRoute returned an unreadable response."); }) as ChatCompletion;
    if (!response.ok) throw new PlannerRequestError(payload.error?.message ?? `OmniRoute request failed (${response.status}).`);
    const content = payload.choices?.[0]?.message?.content;
    if (!content?.trim()) throw new PlannerRequestError("OmniRoute returned an empty planning result.");
    let parsed: unknown; try { parsed = JSON.parse(content); } catch { throw new PlannerRequestError("OmniRoute returned invalid JSON instead of a structured plan."); }
    const result = plannerOutputSchema.safeParse(parsed);
    if (!result.success) throw new PlannerRequestError(`Planner schema validation failed: ${result.error.issues.map((issue) => issue.path.join(".") || issue.message).join(", ")}`);
    return result.data;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw new PlannerRequestError("OmniRoute timed out. Check that the local gateway is running.");
    if (error instanceof PlannerRequestError) throw error;
    throw new PlannerRequestError("OmniRoute is offline. Start the local gateway with `omniroute`, connect a provider in its dashboard at http://localhost:20128, then try again.");
  } finally { window.clearTimeout(timeout); }
}

/** Direct OmniRoute call with exactly one repair attempt; invalid output never reaches Heka state. */
export async function planWithOmniRoute(question: string): Promise<PlannerOutput> {
  try { return await requestPlan(question); } catch (firstError) {
    try { return await requestPlan(question, firstError instanceof Error ? firstError.message : "Unknown validation failure"); }
    catch (secondError) { throw new PlannerRequestError(secondError instanceof Error ? secondError.message : "Planner failed after retry."); }
  }
}
