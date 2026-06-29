const STORAGE_KEY = 'talent-sign-capture.records.v1';
const PENDING_STORAGE_KEY = 'talent-sign-capture.pending-records.v1';
const DATA_VERSION = 2;
const SUPABASE_URL = 'https://tqwtcsbdfriyiirzmmit.supabase.co';
const SUPABASE_KEY = 'sb_publishable_4T6OLyoDE9-eS9y-TTZIFQ_OXICQf9t';
const SUPABASE_TABLE = 'sign_records';
const EVENT_ID = 'default';

const canvas = document.getElementById('sign-canvas');
const ctx = canvas.getContext('2d');
const form = document.getElementById('talent-form');
const talentNameInput = document.getElementById('talent-name');
const saveStatus = document.getElementById('save-status');
const brushSizeInput = document.getElementById('brush-size');
const penTool = document.getElementById('pen-tool');
const eraserTool = document.getElementById('eraser-tool');
const undoButton = document.getElementById('undo-button');
const clearButton = document.getElementById('clear-button');
const saveButton = document.getElementById('save-button');
const replayButton = document.getElementById('replay-button');
const colorInputs = [...document.querySelectorAll('input[name="penColor"]')];
const importInput = document.getElementById('import-input');
const recordList = document.getElementById('record-list');
const recordTemplate = document.getElementById('record-template');

let dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 3));
let activeTool = 'pen';
let activePenColor = '#111111';
let activeRecordId = null;
let currentStroke = null;
let captureStartedAtMs = null;
let replayTimerId = null;
let replayClearTimerId = null;
let canvasDisplayCleared = false;
let strokes = [];

/**
 * サインレコード用の一意IDを作る。
 * @returns {string} レコードID
 */
function createId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return `sign-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * JSON互換データを安全に複製する。
 * @param {unknown} value 複製対象
 * @returns {unknown} 複製後データ
 */
function cloneData(value) {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

/**
 * ブラウザ保存済みのサインレコードを読み込む。
 * @returns {Array<object>} 保存済みレコード
 */
function loadRecords() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  } catch {
    return [];
  }
}

/**
 * サインレコード一覧をブラウザストレージへ保存する。
 * @param {Array<object>} records 保存するレコード配列
 */
function storeRecords(records) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
}

/**
 * 通信失敗時に未送信として退避したレコードを読み込む。
 * @returns {Array<object>} 未送信レコード
 */
function loadPendingRecords() {
  try {
    return JSON.parse(localStorage.getItem(PENDING_STORAGE_KEY) || '[]');
  } catch {
    return [];
  }
}

/**
 * 未送信レコードをブラウザストレージへ保存する。
 * @param {Array<object>} records 未送信レコード配列
 */
function storePendingRecords(records) {
  localStorage.setItem(PENDING_STORAGE_KEY, JSON.stringify(records));
}

/**
 * Supabaseへサインレコードを保存する。
 * @param {object} record 保存するサインレコード
 * @returns {Promise<void>}
 */
async function submitRecordToSupabase(record) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${SUPABASE_TABLE}`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({
      event_id: EVENT_ID,
      talent_name: record.talentName,
      payload: record,
    }),
  });

  if (!response.ok) {
    const message = await response.text().catch(() => '');
    throw new Error(message || `Supabase save failed: ${response.status}`);
  }
}

/**
 * 通信失敗時の未送信レコードを重複なしで退避する。
 * @param {object} record 退避するサインレコード
 */
function queuePendingRecord(record) {
  const pendingRecords = loadPendingRecords();
  const nextRecords = [record, ...pendingRecords.filter((item) => item.id !== record.id)];
  storePendingRecords(nextRecords);
}

/**
 * 現在時刻をサインデータ用のISO文字列で返す。
 * @returns {string} ISO 8601日時
 */
function nowIso() {
  return new Date().toISOString();
}

/**
 * 入力イベントをサイン再現用の筆跡ポイントへ変換する。
 * @param {PointerEvent|MouseEvent|Touch} event ポインターイベント
 * @param {object} stroke 追加先ストローク
 * @returns {object} 正規化座標、筆圧、経過時間、速度を含むポイント
 */
