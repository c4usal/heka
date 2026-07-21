import { ArrowUp, Check, ChevronRight, CircleAlert, CircleDashed, Cpu, Crosshair, LoaderCircle, MapPinned, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { hekaLogo as logo } from "../../assets/hekaLogo";
import { askEarth, exportEarthGeoJson, type EarthDiscovery, type EarthNextAction, type EarthResponse } from "../../earth/askEarth";
import { checkPyQgisRuntime, executeSpatialPlan } from "../../execution/pyqgisExecution";
import { earthApiBaseUrl, isTauriRuntime } from "../../config/aiGateway";
import { useWorkspaceStore } from "../../stores/useWorkspaceStore";
import type { DocumentChatMessage, MapLayerKind, PlannerPlan } from "../../types/workspace";

type AssistantMessage = Extract<DocumentChatMessage, { role: "assistant" }> & { raw: EarthResponse };
type ChatMessage = DocumentChatMessage;

function asAssistant(message: DocumentChatMessage): AssistantMessage | null {
  if (message.role !== "assistant") return null;
  const raw = (message.raw as EarthResponse | undefined) ?? {
    answer: message.answer,
    location: { name: message.place, lat: 0, lon: 0, bbox: [0, 0, 0, 0] },
    criteria: message.criteria,
    candidates: message.candidates.map((c) => ({ ...c, factors: c.factors ?? {} })),
    layers: [],
    assumptions: message.assumptions,
    limitations: message.limitations,
    confidence: message.confidence,
    trace: message.trace,
    next_actions: message.nextActions,
  };
  return { ...message, raw };
}

function earthToPlan(question: string, earth: EarthResponse): PlannerPlan {
  const dsl = (earth.dsl?.length
    ? earth.dsl.map((step) => ({
        id: step.id,
        operation: step.operation,
        label: step.label,
        inputs: step.inputs,
        parameters: [],
        rationale: step.rationale,
      }))
    : earth.trace.map((step, index) => ({
        id: `trace-${index}`,
        operation: step.tool,
        label: step.summary,
        inputs: [],
        parameters: [],
        rationale: step.summary,
      })));
  return {
    question,
    objective: earth.answer.split("\n")[0]?.slice(0, 160) || "Earth Agent analysis",
    location: earth.location.name,
    geographicScope: earth.location.name,
    requiredDatasets: earth.criteria.map((c) => ({ name: c.label, purpose: c.source, kind: c.id })),
    constraints: earth.limitations.map((label) => ({ label, value: "limitation", source: "planner" as const })),
    assumptions: earth.assumptions,
    answer: earth.answer,
    desiredOutput: "MapProduct + recommendation",
    workflowSummary: earth.engineNote || "Evidence → connectors → score → map",
    confidence: earth.confidence,
    clarificationQuestions: [],
    executionReadiness: earth.candidates.length > 0 ? "ready" : "needs_data",
    graph: {
      nodes: [
        { id: "q", label: "Question", kind: "question" as const },
        { id: "evidence", label: "Evidence", kind: "operation" as const },
        { id: "map", label: "MapProduct", kind: "output" as const },
      ],
      edges: [{ from: "q", to: "evidence" }, { from: "evidence", to: "map" }],
    },
    dsl,
  };
}

function emptyDiscovery(): EarthDiscovery {
  return { need: [], found: [], missing: [] };
}

/** Light formatting: **bold**, bullet lines — no raw URL dumps. */
function formatAnswer(text: string) {
  return text.split("\n").map((line, i) => {
    const parts = line.split(/(\*\*[^*]+\*\*)/g).map((chunk, j) => {
      const bold = chunk.match(/^\*\*([^*]+)\*\*$/);
      if (bold) return <strong key={`${i}-${j}`}>{bold[1]}</strong>;
      return <span key={`${i}-${j}`}>{chunk}</span>;
    });
    return (
      <span key={`line-${i}`} className="answer-line">
        {parts}
        {i < text.split("\n").length - 1 ? <br /> : null}
      </span>
    );
  });
}

function explainScoring(message: AssistantMessage): string {
  const top = message.candidates[0];
  const weights = message.criteria.map((c) => `${c.label} ${Math.round(c.weight * 100)}%`).join(", ");
  if (!top) {
    return "There isn’t a ranked site yet for this turn — scoring only runs when a facility or bridge siting mode has enough layers.";
  }
  const weighted = Object.entries(top.factors ?? {})
    .map(([k, v]) => {
      const w = message.criteria.find((c) => c.id === k)?.weight ?? 0;
      return [k, w * v] as [string, number];
    })
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4);
  const factorLines = weighted.map(([k, contrib]) => {
    const raw = top.factors?.[k] ?? 0;
    return `• ${k.replace(/_/g, " ")} — contribution ${contrib.toFixed(2)} (score ${raw.toFixed(2)})`;
  });
  const metrics = (top as { metrics?: Record<string, number | string> }).metrics;
  const metricBits: string[] = [];
  if (metrics?.coverageGapMeters != null) metricBits.push(`~${(Number(metrics.coverageGapMeters) / 1000).toFixed(1)} km from nearest existing facility`);
  if (metrics?.buildingsWithin600m != null) metricBits.push(`${metrics.buildingsWithin600m} buildings within 600 m`);
  if (metrics?.activityAnchorsWithin800m != null) metricBits.push(`${metrics.activityAnchorsWithin800m} community activity anchors within 800 m`);

  return [
    `Here’s how #1 was chosen for ${message.place || "this place"}:`,
    "",
    `Weights (same multi-criteria model for every facility type): ${weights || "equalized"}.`,
    "",
    "What moved the needle (by weighted contribution, not raw factor alone):",
    ...factorLines,
    metricBits.length ? `\nMeasured on this site: ${metricBits.join("; ")}.` : "",
    "",
    "In plain language: coverage gap and catchment demand lead; arterial access is only one secondary factor.",
    "",
    message.limitations.length
      ? `Next direction:\n${message.limitations.slice(0, 3).map((l) => `• ${l}`).join("\n")}`
      : "",
  ].filter(Boolean).join("\n");
}

