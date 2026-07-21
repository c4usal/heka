import type { PlannerOutput } from "./plannerSchema";
import type { GraphEdge, GraphNode, PlannerPlan, SpatialDslStep } from "../types/workspace";

export function transformPlannerOutput(question: string, output: PlannerOutput): PlannerPlan {
  const nodes: GraphNode[] = [{ id: "question", label: "Question", kind: "question" }]; const edges: GraphEdge[] = [];
  output.requiredDatasets.forEach((dataset, index) => { const id = `dataset-${index}`; nodes.push({ id, label: dataset.name, kind: "dataset" }); edges.push({ from: "question", to: id }); });
  let previous = "question"; output.workflow.forEach((step, index) => { const id = `operation-${index}`; nodes.push({ id, label: step.label, kind: "operation" }); edges.push({ from: previous, to: id }); previous = id; });
  nodes.push({ id: "output", label: output.desiredOutput, kind: "output" }); edges.push({ from: previous, to: "output" });
  const dsl: SpatialDslStep[] = output.workflow.map((step, index) => ({ id: `dsl-${index}`, operation: step.operation, label: step.label, inputs: step.inputs, parameters: step.parameters, rationale: step.rationale }));
  return { question, objective: output.objective, location: output.location, geographicScope: output.geographicScope, requiredDatasets: output.requiredDatasets, constraints: output.constraints, assumptions: output.assumptions, desiredOutput: output.desiredOutput, workflowSummary: output.workflowSummary, confidence: output.confidence, clarificationQuestions: output.clarificationQuestions, executionReadiness: output.executionReadiness, graph: { nodes, edges }, dsl };
}
