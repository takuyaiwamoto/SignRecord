const canvas = document.getElementById('replay-canvas');
const ctx = canvas.getContext('2d');
const fileInput = document.getElementById('file-input');
const jsonInput = document.getElementById('json-input');
const fetchButton = document.getElementById('fetch-button');
const parseButton = document.getElementById('parse-button');
const recordSelect = document.getElementById('record-select');
const replayButton = document.getElementById('replay-button');
const clearButton = document.getElementById('clear-button');
const speedInput = document.getElementById('speed-input');
const speedOutput = document.getElementById('speed-output');
const autoClearInput = document.getElementById('auto-clear-input');
const statusText = document.getElementById('status');
const titleText = document.getElementById('title');
const pointCountText = document.getElementById('point-count');
const durationText = document.getElementById('duration');

let dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 3));
let records = [];
let selectedRecord = null;
let replayTimerId = null;
let autoClearTimerId = null;

function setStatus(text) {
  statusText.textContent = text;
}

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 3));
  canvas.width = Math.max(1, Math.round(rect.width * dpr));
  canvas.height = Math.max(1, Math.round(rect.height * dpr));
  clearCanvas();
}

function clearCanvas() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

function stopReplay() {
  if (replayTimerId) {
    window.clearTimeout(replayTimerId);
    replayTimerId = null;
  }
  if (autoClearTimerId) {
    window.clearTimeout(autoClearTimerId);
    autoClearTimerId = null;
  }
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

function drawStroke(stroke, points = stroke.points || []) {
  if (!points.length) return;

  const width = canvas.width;
  const height = canvas.height;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = stroke.tool === 'eraser' ? '#ffffff' : normalizeColor(stroke.color);
  const baseLineWidth = (Number(stroke.size) || 6) * dpr * (stroke.tool === 'eraser' ? 2.4 : 1);

  if (points.length === 1) {
    const point = points[0];
    const radius = getPointLineWidth(baseLineWidth, point) / 2;
    ctx.beginPath();
    ctx.arc(point.x * width, point.y * height, radius, 0, Math.PI * 2);
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
    ctx.moveTo(previous.x * width, previous.y * height);
    ctx.lineTo(point.x * width, point.y * height);
    ctx.stroke();
  }

  ctx.restore();
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

    clearCanvas();
    [...partial.keys()]
      .sort((a, b) => a - b)
      .forEach((key) => {
        const item = partial.get(key);
        drawStroke(item.stroke, item.points);
      });

    if (cursor < events.length) {
      const nextDelay = Math.max(8, (events[cursor].at - elapsed) / speed);
      replayTimerId = window.setTimeout(tick, nextDelay);
      return;
    }

    replayTimerId = null;
    setStatus('再生完了');
    if (autoClearInput.checked) {
      autoClearTimerId = window.setTimeout(() => {
        autoClearTimerId = null;
        clearCanvas();
      }, 1500);
    }
  };

  tick();
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
  stopReplay();
  clearCanvas();

  if (!selectedRecord) {
    titleText.textContent = '未選択';
    pointCountText.textContent = '0';
    durationText.textContent = '0.00秒';
    setStatus('JSONを読み込んでください');
    return;
  }

  titleText.textContent = selectedRecord.talentName || selectedRecord.talent_name || '名称未設定';
  pointCountText.textContent = String(countPoints(selectedRecord));
  durationText.textContent = `${(calculateDuration(selectedRecord) / 1000).toFixed(2)}秒`;
  setStatus('再生できます');
}

function renderRecords() {
  recordSelect.textContent = '';
  records.forEach((record, index) => {
    const option = document.createElement('option');
    option.value = String(index);
    option.textContent = describeRecord(record, index);
    recordSelect.append(option);
  });
  recordSelect.selectedIndex = records.length ? 0 : -1;
  selectRecord(recordSelect.selectedIndex);
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

function loadJsonText(text) {
  const parsed = JSON.parse(text);
  const nextRecords = extractRecords(parsed);
  if (!nextRecords.length) throw new Error('サインレコードが見つかりません');
  records = nextRecords;
  renderRecords();
  setStatus(`${records.length}件を読み込みました`);
}

function loadRows(rows) {
  const nextRecords = extractRecords(rows);
  if (!nextRecords.length) throw new Error('サインレコードが見つかりません');
  records = nextRecords;
  renderRecords();
  setStatus(`サーバから${records.length}件を取得しました`);
}

fetchButton.addEventListener('click', async () => {
  fetchButton.disabled = true;
  setStatus('サーバから取得中');

  try {
    const rows = await window.signReplay.fetchRecords();
    loadRows(rows);
  } catch (error) {
    console.error(error);
    setStatus('サーバ取得失敗: service_roleキーかSELECT権限を確認');
  } finally {
    fetchButton.disabled = false;
  }
});

fileInput.addEventListener('change', async () => {
  const file = fileInput.files?.[0];
  if (!file) return;

  try {
    loadJsonText(await file.text());
  } catch (error) {
    console.error(error);
    setStatus('読み込み失敗');
  } finally {
    fileInput.value = '';
  }
});

parseButton.addEventListener('click', () => {
  try {
    loadJsonText(jsonInput.value);
  } catch (error) {
    console.error(error);
    setStatus('読み込み失敗');
  }
});

recordSelect.addEventListener('change', () => {
  selectRecord(Number(recordSelect.value));
});

replayButton.addEventListener('click', () => {
  if (selectedRecord) replayRecord(selectedRecord);
});

clearButton.addEventListener('click', () => {
  stopReplay();
  clearCanvas();
  setStatus(selectedRecord ? '再生できます' : 'JSONを読み込んでください');
});

speedInput.addEventListener('input', () => {
  speedOutput.textContent = `${Number(speedInput.value).toFixed(2)}x`;
});

window.addEventListener('resize', resizeCanvas);
requestAnimationFrame(resizeCanvas);
