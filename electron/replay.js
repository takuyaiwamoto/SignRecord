const canvas = document.getElementById('replay-canvas');
const ctx = canvas.getContext('2d');
const appRoot = document.getElementById('app');
const chooser = document.getElementById('chooser');
const stage = document.getElementById('stage');
const recordList = document.getElementById('record-list');
const speedInput = document.getElementById('speed-input');
const printOnOpenInput = document.getElementById('print-on-open');
const statusText = document.getElementById('status');

let dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 3));
let records = [];
let selectedRecord = null;
let replayTimerId = null;
let replayStartDelayTimerId = null;
let replayRunId = 0;
let motionTimerIds = [];
let paperRect = { x: 0, y: 0, width: 0, height: 0 };
let paperMotion = { rotationDeg: 0, slideY: 0 };
let motionAnimationId = null;
let currentDrawItems = [];
let replayFinished = false;

function setStatus(text) {
  statusText.textContent = text;
}

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 3));
  canvas.width = Math.max(1, Math.round(rect.width * dpr));
  canvas.height = Math.max(1, Math.round(rect.height * dpr));
  updatePaperRect();
  clearCanvas();
}

function updatePaperRect() {
  const margin = 86 * dpr;
  const maxWidth = Math.max(1, canvas.width - margin * 2);
  const maxHeight = Math.max(1, canvas.height - margin * 2);
  const lPrintRatio = 89 / 127;
  let width = Math.min(maxWidth, maxHeight * lPrintRatio);
  let height = width / lPrintRatio;
  if (height > maxHeight) {
    height = maxHeight;
    width = height * lPrintRatio;
  }
  width *= 0.6348;
  height *= 0.6348;
  const verticalSpace = Math.max(0, canvas.height - height);
  paperRect = {
    x: (canvas.width - width) / 2,
    y: Math.max(12 * dpr, verticalSpace * 0.08),
    width,
    height,
  };
}

function clearCanvas() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.save();
  applyPaperTransform();
  ctx.shadowColor = 'rgba(46, 34, 38, 0.16)';
  ctx.shadowBlur = 22 * dpr;
  ctx.shadowOffsetY = 12 * dpr;
  ctx.fillStyle = '#fffdf8';
  ctx.fillRect(paperRect.x, paperRect.y, paperRect.width, paperRect.height);
  ctx.restore();

  ctx.save();
  applyPaperTransform();
  ctx.strokeStyle = '#eadfce';
  ctx.lineWidth = 1.5 * dpr;
  ctx.strokeRect(paperRect.x, paperRect.y, paperRect.width, paperRect.height);
  ctx.restore();
}

function stopReplay() {
  replayFinished = false;
  if (replayStartDelayTimerId) {
    window.clearTimeout(replayStartDelayTimerId);
    replayStartDelayTimerId = null;
  }
  if (replayTimerId) {
    window.clearTimeout(replayTimerId);
    replayTimerId = null;
  }
  motionTimerIds.forEach((timerId) => window.clearTimeout(timerId));
  motionTimerIds = [];
  if (motionAnimationId) {
    window.cancelAnimationFrame(motionAnimationId);
    motionAnimationId = null;
  }
}

function queueMotion(callback, delayMs) {
  const timerId = window.setTimeout(() => {
    motionTimerIds = motionTimerIds.filter((id) => id !== timerId);
    callback();
  }, delayMs);
  motionTimerIds.push(timerId);
}

function resetStageMotion() {
  paperMotion = { rotationDeg: 0, slideY: 0 };
}

function runCompletionMotion() {
  queueMotion(() => {
    animatePaperMotion({ rotationDeg: 180, slideY: 0 }, { rotationDeg: 360, slideY: 0 }, 1000, () => {
      queueMotion(() => {
        animatePaperMotion(
          { rotationDeg: 360, slideY: 0 },
          { rotationDeg: 360, slideY: canvas.height + paperRect.height * 2 },
          1560,
          () => {
            replayFinished = true;
          }
        );
      }, 1000);
    });
  }, 1000);
}

function animatePaperMotion(from, to, durationMs, onDone) {
  const startedAt = performance.now();

  const tick = (now) => {
    const progress = Math.min(1, (now - startedAt) / durationMs);
    const eased = progress < 0.5 ? 2 * progress * progress : 1 - (-2 * progress + 2) ** 2 / 2;
    paperMotion = {
      rotationDeg: from.rotationDeg + (to.rotationDeg - from.rotationDeg) * eased,
      slideY: from.slideY + (to.slideY - from.slideY) * eased,
    };
    renderCurrentFrame();

    if (progress < 1) {
      motionAnimationId = window.requestAnimationFrame(tick);
      return;
    }

    motionAnimationId = null;
    if (onDone) onDone();
  };

  motionAnimationId = window.requestAnimationFrame(tick);
}

