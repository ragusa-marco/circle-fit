const canvas = document.querySelector("#circleCanvas");
const ctx = canvas.getContext("2d");
const scoreValue = document.querySelector("#scoreValue");
const fitValue = document.querySelector("#fitValue");
const resetButton = document.querySelector("#resetButton");

const TARGET_RADIUS = 300;
const START_HIT_RADIUS = 44;
const TWO_PI = Math.PI * 2;
const MIN_POINT_DISTANCE = 2.4;

let width = 0;
let height = 0;
let center = { x: 0, y: 0 };
let startAngle = 0;
let points = [];
let isDrawing = false;
let lastResult = null;
let message = "Ready";
let flashUntil = 0;
let activePointerId = null;

function resizeCanvas() {
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  width = window.innerWidth;
  height = window.innerHeight;
  center = { x: width / 2, y: height / 2 };
  startAngle = width >= height ? 0 : Math.PI / 2;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function pointerPoint(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function pointRadius(point) {
  return Math.hypot(point.x - center.x, point.y - center.y);
}

function pointAngle(point) {
  return Math.atan2(point.y - center.y, point.x - center.x);
}

function startPoint() {
  return {
    x: center.x + Math.cos(startAngle) * TARGET_RADIUS,
    y: center.y + Math.sin(startAngle) * TARGET_RADIUS,
  };
}

function normalizeAngle(angle) {
  return ((angle % TWO_PI) + TWO_PI) % TWO_PI;
}

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function starterQuality(point) {
  const miss = distance(point, startPoint());
  return clamp(1 - miss / START_HIT_RADIUS);
}

function isNearStarter(point) {
  return starterQuality(point) > 0.18;
}

function addPoint(point) {
  const last = points[points.length - 1];
  if (!last || distance(last, point) >= MIN_POINT_DISTANCE) {
    points.push(point);
  }
}

function pathLength(sample) {
  let total = 0;
  for (let i = 1; i < sample.length; i += 1) {
    total += distance(sample[i - 1], sample[i]);
  }
  return total;
}

function largestEmptyRun(bins) {
  let best = 0;
  let current = 0;
  const limit = bins.length * 2;

  for (let i = 0; i < limit; i += 1) {
    if (bins[i % bins.length] === 0) {
      current += 1;
      best = Math.max(best, current);
    } else {
      current = 0;
    }
  }

  return Math.min(best, bins.length);
}

function calculateScore(sample) {
  if (sample.length < 12) {
    return {
      score: 0,
      rms: 0,
      coverage: 0,
      label: "Too short",
    };
  }

  let squaredError = 0;
  const bins = new Uint8Array(180);

  for (const point of sample) {
    const radialError = Math.abs(pointRadius(point) - TARGET_RADIUS);
    squaredError += radialError * radialError;

    if (radialError <= 92) {
      const bin = Math.floor((normalizeAngle(pointAngle(point)) / TWO_PI) * bins.length);
      bins[Math.min(bins.length - 1, bin)] = 1;
    }
  }

  const rms = Math.sqrt(squaredError / sample.length);
  const coveredBins = bins.reduce((total, value) => total + value, 0);
  const coverage = coveredBins / bins.length;
  const gap = largestEmptyRun(bins) / bins.length;
  const circumference = TWO_PI * TARGET_RADIUS;
  const drawnLength = pathLength(sample);
  const lengthQuality = clamp(1 - Math.abs(drawnLength / circumference - 1) * 1.15);
  const radialQuality = clamp(1 - rms / 82);
  const coverageQuality = clamp((coverage - 0.45) / 0.55);
  const gapQuality = clamp(1 - gap / 0.45);
  const closureQuality = Math.max(
    starterQuality(sample[sample.length - 1]),
    clamp(1 - distance(sample[0], sample[sample.length - 1]) / 150),
  );
  const startQuality = starterQuality(sample[0]);
  const completeness = 0.25 + 0.75 * Math.sqrt(coverageQuality * gapQuality);
  const shapeQuality = clamp(
    radialQuality * 0.55
      + coverageQuality * 0.2
      + gapQuality * 0.15
      + lengthQuality * 0.1,
  );
  const closureBlend = clamp(closureQuality * 0.7 + startQuality * 0.3);
  const score = Math.round(
    100 * (0.12 + shapeQuality * 0.88) * completeness * (0.8 + closureBlend * 0.2),
  );

  return {
    score: clamp(score, 0, 100),
    rms,
    coverage,
    closureQuality,
    label: `${Math.round(rms)}px RMS`,
  };
}

function resetAttempt() {
  points = [];
  isDrawing = false;
  lastResult = null;
  message = "Start and finish on cue";
  activePointerId = null;
  scoreValue.textContent = "--";
  fitValue.textContent = message;
}

function beginDrawing(event) {
  const point = pointerPoint(event);
  event.preventDefault();

  if (!isNearStarter(point)) {
    flashUntil = performance.now() + 620;
    message = "Cue missed";
    fitValue.textContent = message;
    return;
  }

  canvas.setPointerCapture(event.pointerId);
  activePointerId = event.pointerId;
  points = [];
  lastResult = null;
  isDrawing = true;
  message = "Return to start cue";
  fitValue.textContent = message;
  scoreValue.textContent = "--";
  addPoint(point);
}

function continueDrawing(event) {
  if (!isDrawing || event.pointerId !== activePointerId) {
    return;
  }

  event.preventDefault();
  addPoint(pointerPoint(event));
}

function finishDrawing(event) {
  if (!isDrawing || event.pointerId !== activePointerId) {
    return;
  }

  event.preventDefault();
  addPoint(pointerPoint(event));
  isDrawing = false;
  activePointerId = null;
  lastResult = calculateScore(points);
  scoreValue.textContent = String(lastResult.score);
  fitValue.textContent = lastResult.closureQuality >= 0.6 ? lastResult.label : "Finish on cue";

  if (canvas.hasPointerCapture(event.pointerId)) {
    canvas.releasePointerCapture(event.pointerId);
  }
}

function drawBackground() {
  ctx.clearRect(0, 0, width, height);

  const vignette = ctx.createRadialGradient(
    center.x,
    center.y,
    0,
    center.x,
    center.y,
    Math.max(width, height) * 0.72,
  );
  vignette.addColorStop(0, "rgba(246, 241, 228, 0.025)");
  vignette.addColorStop(1, "rgba(0, 0, 0, 0.18)");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, width, height);
}

function drawTargetCircle() {
  if (!lastResult) {
    return;
  }

  ctx.save();
  ctx.setLineDash([4, 14]);
  ctx.lineCap = "round";
  ctx.strokeStyle = "rgba(246, 241, 228, 0.2)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(center.x, center.y, TARGET_RADIUS, 0, TWO_PI);
  ctx.stroke();
  ctx.restore();
}

function drawStartCue(now) {
  const cue = startPoint();
  const flashing = now < flashUntil;
  const pulse = 0.5 + Math.sin(now / 180) * 0.5;
  const alertPulse = flashing ? 0.5 + Math.sin(now / 48) * 0.5 : 0;

  ctx.save();
  ctx.shadowColor = "rgba(89, 217, 194, 0.42)";
  ctx.shadowBlur = flashing ? 26 + alertPulse * 12 : 14;
  ctx.fillStyle = flashing ? "rgba(255, 229, 123, 0.98)" : "#59d9c2";
  ctx.beginPath();
  ctx.arc(cue.x, cue.y, 8 + pulse * 5, 0, TWO_PI);
  ctx.fill();
  ctx.restore();
}

function drawDot() {
  ctx.save();
  ctx.fillStyle = "#f6f1e4";
  ctx.shadowColor = "rgba(246, 241, 228, 0.45)";
  ctx.shadowBlur = 18;
  ctx.beginPath();
  ctx.arc(center.x, center.y, 7, 0, TWO_PI);
  ctx.fill();
  ctx.restore();
}

function drawPlayerPath() {
  if (points.length < 2) {
    return;
  }

  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  ctx.strokeStyle = "rgba(255, 122, 102, 0.2)";
  ctx.lineWidth = 15;
  tracePath();
  ctx.stroke();

  ctx.strokeStyle = "#ff7a66";
  ctx.lineWidth = 5;
  tracePath();
  ctx.stroke();
  ctx.restore();
}

function tracePath() {
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i += 1) {
    const previous = points[i - 1];
    const current = points[i];
    const mid = {
      x: (previous.x + current.x) / 2,
      y: (previous.y + current.y) / 2,
    };
    ctx.quadraticCurveTo(previous.x, previous.y, mid.x, mid.y);
  }
}

function render(now) {
  drawBackground();
  drawTargetCircle();
  drawPlayerPath();
  drawStartCue(now);
  drawDot();
  requestAnimationFrame(render);
}

window.addEventListener("resize", resizeCanvas);
canvas.addEventListener("pointerdown", beginDrawing);
canvas.addEventListener("pointermove", continueDrawing);
canvas.addEventListener("pointerup", finishDrawing);
canvas.addEventListener("pointercancel", finishDrawing);
resetButton.addEventListener("click", resetAttempt);

resizeCanvas();
resetAttempt();
requestAnimationFrame(render);
