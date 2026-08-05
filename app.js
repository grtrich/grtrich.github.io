(function () {
  "use strict";

  const SVGNS = "http://www.w3.org/2000/svg";
  
  // Palette for unique load colors
  const loadColors = ['#e6194b', '#3cb44b', '#ffe119', '#4363d8', '#f58231', '#911eb4', '#46f0f0', '#f032e6', '#bcf60c', '#fabebe'];

  const state = {
    length: 20,
    lengthUnit: "ft",
    forceUnit: "lb",
    supportType: "simple",
    supportA: 0,
    supportB: 20,
    fixedEnd: "left",
    loads: [],
    nextId: 1,
  };

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

  // Update units instantly without hitting calculate
  el("forceUnit").addEventListener("input", (e) => {
    state.forceUnit = e.target.value;
    renderLoadList();
  });
  
  el("lengthUnit").addEventListener("input", (e) => {
    state.lengthUnit = e.target.value;
    renderLoadList();
  });

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
    return (Math.round(n * 100) / 100).toString();
  }
  
  function getLoadColor(id) {
    return loadColors[(id - 1) % loadColors.length];
  }

  function renderLoadList() {
    loadListEl.innerHTML = "";
    state.loads.forEach((l) => {
      const li = document.createElement("li");
      const color = getLoadColor(l.id);
      let text = "";
      if (l.type === "point") {
        text = `Point: ${fmt(l.magnitude)} ${state.forceUnit} @ x=${fmt(l.position)}`;
      } else if (l.type === "udl") {
        text = `UDL: ${fmt(l.magnitude)} ${state.forceUnit}/${state.lengthUnit} [${fmt(l.start)} to ${fmt(l.end)}]`;
      } else if (l.type === "moment") {
        text = `Moment: ${fmt(l.magnitude)} ${state.forceUnit}·${state.lengthUnit} (${l.direction.toUpperCase()}) @ x=${fmt(l.position)}`;
      }
      li.innerHTML = `<span style="border-left: 4px solid ${color}; padding-left: 8px;">${text}</span><button type="button" data-id="${l.id}">x</button>`;
      loadListEl.appendChild(li);
    });
  }

  function computeReactions(L, loads) {
    if (state.supportType === "simple") {
      const xA = clamp(state.supportA, 0, L);
      const xB = clamp(state.supportB, 0, L);
      const span = xB - xA;
      if (Math.abs(span) < 1e-9) return null;

      let momentAboutA = 0;
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
        kind: "simple", xA, xB, RA, RB,
        forces: [{ x: xA, F: RA }, { x: xB, F: RB }],
        moments: [],
        summary: [{ label: `Rₐ @ x=${fmt(xA)}`, value: RA }, { label: `R_b @ x=${fmt(xB)}`, value: RB }],
      };
    }

    const pivot = state.fixedEnd === "left" ? 0 : L;
    let momentAboutPivot = 0;
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
    const Mfix = -momentAboutPivot;

    return {
      kind: "cantilever", pivot, R, Mfix,
      forces: [{ x: pivot, F: R }],
      moments: [{ x: pivot, M: Mfix }],
      summary: [{ label: `R @ x=${fmt(pivot)}`, value: R }, { label: `M_fix @ x=${fmt(pivot)}`, value: Mfix, isMoment: true }],
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

  function computeDiagram(L, forces, moments, N = 480) {
    const xs = new Array(N + 1), Vs = new Array(N + 1), Ms = new Array(N + 1);
    const EPS = 1e-7;

    for (let i = 0; i <= N; i++) {
      const x = (L * i) / N;
      let V = 0, M = 0;
      for (let k = 0; k < forces.length; k++) {
        if (forces[k].x <= x + EPS) {
          V += forces[k].F;
          M += forces[k].F * (x - forces[k].x);
        }
      }
      for (let k = 0; k < moments.length; k++) {
        if (moments[k].x <= x + EPS) M += moments[k].M;
      }
      xs[i] = x; Vs[i] = V; Ms[i] = M;
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

  function calculate() {
    state.length = parseFloat(el("beamLength").value) || 0;
    const L = state.length;
    if (!(L > 0)) {
      reactionsOut.innerHTML = `<p style="color:red">Enter a length greater than zero.</p>`;
      return;
    }
    
    // Support type positions grabbed dynamically prior to run
    if (state.supportType === "simple") {
      state.supportA = clamp(parseFloat(el("supportA").value), 0, state.length);
      state.supportB = clamp(parseFloat(el("supportB").value), 0, state.length);
    } else {
      state.fixedEnd = el("fixedEnd").value;
    }

    const reactions = computeReactions(L, state.loads);
    if (!reactions) {
      reactionsOut.innerHTML = `<p style="color:red">Support A and Support B can't be at the same position.</p>`;
      return;
    }

    const { forces, moments } = buildForcesAndMoments(reactions, state.loads);
    const diagram = computeDiagram(L, forces, moments);

    renderReactions(reactions);
    drawBeamDiagram(el("beamSvg"), L, state.loads, reactions, false);
    drawBeamDiagram(el("fbdSvg"), L, state.loads, reactions, true);
    drawChart(el("sfdSvg"), diagram.xs, diagram.Vs, { color: "#000", unit: state.forceUnit, title: "V" });
    drawChart(el("bmdSvg"), diagram.xs, diagram.Ms, { color: "#000", unit: `${state.forceUnit}·${state.lengthUnit}`, title: "M" });
  }

  function renderReactions(reactions) {
    const cards = reactions.summary.map(
        (s) => `<div><strong>${s.label}:</strong> ${fmt(s.value)} ${s.isMoment ? state.forceUnit + "·" + state.lengthUnit : state.forceUnit}</div>`
      ).join("");
    reactionsOut.innerHTML = `<div class="reactions-grid">${cards}</div>`;
  }

  function svgEl(tag, attrs) {
    const n = document.createElementNS(SVGNS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    return n;
  }

  function ensureDefs(svg) {
    let defs = svg.querySelector("defs");
    if (!defs) {
      defs = svgEl("defs", {});
      svg.appendChild(defs);
    }
    defs.innerHTML = "";
    loadColors.forEach((c) => {
      const idStr = "arr_" + c.replace("#", "");
      defs.innerHTML += `<marker id="${idStr}" markerWidth="8" markerHeight="8" refX="5" refY="3" orient="auto" markerUnits="userSpaceOnUse"><path d="M0,0 L6,3 L0,6 Z" fill="${c}"></path></marker>`;
    });
    defs.innerHTML += `<marker id="arr_black" markerWidth="8" markerHeight="8" refX="5" refY="3" orient="auto" markerUnits="userSpaceOnUse"><path d="M0,0 L6,3 L0,6 Z" fill="#000"></path></marker>`;
    return defs;
  }

  const MX = 60, MR = 40;
  function drawBeamDiagram(svg, L, loads, reactions, isFBD) {
    svg.innerHTML = "";
    ensureDefs(svg);
    const W = 900, H = 240, beamY = 110, plotW = W - MX - MR;
    const sx = (x) => MX + (x / L) * plotW;
    const g = svgEl("g", {});
    svg.appendChild(g);

    g.appendChild(svgEl("rect", { x: MX, y: beamY - 6, width: plotW, height: 12, fill: "#ccc", stroke: "#000" }));

    if (!isFBD) {
      if (reactions.kind === "simple") {
        drawPinSupport(g, sx(reactions.xA), beamY);
        drawRollerSupport(g, sx(reactions.xB), beamY);
      } else {
        drawFixedSupport(g, sx(reactions.pivot), beamY, state.fixedEnd);
      }
    } else {
      if (reactions.kind === "simple") {
        drawReactionArrow(g, sx(reactions.xA), beamY, reactions.RA, "Rₐ");
        drawReactionArrow(g, sx(reactions.xB), beamY, reactions.RB, "R_b");
      } else {
        drawReactionArrow(g, sx(reactions.pivot), beamY, reactions.R, "R");
      }
    }

    loads.forEach((l) => {
      const color = getLoadColor(l.id);
      const markerId = "url(#arr_" + color.replace("#", "") + ")";
      if (l.type === "point") {
        drawPointLoadArrow(g, sx(l.position), beamY, l.magnitude, markerId, color);
      } else if (l.type === "udl") {
        drawUDL(g, sx(l.start), sx(l.end), beamY, l.magnitude, markerId, color);
      } else if (l.type === "moment") {
        drawAppliedMomentArc(g, sx(l.position), beamY, l.direction, markerId, color);
      }
    });
  }

  function drawPinSupport(g, x, y) {
    g.appendChild(svgEl("path", { d: `M ${x} ${y + 6} L ${x - 8} ${y + 22} L ${x + 8} ${y + 22} Z`, fill: "none", stroke: "#000" }));
  }
  function drawRollerSupport(g, x, y) {
    g.appendChild(svgEl("path", { d: `M ${x} ${y + 6} L ${x - 8} ${y + 22} L ${x + 8} ${y + 22} Z`, fill: "none", stroke: "#000" }));
    g.appendChild(svgEl("line", { x1: x - 12, y1: y + 26, x2: x + 12, y2: y + 26, stroke: "#000" }));
  }
  function drawFixedSupport(g, x, y, side) {
    g.appendChild(svgEl("line", { x1: x, y1: y - 34, x2: x, y2: y + 34, stroke: "#000", "stroke-width": 4 }));
  }

  function drawPointLoadArrow(g, x, beamY, magnitude, marker, color) {
    const down = magnitude >= 0;
    const y1 = down ? beamY - 48 : beamY + 48;
    const y2 = down ? beamY - 8 : beamY + 8;
    g.appendChild(svgEl("line", { x1: x, y1, x2: x, y2, stroke: color, "stroke-width": 2, "marker-end": marker }));
  }

  function drawUDL(g, x1, x2, beamY, magnitude, marker, color) {
    const down = magnitude >= 0;
    const barY = down ? beamY - 34 : beamY + 34;
    g.appendChild(svgEl("line", { x1, y1: barY, x2, y2: barY, stroke: color, "stroke-width": 2 }));
    for (let i = 0; i <= 4; i++) {
      const xx = x1 + (i * (x2 - x1)) / 4;
      g.appendChild(svgEl("line", { x1: xx, y1: barY, x2: xx, y2: down ? beamY - 8 : beamY + 8, stroke: color, "stroke-width": 2, "marker-end": marker }));
    }
  }

  function drawReactionArrow(g, x, beamY, value, text) {
    const up = value >= 0;
    const y1 = up ? beamY + 48 : beamY - 48;
    const y2 = up ? beamY + 8 : beamY - 8;
    g.appendChild(svgEl("line", { x1: x, y1, x2: x, y2, stroke: "#000", "stroke-width": 2, "marker-end": "url(#arr_black)" }));
  }

  function drawAppliedMomentArc(g, x, beamY, direction, marker, color) {
    const r = 20, y = beamY - 46, sweep = direction === "cw" ? 1 : 0;
    g.appendChild(svgEl("path", { d: `M ${x - r} ${y} A ${r} ${r} 0 1 ${sweep} ${x + r} ${y}`, fill: "none", stroke: color, "stroke-width": 2, "marker-end": marker }));
  }

  function drawChart(svg, xs, ys, opts) {
    svg.innerHTML = "";
    const W = 900, H = 260, marginL = 64, marginR = 30, marginT = 20, marginB = 34;
    const plotW = W - marginL - marginR, plotH = H - marginT - marginB;
    const xMin = xs[0], xMax = xs[xs.length - 1];
    let yMax = Math.max(...ys, 0), yMin = Math.min(...ys, 0);
    if (yMax - yMin < 1e-6) { yMax += 1; yMin -= 1; }
    const yRange = yMax - yMin;
    const sx = (x) => marginL + ((x - xMin) / (xMax - xMin || 1)) * plotW;
    const sy = (y) => marginT + plotH - ((y - yMin) / yRange) * plotH;

    const g = svgEl("g", {});
    svg.appendChild(g);
    g.appendChild(svgEl("line", { x1: marginL, y1: sy(0), x2: W - marginR, y2: sy(0), stroke: "#ccc", "stroke-width": 1 }));

    let linePath = `M ${sx(xs[0])} ${sy(ys[0])}`;
    for (let i = 1; i < xs.length; i++) linePath += ` L ${sx(xs[i])} ${sy(ys[i])}`;
    g.appendChild(svgEl("path", { d: linePath, fill: "none", stroke: opts.color, "stroke-width": 2 }));
    g.appendChild(svgEl("rect", { x: marginL, y: marginT, width: plotW, height: plotH, fill: "none", stroke: "#000" }));
  }

  state.loads.push({ id: state.nextId++, type: "point", position: 10, magnitude: 400 });
  state.loads.push({ id: state.nextId++, type: "udl", start: 0, end: 20, magnitude: 30 });
  renderLoadList();
  calculate();
})();