function applyPaperTransform() {
  const centerX = paperRect.x + paperRect.width / 2;
  const centerY = paperRect.y + paperRect.height / 2;
  ctx.translate(centerX, centerY + paperMotion.slideY);
  ctx.rotate((paperMotion.rotationDeg * Math.PI) / 180);
  ctx.translate(-centerX, -centerY);
}

function normalizeColor(color) {
  return /^#[0-9a-f]{6}$/i.test(color || '') ? color : '#111111';
}

function normalizePressure(pressure) {
  if (!Number.isFinite(pressure) || pressure <= 0) return 0.5;
  return Math.min(1, Math.max(0, pressure));
}

function getPointLineWidth(baseLineWidth, point) {
  return baseLineWidth * (0.55 + normalizePressure(point.pressure) * 0.9);
}

function getSourceCanvasSize() {
  const sourceCanvas = selectedRecord?.canvas || {};
  return {
    width: Math.max(1, Number(sourceCanvas.width) || canvas.width),
    height: Math.max(1, Number(sourceCanvas.height) || canvas.height),
  };
}

function getSignatureRect() {
  const source = getSourceCanvasSize();
  const sourceRatio = source.width / source.height;
  const paperRatio = paperRect.width / paperRect.height;
  let width = paperRect.width;
  let height = paperRect.height;

  if (sourceRatio > paperRatio) {
    height = width / sourceRatio;
  } else {
    width = height * sourceRatio;
  }

  return {
    x: paperRect.x + (paperRect.width - width) / 2,
    y: paperRect.y + (paperRect.height - height) / 2,
    width,
    height,
  };
}

function getBaseLineWidth(stroke) {
  const signatureRect = getSignatureRect();
  const source = getSourceCanvasSize();
  const targetShortSide = Math.max(1, Math.min(signatureRect.width, signatureRect.height));
  const sourceShortSide = Math.max(1, Math.min(source.width, source.height));
  const relativeScale = targetShortSide / sourceShortSide;
  return (Number(stroke.size) || 6) * dpr * relativeScale * (stroke.tool === 'eraser' ? 2.4 : 1);
}

function getPrintSignatureRect(record, printPaperRect) {
  const sourceCanvas = record?.canvas || {};
  const sourceWidth = Math.max(1, Number(sourceCanvas.width) || printPaperRect.width);
  const sourceHeight = Math.max(1, Number(sourceCanvas.height) || printPaperRect.height);
  const sourceRatio = sourceWidth / sourceHeight;
  const paperRatio = printPaperRect.width / printPaperRect.height;
  let width = printPaperRect.width;
  let height = printPaperRect.height;

  if (sourceRatio > paperRatio) {
    height = width / sourceRatio;
  } else {
    width = height * sourceRatio;
  }

  return {
    x: printPaperRect.x + (printPaperRect.width - width) / 2,
    y: printPaperRect.y + (printPaperRect.height - height) / 2,
    width,
    height,
    sourceShortSide: Math.min(sourceWidth, sourceHeight),
  };
}

function drawPrintStroke(printCtx, record, stroke, printPaperRect) {
  const points = stroke.points || [];
  if (!points.length) return;

  const rect = getPrintSignatureRect(record, printPaperRect);
  const baseLineWidth =
    (Number(stroke.size) || 6) *
    (Math.min(rect.width, rect.height) / Math.max(1, rect.sourceShortSide)) *
    (stroke.tool === 'eraser' ? 2.4 : 1);

  printCtx.lineCap = 'round';
  printCtx.lineJoin = 'round';
  printCtx.strokeStyle = stroke.tool === 'eraser' ? '#fffdf8' : normalizeColor(stroke.color);

  if (points.length === 1) {
    const point = points[0];
    const radius = getPointLineWidth(baseLineWidth, point) / 2;
    printCtx.beginPath();
    printCtx.arc(rect.x + point.x * rect.width, rect.y + point.y * rect.height, radius, 0, Math.PI * 2);
    printCtx.fillStyle = printCtx.strokeStyle;
    printCtx.fill();
    return;
  }

  for (let i = 1; i < points.length; i += 1) {
    const previous = points[i - 1];
    const point = points[i];
    printCtx.lineWidth =
      (getPointLineWidth(baseLineWidth, previous) + getPointLineWidth(baseLineWidth, point)) / 2;
    printCtx.beginPath();
    printCtx.moveTo(rect.x + previous.x * rect.width, rect.y + previous.y * rect.height);
    printCtx.lineTo(rect.x + point.x * rect.width, rect.y + point.y * rect.height);
    printCtx.stroke();
  }

}

