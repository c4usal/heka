import type { PlannerPort } from "../application/ports";
import type { AnalysisIntent, DatasetRef, SpatialReasoningGraph, SpatialWorkflow } from "../domain/spatial";

/**
 * Deterministic development planner. The production OpenAI planner implements the
 * same port and must only emit validated graph/DSL structures, never executable code.
 */
export class RulePlanner implements PlannerPort {
  async plan(question: string, datasets: DatasetRef[]) {
    const lower = question.toLowerCase();
    const needsFloodRisk = lower.includes("flood");
    const wantsCoverage = /hospital|fire station|emergency|coverage/.test(lower);
    const selected = datasets.filter((dataset) => wantsCoverage ? ["roads", "facilities", "population", "flood_zones"].includes(dataset.kind) : true);
    const constraints = [
      ...(needsFloodRisk ? [{ id: "avoid-flood", label: "Avoid flood-prone areas", value: "excluded", source: "user" as const }] : []),
      ...(wantsCoverage ? [{ id: "travel-time", label: "Target emergency access", value: "15 minutes by road", source: "planner" as const }] : [])
    ];
    const intent: AnalysisIntent = {
      question,
      objective: wantsCoverage ? "Improve emergency-service coverage" : "Evaluate spatial suitability",
      desiredOutput: "Ranked candidate locations with evidence",
      constraints,
      datasets: selected.map((dataset) => dataset.kind)
    };
    const operations: SpatialWorkflow["operations"] = selected.map((dataset) => ({ type: "LoadDataset", datasetId: dataset.id }));
    if (wantsCoverage) operations.push({ type: "Route", origins: "facilities", network: "roads", minutes: 15, mode: "drive" });
    if (needsFloodRisk) operations.push({ type: "Overlay", inputs: ["candidate-sites", "flood-zones"] });
    operations.push({ type: "Score", inputs: ["population", "accessibility"], weights: { coverage: 0.7, floodRisk: needsFloodRisk ? 0.3 : 0 } }, { type: "Rank", input: "scored-sites", limit: 5 }, { type: "Visualize", input: "ranked-sites", style: "candidates" });
    const workflow: SpatialWorkflow = { id: crypto.randomUUID(), version: "1.0", intent, operations, createdAt: new Date().toISOString() };
    const graph: SpatialReasoningGraph = { nodes: [
      { id: "intent", label: intent.objective, kind: "intent", dependsOn: [] },
      ...selected.map((dataset) => ({ id: dataset.id, label: dataset.name, kind: "dataset" as const, dependsOn: [] })),
      ...constraints.map((constraint) => ({ id: constraint.id, label: constraint.label, kind: "constraint" as const, dependsOn: ["intent"] })),
      ...operations.map((operation, index) => ({ id: `operation-${index}`, label: operation.type, kind: "operation" as const, dependsOn: index ? [`operation-${index - 1}`] : ["intent"] })),
      { id: "output", label: intent.desiredOutput, kind: "output", dependsOn: [`operation-${operations.length - 1}`] }
    ] };
    return { intent, graph, workflow };
  }
}
