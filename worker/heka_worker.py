"""Heka's future local JSON-lines worker boundary.

The desktop shell owns this process. It validates a backend-independent DSL and emits
progress events; PyQGIS compilation belongs behind this boundary, never in the planner.
"""
from __future__ import annotations
import json
import sys
from dataclasses import asdict, dataclass
from typing import Any

@dataclass(frozen=True)
class WorkerEvent:
    stage: str
    label: str
    progress: float

def emit(event: WorkerEvent) -> None:
    print(json.dumps({"type": "progress", "payload": asdict(event)}), flush=True)

def validate(workflow: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    if workflow.get("version") != "1.0": errors.append("Unsupported workflow version")
    if not workflow.get("operations"): errors.append("Workflow contains no operations")
    # CRS validation and operation schemas are added here before backend compilation.
    return errors

def handle(message: dict[str, Any]) -> None:
    if message.get("type") == "validate":
        errors = validate(message.get("workflow", {}))
        print(json.dumps({"type": "validation", "payload": {"valid": not errors, "errors": errors}}), flush=True)
    else:
        print(json.dumps({"type": "error", "payload": {"message": "Unsupported worker message"}}), flush=True)

if __name__ == "__main__":
    for line in sys.stdin:
        if line.strip(): handle(json.loads(line))