function eventToPoint(event, stroke) {
  const rect = canvas.getBoundingClientRect();
  const eventMs = Number.isFinite(event.timeStamp) ? event.timeStamp : performance.now();
  const elapsedMs = Math.max(0, eventMs - captureStartedAtMs);
  const strokeElapsedMs = Math.max(0, eventMs - stroke.startedAtMs);
  const x = clamp((event.clientX - rect.left) / rect.width, 0, 1);
  const y = clamp((event.clientY - rect.top) / rect.height, 0, 1);
  const previous = stroke.points[stroke.points.length - 1] || null;
  const dxCss = previous ? (x - previous.x) * rect.width : 0;
  const dyCss = previous ? (y - previous.y) * rect.height : 0;
  const distancePx = Math.hypot(dxCss, dyCss);
  const distanceNormalized = previous ? Math.hypot(x - previous.x, y - previous.y) : 0;
  const deltaMs = previous ? Math.max(0, elapsedMs - previous.elapsedMs) : 0;

  return {
    x,
    y,
    pressure: normalizePressure(event.pressure),
    elapsedMs: Math.round(elapsedMs),
    strokeElapsedMs: Math.round(strokeElapsedMs),
    deltaMs: Math.round(deltaMs),
    distancePx: roundMetric(distancePx),
    distanceNormalized: roundMetric(distanceNormalized),
    speedPxPerSecond: deltaMs > 0 ? roundMetric((distancePx / deltaMs) * 1000) : 0,
    speedNormalizedPerSecond: deltaMs > 0 ? roundMetric((distanceNormalized / deltaMs) * 1000) : 0,
    width: roundMetric(event.width || 0),
    height: roundMetric(event.height || 0),
    tiltX: Math.round(event.tiltX || 0),
    tiltY: Math.round(event.tiltY || 0),
    twist: Math.round(event.twist || 0),
    tangentialPressure: roundMetric(event.tangentialPressure || 0),
    altitudeAngle: roundMetric(event.altitudeAngle || 0),
    azimuthAngle: roundMetric(event.azimuthAngle || 0),
    t: Math.round(strokeElapsedMs),
  };
}

/**
 * 筆圧未対応端末でも再現しやすい標準値へ整える。
 * @param {number|undefined} pressure 入力筆圧
 * @returns {number} 0..1の筆圧
 */
function normalizePressure(pressure) {
  if (!Number.isFinite(pressure) || pressure <= 0) return 0.5;
  return roundMetric(clamp(pressure, 0, 1));
}

/**
 * 保存データの数値を十分な精度に丸める。
 * @param {number} value 対象値
 * @returns {number} 丸め後の値
 */
function roundMetric(value) {
  return Math.round(value * 10000) / 10000;
}

/**
 * 数値を指定範囲に収める。
 * @param {number} value 対象値
 * @param {number} min 最小値
 * @param {number} max 最大値
 * @returns {number} 範囲内に丸めた値
 */
function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/**
 * キャンバス表示サイズと内部解像度を同期する。
 */
function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 3));
  canvas.width = Math.max(1, Math.round(rect.width * dpr));
  canvas.height = Math.max(1, Math.round(rect.height * dpr));
  if (canvasDisplayCleared) {
    clearCanvas({ markCleared: true });
    return;
  }
  redraw();
}

/**
 * 1ストロークをキャンバスへ描画する。
 * @param {object} stroke 描画ストローク
 */
function drawStroke(stroke) {
  if (!stroke.points.length) return;

  const width = canvas.width;
  const height = canvas.height;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = stroke.tool === 'eraser' ? '#ffffff' : normalizeColor(stroke.color);
  const baseLineWidth = stroke.size * dpr * (stroke.tool === 'eraser' ? 2.4 : 1);

  const points = stroke.points;

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

  // 筆圧を線幅に反映するため、セグメント単位で描く。
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

/**
 * 保存された色指定を安全なCSSカラーへ整える。
 * @param {string|undefined} color 保存色
 * @returns {string} 描画に使う色
 */
function normalizeColor(color) {
  return /^#[0-9a-f]{6}$/i.test(color || '') ? color : '#111111';
}

/**
 * 筆圧から描画線幅を計算する。
 * @param {number} baseLineWidth 基準線幅
 * @param {object} point 筆跡ポイント
 * @returns {number} 実際に描画する線幅
 */
function getPointLineWidth(baseLineWidth, point) {
  const pressure = normalizePressure(point.pressure);
  return baseLineWidth * (0.55 + pressure * 0.9);
}

/**
 * 指定された途中状態のストロークだけを描画する。
 * @param {object} stroke 元ストローク
 * @param {Array<object>} points 再生中に表示するポイント
 */
function drawStrokeSlice(stroke, points) {
  drawStroke({ ...stroke, points });
}

/**
 * キャンバス表示だけを白紙に戻す。
 * @param {{markCleared?: boolean}} options 表示だけ消した状態として扱うか
 */
function clearCanvas({ markCleared = false } = {}) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  canvasDisplayCleared = markCleared;
}

