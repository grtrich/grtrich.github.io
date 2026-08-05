/* ==========================================================
   BeamSheet — client-side beam analysis
   Statically determinate beams: simply supported (pin+roller)
   or cantilever (single fixed support).
   ========================================================== */

(function () {
  "use strict";

  const SVGNS = "http://www.w3.org/2000/svg";

  // ---------------------------------------------------------
  // State
  // ---------------------------------------------------------
  const state = {
    length: 20,
    lengthUnit: "ft",
    forceUnit: "lb",
    supportType: "simple", // 'simple' | 'cantilever'
    supportA: 0,
    supportB: 20,
    fixedEnd: "left", // 'left' | 'right'
    loads: [], // {id, type:'point'|'udl'|'moment', ...}
    nextId: 1,
  };

  let lastResult = null; // cached calculation output

  // ---------------------------------------------------------
  // DOM refs
  // ---------------------------------------------------------
  const el = (id) => document.getElementById(id);
  const form = el("beamForm");
  const loadTypeSel = el("loadType");
  const pointFields = el("pointFields");
  const udlFields = el("udlFields");
  const momentFields = el("momentFields");
  const loadListEl = el("loadList");
  const supportTypeToggle = el("supportTypeToggle");
  const simpleSupportFields = el("simpleSupportFields");
  const cantileverFields = el("cantileverFields");
  const reactionsOut = el("reactionsOut");

  // ---------------------------------------------------------
  // UI wiring
  // ---------------------------------------------------------
  loadTypeSel.addEventListener("change", () => {
    const t = loadTypeSel.value;
    pointFields.classList.toggle("hidden", t !== "point");
    udlFields.classList.toggle("hidden", t !== "udl");
    momentFields.classList.toggle("hidden", t !== "moment");
  });

  supportTypeToggle.addEventListener("click", (e) => {
    const btn = e.target.closest(".toggle-btn");
    if (!btn) return;
    [...supportTypeToggle.children].forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    state.supportType = btn.dataset.value;
    simpleSupportFields.classList.toggle("hidden", state.supportType !== "simple");
    cantileverFields.classList.toggle("hidden", state.supportType !== "cantilever");
  });

  el("addLoadBtn").addEventListener("click", () => {
    const type = loadTypeSel.value;
    const L = parseFloat(el("beamLength").value) || 0;
    let load = null;

    if (type === "point") {
      const position = clamp(parseFloat(el("pPos").value), 0, L);
      const magnitude = parseFloat(el("pMag").value) || 0;
      load = { id: state.nextId++, type, position, magnitude };
    } else if (type === "udl") {
      let start = clamp(parseFloat(el("uStart").value), 0, L);
      let end = clamp(parseFloat(el("uEnd").value), 0, L);
      if (end < start) [start, end] = [end, start];
      const magnitude = parseFloat(el("uMag").value) || 0;
      load = { id: state.nextId++, type, start, end, magnitude };
    } else if (type === "moment") {
      const position = clamp(parseFloat(el("mPos").value), 0, L);
      const magnitude = parseFloat(el("mMag").value) || 0;
      const direction = el("mDir").value;
      load = { id: state.nextId++, type, position, magnitude, direction };
    }

    if (load) {
      state.loads.push(load);
      renderLoadList();
    }
  });

  loadListEl.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-id]");
    if (!btn) return;
    const id = parseInt(btn.dataset.id, 10);
    state.loads = state.loads.filter((l) => l.id !== id);
    renderLoadList();
  });

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    calculate();
  });

  function clamp(v, min, max) {
    if (isNaN(v)) return min;
    return Math.min(Math.max(v, min), max);
  }

  function fmt(n) {
    if (!isFinite(n)) return "0";
    const r = Math.round(n * 100) / 100;
    return r.toString();
  }

  function renderLoadList() {
    loadListEl.innerHTML = "";
    state.loads.forEach((l) => {
      const li = document.createElement("li");
      let text = "";
      if (l.type === "point") {
        text = `<span class="tag">Point</span>${fmt(l.magnitude)} ${state.forceUnit} @ x=${fmt(l.position)}`;
      } else if (l.type === "udl") {
        text = `<span class="tag">UDL</span>${fmt(l.magnitude)} ${state.forceUnit}/${state.lengthUnit} [${fmt(l.start)} \u2192 ${fmt(l.end)}]`;
      } else if (l.type === "moment") {
        text = `<span class="tag">Moment</span>${fmt(l.magnitude)} ${state.forceUnit}\u00b7${state.lengthUnit} (${l.direction.toUpperCase()}) @ x=${fmt(l.position)}`;
      }
      li.innerHTML = `<span>${text}</span><button type="button" data-id="${l.id}" aria-label="Remove load" title="Remove">\u00d7</button>`;
      loadListEl.appendChild(li);
    });
  }

  // ---------------------------------------------------------
  // Statics engine
  // ---------------------------------------------------------
  function computeReactions(L, loads) {
    if (state.supportType === "simple") {
      const xA = clamp(state.supportA, 0, L);
      const xB = clamp(state.supportB, 0, L);
      const span = xB - xA;
      if (Math.abs(span) < 1e-9) return null;

      let momentAboutA = 0; // CW positive
      let totalDown = 0;
      loads.forEach((l) => {
        if (l.type === "point") {
          momentAboutA += l.magnitude * (l.position - xA);
          totalDown += l.magnitude;
        } else if (l.type === "udl") {
          const total = l.magnitude * (l.end - l.start);
          const xc = (l.start + l.end) / 2;
          momentAboutA += total * (xc - xA);
          totalDown += total;
        } else if (l.type === "moment") {
          momentAboutA += l.direction === "cw" ? l.magnitude : -l.magnitude;
        }
      });

      const RB = momentAboutA / span;
      const RA = totalDown - RB;

      return {
        kind: "simple",
        xA,
        xB,
        RA,
        RB,
        forces: [
          { x: xA, F: RA },
          { x: xB, F: RB },
        ],
        moments: [],
        summary: [
          { label: `R\u2090 @ x=${fmt(xA)}`, value: RA },
          { label: `R_b @ x=${fmt(xB)}`, value: RB },
        ],
      };
    }

    // Cantilever
    const pivot = state.fixedEnd === "left" ? 0 : L;
    let momentAboutPivot = 0; // CW positive
    let totalDown = 0;
    loads.forEach((l) => {
      if (l.type === "point") {
        momentAboutPivot += l.magnitude * (l.position - pivot);
        totalDown += l.magnitude;
      } else if (l.type === "udl") {
        const total = l.magnitude * (l.end - l.start);
        const xc = (l.start + l.end) / 2;
        momentAboutPivot += total * (xc - pivot);
        totalDown += total;
      } else if (l.type === "moment") {
        momentAboutPivot += l.direction === "cw" ? l.magnitude : -l.magnitude;
      }
    });

    const R = totalDown;
    const Mfix = -momentAboutPivot; // reaction moment, CW-positive convention

    return {
      kind: "cantilever",
      pivot,
      R,
      Mfix,
      forces: [{ x: pivot, F: R }],
      moments: [{ x: pivot, M: Mfix }],
      summary: [
        { label: `R @ x=${fmt(pivot)}`, value: R },
        { label: `M_fix @ x=${fmt(pivot)}`, value: Mfix, isMoment: true },
      ],
    };
  }

  function buildForcesAndMoments(reactions, loads) {
    const forces = [...reactions.forces];
    const moments = [...reactions.moments];

    loads.forEach((l) => {
      if (l.type === "point") {
        forces.push({ x: l.position, F: -l.magnitude });
      } else if (l.type === "udl") {
        const n = 240;
        const span = l.end - l.start;
        if (span > 1e-9) {
          const dx = span / n;
          for (let i = 0; i < n; i++) {
            const xc = l.start + dx * (i + 0.5);
            forces.push({ x: xc, F: -l.magnitude * dx });
          }
        }
      } else if (l.type === "moment") {
        moments.push({ x: l.position, M: l.direction === "cw" ? -l.magnitude : l.magnitude });
      }
    });

    forces.sort((a, b) => a.x - b.x);
    moments.sort((a, b) => a.x - b.x);
    return { forces, moments };
  }

  function computeDiagram(L, forces, moments, N) {
    N = N || 480;
    const xs = new Array(N + 1);
    const Vs = new Array(N + 1);
    const Ms = new Array(N + 1);
    const EPS = 1e-7;

    for (let i = 0; i <= N; i++) {
      const x = (L * i) / N;
      let V = 0,
        M = 0;
      for (let k = 0; k < forces.length; k++) {
        const f = forces[k];
        if (f.x <= x + EPS) {
          V += f.F;
          M += f.F * (x - f.x);
        }
      }
      for (let k = 0; k < moments.length; k++) {
        const m = moments[k];
        if (m.x <= x + EPS) M += m.M;
      }
      xs[i] = x;
      Vs[i] = V;
      Ms[i] = M;
    }
    return { xs, Vs, Ms };
  }

  function extremum(arr, xs, mode) {
    let idx = 0;
    for (let i = 1; i < arr.length; i++) {
      if (mode === "max" ? arr[i] > arr[idx] : arr[i] < arr[idx]) idx = i;
    }
    return { x: xs[idx], v: arr[idx] };
  }

  // ---------------------------------------------------------
  // Main calculate
  // ---------------------------------------------------------
  function calculate() {
    state.length = parseFloat(el("beamLength").value) || 0;
    state.lengthUnit = el("lengthUnit").value || "ft";
    state.forceUnit = el("forceUnit").value || "lb";
    if (state.supportType === "simple") {
      state.supportA = clamp(parseFloat(el("supportA").value), 0, state.length);
      state.supportB = clamp(parseFloat(el("supportB").value), 0, state.length);
    } else {
      state.fixedEnd = el("fixedEnd").value;
    }

    const L = state.length;
    if (!(L > 0)) {
      reactionsOut.innerHTML = `<p style="color:var(--coral)">Enter a beam length greater than zero.</p>`;
      return;
    }

    const reactions = computeReactions(L, state.loads);
    if (!reactions) {
      reactionsOut.innerHTML = `<p style="color:var(--coral)">Support A and Support B can't be at the same position.</p>`;
      return;
    }

    const { forces, moments } = buildForcesAndMoments(reactions, state.loads);
    const diagram = computeDiagram(L, forces, moments);

    lastResult = { L, reactions, diagram };

    renderReactions(reactions);
    drawBeamDiagram(el("beamSvg"), L, state.loads, reactions, false);
    drawBeamDiagram(el("fbdSvg"), L, state.loads, reactions, true);
    drawChart(el("sfdSvg"), diagram.xs, diagram.Vs, {
      color: "var(--teal)",
      colorNeg: "var(--coral)",
      unit: `${state.forceUnit}`,
      title: "V",
    });
    drawChart(el("bmdSvg"), diagram.xs, diagram.Ms, {
      color: "var(--amber)",
      colorNeg: "var(--coral)",
      unit: `${state.forceUnit}\u00b7${state.lengthUnit}`,
      title: "M",
    });
  }

  function renderReactions(reactions) {
    const cards = reactions.summary
      .map(
        (s) => `
      <div class="reaction-card">
        <div class="label">${s.label}</div>
        <div class="value ${s.isMoment ? "small" : ""}">${fmt(s.value)} ${
          s.isMoment ? state.forceUnit + "\u00b7" + state.lengthUnit : state.forceUnit
        }</div>
      </div>`
      )
      .join("");
    reactionsOut.innerHTML = `<div class="reactions-grid">${cards}</div>`;
  }

  // ===========================================================
  // Drawing helpers (shared)
  // ===========================================================
  function svgEl(tag, attrs) {
    const n = document.createElementNS(SVGNS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    return n;
  }

  function ensureDefs(svg) {
    let defs = svg.querySelector("defs");
    if (defs) return defs;
    defs = svgEl("defs", {});
    const mk = (id, color, refX) =>
      `<marker id="${id}" markerWidth="8" markerHeight="8" refX="${refX}" refY="3" orient="auto" markerUnits="userSpaceOnUse">
         <path d="M0,0 L6,3 L0,6 Z" fill="${color}"></path>
       </marker>`;
    defs.innerHTML =
      mk("arrowAmber", "#f2a65a", 5) +
      mk("arrowTeal", "#57c7b8", 5) +
      mk("arrowCoral", "#ef6f6c", 5) +
      mk("arrowInk", "#eaf2fb", 5);
    svg.appendChild(defs);
    return defs;
  }

  const MX = 60,
    MR = 40; // beam diagram margins

  // ===========================================================
  // Beam diagram / FBD
  // ===========================================================
  function drawBeamDiagram(svg, L, loads, reactions, isFBD) {
    svg.innerHTML = "";
    ensureDefs(svg);
    const vb = svg.viewBox.baseVal;
    const W = vb.width || 900,
      H = vb.height || 240;
    const beamY = 110;
    const plotW = W - MX - MR;
    const sx = (x) => MX + (x / L) * plotW;

    const g = svgEl("g", {});
    svg.appendChild(g);

    // background centerline + grid ticks
    g.appendChild(
      svgEl("line", {
        x1: MX,
        y1: beamY,
        x2: W - MR,
        y2: beamY,
        stroke: "var(--line-grid-strong)",
        "stroke-dasharray": "2 4",
        "stroke-width": 1,
      })
    );

    // beam bar
    g.appendChild(
      svgEl("rect", {
        x: MX,
        y: beamY - 6,
        width: plotW,
        height: 12,
        rx: 1,
        fill: "#1b3552",
        stroke: "var(--ink)",
        "stroke-width": 1.2,
      })
    );

    // dimension line (span)
    const dimY = H - 26;
    g.appendChild(svgEl("line", { x1: MX, y1: dimY, x2: W - MR, y2: dimY, stroke: "var(--muted)", "stroke-width": 1 }));
    [MX, W - MR].forEach((xx) => {
      g.appendChild(svgEl("line", { x1: xx, y1: dimY - 5, x2: xx, y2: dimY + 5, stroke: "var(--muted)", "stroke-width": 1 }));
    });
    const dimLabel = svgEl("text", {
      x: (MX + W - MR) / 2,
      y: dimY + 18,
      fill: "var(--muted)",
      "font-family": "IBM Plex Mono, monospace",
      "font-size": 11,
      "text-anchor": "middle",
    });
    dimLabel.textContent = `L = ${fmt(L)} ${state.lengthUnit}`;
    g.appendChild(dimLabel);

    // ---- supports or reaction arrows ----
    if (!isFBD) {
      if (reactions.kind === "simple") {
        drawPinSupport(g, sx(reactions.xA), beamY);
        drawRollerSupport(g, sx(reactions.xB), beamY);
        label(g, sx(reactions.xA), beamY + 40, "A", "var(--muted)");
        label(g, sx(reactions.xB), beamY + 40, "B", "var(--muted)");
      } else {
        drawFixedSupport(g, sx(reactions.pivot), beamY, state.fixedEnd);
      }
    } else {
      if (reactions.kind === "simple") {
        drawReactionArrow(g, sx(reactions.xA), beamY, reactions.RA, "R\u2090");
        drawReactionArrow(g, sx(reactions.xB), beamY, reactions.RB, "R_b");
      } else {
        drawReactionArrow(g, sx(reactions.pivot), beamY, reactions.R, "R");
        drawReactionMomentArc(g, sx(reactions.pivot), beamY, reactions.Mfix, "M_fix");
      }
    }

    // ---- loads ----
    loads.forEach((l) => {
      if (l.type === "point") {
        drawPointLoadArrow(g, sx(l.position), beamY, l.magnitude, `${fmt(l.magnitude)}`);
      } else if (l.type === "udl") {
        drawUDL(g, sx(l.start), sx(l.end), beamY, l.magnitude);
      } else if (l.type === "moment") {
        drawAppliedMomentArc(g, sx(l.position), beamY, l.direction, `${fmt(l.magnitude)}`);
      }
    });
  }

  function label(g, x, y, text, color, size) {
    const t = svgEl("text", {
      x,
      y,
      fill: color || "var(--ink)",
      "font-family": "IBM Plex Mono, monospace",
      "font-size": size || 11,
      "text-anchor": "middle",
    });
    t.textContent = text;
    g.appendChild(t);
  }

  function drawPinSupport(g, x, y) {
    const s = 16;
    g.appendChild(svgEl("path", { d: `M ${x} ${y + 6} L ${x - s / 2} ${y + 6 + s} L ${x + s / 2} ${y + 6 + s} Z`, fill: "none", stroke: "var(--amber)", "stroke-width": 1.6, "stroke-linejoin": "round" }));
    hatch(g, x - s / 2 - 4, y + 6 + s, x + s / 2 + 4, y + 6 + s + 8);
  }
  function drawRollerSupport(g, x, y) {
    const s = 16;
    g.appendChild(svgEl("path", { d: `M ${x} ${y + 6} L ${x - s / 2} ${y + 6 + s} L ${x + s / 2} ${y + 6 + s} Z`, fill: "none", stroke: "var(--amber)", "stroke-width": 1.6, "stroke-linejoin": "round" }));
    g.appendChild(svgEl("line", { x1: x - s / 2 - 4, y1: y + 6 + s + 4, x2: x + s / 2 + 4, y2: y + 6 + s + 4, stroke: "var(--amber)", "stroke-width": 1.4 }));
    hatch(g, x - s / 2 - 4, y + 6 + s + 4, x + s / 2 + 4, y + 6 + s + 12);
  }
  function drawFixedSupport(g, x, y, side) {
    const h = 34;
    const wallX = side === "left" ? x : x;
    g.appendChild(svgEl("line", { x1: wallX, y1: y - h, x2: wallX, y2: y + h, stroke: "var(--amber)", "stroke-width": 2 }));
    if (side === "left") hatch(g, wallX - 10, y - h, wallX, y + h, true);
    else hatch(g, wallX, y - h, wallX + 10, y + h, true);
  }
  function hatch(g, x1, y1, x2, y2, vertical) {
    const n = vertical ? Math.max(2, Math.round((y2 - y1) / 8)) : Math.max(2, Math.round((x2 - x1) / 8));
    for (let i = 0; i <= n; i++) {
      if (vertical) {
        const yy = y1 + (i * (y2 - y1)) / n;
        g.appendChild(svgEl("line", { x1: x1, y1: yy, x2: x2, y2: yy + 8, stroke: "var(--muted-dim)", "stroke-width": 1 }));
      } else {
        const xx = x1 + (i * (x2 - x1)) / n;
        g.appendChild(svgEl("line", { x1: xx, y1: y1, x2: xx - 6, y2: y2, stroke: "var(--muted-dim)", "stroke-width": 1 }));
      }
    }
  }

  function drawPointLoadArrow(g, x, beamY, magnitude, text) {
    const down = magnitude >= 0;
    const len = 42;
    const y1 = down ? beamY - 6 - len : beamY + 6 + len;
    const y2 = down ? beamY - 8 : beamY + 8;
    g.appendChild(
      svgEl("line", {
        x1: x,
        y1,
        x2: x,
        y2,
        stroke: "var(--coral)",
        "stroke-width": 2,
        "marker-end": "url(#arrowCoral)",
      })
    );
    label(g, x, down ? y1 - 6 : y1 + 16, text, "var(--coral)");
  }

  function drawUDL(g, x1, x2, beamY, magnitude) {
    const down = magnitude >= 0;
    const barY = down ? beamY - 34 : beamY + 34;
    g.appendChild(svgEl("line", { x1, y1: barY, x2, y2: barY, stroke: "var(--coral)", "stroke-width": 1.4 }));
    const n = Math.max(3, Math.round((x2 - x1) / 26));
    for (let i = 0; i <= n; i++) {
      const xx = x1 + (i * (x2 - x1)) / n;
      const yA = barY;
      const yB = down ? beamY - 8 : beamY + 8;
      g.appendChild(svgEl("line", { x1: xx, y1: yA, x2: xx, y2: yB, stroke: "var(--coral)", "stroke-width": 1.4, "marker-end": "url(#arrowCoral)" }));
    }
    label(g, (x1 + x2) / 2, down ? barY - 8 : barY + 18, `${fmt(magnitude)}/${state.lengthUnit}`, "var(--coral)");
  }

  function drawReactionArrow(g, x, beamY, value, text) {
    const up = value >= 0;
    const len = 42;
    const y1 = up ? beamY + 6 + len : beamY - 6 - len;
    const y2 = up ? beamY + 8 : beamY - 8;
    g.appendChild(
      svgEl("line", {
        x1: x,
        y1,
        x2: x,
        y2,
        stroke: "var(--amber)",
        "stroke-width": 2.2,
        "marker-end": "url(#arrowAmber)",
      })
    );
    label(g, x, up ? y1 + 16 : y1 - 8, `${text}=${fmt(value)}`, "var(--amber)");
  }

  function drawReactionMomentArc(g, x, beamY, value, text) {
    const cw = value >= 0;
    const r = 20;
    const y = beamY - 46;
    const sweep = cw ? 1 : 0;
    const path = `M ${x - r} ${y} A ${r} ${r} 0 1 ${sweep} ${x + r} ${y}`;
    g.appendChild(svgEl("path", { d: path, fill: "none", stroke: "var(--amber)", "stroke-width": 2, "marker-end": "url(#arrowAmber)" }));
    label(g, x, y - 10, `${text}=${fmt(Math.abs(value))}`, "var(--amber)");
  }

  function drawAppliedMomentArc(g, x, beamY, direction, text) {
    const cw = direction === "cw";
    const r = 20;
    const y = beamY - 46;
    const sweep = cw ? 1 : 0;
    const path = `M ${x - r} ${y} A ${r} ${r} 0 1 ${sweep} ${x + r} ${y}`;
    g.appendChild(svgEl("path", { d: path, fill: "none", stroke: "var(--coral)", "stroke-width": 2, "marker-end": "url(#arrowCoral)" }));
    label(g, x, y - 10, text, "var(--coral)");
  }

  // ===========================================================
  // SFD / BMD chart
  // ===========================================================
  function drawChart(svg, xs, ys, opts) {
    svg.innerHTML = "";
    const vb = svg.viewBox.baseVal;
    const W = vb.width || 900,
      H = vb.height || 260;
    const marginL = 64,
      marginR = 30,
      marginT = 20,
      marginB = 34;
    const plotW = W - marginL - marginR;
    const plotH = H - marginT - marginB;

    const xMin = xs[0],
      xMax = xs[xs.length - 1];
    let yMax = Math.max(...ys, 0),
      yMin = Math.min(...ys, 0);
    if (yMax - yMin < 1e-6) {
      yMax += 1;
      yMin -= 1;
    }
    const pad = (yMax - yMin) * 0.12;
    yMax += pad;
    yMin -= pad;
    const yRange = yMax - yMin;

    const sx = (x) => marginL + ((x - xMin) / (xMax - xMin || 1)) * plotW;
    const sy = (y) => marginT + plotH - ((y - yMin) / yRange) * plotH;
    const zeroY = sy(0);

    const g = svgEl("g", {});
    svg.appendChild(g);

    // horizontal gridlines (4 divisions)
    const steps = 4;
    for (let i = 0; i <= steps; i++) {
      const yy = marginT + (i * plotH) / steps;
      g.appendChild(svgEl("line", { x1: marginL, y1: yy, x2: W - marginR, y2: yy, stroke: "var(--line-grid)", "stroke-width": 1 }));
      const val = yMax - (i * yRange) / steps;
      const t = svgEl("text", { x: marginL - 8, y: yy + 3, fill: "var(--muted)", "font-family": "IBM Plex Mono, monospace", "font-size": 9.5, "text-anchor": "end" });
      t.textContent = fmt(val);
      g.appendChild(t);
    }

    // x axis ticks
    const xticks = 5;
    for (let i = 0; i <= xticks; i++) {
      const xv = xMin + (i * (xMax - xMin)) / xticks;
      const xx = sx(xv);
      g.appendChild(svgEl("line", { x1: xx, y1: marginT, x2: xx, y2: marginT + plotH, stroke: "var(--line-grid)", "stroke-width": 1 }));
      const t = svgEl("text", { x: xx, y: H - marginB + 16, fill: "var(--muted)", "font-family": "IBM Plex Mono, monospace", "font-size": 9.5, "text-anchor": "middle" });
      t.textContent = fmt(xv);
      g.appendChild(t);
    }

    // zero line
    g.appendChild(svgEl("line", { x1: marginL, y1: zeroY, x2: W - marginR, y2: zeroY, stroke: "var(--line-grid-strong)", "stroke-width": 1.4 }));

    // split into positive/negative area fills using a single path with clip would be complex;
    // simpler: draw area with two fills by masking sign via per-segment polygons.
    let posPath = `M ${sx(xs[0])} ${zeroY}`;
    let negPath = `M ${sx(xs[0])} ${zeroY}`;
    for (let i = 0; i < xs.length; i++) {
      const px = sx(xs[i]);
      const py = sy(ys[i]);
      posPath += ` L ${px} ${ys[i] >= 0 ? py : zeroY}`;
      negPath += ` L ${px} ${ys[i] <= 0 ? py : zeroY}`;
    }
    posPath += ` L ${sx(xs[xs.length - 1])} ${zeroY} Z`;
    negPath += ` L ${sx(xs[xs.length - 1])} ${zeroY} Z`;

    g.appendChild(svgEl("path", { d: posPath, fill: opts.color, "fill-opacity": 0.18, stroke: "none" }));
    g.appendChild(svgEl("path", { d: negPath, fill: opts.colorNeg, "fill-opacity": 0.18, stroke: "none" }));

    // line itself, colored per-segment by sign
    let linePath = `M ${sx(xs[0])} ${sy(ys[0])}`;
    for (let i = 1; i < xs.length; i++) linePath += ` L ${sx(xs[i])} ${sy(ys[i])}`;
    g.appendChild(svgEl("path", { d: linePath, fill: "none", stroke: opts.color, "stroke-width": 2 }));

    // extrema markers
    const mx = extremum(ys, xs, "max");
    const mn = extremum(ys, xs, "min");
    [mx, mn].forEach((pt, i) => {
      if (Math.abs(pt.v) < 1e-9) return;
      const cx = sx(pt.x),
        cy = sy(pt.v);
      g.appendChild(svgEl("circle", { cx, cy, r: 3.4, fill: i === 0 ? opts.color : opts.colorNeg, stroke: "var(--bg-sheet)", "stroke-width": 1.4 }));
      const t = svgEl("text", {
        x: cx,
        y: pt.v >= 0 ? cy - 8 : cy + 15,
        fill: i === 0 ? opts.color : opts.colorNeg,
        "font-family": "IBM Plex Mono, monospace",
        "font-size": 10.5,
        "text-anchor": cx > W - 90 ? "end" : cx < marginL + 30 ? "start" : "middle",
        "font-weight": "600",
      });
      t.textContent = `${opts.title}=${fmt(pt.v)}`;
      g.appendChild(t);
    });

    // axis border
    g.appendChild(svgEl("rect", { x: marginL, y: marginT, width: plotW, height: plotH, fill: "none", stroke: "var(--border)", "stroke-width": 1 }));

    // unit label
    const ul = svgEl("text", { x: W - marginR, y: marginT - 6, fill: "var(--muted)", "font-family": "IBM Plex Mono, monospace", "font-size": 10, "text-anchor": "end" });
    ul.textContent = `[${opts.unit}]`;
    g.appendChild(ul);
  }

  // ---------------------------------------------------------
  // Seed with a couple of example loads so the page isn't empty
  // ---------------------------------------------------------
  state.loads.push({ id: state.nextId++, type: "point", position: 10, magnitude: 400 });
  state.loads.push({ id: state.nextId++, type: "udl", start: 0, end: 20, magnitude: 30 });
  renderLoadList();
  calculate();
})();
