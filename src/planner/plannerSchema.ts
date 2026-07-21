import { z } from "zod";

export const spatialOperationSchema = z.enum(["LoadDataset", "Buffer", "Overlay", "Difference", "Intersect", "Coverage", "Score", "Rank", "Visualize"]);
export type SpatialOperationName = z.infer<typeof spatialOperationSchema>;
export const workflowParameterSchema = z.object({ name: z.string().min(1), value: z.union([z.string(), z.number(), z.boolean(), z.null()]) });

export const plannerOutputSchema = z.object({
  objective: z.string().min(3),
  location: z.string().min(2).nullable(),
  geographicScope: z.string().min(2),
  requiredDatasets: z.array(z.object({ name: z.string().min(2), purpose: z.string().min(3), kind: z.enum(["roads", "facilities", "population", "risk", "boundaries", "land_use", "raster", "other"]) })).min(1),
  constraints: z.array(z.object({ label: z.string().min(2), value: z.string().min(1), source: z.enum(["user", "planner"]) })),
  assumptions: z.array(z.string().min(3)),
  desiredOutput: z.string().min(3),
  workflowSummary: z.string().min(10),
  workflow: z.array(z.object({ operation: spatialOperationSchema, label: z.string().min(2), inputs: z.array(z.string()), parameters: z.array(workflowParameterSchema), rationale: z.string().min(3) })).min(1),
  confidence: z.number().int().min(0).max(100),
  clarificationQuestions: z.array(z.string().min(3)),
  executionReadiness: z.enum(["ready", "needs_data", "needs_clarification", "unsupported"])
});
export type PlannerOutput = z.infer<typeof plannerOutputSchema>;

/** OpenAI JSON schema submitted directly to OmniRoute's compatible endpoint. */
export const plannerJsonSchema = {
  name: "heka_spatial_plan",
  strict: true,
  schema: {
    type: "object", additionalProperties: false,
    required: ["objective", "location", "geographicScope", "requiredDatasets", "constraints", "assumptions", "desiredOutput", "workflowSummary", "workflow", "confidence", "clarificationQuestions", "executionReadiness"],
    properties: {
      objective: { type: "string" }, location: { type: ["string", "null"] }, geographicScope: { type: "string" },
      requiredDatasets: { type: "array", items: { type: "object", additionalProperties: false, required: ["name", "purpose", "kind"], properties: { name: { type: "string" }, purpose: { type: "string" }, kind: { type: "string", enum: ["roads", "facilities", "population", "risk", "boundaries", "land_use", "raster", "other"] } } } },
      constraints: { type: "array", items: { type: "object", additionalProperties: false, required: ["label", "value", "source"], properties: { label: { type: "string" }, value: { type: "string" }, source: { type: "string", enum: ["user", "planner"] } } } },
      assumptions: { type: "array", items: { type: "string" } }, desiredOutput: { type: "string" }, workflowSummary: { type: "string" },
      workflow: { type: "array", items: { type: "object", additionalProperties: false, required: ["operation", "label", "inputs", "parameters", "rationale"], properties: { operation: { type: "string", enum: ["LoadDataset", "Buffer", "Overlay", "Difference", "Intersect", "Coverage", "Score", "Rank", "Visualize"] }, label: { type: "string" }, inputs: { type: "array", items: { type: "string" } }, parameters: { type: "array", items: { type: "object", additionalProperties: false, required: ["name", "value"], properties: { name: { type: "string" }, value: { type: ["string", "number", "boolean", "null"] } } } }, rationale: { type: "string" } } } },
      confidence: { type: "integer", minimum: 0, maximum: 100 }, clarificationQuestions: { type: "array", items: { type: "string" } }, executionReadiness: { type: "string", enum: ["ready", "needs_data", "needs_clarification", "unsupported"] }
    }
  }
} as const;