function createPrintImage(record) {
  const sourceCanvas = document.createElement('canvas');
  sourceCanvas.width = 890;
  sourceCanvas.height = 1270;
  const sourceCtx = sourceCanvas.getContext('2d');
  const printPaperRect = { x: 0, y: 0, width: sourceCanvas.width, height: sourceCanvas.height };

  sourceCtx.fillStyle = '#ffffff';
  sourceCtx.fillRect(0, 0, sourceCanvas.width, sourceCanvas.height);
  sourceCtx.fillStyle = '#fffdf8';
  sourceCtx.fillRect(printPaperRect.x, printPaperRect.y, printPaperRect.width, printPaperRect.height);

  (record.strokes || []).forEach((stroke) => drawPrintStroke(sourceCtx, record, stroke, printPaperRect));

  const printCanvas = document.createElement('canvas');
  printCanvas.width = sourceCanvas.width;
  printCanvas.height = sourceCanvas.height;
  const printCtx = printCanvas.getContext('2d');
  printCtx.translate(printCanvas.width / 2, printCanvas.height / 2);
  printCtx.rotate(Math.PI);
  printCtx.drawImage(sourceCanvas, -sourceCanvas.width / 2, -sourceCanvas.height / 2);
  return printCanvas.toDataURL('image/png');
}

async function printCompletedSignature(record) {
  try {
    await window.signReplay.printImage(createPrintImage(record));
  } catch (error) {
    console.error(error);
  }
}

function drawStroke(stroke, points = stroke.points || []) {
  if (!points.length) return;

  const { x, y, width, height } = getSignatureRect();
  ctx.save();
  applyPaperTransform();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = stroke.tool === 'eraser' ? '#ffffff' : normalizeColor(stroke.color);
  const baseLineWidth = getBaseLineWidth(stroke);

  if (points.length === 1) {
    const point = points[0];
    const radius = getPointLineWidth(baseLineWidth, point) / 2;
    ctx.beginPath();
    ctx.arc(x + point.x * width, y + point.y * height, radius, 0, Math.PI * 2);
    ctx.fillStyle = ctx.strokeStyle;
    ctx.fill();
    ctx.restore();
    return;
  }

  for (let i = 1; i < points.length; i += 1) {
    const previous = points[i - 1];
    const point = points[i];
    ctx.lineWidth =
      (getPointLineWidth(baseLineWidth, previous) + getPointLineWidth(baseLineWidth, point)) / 2;
    ctx.beginPath();
    ctx.moveTo(x + previous.x * width, y + previous.y * height);
    ctx.lineTo(x + point.x * width, y + point.y * height);
    ctx.stroke();
  }

  ctx.restore();
}

function renderCurrentFrame() {
  clearCanvas();
  currentDrawItems.forEach((item) => {
    drawStroke(item.stroke, item.points);
  });
}

function normalizeStrokeTiming(stroke, strokeIndex) {
  const fallbackStart = strokeIndex * 120;
  const startedAtElapsedMs = Number.isFinite(stroke.startedAtElapsedMs)
    ? stroke.startedAtElapsedMs
    : fallbackStart;
  return {
    ...stroke,
    points: (stroke.points || []).map((point, pointIndex) => ({
      ...point,
      elapsedMs: Number.isFinite(point.elapsedMs)
        ? point.elapsedMs
        : startedAtElapsedMs + (Number.isFinite(point.t) ? point.t : pointIndex * 16),
    })),
  };
}

function replayRecord(record) {
  stopReplay();
  replayFinished = false;
  resetStageMotion();
  paperMotion = { rotationDeg: 180, slideY: 0 };
  currentDrawItems = [];
  clearCanvas();

  const strokes = Array.isArray(record.strokes) ? record.strokes : [];
  const events = [];
  strokes.forEach((stroke, strokeIndex) => {
    const normalizedStroke = normalizeStrokeTiming(stroke, strokeIndex);
    normalizedStroke.points.forEach((point, pointIndex) => {
      events.push({
        at: point.elapsedMs,
        stroke: normalizedStroke,
        strokeIndex,
        pointIndex,
      });
    });
  });

  events.sort((a, b) => a.at - b.at || a.strokeIndex - b.strokeIndex || a.pointIndex - b.pointIndex);

  if (!events.length) {
    setStatus('再生できる点がありません');
    return;
  }

  const speed = Number(speedInput.value) || 1;
  const partial = new Map();
  const startedAt = performance.now();
  let cursor = 0;
  setStatus('再生中');

  const tick = () => {
    const elapsed = (performance.now() - startedAt) * speed;
    while (cursor < events.length && events[cursor].at <= elapsed) {
      const event = events[cursor];
      partial.set(event.strokeIndex, {
        stroke: event.stroke,
        points: event.stroke.points.slice(0, event.pointIndex + 1),
      });
      cursor += 1;
    }

    currentDrawItems = [...partial.keys()]
      .sort((a, b) => a - b)
      .map((key) => partial.get(key));
    renderCurrentFrame();

    if (cursor < events.length) {
      const nextDelay = Math.max(8, (events[cursor].at - elapsed) / speed);
      replayTimerId = window.setTimeout(tick, nextDelay);
      return;
    }

    replayTimerId = null;
    setStatus('再生完了');
    runCompletionMotion();
  };

  tick();
}

