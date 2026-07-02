const { app, BrowserWindow, ipcMain } = require('electron');
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const SUPABASE_URL = 'https://tqwtcsbdfriyiirzmmit.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_4T6OLyoDE9-eS9y-TTZIFQ_OXICQf9t';
const DEMO_VIDEO_PATH = '/Users/a14881/Documents/9thSignSystem/video1Demo.mp4';
const PRINT_PAGE_SIZE = { width: 5, height: 7 };

let mainWindow = null;
let videoWindow = null;

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

function loadLocalEnv() {
  const envPath = path.join(__dirname, '..', '.env.local');
  if (!fs.existsSync(envPath)) return;

  const text = fs.readFileSync(envPath, 'utf8');
  text.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex === -1) return;

    const key = trimmed.slice(0, separatorIndex).trim();
    const rawValue = trimmed.slice(separatorIndex + 1).trim();
    if (!key || process.env[key]) return;
    process.env[key] = rawValue.replace(/^["']|["']$/g, '');
  });
}

async function fetchSignRecords() {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const apiKey = serviceRoleKey || process.env.SUPABASE_PUBLISHABLE_KEY || SUPABASE_PUBLISHABLE_KEY;
  const url = new URL('/rest/v1/sign_records', SUPABASE_URL);
  url.searchParams.set('select', 'id,event_id,talent_name,payload,created_at');
  url.searchParams.set('order', 'created_at.desc');
  url.searchParams.set('limit', '200');

  const response = await fetch(url, {
    headers: {
      apikey: apiKey,
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Supabase read failed: ${response.status} ${body}`);
  }

  return response.json();
}

function printImage(dataUrl) {
  if (!/^data:image\/png;base64,/.test(dataUrl || '')) {
    return Promise.reject(new Error('Invalid print image'));
  }

  return new Promise((resolve, reject) => {
    const printWindow = new BrowserWindow({
      show: false,
      width: 890,
      height: 1270,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });

    const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      @page {
        size: 127mm 178mm;
        margin: 0;
      }
      html, body {
        width: 100%;
        height: 100%;
        margin: 0;
        background: #ffffff;
      }
      img {
        display: block;
        width: 100vw;
        height: 100vh;
        object-fit: contain;
      }
    </style>
  </head>
  <body><img src="${dataUrl}" /></body>
</html>`;

    printWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    printWindow.webContents.once('did-finish-load', async () => {
      try {
        const pdfBuffer = await printWindow.webContents.printToPDF({
          printBackground: true,
          margins: { marginType: 'none' },
          pageSize: PRINT_PAGE_SIZE,
          landscape: false,
          scale: 1,
          preferCSSPageSize: true,
        });
        printWindow.close();
        resolve(await sendPdfToPrinter(pdfBuffer));
      } catch (error) {
        printWindow.close();
        reject(error);
      }
    });
  });
}

function sendPdfToPrinter(pdfBuffer) {
  return new Promise((resolve, reject) => {
    const filePath = path.join(app.getPath('temp'), `sign-print-${Date.now()}.pdf`);
    fs.writeFileSync(filePath, pdfBuffer);

    const args = [
      '-o',
      'PageSize=5x7',
      '-o',
      'PageRegion=5x7',
      '-o',
      'MediaType=stationery',
      '-o',
      'InputSlot=tray-1',
      '-o',
      'Duplex=None',
      '-o',
      'ColorModel=RGB',
      '-o',
      'cupsPrintQuality=Normal',
      filePath,
    ];

    execFile('lp', args, (error, stdout, stderr) => {
      fs.unlink(filePath, () => {});

      if (error) {
        reject(new Error(stderr || error.message));
        return;
      }

      resolve({ ok: true, stdout: stdout.trim() });
    });
  });
}

async function ensureVideoWindow() {
  if (!fs.existsSync(DEMO_VIDEO_PATH)) {
    throw new Error(`Video file not found: ${DEMO_VIDEO_PATH}`);
  }

  if (videoWindow && !videoWindow.isDestroyed()) {
    return videoWindow;
  }

  videoWindow = new BrowserWindow({
    width: 960,
    height: 540,
    title: 'Demo Video',
    backgroundColor: '#000000',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  videoWindow.on('closed', () => {
    videoWindow = null;
  });

  await videoWindow.loadFile(path.join(__dirname, 'video.html'), {
    query: {
      src: pathToFileURL(DEMO_VIDEO_PATH).href,
    },
  });
  return videoWindow;
}

async function playDemoVideo() {
  const window = await ensureVideoWindow();
  window.show();
  return window.webContents.executeJavaScript(`
    new Promise((resolve) => {
      const video = document.querySelector('video');
      let resolved = false;
      const done = (result) => {
        if (resolved) return;
        resolved = true;
        resolve(result);
      };
      video.addEventListener('playing', () => done({ ok: true }), { once: true });
      const start = () => {
        video.pause();
        video.currentTime = 0;
        const playPromise = video.play();
        if (playPromise && typeof playPromise.catch === 'function') {
          playPromise.catch((error) => done({ ok: false, error: error.message }));
        }
      };
      if (video.readyState >= 1) {
        start();
      } else {
        video.addEventListener('loadedmetadata', start, { once: true });
      }
      setTimeout(() => done({ ok: false, timeout: true }), 3000);
    });
  `);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 860,
    minHeight: 620,
    title: 'Sign Replay',
    backgroundColor: '#fff7f9',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.cjs'),
      sandbox: true,
    },
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.loadFile(path.join(__dirname, 'replay.html'));
}

loadLocalEnv();

ipcMain.handle('sign-records:fetch', fetchSignRecords);
ipcMain.handle('sign-records:print-image', (_event, dataUrl) => printImage(dataUrl));
ipcMain.handle('sign-video:play', playDemoVideo);

app.whenReady().then(() => {
  createWindow();
  ensureVideoWindow().catch((error) => {
    console.error(error);
  });

  app.on('activate', () => {
    if (!mainWindow || mainWindow.isDestroyed()) createWindow();
    ensureVideoWindow().catch((error) => {
      console.error(error);
    });
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