function compareCandidates(message: AssistantMessage): string {
  if (message.candidates.length < 2) return "Only one ranked candidate is available to compare.";
  const lines = message.candidates.slice(0, 5).map((c) => {
    const topFactor = Object.entries(c.factors ?? {}).sort((a, b) => b[1] - a[1])[0];
    return `#${c.rank} (score ${c.score.toFixed(3)}) — strongest factor ${topFactor ? `${topFactor[0].replace(/_/g, " ")}=${topFactor[1].toFixed(2)}` : "n/a"} · ${c.lat.toFixed(4)}, ${c.lon.toFixed(4)}`;
  });
  return [
    `Comparing ranked sites in ${message.place}:`,
    "",
    ...lines,
    "",
    "Click a # in the previous answer (or below) to fly the camera. #1 is the recommended pick; lower ranks are tradeoff alternatives.",
  ].join("\n");
}

function floodGapNote(message: AssistantMessage): string {
  const gaps = message.discovery.missing.filter((m) => /flood|water/i.test(m.label) || /flood/i.test(m.reason ?? ""));
  return [
    `Flood evidence for ${message.place || "this place"}:`,
    "",
    "Official flood / inundation polygons are not wired yet.",
    "What we can use today: OSM waterways as a *labeled proxy*, plus open research.",
    gaps.length ? `\nKnown gaps:\n${gaps.map((g) => `• ${g.label}: ${g.reason ?? g.status}`).join("\n")}` : "",
    "",
    "Import a flood GeoJSON via File → Import (or drop on the map) to overlay your own polygons.",
  ].filter(Boolean).join("\n");
}

const PENDING_STEPS = [
  "Understanding question",
  "Planning evidence",
  "Acquiring open data",
  "Scoring / mapping",
  "Finalize",
];