/**
 * 全ストロークを現在のキャンバスサイズへ再描画する。
 */
function redraw() {
  clearCanvas();
  strokes.forEach(drawStroke);
}

/**
 * 再生タイマーを止める。
 */
function stopReplay() {
  if (replayTimerId) {
    window.clearTimeout(replayTimerId);
    replayTimerId = null;
  }
  if (replayClearTimerId) {
    window.clearTimeout(replayClearTimerId);
    replayClearTimerId = null;
  }
}

/**
 * 保存済み筆跡を、書き順と速度に沿って再生する。
 * @param {Array<object>} sourceStrokes 再生するストローク
 * @param {{finalize?: boolean}} options 再生オプション
 */
function replayStrokes(sourceStrokes, { finalize = true } = {}) {
  stopReplay();
  const events = [];

  sourceStrokes.forEach((stroke, strokeIndex) => {
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
  const partial = new Map();
  clearCanvas();

  const startedAt = performance.now();
  let cursor = 0;

  const tick = () => {
    const elapsed = performance.now() - startedAt;
    while (cursor < events.length && events[cursor].at <= elapsed) {
      const event = events[cursor];
      const points = event.stroke.points.slice(0, event.pointIndex + 1);
      partial.set(event.strokeIndex, { stroke: event.stroke, points });
      cursor += 1;
    }

    clearCanvas();
    [...partial.keys()]
      .sort((a, b) => a - b)
      .forEach((key) => {
        const item = partial.get(key);
        drawStrokeSlice(item.stroke, item.points);
      });

    if (cursor < events.length) {
      const nextDelay = Math.max(8, events[cursor].at - (performance.now() - startedAt));
      replayTimerId = window.setTimeout(tick, nextDelay);
      return;
    }

    replayTimerId = null;
    if (finalize) {
      redraw();
      replayClearTimerId = window.setTimeout(() => {
        replayClearTimerId = null;
        clearCanvas({ markCleared: true });
      }, 1500);
    }
    setStatus('再現済み', true);
  };

  tick();
}

/**
 * 古い保存データも再生できるよう、時間情報を補完する。
 * @param {object} stroke 対象ストローク
 * @param {number} strokeIndex ストローク順
 * @returns {object} 再生用に整えたストローク
 */
function normalizeStrokeTiming(stroke, strokeIndex) {
  const clone = cloneData(stroke);
  const fallbackStart = strokeIndex * 120;
  clone.startedAtElapsedMs = Number.isFinite(clone.startedAtElapsedMs)
    ? clone.startedAtElapsedMs
    : fallbackStart;
  clone.points = (clone.points || []).map((point, pointIndex) => ({
    ...point,
    elapsedMs: Number.isFinite(point.elapsedMs)
      ? point.elapsedMs
      : clone.startedAtElapsedMs + (Number.isFinite(point.t) ? point.t : pointIndex * 16),
  }));
  return clone;
}

/**
 * 現在編集中のデータを保存可能なレコードへ変換する。
 * @returns {object} サインレコード
 */
function buildRecord() {
  const createdAt = activeRecordId
    ? loadRecords().find((record) => record.id === activeRecordId)?.createdAt || nowIso()
    : nowIso();

  return {
    version: DATA_VERSION,
    id: activeRecordId || createId(),
    talentName: talentNameInput.value.trim(),
    talentId: '',
    note: '',
    createdAt,
    updatedAt: nowIso(),
    capture: {
      startedAtMs: Math.round(captureStartedAtMs || 0),
      durationMs: calculateCaptureDuration(strokes),
      pointCount: strokes.reduce((sum, stroke) => sum + stroke.points.length, 0),
      timing: 'elapsedMs',
      order: 'array-index',
    },
    canvas: {
      width: canvas.width,
      height: canvas.height,
      coordinateSpace: 'normalized',
    },
    strokes: cloneData(strokes),
  };
}

/**
 * レコードを編集画面へ読み込む。
 * @param {object} record 読み込むサインレコード
 */
function loadRecordIntoEditor(record) {
  stopReplay();
  activeRecordId = record.id;
  talentNameInput.value = record.talentName || '';
  strokes = Array.isArray(record.strokes) ? cloneData(record.strokes) : [];
  renderRecordList();
  replayStrokes(strokes);
}

/**
 * 保存対象ストローク全体の記録時間を算出する。
 * @param {Array<object>} targetStrokes 対象ストローク
 * @returns {number} 記録時間ms
 */
function calculateCaptureDuration(targetStrokes) {
  const lastMs = targetStrokes.reduce((maxMs, stroke) => {
    const lastPoint = stroke.points[stroke.points.length - 1];
    return Math.max(maxMs, lastPoint?.elapsedMs || 0);
  }, 0);
  return Math.round(lastMs);
}

/**
 * 保存済みレコード一覧を画面へ反映する。
 */
function renderRecordList() {
  const records = loadRecords().sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  recordList.textContent = '';

  if (!records.length) {
    const empty = document.createElement('p');
    empty.className = 'empty-state';
    empty.textContent = '保存されたサインはまだありません。';
    recordList.append(empty);
    return;
  }

  records.forEach((record) => {
    const node = recordTemplate.content.firstElementChild.cloneNode(true);
    if (record.id === activeRecordId) node.classList.add('is-selected');
    node.querySelector('strong').textContent = record.talentName || '名称未設定';
    node.querySelector('span').textContent = `${formatDate(record.updatedAt)} / ${formatRecordMetrics(record)}`;
    node.querySelector('.record-main').addEventListener('click', () => loadRecordIntoEditor(record));
    node.querySelector('.record-delete').addEventListener('click', () => deleteRecord(record.id));
    recordList.append(node);
  });
}

/**
 * 保存済みサインの確認用メタ情報を表示向けに整える。
 * @param {object} record サインレコード
 * @returns {string} 記録時間と点数
 */
function formatRecordMetrics(record) {
  const durationMs = record.capture?.durationMs || calculateCaptureDuration(record.strokes || []);
  const pointCount =
    record.capture?.pointCount || (record.strokes || []).reduce((sum, stroke) => sum + (stroke.points?.length || 0), 0);
  return `${formatDuration(durationMs)} / ${pointCount}点`;
}

/**
 * 記録時間を確認しやすい秒表記にする。
 * @param {number} durationMs 記録時間ms
 * @returns {string} 表示用の秒数
 */
function formatDuration(durationMs) {
  const seconds = durationMs / 1000;
  return `${seconds < 1 ? seconds.toFixed(2) : seconds.toFixed(1)}秒`;
}

/**
 * ISO日時を一覧表示用に短く整える。
 * @param {string} iso ISO日時
 * @returns {string} 表示用日時
 */
function formatDate(iso) {
  if (!iso) return '日時なし';
  return new Intl.DateTimeFormat('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

/**
 * 保存状態ラベルを更新する。
 * @param {string} text 表示文言
 * @param {boolean} saved 保存済み状態か
 */
function setStatus(text, saved = false) {
  saveStatus.textContent = text;
  saveStatus.classList.toggle('saved', saved);
}

/**
 * 現在の編集内容をSupabaseへ保存する。
 */
async function saveCurrentRecord() {
  if (!form.reportValidity()) return;
  stopReplay();
  const record = buildRecord();
  const records = loadRecords();
  saveButton.disabled = true;
  setStatus('保存中');

  try {
    await submitRecordToSupabase(record);
    const savedRecord = {
      ...record,
      eventId: EVENT_ID,
      remoteSavedAt: nowIso(),
      pendingUpload: false,
    };
    const nextRecords = [savedRecord, ...records.filter((item) => item.id !== record.id)];
    storeRecords(nextRecords);
    storePendingRecords(loadPendingRecords().filter((item) => item.id !== record.id));
    setStatus('保存済み', true);
  } catch (error) {
    queuePendingRecord(record);
    const queuedRecord = {
      ...record,
      eventId: EVENT_ID,
      pendingUpload: true,
    };
    const nextRecords = [queuedRecord, ...records.filter((item) => item.id !== record.id)];
    storeRecords(nextRecords);
    console.error(error);
    setStatus('未送信保存');
  } finally {
    saveButton.disabled = false;
  }

  activeRecordId = null;
  captureStartedAtMs = null;
  currentStroke = null;
  strokes = [];
  clearCanvas({ markCleared: true });
  renderRecordList();
}

/**
 * 指定IDの保存済みレコードを削除する。
 * @param {string} id レコードID
 */
function deleteRecord(id) {
  storeRecords(loadRecords().filter((record) => record.id !== id));
  if (activeRecordId === id) {
    activeRecordId = null;
    strokes = [];
    redraw();
    setStatus('削除済み');
  }
  renderRecordList();
}

/**
 * 現在のサイン入力を破棄し、編集中レコードがあれば保存済み一覧からも削除する。
 */
function resetCurrentSignature() {
  stopReplay();
  // タレント向けの「やり直し」は、画面上の線と直前保存データを同じ操作で消す。
  if (activeRecordId) {
    storeRecords(loadRecords().filter((record) => record.id !== activeRecordId));
  }
  activeRecordId = null;
  captureStartedAtMs = null;
  strokes = [];
  redraw();
  renderRecordList();
  setStatus('やり直し');
}

/**
 * JSONから読み込んだサインデータが最低限使える形か確認する。
 * @param {unknown} data 検証対象
 * @returns {boolean} 有効なサインデータならtrue
 */
function isValidRecord(data) {
  return Boolean(data && typeof data === 'object' && Array.isArray(data.strokes));
}

/**
 * ポインター入力を開始し、タップだけでも署名の点が残るよう即時描画する。
 * @param {PointerEvent} event ポインターイベント
 */
function beginStroke(event) {
  stopReplay();
  event.preventDefault();
  if (canvasDisplayCleared && strokes.length) {
    activeRecordId = null;
    captureStartedAtMs = null;
    strokes = [];
    renderRecordList();
  }
  const eventMs = Number.isFinite(event.timeStamp) ? event.timeStamp : performance.now();
  if (captureStartedAtMs === null) captureStartedAtMs = eventMs;
  if (event.pointerId !== undefined && canvas.setPointerCapture) {
    try {
      canvas.setPointerCapture(event.pointerId);
    } catch {
      // ブラウザ差異でcaptureできない場合も、描画自体は継続できる。
    }
  }
  currentStroke = {
    tool: activeTool,
    size: Number(brushSizeInput.value),
    color: activeTool === 'eraser' ? '#ffffff' : activePenColor,
    pointerType: event.pointerType || 'touch',
    startedAt: nowIso(),
    startedAtMs: eventMs,
    startedAtElapsedMs: Math.round(eventMs - captureStartedAtMs),
    order: strokes.length,
    points: [],
  };
  currentStroke.points.push(eventToPoint(event, currentStroke));
  strokes.push(currentStroke);
  redraw();
  setStatus('編集中');
}

/**
 * 入力中のストロークへ点を追加する。
 * @param {PointerEvent} event ポインターイベント
 */
function appendStrokePoint(event) {
  if (!currentStroke) return;
  event.preventDefault();
  const coalescedEvents = typeof event.getCoalescedEvents === 'function' ? event.getCoalescedEvents() : [];
  const events = coalescedEvents.length ? coalescedEvents : [event];

  events.forEach((inputEvent) => {
    const point = eventToPoint(inputEvent, currentStroke);
    const previous = currentStroke.points[currentStroke.points.length - 1];
    const dx = point.x - previous.x;
    const dy = point.y - previous.y;

    // 点を詰め込みすぎると保存データが重くなるため、見た目に影響しにくい微小移動だけを間引く。
    if (dx * dx + dy * dy < 0.000001 && point.deltaMs < 8) return;

    currentStroke.points.push(point);
  });
  redraw();
}

/**
 * ポインター入力を終了する。
 * @param {PointerEvent} event ポインターイベント
 */
function endStroke(event) {
  event.preventDefault();
  if (currentStroke) {
    currentStroke.endedAt = nowIso();
    const lastPoint = currentStroke.points[currentStroke.points.length - 1];
    currentStroke.durationMs = Math.round(lastPoint?.strokeElapsedMs || 0);
  }
  if (currentStroke && currentStroke.points.length === 1) redraw();
  currentStroke = null;
}

/**
 * TouchEventから先頭タッチを取り出す。
 * @param {TouchEvent} event タッチイベント
 * @returns {Touch|null} 入力中のタッチ
 */
function firstTouch(event) {
  return event.touches[0] || event.changedTouches[0] || null;
}

/**
 * TouchをPointerEvent相当の最小データへ変換する。
 * @param {Touch} touch タッチ情報
 * @returns {{clientX:number,clientY:number,pressure:number,pointerType:string,preventDefault:function}} 入力処理用イベント
 */
function touchToInput(touch) {
  return {
    clientX: touch.clientX,
    clientY: touch.clientY,
    timeStamp: performance.now(),
    pressure: touch.force || 0.5,
    pointerType: 'touch',
    preventDefault() {},
  };
}

if (window.PointerEvent) {
  canvas.addEventListener('pointerdown', beginStroke);
  canvas.addEventListener('pointermove', appendStrokePoint);
  canvas.addEventListener('pointerup', endStroke);
  canvas.addEventListener('pointercancel', endStroke);
  canvas.addEventListener('pointerleave', () => {
    currentStroke = null;
  });
} else {
  canvas.addEventListener('touchstart', (event) => {
    const touch = firstTouch(event);
    if (touch) beginStroke(touchToInput(touch));
    event.preventDefault();
  });
  canvas.addEventListener('touchmove', (event) => {
    const touch = firstTouch(event);
    if (touch) appendStrokePoint(touchToInput(touch));
    event.preventDefault();
  });
  canvas.addEventListener('touchend', (event) => {
    endStroke(event);
  });
  canvas.addEventListener('mousedown', beginStroke);
  canvas.addEventListener('mousemove', appendStrokePoint);
  window.addEventListener('mouseup', endStroke);
}

penTool.addEventListener('click', () => {
  activeTool = 'pen';
  penTool.classList.add('is-active');
  eraserTool.classList.remove('is-active');
});

eraserTool.addEventListener('click', () => {
  activeTool = 'eraser';
  eraserTool.classList.add('is-active');
  penTool.classList.remove('is-active');
});

colorInputs.forEach((input) => {
  input.addEventListener('change', () => {
    if (!input.checked) return;
    activePenColor = input.value;
    colorInputs.forEach((item) => {
      item.closest('.color-swatch')?.classList.toggle('is-active', item.checked);
    });
    activeTool = 'pen';
    penTool.classList.add('is-active');
    eraserTool.classList.remove('is-active');
  });
});

undoButton.addEventListener('click', () => {
  stopReplay();
  strokes.pop();
  if (!strokes.length) captureStartedAtMs = null;
  redraw();
  setStatus('編集中');
});

clearButton.addEventListener('click', resetCurrentSignature);

saveButton.addEventListener('click', saveCurrentRecord);

replayButton.addEventListener('click', () => {
  if (!strokes.length) {
    setStatus('再生なし');
    return;
  }
  replayCurrentSignature();
});

importInput.addEventListener('change', async () => {
  const file = importInput.files?.[0];
  if (!file) return;

  try {
    const data = JSON.parse(await file.text());
    if (!isValidRecord(data)) throw new Error('Invalid sign data');
    loadRecordIntoEditor({
      ...data,
      id: data.id || createId(),
      updatedAt: data.updatedAt || nowIso(),
      createdAt: data.createdAt || nowIso(),
    });
  } catch {
    setStatus('読み込み失敗');
  } finally {
    importInput.value = '';
  }
});

/**
 * 指定IDの保存済みサインを呼び出して書き順どおりに再現する。
 * @param {string} id レコードID
 * @returns {object|null} 読み込んだレコード
 */
function loadSavedRecord(id) {
  const record = loadRecords().find((item) => item.id === id);
  if (!record) return null;
  loadRecordIntoEditor(record);
  return record;
}

/**
 * 最新の保存済みサインを呼び出して書き順どおりに再現する。
 * @returns {object|null} 読み込んだレコード
 */
function loadLatestRecord() {
  const [latest] = loadRecords().sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  if (!latest) return null;
  loadRecordIntoEditor(latest);
  return latest;
}

/**
 * 現在キャンバスに読み込まれている筆跡を再生する。
 */
function replayCurrentSignature() {
  replayStrokes(strokes);
}

window.TalentSignCapture = {
  getRecords: loadRecords,
  getCurrentRecord: buildRecord,
  loadRecord: loadSavedRecord,
  loadLatest: loadLatestRecord,
  replayCurrent: replayCurrentSignature,
};

window.addEventListener('resize', resizeCanvas);
window.addEventListener('orientationchange', () => {
  window.setTimeout(resizeCanvas, 250);
});

requestAnimationFrame(resizeCanvas);
renderRecordList();
