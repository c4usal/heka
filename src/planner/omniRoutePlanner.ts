import { HEKA_PLANNER_SYSTEM_PROMPT } from "./plannerPrompt";
import { plannerJsonSchema, plannerOutputSchema, type PlannerOutput } from "./plannerSchema";
import { invoke } from "@tauri-apps/api/core";
import { plannerDatasetContext } from "../datasets/datasetCatalog";

const endpoint = (import.meta.env.VITE_OMNIROUTE_BASE_URL ?? "http://localhost:20128/v1").replace(/\/$/, "");
// Keep Heka on one direct, structured-output-capable model instead of an
// `auto` route that can fan out across unavailable community providers. The
// Groq credential lives in local OmniRoute; deployments can still override it.
const model = import.meta.env.VITE_OMNIROUTE_MODEL ?? "groq/openai/gpt-oss-20b";
const apiKey = import.meta.env.VITE_OMNIROUTE_API_KEY ?? "";
const directModel = import.meta.env.VITE_HEKA_GROQ_MODEL ?? "openai/gpt-oss-120b";

export class PlannerRequestError extends Error { constructor(message: string) { super(message); this.name = "PlannerRequestError"; } }

type ChatCompletion = { choices?: Array<{ message?: { content?: string | null } }>; error?: { message?: string } };

/**
 * Community models do not always honour nested JSON Schema fields even when
 * they return valid JSON. Keep that variability at the planner boundary: turn
 * their compact, human-readable plan into Heka's strict internal shape, then
 * validate it below. Invalid plans still never reach application state.
 */
function normalizePlannerPayload(payload: unknown): unknown {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) return payload;
  const plan = payload as Record<string, unknown>;
  const asText = (value: unknown) => typeof value === "string" ? value.trim() : "";
  const inferDatasetKind = (name: string) => {
    const value = name.toLowerCase();
    if (/(road|street|network|route)/.test(value)) return "roads";
    if (/(station|hospital|school|facility|charger)/.test(value)) return "facilities";
    if (/(population|demographic|census)/.test(value)) return "population";
    if (/(flood|risk|hazard|wildfire)/.test(value)) return "risk";
    if (/(boundary|community|neighbou?r|district)/.test(value)) return "boundaries";
    if (/(land.?use|zoning|parcel)/.test(value)) return "land_use";
    if (/(raster|elevation|dem|imagery)/.test(value)) return "raster";
    return "other";
  };
  return {
    ...plan,
    requiredDatasets: Array.isArray(plan.requiredDatasets) ? plan.requiredDatasets.map((dataset) => {
      if (typeof dataset === "string") return { name: dataset, purpose: `Required for the requested spatial analysis: ${dataset}.`, kind: inferDatasetKind(dataset) };
      if (dataset === null || typeof dataset !== "object" || Array.isArray(dataset)) return dataset;
      const compactDataset = dataset as Record<string, unknown>;
      const name = asText(compactDataset.name) || asText(compactDataset.dataset) || asText(compactDataset.label);
      return { ...compactDataset, name, purpose: asText(compactDataset.purpose) || `Required for the requested spatial analysis: ${name}.`, kind: asText(compactDataset.kind) || inferDatasetKind(name) };
    }) : plan.requiredDatasets,
    constraints: Array.isArray(plan.constraints) ? plan.constraints.map((constraint) => {
      if (typeof constraint === "string") return { label: constraint, value: constraint, source: "planner" };
      if (constraint === null || typeof constraint !== "object" || Array.isArray(constraint)) return constraint;
      const compactConstraint = constraint as Record<string, unknown>;
      const label = asText(compactConstraint.label) || asText(compactConstraint.constraint) || asText(compactConstraint.name);
      return { ...compactConstraint, label, value: asText(compactConstraint.value) || asText(compactConstraint.description) || label, source: compactConstraint.source === "user" ? "user" : "planner" };
    }) : plan.constraints,
    assumptions: Array.isArray(plan.assumptions) ? plan.assumptions : ["This is a preliminary spatial screening; local operational criteria and available datasets must be validated before a final decision."],
    workflow: Array.isArray(plan.workflow) ? plan.workflow.map((step) => {
      if (step === null || typeof step !== "object" || Array.isArray(step)) return step;
      const workflowStep = step as Record<string, unknown>;
      const description = typeof workflowStep.description === "string" ? workflowStep.description : typeof workflowStep.rationale === "string" ? workflowStep.rationale : "Spatial analysis step.";
      const compactOperation = asText(workflowStep.operation) || asText(workflowStep.action) || asText(workflowStep.type);
      const normalizedOperation = (() => {
        const operation = compactOperation.toLowerCase().replace(/[^a-z]/g, "");
        if (operation.includes("load")) return "LoadDataset";
        if (operation.includes("buffer")) return "Buffer";
        if (operation.includes("overlay")) return "Overlay";
        if (operation.includes("difference") || operation.includes("subtract") || operation.includes("gap")) return "Difference";
        if (operation.includes("intersect") || operation.includes("clip")) return "Intersect";
        if (operation.includes("route") || operation.includes("travel")) return "Route";
        if (operation.includes("cover")) return "Coverage";
        if (operation.includes("raster")) return "RasterMath";
        if (operation.includes("score") || operation.includes("suitability")) return "Score";
        if (operation.includes("rank")) return "Rank";
        if (operation.includes("visual") || operation.includes("export")) return "Visualize";
        return compactOperation;
      })();
      return {
        ...workflowStep,
        operation: normalizedOperation,
        label: typeof workflowStep.label === "string" ? workflowStep.label : description,
        inputs: Array.isArray(workflowStep.inputs) ? workflowStep.inputs : [],
        parameters: Array.isArray(workflowStep.parameters) ? workflowStep.parameters : [],
        rationale: typeof workflowStep.rationale === "string" ? workflowStep.rationale : description
      };
    }) : plan.workflow,
    executionReadiness: plan.executionReadiness === "ready" || plan.executionReadiness === "needs_data" || plan.executionReadiness === "needs_clarification" || plan.executionReadiness === "unsupported" ? plan.executionReadiness : "needs_data",
  };
}