const WELCOME_PROMPTS = [
  "Where should I put a hospital in Calgary?",
  "Where should I put a bridge in Lagos?",
  "Where should I put an EV charger in Vancouver?",
] as const;

export function PlannerComposer() {
  const [question, setQuestion] = useState("");
  const [liveTrace, setLiveTrace] = useState<Array<{ tool: string; status: "pending" | "active" | "done" }>>([]);
  const [selectedCandidateId, setSelectedCandidateId] = useState<string>();
  const [qgisBusy, setQgisBusy] = useState(false);
  const threadRef = useRef<HTMLDivElement>(null);
  const lastFull = useRef<AssistantMessage | null>(null);

  const activeDocumentId = useWorkspaceStore((state) => state.activeDocumentId);
  const messages = useWorkspaceStore((state) =>
    state.documents.find((doc) => doc.id === state.activeDocumentId)?.chatMessages ?? [],
  );
  const setActiveChatMessages = useWorkspaceStore((state) => state.setActiveChatMessages);
  const planner = useWorkspaceStore((state) => state.planner);
  const beginPlanning = useWorkspaceStore((state) => state.beginPlanning);
  const applyPlan = useWorkspaceStore((state) => state.applyPlan);
  const addResolvedMapLayer = useWorkspaceStore((state) => state.addResolvedMapLayer);
  const setMapFocus = useWorkspaceStore((state) => state.setMapFocus);
  const setCameraTarget = useWorkspaceStore((state) => state.setCameraTarget);
  const setRankedCandidates = useWorkspaceStore((state) => state.setRankedCandidates);
  const failPlanning = useWorkspaceStore((state) => state.failPlanning);
  const beginExecution = useWorkspaceStore((state) => state.beginExecution);
  const completeExecution = useWorkspaceStore((state) => state.completeExecution);
  const failExecution = useWorkspaceStore((state) => state.failExecution);
  const showToast = useWorkspaceStore((state) => state.showToast);
  const qgisHealth = useWorkspaceStore((state) => state.qgisHealth);
  const selectedFeature = useWorkspaceStore((state) => state.execution.selectedFeature);

  const setMessages = (updater: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => {
    const current = useWorkspaceStore.getState().documents.find((doc) => doc.id === useWorkspaceStore.getState().activeDocumentId)?.chatMessages ?? [];
    const next = typeof updater === "function" ? updater(current) : updater;
    setActiveChatMessages(next);
  };

  useEffect(() => {
    const last = [...messages].reverse().find((message) => message.role === "assistant" && message.variant === "full");
    lastFull.current = last ? asAssistant(last) : null;
  }, [messages, activeDocumentId]);

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, planner.status, liveTrace, activeDocumentId]);

  // Warm server cache for Try asking prompts so first click is fast.
  useEffect(() => {
    let cancelled = false;
    const warm = async () => {
      try {
        await fetch(`${earthApiBaseUrl()}/api/ask/warmup`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        });
      } catch {
        for (const prompt of WELCOME_PROMPTS) {
          if (cancelled) break;
          try { await askEarth(prompt); } catch { /* ignore */ }
          await new Promise((r) => setTimeout(r, 800));
        }
      }
    };
    const handle = window.setTimeout(() => { void warm(); }, 1200);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, []);

  const wantsQgisOps = (dsl: Array<{ operation: string }>) =>
    dsl.some((step) => ["Buffer", "Coverage", "Difference", "Intersect"].includes(step.operation));

  const runQgisForPlan = async (plan: PlannerPlan) => {
    if (!isTauriRuntime()) return;
    setQgisBusy(true);
    try {
      const health = qgisHealth ?? await checkPyQgisRuntime();
      if (!health.available) {
        showToast("QGIS LTR not found — install OSGeo4W QGIS or set HEKA_QGIS_PYTHON to run Processing.");
        return;
      }
      beginExecution();
      const result = await executeSpatialPlan(plan);
      completeExecution(result);
      if (result.geojson) {
        addResolvedMapLayer({
          id: "qgis-result",
          name: result.layerName,
          kind: "candidates",
          geojson: result.geojson,
          featureCount: result.featureCount,
          outputPath: result.outputPath,
          source: "agent",
        });
      }
      showToast(`QGIS finished · ${result.featureCount} features`);
    } catch (error) {
      failExecution(error instanceof Error ? error.message : "QGIS execution failed.");
      showToast(error instanceof Error ? error.message : "QGIS execution failed.");
    } finally {
      setQgisBusy(false);
    }
  };

  const appendNote = (userText: string, answer: string) => {
    setMessages((prev) => [
      ...prev,
      { id: `u-${Date.now()}`, role: "user", text: userText },
      {
        id: `a-note-${Date.now()}`,
        role: "assistant",
        variant: "note",
        answer,
        place: lastFull.current?.place ?? "",
        confidence: lastFull.current?.confidence ?? 0,
        trace: [{ tool: "conversation", summary: "Follow-up answered from prior MapProduct (no re-run)" }],
        criteria: lastFull.current?.criteria ?? [],
        limitations: [],
        assumptions: [],
        candidates: [],
        nextActions: lastFull.current?.nextActions ?? [],
        discovery: emptyDiscovery(),
        dsl: [],
        engineNote: "",
        runtime: "conversation",
        raw: lastFull.current?.raw ?? {
          answer: "",
          location: { name: "", lat: 0, lon: 0, bbox: [0, 0, 0, 0] },
          criteria: [],
          candidates: [],
          layers: [],
          assumptions: [],
          limitations: [],
          confidence: 0,
          trace: [],
          next_actions: [],
        },
      },
    ]);
  };

  const flyToCandidate = (candidate: AssistantMessage["candidates"][0], all?: AssistantMessage["candidates"]) => {
    setSelectedCandidateId(candidate.id);
    const peers = all?.length ? all : [candidate];
    const lats = peers.map((c) => c.lat);
    const lons = peers.map((c) => c.lon);
    const latSpan = Math.max(...lats) - Math.min(...lats);
    const lonSpan = Math.max(...lons) - Math.min(...lons);
    const spanMeters = Math.max(latSpan, lonSpan) * 111_000;
    // Tight zoom on #1; slightly wider when comparing a cluster.
    const height = candidate.rank === 1
      ? Math.min(14_000, Math.max(6_500, spanMeters * 1.4 || 8_500))
      : Math.min(18_000, Math.max(8_000, spanMeters * 1.8 || 11_000));
    setCameraTarget({
      lon: candidate.lon,
      lat: candidate.lat,
      height,
      label: `#${candidate.rank}`,
    });
  };

  const applyEarthResponse = async (prompt: string, earth: EarthResponse) => {
    setLiveTrace(earth.trace.map((step) => ({ tool: `${step.tool}: ${step.summary}`, status: "done" as const })));

    if (earth.location.name && earth.location.lat !== 0) {
      setMapFocus({
        displayName: earth.location.name,
        lat: earth.location.lat,
        lon: earth.location.lon,
        west: earth.location.bbox[0],
        south: earth.location.bbox[1],
        east: earth.location.bbox[2],
        north: earth.location.bbox[3],
      });
    }

    for (const layer of earth.layers) {
      if (!layer.geojson || layer.featureCount <= 0) continue;
      addResolvedMapLayer({
        id: layer.id,
        name: layer.name,
        kind: layer.kind as MapLayerKind,
        geojson: layer.geojson,
        featureCount: layer.featureCount,
        outputPath: `earth://${layer.id}`,
        source: "agent",
      });
    }

    const candidates = earth.candidates.map((c) => ({
      id: c.id,
      rank: c.rank,
      lon: c.lon,
      lat: c.lat,
      score: c.score,
      rationale: c.rationale,
      factors: c.factors,
    }));
    setRankedCandidates(candidates);
    if (candidates[0]) flyToCandidate(candidates[0], candidates);

    const plan = earthToPlan(prompt, earth);
    applyPlan(plan);

    const assistant: AssistantMessage = {
      id: `a-${Date.now()}`,
      role: "assistant",
      variant: "full",
      answer: earth.answer,
      place: earth.location.name,
      confidence: earth.confidence,
      trace: earth.trace.map((t) => ({ tool: t.tool, summary: t.summary })),
      criteria: earth.criteria,
      limitations: earth.limitations,
      assumptions: earth.assumptions,
      candidates,
      nextActions: earth.next_actions ?? [],
      discovery: earth.discovery ?? emptyDiscovery(),
      dsl: (earth.dsl ?? []).map((d) => ({ operation: d.operation, label: d.label })),
      engineNote: earth.engineNote ?? "",
      runtime: earth.runtime ?? "open-data-tools",
      raw: earth,
    };
    lastFull.current = assistant;
    setMessages((prev) => [...prev, assistant]);

    if (isTauriRuntime() && wantsQgisOps(earth.dsl ?? [])) {
      const health = qgisHealth ?? await checkPyQgisRuntime();
      if (health.available) {
        await runQgisForPlan(plan);
      } else {
        showToast("Plan ready — install QGIS LTR to run Buffer/Coverage Processing, or keep the open-data map.");
      }
    }
  };

  const submit = async (override?: string) => {
    const prompt = (override ?? question).trim();
    if (!prompt || planner.status === "planning") return;
    if (!override) setQuestion("");

    // Conversational follow-ups from last MapProduct — do not re-run the whole agent.
    if (lastFull.current) {
      if (/explain (how )?(the )?scoring|explain scoring|how did you (score|rank)/i.test(prompt)) {
        appendNote(prompt, explainScoring(lastFull.current));
        return;
      }
      if (/compare (top )?candidates|compare (the )?sites|tradeoffs/i.test(prompt)) {
        appendNote(prompt, compareCandidates(lastFull.current));
        return;
      }
      if (/flood dataset|import flood|flood evidence/i.test(prompt)) {
        appendNote(prompt, floodGapNote(lastFull.current));
        return;
      }
    }

    setMessages((prev) => [...prev, { id: `u-${Date.now()}`, role: "user", text: prompt }]);
    beginPlanning();
    setLiveTrace(PENDING_STEPS.map((tool, index) => ({
      tool,
      status: index === 0 ? "active" : "pending",
    })));

    try {
      const earth = await askEarth(prompt);
      await applyEarthResponse(prompt, earth);
    } catch (error) {
      failPlanning(error instanceof Error ? error.message : "The Earth Agent failed unexpectedly.");
      setLiveTrace([]);
      setMessages((prev) => [
        ...prev,
        {
          id: `a-err-${Date.now()}`,
          role: "assistant",
          variant: "note",
          answer: error instanceof Error ? error.message : "The Earth Agent failed unexpectedly.",
          place: "",
          confidence: 0,
          trace: [],
          criteria: [],
          limitations: [],
          assumptions: [],
          candidates: [],
          nextActions: [],
          discovery: emptyDiscovery(),
          dsl: [],
          engineNote: "",
          runtime: "error",
          raw: {
            answer: "",
            location: { name: "", lat: 0, lon: 0, bbox: [0, 0, 0, 0] },
            criteria: [],
            candidates: [],
            layers: [],
            assumptions: [],
            limitations: [],
            confidence: 0,
            trace: [],
            next_actions: [],
          },
        },
      ]);
    }
  };

  const onNextAction = (action: EarthNextAction, message: AssistantMessage) => {
    if (action.action === "export_geojson") {
      exportEarthGeoJson(message.raw);
      showToast("Exported GeoJSON.");
      return;
    }
    if (action.action === "explain_scoring") {
      appendNote("Explain scoring", explainScoring(message));
      return;
    }
    if (action.action === "compare_candidates") {
      if (message.candidates.length) {
        appendNote("Compare top candidates", compareCandidates(message));
      } else {
        void submit("Where should Calgary build its next hospital considering population, roads, flood risk, and growth?");
      }
      return;
    }
    if (action.action === "import_flood") {
      appendNote("Import flood dataset", floodGapNote(message));
      return;
    }
    if (action.action === "route_access") {
      void submit(`Run road-access / drive-time analysis for the top sites in ${message.place || "this place"}.`);
      return;
    }
  };

  const renderAssistant = (message: AssistantMessage) => {
    const focused = message.candidates.find((c) => c.id === (selectedCandidateId ?? message.candidates[0]?.id));
    return (
      <article className={`assistant-message ${message.variant === "note" ? "assistant-note" : ""}`} key={message.id}>
        <p className="assistant-kicker"><Sparkles size={13} /> {message.variant === "note" ? "Follow-up" : "Answer"}</p>
        <div className="assistant-answer">{formatAnswer(message.answer)}</div>

        {message.variant === "full" && (message.place || message.confidence > 0) && (
          <div className="plan-meta">
            {message.place && <span>{message.place}</span>}
            {message.confidence > 0 && <span>{message.confidence}% confidence</span>}
          </div>
        )}

        {message.variant === "full" && focused && message.candidates.length > 0 && (
          <p className="focus-line">
            <MapPinned size={13} /> Focusing <b>#{focused.rank}</b> · score {focused.score.toFixed(3)} · {focused.lat.toFixed(4)}, {focused.lon.toFixed(4)}
          </p>
        )}

        {message.variant === "full" && message.candidates.length > 0 && (
          <div className="candidate-list compact">
            {message.candidates.map((candidate) => (
              <button
                key={candidate.id}
                type="button"
                className={`candidate-row ${selectedCandidateId === candidate.id || (!selectedCandidateId && candidate.rank === 1) ? "selected" : ""}`}
                onClick={() => flyToCandidate(candidate, message.candidates)}
              >
                <span className={candidate.rank === 1 ? "rank top" : "rank"}>#{candidate.rank}</span>
                <span className="cand-meta">
                  <b>{candidate.score.toFixed(3)}</b>
                  <em>{candidate.lat.toFixed(4)}, {candidate.lon.toFixed(4)}</em>
                </span>
                <Crosshair size={13} />
              </button>
            ))}
          </div>
        )}

        {message.variant === "full" && isTauriRuntime() && wantsQgisOps(message.dsl) && (
          <div className="next-actions">
            <button
              type="button"
              className="next-action qgis-action"
              disabled={qgisBusy || planner.status === "planning"}
              onClick={() => {
                const plan = planner.plan ?? earthToPlan(message.place || "analysis", message.raw);
                void runQgisForPlan(plan);
              }}
            >
              {qgisBusy ? "Running QGIS…" : qgisHealth?.available === false ? "QGIS unavailable — install LTR" : "Run in QGIS"}
            </button>
          </div>
        )}

        {message.nextActions.length > 0 && message.variant === "full" && (
          <div className="next-actions">
            {message.nextActions.map((action) => (
              <button key={action.action} type="button" className="next-action" onClick={() => onNextAction(action, message)}>
                {action.label}
              </button>
            ))}
          </div>
        )}

        {message.variant === "full" && (
          <>
            {(message.discovery.need.length > 0 || message.discovery.found.length > 0) && (
              <details className="thinking-details">
                <summary><span>Dataset discovery</span><small>{message.discovery.found.length} found</small><ChevronRight size={14} /></summary>
                <div className="thinking-body discovery-card">
                  {message.discovery.need.length > 0 && (
                    <p><b>Need</b>{message.discovery.need.map((item) => <span key={item.id} className="chip need">{item.label}</span>)}</p>
                  )}
                  {message.discovery.found.length > 0 && (
                    <p><b>Found</b>{message.discovery.found.map((item) => <span key={item.id} className="chip found">✓ {item.label}{item.featureCount != null ? ` (${item.featureCount})` : ""}</span>)}</p>
                  )}
                  {message.discovery.missing.length > 0 && (
                    <p><b>Gaps</b>{message.discovery.missing.map((item) => <span key={item.id} className="chip missing">⚠ {item.label}</span>)}</p>
                  )}
                </div>
              </details>
            )}

            <details className="thinking-details">
              <summary><Cpu size={14} /><span>Thinking</span><small>{message.trace.length} steps</small><ChevronRight size={14} /></summary>
              <div className="thinking-body">
                <ul className="agent-progress static">
                  {message.trace.map((step) => (
                    <li key={`${step.tool}-${step.summary}`} className="done">
                      <Check size={13} />
                      <span><b>{step.tool}</b> — {step.summary}</span>
                    </li>
                  ))}
                </ul>
                {message.dsl.length > 0 && (
                  <p><b>Spatial DSL</b>{message.dsl.map((step) => <span key={step.label}>{step.operation}: {step.label}</span>)}</p>
                )}
                {message.assumptions.length > 0 && (
                  <details className="inner-details"><summary>Assumptions</summary>{message.assumptions.map((item) => <p key={item}>{item}</p>)}</details>
                )}
                {message.limitations.length > 0 && (
                  <details className="inner-details"><summary>Next direction</summary>{message.limitations.map((item) => <p key={item}>{item}</p>)}</details>
                )}
                {message.engineNote && <p className="engine-note">{message.engineNote}</p>}
              </div>
            </details>
          </>
        )}

        {message.variant === "note" && message.trace.length > 0 && (
          <p className="engine-note">{message.trace[0]?.summary}</p>
        )}
      </article>
    );
  };

  return <aside className="chat-panel">
    <header className="chat-header">
      <div><img src={logo} alt="" /><span>Earth Agent</span></div>
      <span className="agent-badge" title="Researches the question, then runs spatial analysis when needed">Research → Analyze</span>
    </header>
    <div className="chat-thread" ref={threadRef}>
      {messages.length === 0 && planner.status !== "planning" && (
        <div className="chat-welcome">
          <div className="welcome-mark"><img src={logo} alt="Heka" /></div>
          <h1>Ask Earth</h1>
          <p>Ask a question about the physical world. Heka finds the data, runs spatial analysis when needed, and explains the result.</p>
          <p className="welcome-label">Try asking:</p>
          <ul className="welcome-prompts">
            {WELCOME_PROMPTS.map((prompt) => (
              <li key={prompt}>
                <button type="button" onClick={() => void submit(prompt)}>{prompt}</button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {messages.map((message) => message.role === "user"
        ? <article className="user-message" key={message.id}>{message.text}</article>
        : (() => {
            const assistant = asAssistant(message);
            return assistant ? renderAssistant(assistant) : null;
          })())}

      {planner.status === "planning" && (
        <article className="assistant-message thinking-live progress-card">
          <div className="progress-head"><LoaderCircle className="spin" size={15} /> Working…</div>
          <ul className="agent-progress">
            {liveTrace.map((step) => (
              <li key={step.tool} className={step.status}>
                {step.status === "done" ? <Check size={13} /> : step.status === "active" ? <LoaderCircle className="spin" size={13} /> : <CircleDashed size={13} />}
                <span>{step.tool}</span>
              </li>
            ))}
          </ul>
        </article>
      )}

      {planner.error && <article className="chat-error"><CircleAlert size={15} /><span>{planner.error}</span></article>}

      {selectedFeature && (
        <aside className="feature-inspect">
          <b>{selectedFeature.layerName}</b>
          {Object.entries(selectedFeature.properties).slice(0, 5).map(([key, value]) => (
            <p key={key}><em>{key}</em> {String(value)}</p>
          ))}
        </aside>
      )}
    </div>
    <form className="chat-composer" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <textarea
        aria-label="Spatial question"
        value={question}
        onChange={(event) => setQuestion(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            void submit();
          }
        }}
        placeholder="Ask about cities, infrastructure, disasters, conservation, or upload your own GIS data…"
        rows={3}
      />
      <div>
        <span>Enter to send · conversation keeps history</span>
        <button type="submit" disabled={!question.trim() || planner.status === "planning"} title="Ask Earth"><ArrowUp size={17} /></button>
      </div>
    </form>
  </aside>;
}
