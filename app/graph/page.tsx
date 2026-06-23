"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type GraphNode = {
  id: string;
  label: string;
  type: "topic" | "paper";
  topic: string | null;
  citations?: number;
  url?: string;
};
type GraphEdge = { source: string; target: string; kind: string };
type GraphData = { nodes: GraphNode[]; edges: GraphEdge[] };

type SimNode = GraphNode & {
  x: number;
  y: number;
  vx: number;
  vy: number;
  aAngle: number;
  aRadius: number;
  count?: number;
};

const PALETTE = [
  "#22d3ee", "#818cf8", "#34d399", "#fbbf24", "#f472b6",
  "#a78bfa", "#2dd4bf", "#fb923c", "#60a5fa", "#f87171",
  "#4ade80", "#e879f9", "#38bdf8", "#facc15", "#c084fc",
];

function colorFor(slug: string | null, map: Map<string, string>): string {
  return slug ? map.get(slug) ?? "#8b93a7" : "#8b93a7";
}

export default function GraphPage() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const [data, setData] = useState<GraphData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [focus, setFocus] = useState<string>(""); // topic slug or "" for all
  const [showRelations, setShowRelations] = useState(true);

  const showRelRef = useRef(showRelations);
  useEffect(() => {
    showRelRef.current = showRelations;
  }, [showRelations]);

  // Stable slug -> color map across the whole dataset.
  const colorMap = useMemo(() => {
    const map = new Map<string, string>();
    if (!data) return map;
    const slugs = Array.from(
      new Set(data.nodes.map((n) => n.topic).filter((t): t is string => !!t)),
    ).sort();
    slugs.forEach((s, i) => map.set(s, PALETTE[i % PALETTE.length]));
    return map;
  }, [data]);
  const colorMapRef = useRef(colorMap);
  useEffect(() => {
    colorMapRef.current = colorMap;
  }, [colorMap]);

  // Topics + counts for the legend / filter.
  const topicList = useMemo(() => {
    if (!data) return [] as { slug: string; name: string; count: number }[];
    const counts = new Map<string, number>();
    for (const n of data.nodes)
      if (n.type === "paper" && n.topic) counts.set(n.topic, (counts.get(n.topic) ?? 0) + 1);
    const out: { slug: string; name: string; count: number }[] = [];
    for (const n of data.nodes)
      if (n.type === "topic" && n.topic)
        out.push({ slug: n.topic, name: n.label, count: counts.get(n.topic) ?? 0 });
    return out.sort((a, b) => b.count - a.count);
  }, [data]);

  // The visible slice: optionally focused on one topic. Membership edges are
  // never included — only paper<->paper relations.
  const view = useMemo(() => {
    if (!data) return { nodes: [] as GraphNode[], edges: [] as GraphEdge[] };
    let nodes = data.nodes;
    if (focus) nodes = nodes.filter((n) => n.topic === focus);
    const ids = new Set(nodes.map((n) => n.id));
    const edges = data.edges.filter(
      (e) => e.kind !== "topic" && ids.has(e.source) && ids.has(e.target),
    );
    return { nodes, edges };
  }, [data, focus]);

  const nodesRef = useRef<SimNode[]>([]);
  const edgesRef = useRef<GraphEdge[]>([]);
  const byIdRef = useRef<Map<string, SimNode>>(new Map());
  const transformRef = useRef({ offsetX: 0, offsetY: 0, scale: 1 });
  const dragRef = useRef({ panning: false, lastX: 0, lastY: 0 });
  const hoverRef = useRef<SimNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const sizeRef = useRef({ w: 800, h: 600 });

  useEffect(() => {
    let cancelled = false;
    fetch("/api/graph?limit=140")
      .then((r) => {
        if (!r.ok) throw new Error("Request failed: " + r.status);
        return r.json();
      })
      .then((d: GraphData) => {
        if (!cancelled) setData(d);
      })
      .catch((e) => !cancelled && setError(String(e?.message ?? e)));
    return () => {
      cancelled = true;
    };
  }, []);

  // Build + run the simulation. Re-inits when the visible slice changes.
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    function resize() {
      if (!canvas || !container) return;
      const rect = container.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const w = Math.max(1, Math.floor(rect.width));
      const h = Math.max(1, Math.floor(rect.height));
      sizeRef.current = { w, h };
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = w + "px";
      canvas.style.height = h + "px";
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();
    window.addEventListener("resize", resize);

    // Assign each present topic a slot on a ring; papers cluster on their topic.
    const present = Array.from(
      new Set(view.nodes.map((n) => n.topic).filter((t): t is string => !!t)),
    ).sort();
    const K = present.length;
    const anchor = new Map<string, { angle: number; radius: number }>();
    present.forEach((s, i) => {
      anchor.set(s, { angle: (i / Math.max(1, K)) * Math.PI * 2 - Math.PI / 2, radius: K <= 1 ? 0 : 0.34 });
    });

    const counts = new Map<string, number>();
    for (const n of view.nodes)
      if (n.type === "paper" && n.topic) counts.set(n.topic, (counts.get(n.topic) ?? 0) + 1);

    const { w, h } = sizeRef.current;
    const cx = w / 2;
    const cy = h / 2;
    const minDim = Math.min(w, h);
    const sims: SimNode[] = view.nodes.map((n) => {
      const a = anchor.get(n.topic ?? "") ?? { angle: 0, radius: 0 };
      const ax = cx + Math.cos(a.angle) * minDim * a.radius;
      const ay = cy + Math.sin(a.angle) * minDim * a.radius;
      return {
        ...n,
        aAngle: a.angle,
        aRadius: a.radius,
        count: n.type === "topic" ? counts.get(n.topic ?? "") ?? 0 : undefined,
        x: ax + (Math.random() - 0.5) * 70,
        y: ay + (Math.random() - 0.5) * 70,
        vx: 0,
        vy: 0,
      };
    });
    nodesRef.current = sims;
    edgesRef.current = view.edges;
    const byId = new Map<string, SimNode>();
    for (const s of sims) byId.set(s.id, s);
    byIdRef.current = byId;
    // Reset the view transform on (re)build.
    transformRef.current = { offsetX: 0, offsetY: 0, scale: 1 };

    const REPULSION = 1500;
    const REPULSION_CAP = 500;
    const RELATION_LEN = 95;
    const RELATION_SPRING = 0.03;
    const DAMPING = 0.85;
    const ENERGY_FLOOR = 0.02;

    function radiusOf(n: SimNode): number {
      if (n.type === "topic") return 10 + Math.min(9, Math.sqrt(n.count ?? 0) * 1.6);
      return 3.5 + Math.min(7, Math.log10((n.citations ?? 0) + 1) * 2.4);
    }

    function step() {
      const nodes = nodesRef.current;
      const edges = edgesRef.current;
      const byId2 = byIdRef.current;
      const { w: ww, h: hh } = sizeRef.current;
      const cx2 = ww / 2;
      const cy2 = hh / 2;
      const md = Math.min(ww, hh);

      for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i];
        for (let j = i + 1; j < nodes.length; j++) {
          const b = nodes[j];
          let dx = a.x - b.x;
          let dy = a.y - b.y;
          let d2 = dx * dx + dy * dy;
          if (d2 < 0.01) {
            dx = (Math.random() - 0.5) * 0.5;
            dy = (Math.random() - 0.5) * 0.5;
            d2 = dx * dx + dy * dy + 0.01;
          }
          const d = Math.sqrt(d2);
          let force = REPULSION / d2;
          if (force > REPULSION_CAP) force = REPULSION_CAP;
          const fx = (dx / d) * force;
          const fy = (dy / d) * force;
          a.vx += fx;
          a.vy += fy;
          b.vx -= fx;
          b.vy -= fy;
        }
      }

      // Relation springs (paper<->paper only).
      for (const e of edges) {
        const s = byId2.get(e.source);
        const t = byId2.get(e.target);
        if (!s || !t) continue;
        let dx = t.x - s.x;
        let dy = t.y - s.y;
        const d = Math.sqrt(dx * dx + dy * dy) || 0.01;
        const force = (d - RELATION_LEN) * RELATION_SPRING;
        const fx = (dx / d) * force;
        const fy = (dy / d) * force;
        s.vx += fx;
        s.vy += fy;
        t.vx -= fx;
        t.vy -= fy;
      }

      // Anchor pull: topics snap to their ring slot; papers cluster on it.
      let energy = 0;
      for (const n of nodes) {
        const ax = cx2 + Math.cos(n.aAngle) * md * n.aRadius;
        const ay = cy2 + Math.sin(n.aAngle) * md * n.aRadius;
        const pull = n.type === "topic" ? 0.09 : 0.022;
        n.vx += (ax - n.x) * pull;
        n.vy += (ay - n.y) * pull;
        n.vx *= DAMPING;
        n.vy *= DAMPING;
        n.x += n.vx;
        n.y += n.vy;
        energy += n.vx * n.vx + n.vy * n.vy;
      }
      return nodes.length ? energy / nodes.length : 0;
    }

    function toScreen(x: number, y: number) {
      const t = transformRef.current;
      return { x: x * t.scale + t.offsetX, y: y * t.scale + t.offsetY };
    }

    function draw() {
      if (!ctx) return;
      const { w: ww, h: hh } = sizeRef.current;
      const t = transformRef.current;
      const nodes = nodesRef.current;
      const edges = edgesRef.current;
      const byId2 = byIdRef.current;
      const cmap = colorMapRef.current;
      ctx.clearRect(0, 0, ww, hh);

      if (showRelRef.current) {
        ctx.lineWidth = 1;
        ctx.strokeStyle = "rgba(129,140,248,0.30)";
        for (const e of edges) {
          const s = byId2.get(e.source);
          const tn = byId2.get(e.target);
          if (!s || !tn) continue;
          const p1 = toScreen(s.x, s.y);
          const p2 = toScreen(tn.x, tn.y);
          ctx.beginPath();
          ctx.moveTo(p1.x, p1.y);
          ctx.lineTo(p2.x, p2.y);
          ctx.stroke();
        }
      }

      // Paper nodes first, topic hubs on top.
      for (const pass of ["paper", "topic"] as const) {
        for (const n of nodes) {
          if (n.type !== pass) continue;
          const p = toScreen(n.x, n.y);
          const r = radiusOf(n) * t.scale;
          const color = colorFor(n.topic, cmap);
          ctx.beginPath();
          ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
          ctx.shadowColor = color;
          ctx.shadowBlur = n.type === "topic" ? 20 : 7;
          ctx.fillStyle = color;
          ctx.fill();
          ctx.shadowBlur = 0;
          if (n.type === "topic") {
            ctx.lineWidth = 2;
            ctx.strokeStyle = "rgba(11,13,18,0.9)";
            ctx.stroke();
          }
        }
      }
      ctx.shadowBlur = 0;

      // Topic labels with counts.
      ctx.font = "600 12px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      for (const n of nodes) {
        if (n.type !== "topic") continue;
        const p = toScreen(n.x, n.y);
        const r = radiusOf(n) * t.scale;
        const text = `${n.label} (${n.count ?? 0})`;
        ctx.lineWidth = 3;
        ctx.strokeStyle = "rgba(11,13,18,0.85)";
        ctx.strokeText(text, p.x, p.y - r - 9);
        ctx.fillStyle = "#e6e8ee";
        ctx.fillText(text, p.x, p.y - r - 9);
      }

      const hov = hoverRef.current;
      if (hov && hov.type === "paper") {
        const p = toScreen(hov.x, hov.y);
        const label = hov.label.length > 84 ? hov.label.slice(0, 83) + "…" : hov.label;
        ctx.font = "12px system-ui, sans-serif";
        const padX = 9;
        const tw = ctx.measureText(label).width;
        const boxW = tw + padX * 2;
        const boxH = 24;
        let bx = p.x + 10;
        let by = p.y - boxH - 6;
        if (bx + boxW > ww) bx = ww - boxW - 4;
        if (by < 0) by = p.y + 12;
        ctx.shadowColor = "rgba(0,0,0,0.5)";
        ctx.shadowBlur = 12;
        ctx.shadowOffsetY = 3;
        ctx.fillStyle = "#14171f";
        ctx.beginPath();
        ctx.roundRect(bx, by, boxW, boxH, 7);
        ctx.fill();
        ctx.shadowColor = "transparent";
        ctx.shadowBlur = 0;
        ctx.shadowOffsetY = 0;
        ctx.lineWidth = 1;
        ctx.strokeStyle = "#262b36";
        ctx.beginPath();
        ctx.roundRect(bx, by, boxW, boxH, 7);
        ctx.stroke();
        ctx.fillStyle = "#e6e8ee";
        ctx.textAlign = "left";
        ctx.fillText(label, bx + padX, by + boxH / 2);
        ctx.textAlign = "center";
      }
    }

    let running = true;
    let settled = false;
    function frame() {
      if (!running) return;
      if (!settled) {
        if (step() < ENERGY_FLOOR) settled = true;
      }
      draw();
      rafRef.current = requestAnimationFrame(frame);
    }
    rafRef.current = requestAnimationFrame(frame);

    function screenToWorld(sx: number, sy: number) {
      const t = transformRef.current;
      return { x: (sx - t.offsetX) / t.scale, y: (sy - t.offsetY) / t.scale };
    }
    function pickNode(sx: number, sy: number): SimNode | null {
      const world = screenToWorld(sx, sy);
      let best: SimNode | null = null;
      let bestD = Infinity;
      for (const n of nodesRef.current) {
        const dx = n.x - world.x;
        const dy = n.y - world.y;
        const d = Math.sqrt(dx * dx + dy * dy);
        const hitR = (n.type === "topic" ? 14 : 8) + 4;
        if (d < hitR && d < bestD) {
          bestD = d;
          best = n;
        }
      }
      return best;
    }
    function relPos(ev: MouseEvent) {
      const rect = canvas!.getBoundingClientRect();
      return { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
    }
    function onMouseDown(ev: MouseEvent) {
      const { x, y } = relPos(ev);
      dragRef.current = { panning: true, lastX: x, lastY: y };
    }
    function onMouseMove(ev: MouseEvent) {
      const { x, y } = relPos(ev);
      if (dragRef.current.panning) {
        const t = transformRef.current;
        t.offsetX += x - dragRef.current.lastX;
        t.offsetY += y - dragRef.current.lastY;
        dragRef.current.lastX = x;
        dragRef.current.lastY = y;
        hoverRef.current = null;
      } else {
        hoverRef.current = pickNode(x, y);
        if (canvas) canvas.style.cursor = hoverRef.current ? "pointer" : "grab";
      }
      if (settled) draw();
    }
    function onMouseUp() {
      dragRef.current.panning = false;
    }
    function onClick(ev: MouseEvent) {
      const { x, y } = relPos(ev);
      const n = pickNode(x, y);
      if (n && n.type === "paper" && n.url) window.open(n.url, "_blank", "noopener,noreferrer");
    }
    function onWheel(ev: WheelEvent) {
      ev.preventDefault();
      const { x, y } = relPos(ev);
      const t = transformRef.current;
      const world = screenToWorld(x, y);
      const factor = ev.deltaY < 0 ? 1.1 : 1 / 1.1;
      const ns = Math.min(4, Math.max(0.2, t.scale * factor));
      t.offsetX = x - world.x * ns;
      t.offsetY = y - world.y * ns;
      t.scale = ns;
      if (settled) draw();
    }

    canvas.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    canvas.addEventListener("click", onClick);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.style.cursor = "grab";

    return () => {
      running = false;
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      window.removeEventListener("resize", resize);
      canvas.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      canvas.removeEventListener("click", onClick);
      canvas.removeEventListener("wheel", onWheel);
    };
  }, [view]);

  const isEmpty = data != null && data.nodes.length === 0;
  const relationCount = view.edges.length;

  const selectStyle = { padding: "7px 10px", maxWidth: 220 } as const;

  return (
    <div style={{ color: "var(--text)" }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, margin: "0 0 6px" }}>🕸️ Knowledge graph</h1>
      <p style={{ color: "var(--muted)", margin: "0 0 16px", fontSize: 13 }}>
        Papers clustered by topic; lines show paper-to-paper relations (cites / similar).
        Drag to pan, scroll to zoom, hover for titles, click a paper to open it.
      </p>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", marginBottom: 14 }}>
        <select
          className="input"
          style={selectStyle}
          value={focus}
          onChange={(e) => setFocus(e.target.value)}
        >
          <option value="">All topics</option>
          {topicList.map((t) => (
            <option key={t.slug} value={t.slug}>
              {t.name} ({t.count})
            </option>
          ))}
        </select>
        <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 14, color: "var(--muted)", cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={showRelations}
            onChange={(e) => setShowRelations(e.target.checked)}
          />
          Show connections{relationCount ? ` (${relationCount})` : ""}
        </label>
      </div>

      {error && (
        <div
          style={{
            color: "var(--danger)",
            fontSize: 13,
            marginBottom: 12,
            padding: "10px 14px",
            borderRadius: 10,
            background: "rgba(248,113,113,0.08)",
            border: "1px solid rgba(248,113,113,0.25)",
          }}
        >
          Failed to load graph: {error}
        </div>
      )}

      <div className="fade-in">
        <div
          ref={containerRef}
          className="card"
          style={{
            position: "relative",
            width: "100%",
            height: "72vh",
            background: "#0d1018",
            overflow: "hidden",
            boxShadow: "inset 0 0 60px rgba(0,0,0,0.35)",
          }}
        >
          <canvas ref={canvasRef} style={{ display: "block" }} />
          {isEmpty && (
            <Overlay>No graph data yet — ingest some papers first.</Overlay>
          )}
          {!data && !error && (
            <Overlay>
              <span className="spinner" /> Loading…
            </Overlay>
          )}
        </div>

        {topicList.length > 0 && (
          <div
            className="card"
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 14,
              marginTop: 16,
              padding: "12px 16px",
              fontSize: 12,
              background: "var(--surface)",
            }}
          >
            {topicList.map((l) => (
              <button
                key={l.slug}
                onClick={() => setFocus(focus === l.slug ? "" : l.slug)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 7,
                  background: "transparent",
                  border: "none",
                  color: focus && focus !== l.slug ? "var(--muted)" : "var(--text)",
                  cursor: "pointer",
                  font: "inherit",
                  fontSize: 12,
                  opacity: focus && focus !== l.slug ? 0.5 : 1,
                }}
              >
                <span
                  style={{
                    width: 12,
                    height: 12,
                    borderRadius: 6,
                    background: colorMap.get(l.slug) ?? "#888",
                    boxShadow: `0 0 8px ${colorMap.get(l.slug) ?? "#888"}`,
                    border: "1px solid rgba(255,255,255,0.15)",
                  }}
                />
                {l.name} ({l.count})
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Overlay({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 10,
        color: "var(--muted)",
        fontSize: 14,
      }}
    >
      {children}
    </div>
  );
}