async function startVideoThenReplay(record, runId) {
  try {
    await window.signReplay.playVideo();
  } catch (error) {
    console.error(error);
  }

  if (runId !== replayRunId) return;

  replayStartDelayTimerId = window.setTimeout(() => {
    if (runId !== replayRunId) return;
    replayStartDelayTimerId = null;
    replayRecord(record);
  }, 4000);
}

function restartSelectedRecord() {
  if (!selectedRecord || stage.hidden || !replayFinished) return;
  replayRunId += 1;
  const runId = replayRunId;
  stopReplay();
  replayFinished = false;
  resetStageMotion();
  resizeCanvas();
  if (printOnOpenInput.checked) {
    printCompletedSignature(selectedRecord);
  }
  startVideoThenReplay(selectedRecord, runId);
}

function calculateDuration(record) {
  if (Number.isFinite(record.capture?.durationMs)) return record.capture.durationMs;
  return (record.strokes || []).reduce((maxMs, stroke) => {
    const lastPoint = stroke.points?.[stroke.points.length - 1];
    return Math.max(maxMs, lastPoint?.elapsedMs || 0);
  }, 0);
}

function countPoints(record) {
  if (Number.isFinite(record.capture?.pointCount)) return record.capture.pointCount;
  return (record.strokes || []).reduce((sum, stroke) => sum + (stroke.points?.length || 0), 0);
}

function describeRecord(record, index) {
  const name = record.talentName || record.talent_name || '名称未設定';
  const createdAt = record.updatedAt || record.createdAt || record.created_at || '';
  const date = createdAt ? new Date(createdAt).toLocaleString('ja-JP') : `#${index + 1}`;
  return `${name} / ${date}`;
}

function selectRecord(index) {
  selectedRecord = records[index] || null;
  replayRunId += 1;
  const runId = replayRunId;
  stopReplay();
  clearCanvas();

  if (!selectedRecord) {
    setStatus('サーバに保存データがありません');
    return;
  }

  appRoot.classList.remove('app-choosing');
  chooser.hidden = true;
  stage.hidden = false;
  resetStageMotion();
  requestAnimationFrame(() => {
    resizeCanvas();
    if (printOnOpenInput.checked) {
      printCompletedSignature(selectedRecord);
    }
    startVideoThenReplay(selectedRecord, runId);
  });
}

function renderRecords() {
  recordList.textContent = '';
  records.forEach((record, index) => {
    const button = document.createElement('button');
    button.className = 'record-button';
    button.type = 'button';
    button.textContent = describeRecord(record, index);
    button.addEventListener('click', () => selectRecord(index));
    recordList.append(button);
  });
  setStatus(records.length ? `${records.length}件から選択してください` : 'サーバに保存データがありません');
}

function isRecordLike(value) {
  return Boolean(value && typeof value === 'object' && Array.isArray(value.strokes));
}

function extractRecords(value) {
  const source = Array.isArray(value) ? value : [value];
  const extracted = [];

  source.forEach((item) => {
    if (isRecordLike(item)) {
      extracted.push(item);
      return;
    }
    if (isRecordLike(item?.payload)) {
      extracted.push({
        ...item.payload,
        talentName: item.payload.talentName || item.talent_name,
        createdAt: item.payload.createdAt || item.created_at,
      });
      return;
    }
    if (Array.isArray(item?.payload)) {
      extracted.push(...extractRecords(item.payload));
    }
  });

  return extracted;
}

function loadRows(rows) {
  const nextRecords = extractRecords(rows);
  if (!nextRecords.length) throw new Error('サインレコードが見つかりません');
  records = nextRecords;
  renderRecords();
  setStatus(`サーバから${records.length}件を取得しました`);
}

async function fetchRecordsOnStartup() {
  setStatus('サーバから取得中');

  try {
    const rows = await window.signReplay.fetchRecords();
    loadRows(rows);
  } catch (error) {
    console.error(error);
    setStatus('サーバ取得失敗: service_roleキーかSELECT権限を確認');
  }
}

window.addEventListener('resize', resizeCanvas);
window.addEventListener('keydown', (event) => {
  if (event.key.toLowerCase() !== 'r' || event.metaKey || event.ctrlKey || event.altKey) return;
  restartSelectedRecord();
});
requestAnimationFrame(() => {
  resizeCanvas();
  fetchRecordsOnStartup();
});
