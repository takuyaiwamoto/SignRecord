const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const SUPABASE_URL = 'https://tqwtcsbdfriyiirzmmit.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_4T6OLyoDE9-eS9y-TTZIFQ_OXICQf9t';

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
      @page { margin: 0; }
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
    printWindow.webContents.once('did-finish-load', () => {
      printWindow.webContents.print(
        {
          silent: true,
          printBackground: true,
        },
        (success, failureReason) => {
          printWindow.close();
          if (!success) {
            reject(new Error(failureReason || 'Print failed'));
            return;
          }
          resolve({ ok: true });
        }
      );
    });
  });
}

function createWindow() {
  const window = new BrowserWindow({
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

  window.loadFile(path.join(__dirname, 'replay.html'));
}

loadLocalEnv();

ipcMain.handle('sign-records:fetch', fetchSignRecords);
ipcMain.handle('sign-records:print-image', (_event, dataUrl) => printImage(dataUrl));

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