async function requestPlan(question: string, repair?: string): Promise<PlannerOutput> {
  const controller = new AbortController(); const timeout = window.setTimeout(() => controller.abort(), 25_000);
  try {
    const catalog = `\n\nAVAILABLE LOCAL DATASET CATALOG:\n${plannerDatasetContext()}`;
    const body = { model: "__TAURI_INTERNALS__" in window ? directModel : model, temperature: 0.1, stream: false, max_tokens: 1800, response_format: { type: "json_schema", json_schema: plannerJsonSchema }, messages: [{ role: "system", content: `${HEKA_PLANNER_SYSTEM_PROMPT}${catalog}` }, { role: "user", content: repair ? `Original question: ${question}\n\nThe previous response failed validation: ${repair}\nReturn a corrected JSON object only.` : question }] };
    const payload = ("__TAURI_INTERNALS__" in window
      ? await invoke<ChatCompletion>("request_groq_planner", { request: { body } })
      : await (async () => { const response = await fetch(`${endpoint}/chat/completions`, { method: "POST", signal: controller.signal, headers: { "Content-Type": "application/json", ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) }, body: JSON.stringify(body) }); const value = await response.json().catch(() => { throw new PlannerRequestError("OmniRoute returned an unreadable response."); }) as ChatCompletion; if (!response.ok) throw new PlannerRequestError(value.error?.message ?? `OmniRoute request failed (${response.status}).`); return value; })()) as ChatCompletion;
    const content = payload.choices?.[0]?.message?.content;
    if (!content?.trim()) throw new PlannerRequestError("OmniRoute returned an empty planning result.");
    let parsed: unknown; try { parsed = JSON.parse(content); } catch { throw new PlannerRequestError("OmniRoute returned invalid JSON instead of a structured plan."); }
    const result = plannerOutputSchema.safeParse(normalizePlannerPayload(parsed));
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
