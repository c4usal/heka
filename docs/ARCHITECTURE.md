# Heka architecture

Heka keeps probabilistic language understanding separate from deterministic spatial execution.

```text
Presentation (React workspace)
  → Application ports (PlannerPort, SpatialRuntimePort)
  → Domain (intent, graph, DSL)
  → Infrastructure (OpenAI planner, PyQGIS runtime adapters)
```

The starter `RulePlanner` exists only to keep the UI runnable while the OpenAI planner adapter is built. Both are constrained to emit the same `SpatialWorkflow` representation. The Python worker validates and compiles workflows; it must never accept raw generated Python from a planner.

Project folders will contain `project.heka`, `datasets/`, `analyses/`, `exports/`, `cache/`, `reports/`, `logs/`, and `plugins/`.
