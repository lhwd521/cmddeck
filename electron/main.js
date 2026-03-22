const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile, spawn } = require('child_process');
const { ClaudeBridge } = require('./claude-bridge');
const { CodexBridge } = require('./codex-bridge');
const claudeHistory = require('./cc-history');
const codexHistory = require('./codex-history');

const isDev = !app.isPackaged;
const bridges = {
  claude: new ClaudeBridge(),
  codex: new CodexBridge(),
};
const externalCliProcesses = new Map();
const EXTERNAL_CLI_POLL_MS = 2000;
let mainWindow;
const appIconPath = path.join(__dirname, '../assets/icon.png');
const CODEX_CONFIG_PATH = path.join(os.homedir(), '.codex', 'config.toml');

if (isDev) {
  const devUserData = path.join(app.getPath('appData'), 'CmdDeck-dev');
  app.setPath('userData', devUserData);
  app.setPath('sessionData', path.join(devUserData, 'session'));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    frame: false,
    backgroundColor: '#1A1A1A',
    icon: fs.existsSync(appIconPath) ? appIconPath : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

function getBridge(provider = 'claude') {
  return bridges[provider] || bridges.claude;
}

function getHistoryApi(provider = 'claude') {
  return provider === 'codex' ? codexHistory : claudeHistory;
}

function readCodexConfig() {
  if (!fs.existsSync(CODEX_CONFIG_PATH)) {
    return {};
  }

  try {
    const content = fs.readFileSync(CODEX_CONFIG_PATH, 'utf-8');
    const model = content.match(/^model\s*=\s*"([^"]+)"/m)?.[1] || null;
    const reasoningEffort = content.match(/^model_reasoning_effort\s*=\s*"([^"]+)"/m)?.[1] || null;
    const serviceTier = content.match(/^service_tier\s*=\s*"([^"]+)"/m)?.[1] || null;
    return { model, reasoningEffort, serviceTier };
  } catch {
    return {};
  }
}

function updateCodexServiceTier(enabled) {
  const nextLine = enabled ? 'service_tier = "fast"' : null;
  const content = fs.existsSync(CODEX_CONFIG_PATH)
    ? fs.readFileSync(CODEX_CONFIG_PATH, 'utf-8')
    : '';
  const nextContent = updateTopLevelTomlKey(content, 'service_tier', nextLine);

  fs.mkdirSync(path.dirname(CODEX_CONFIG_PATH), { recursive: true });
  fs.writeFileSync(CODEX_CONFIG_PATH, nextContent, 'utf-8');

  return readCodexConfig();
}

function updateTopLevelTomlKey(content, key, nextLine) {
  const eol = content.includes('\r\n') ? '\r\n' : '\n';
  const lines = content ? content.split(/\r?\n/) : [];
  const keyPattern = new RegExp(`^\\s*${key}\\s*=`);
  const nextLines = [];
  let beforeFirstSection = true;
  let inserted = false;

  for (const line of lines) {
    const trimmed = line.trim();
    const isSection = /^\s*\[.*\]\s*$/.test(trimmed);

    if (beforeFirstSection && keyPattern.test(line)) {
      if (nextLine && !inserted) {
        nextLines.push(nextLine);
        inserted = true;
      }
      continue;
    }

    if (beforeFirstSection && isSection) {
      if (nextLine && !inserted) {
        nextLines.push(nextLine);
        inserted = true;
      }
      beforeFirstSection = false;
    }

    nextLines.push(line);
  }

  if (nextLine && !inserted) {
    nextLines.push(nextLine);
  }

  return nextLines.join(eol).replace(/\s+$/, '') + eol;
}

function escapePowerShell(value) {
  return `'${String(value ?? '').replace(/'/g, "''")}'`;
}

function buildCliLaunchScript(provider, cwd, providerSessionId) {
  const normalizedProvider = provider === 'codex' ? 'codex' : 'claude';
  const safeCwd = cwd && fs.existsSync(cwd) ? cwd : app.getPath('home');
  const title = normalizedProvider === 'codex' ? 'Codex CLI' : 'Claude Code CLI';

  let command = normalizedProvider;
  if (providerSessionId) {
    command = normalizedProvider === 'codex'
      ? `codex resume ${escapePowerShell(providerSessionId)}`
      : `claude -r ${escapePowerShell(providerSessionId)}`;
  }

  return {
    cwd: safeCwd,
    command,
    script: [
      `$Host.UI.RawUI.WindowTitle = ${escapePowerShell(title)}`,
      `Set-Location -LiteralPath ${escapePowerShell(safeCwd)}`,
      command,
    ].join('; '),
  };
}

function notifyCliExit(sessionId, provider, pid, code, signal) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('agent:cli-exit', {
      sessionId,
      provider,
      pid,
      exitCode: code,
      signal: signal || null,
    });
  }
}

function clearExternalCliTracker(sessionId) {
  const tracker = externalCliProcesses.get(sessionId);
  if (tracker?.intervalId) {
    clearInterval(tracker.intervalId);
  }
  externalCliProcesses.delete(sessionId);
}

function isProcessAlive(pid) {
  if (!pid || Number.isNaN(Number(pid))) {
    return false;
  }

  try {
    process.kill(Number(pid), 0);
    return true;
  } catch {
    return false;
  }
}

function trackExternalCliProcess(sessionId, provider, pid) {
  clearExternalCliTracker(sessionId);

  const intervalId = setInterval(() => {
    if (isProcessAlive(pid)) {
      return;
    }

    clearExternalCliTracker(sessionId);
    notifyCliExit(sessionId, provider, pid, null, null);
  }, EXTERNAL_CLI_POLL_MS);

  externalCliProcesses.set(sessionId, { pid, provider, intervalId });
}

async function openCliTerminal(sessionId, provider, cwd, providerSessionId) {
  if (process.platform !== 'win32') {
    throw new Error('Open in CLI is currently implemented for Windows builds only.');
  }

  const normalizedProvider = provider === 'codex' ? 'codex' : 'claude';
  const launch = buildCliLaunchScript(provider, cwd, providerSessionId);
  const encodedScript = Buffer.from(launch.script, 'utf16le').toString('base64');
  const launcherCommand = [
    `$p = Start-Process -FilePath 'powershell.exe'`,
    `-WorkingDirectory ${escapePowerShell(launch.cwd)}`,
    `-ArgumentList @('-NoExit','-ExecutionPolicy','Bypass','-EncodedCommand','${encodedScript}')`,
    '-PassThru;',
    'Write-Output $p.Id',
  ].join(' ');

  const pid = await new Promise((resolve, reject) => {
    execFile('powershell.exe', [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      launcherCommand,
    ], { timeout: 10000 }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(stderr.trim() || err.message));
        return;
      }

      const parsedPid = Number(stdout.trim());
      if (!parsedPid) {
        reject(new Error('Failed to determine external CLI process id.'));
        return;
      }

      resolve(parsedPid);
    });
  });

  trackExternalCliProcess(sessionId, normalizedProvider, pid);

  return {
    provider: normalizedProvider,
    cwd: launch.cwd,
    command: launch.command,
    resumed: Boolean(providerSessionId),
    pid,
  };
}

for (const bridge of Object.values(bridges)) {
  bridge.on('event', (data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('agent:event', data);
    }
  });
}

ipcMain.on('window:minimize', () => mainWindow?.minimize());
ipcMain.on('window:maximize', () => {
  if (mainWindow?.isMaximized()) mainWindow.unmaximize();
  else mainWindow?.maximize();
});
ipcMain.on('window:close', () => mainWindow?.close());

ipcMain.handle('agent:send', (_event, provider, sessionId, message, options) => {
  try {
    const requestId = getBridge(provider).sendMessage(sessionId, message, options);
    return { success: true, requestId };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('agent:abort', (_event, provider, sessionId) => {
  return { success: getBridge(provider).abort(sessionId) };
});

ipcMain.handle('agent:setSessionId', (_event, provider, sessionId, providerSessionId) => {
  getBridge(provider).setSessionId(sessionId, providerSessionId);
  return { success: true };
});

ipcMain.handle('history:index', (_event, provider) => {
  try {
    return { success: true, sessions: getHistoryApi(provider).loadHistoryIndex() };
  } catch (err) {
    return { success: false, error: err.message, sessions: [] };
  }
});

ipcMain.handle('history:session', (_event, provider, sessionId) => {
  try {
    return { success: true, ...getHistoryApi(provider).loadSessionMessages(sessionId) };
  } catch (err) {
    return { success: false, error: err.message, messages: [] };
  }
});

ipcMain.handle('provider:version', async (_event, provider) => {
  const bin = provider === 'codex' ? 'codex' : 'claude';
  return new Promise((resolve) => {
    execFile(bin, ['--version'], { timeout: 5000, shell: true }, (err, stdout) => {
      if (err) {
        resolve({ success: false, version: null, error: err.message });
      } else {
        resolve({ success: true, version: stdout.trim() });
      }
    });
  });
});

ipcMain.handle('provider:update', async (_event, provider) => {
  const packageName = provider === 'codex'
    ? '@openai/codex@latest'
    : '@anthropic-ai/claude-code@latest';

  return new Promise((resolve) => {
    const child = spawn('npm', ['install', '-g', packageName], {
      shell: true,
      timeout: 120000,
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (data) => { stdout += data; });
    child.stderr?.on('data', (data) => { stderr += data; });
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ success: true, output: stdout.trim() });
      } else {
        resolve({ success: false, error: stderr.trim() || stdout.trim() });
      }
    });
    child.on('error', (err) => {
      resolve({ success: false, error: err.message });
    });
  });
});

ipcMain.handle('provider:config', async (_event, provider) => {
  try {
    if (provider === 'codex') {
      return { success: true, config: readCodexConfig() };
    }
    return { success: true, config: {} };
  } catch (err) {
    return { success: false, error: err.message, config: {} };
  }
});

ipcMain.handle('provider:setCodexFastMode', async (_event, enabled) => {
  try {
    return {
      success: true,
      config: updateCodexServiceTier(Boolean(enabled)),
    };
  } catch (err) {
    return { success: false, error: err.message, config: readCodexConfig() };
  }
});

ipcMain.handle('provider:openCli', async (_event, sessionId, provider, cwd, providerSessionId) => {
  try {
    return {
      success: true,
      ...await openCliTerminal(sessionId, provider, cwd, providerSessionId),
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('claude:send', (_event, sessionId, message, options) => {
  try {
    const requestId = getBridge('claude').sendMessage(sessionId, message, options);
    return { success: true, requestId };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('claude:abort', (_event, sessionId) => {
  return { success: getBridge('claude').abort(sessionId) };
});

ipcMain.handle('claude:setCCSessionId', (_event, sessionId, providerSessionId) => {
  getBridge('claude').setSessionId(sessionId, providerSessionId);
  return { success: true };
});

ipcMain.handle('dialog:selectDirectory', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
  });
  if (result.canceled) return null;
  return result.filePaths[0];
});

ipcMain.handle('dialog:selectFiles', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'All Files', extensions: ['*'] },
      { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg'] },
      { name: 'Code', extensions: ['js', 'ts', 'jsx', 'tsx', 'py', 'java', 'c', 'cpp', 'h', 'css', 'html', 'json', 'xml', 'yaml', 'yml', 'md', 'txt'] },
    ],
  });
  if (result.canceled) return [];
  return result.filePaths;
});

ipcMain.handle('paths:classify', (_event, paths = []) => {
  try {
    const items = Array.isArray(paths) ? paths : [];
    return {
      success: true,
      items: items.map((targetPath) => {
        try {
          const stats = fs.statSync(targetPath);
          return {
            path: targetPath,
            isDirectory: stats.isDirectory(),
          };
        } catch {
          return {
            path: targetPath,
            isDirectory: false,
          };
        }
      }),
    };
  } catch (err) {
    return { success: false, error: err.message, items: [] };
  }
});

ipcMain.handle('workspace:listDirectory', (_event, targetPath) => {
  try {
    const normalizedPath = String(targetPath || '').trim();
    if (!normalizedPath) {
      return { success: false, error: 'Workspace path is required.', entries: [] };
    }

    const stats = fs.statSync(normalizedPath);
    if (!stats.isDirectory()) {
      return { success: false, error: 'Target path is not a directory.', entries: [] };
    }

    const entries = fs.readdirSync(normalizedPath, { withFileTypes: true })
      .map((entry) => {
        const entryPath = path.join(normalizedPath, entry.name);

        try {
          let isDirectory = entry.isDirectory();
          if (!entry.isDirectory() && !entry.isFile()) {
            isDirectory = fs.statSync(entryPath).isDirectory();
          }

          return {
            name: entry.name,
            path: entryPath,
            isDirectory,
          };
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .sort((left, right) => {
        if (left.isDirectory !== right.isDirectory) {
          return left.isDirectory ? -1 : 1;
        }

        return left.name.localeCompare(right.name, undefined, {
          numeric: true,
          sensitivity: 'base',
        });
      });

    return { success: true, entries };
  } catch (err) {
    return { success: false, error: err.message, entries: [] };
  }
});

ipcMain.handle('workspace:openPath', async (_event, targetPath) => {
  try {
    const error = await shell.openPath(String(targetPath || ''));
    if (error) {
      return { success: false, error };
    }

    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('workspace:revealPath', (_event, targetPath) => {
  try {
    shell.showItemInFolder(String(targetPath || ''));
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('external:open', async (_event, target) => {
  try {
    await shell.openExternal(target);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('app:getDefaultCwd', () => app.getPath('home'));

ipcMain.handle('clipboard:saveImage', async (_event, base64Data, mimeType) => {
  try {
    const ext = mimeType === 'image/png' ? '.png' : mimeType === 'image/jpeg' ? '.jpg' : '.png';
    const tempDir = path.join(os.tmpdir(), 'ccdesktop-clipboard');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    const fileName = `paste-${Date.now()}${ext}`;
    const filePath = path.join(tempDir, fileName);
    const buffer = Buffer.from(base64Data, 'base64');
    fs.writeFileSync(filePath, buffer);
    return { success: true, path: filePath };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('file:readAsDataUrl', async (_event, filePath) => {
  try {
    const ext = path.extname(filePath).toLowerCase();
    const mimeMap = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.bmp': 'image/bmp',
      '.webp': 'image/webp',
      '.svg': 'image/svg+xml',
    };
    const mime = mimeMap[ext] || 'application/octet-stream';
    const data = fs.readFileSync(filePath);
    return { success: true, dataUrl: `data:${mime};base64,${data.toString('base64')}` };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('skills:list', async () => {
  try {
    const skillsDir = path.join(os.homedir(), '.claude', 'skills');
    if (!fs.existsSync(skillsDir)) {
      return { success: true, skills: [] };
    }

    const dirs = fs.readdirSync(skillsDir, { withFileTypes: true }).filter((entry) => entry.isDirectory());
    const skills = [];

    for (const dir of dirs) {
      const mdPath = path.join(skillsDir, dir.name, 'SKILL.md');
      if (!fs.existsSync(mdPath)) {
        continue;
      }

      try {
        const content = fs.readFileSync(mdPath, 'utf-8');
        const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
        if (!match) {
          continue;
        }

        const fm = match[1];
        const name = fm.match(/^name:\s*(.+)$/m)?.[1]?.trim() || dir.name;
        const descMatch = fm.match(/^description:\s*(.*(?:\n\s{4,}.*)*)$/m);
        const description = descMatch ? descMatch[1].replace(/\n\s{4,}/g, ' ').trim() : '';
        skills.push({ name, description, dir: dir.name });
      } catch {
        // Skip unreadable skills.
      }
    }

    return { success: true, skills };
  } catch (err) {
    return { success: false, error: err.message, skills: [] };
  }
});

ipcMain.handle('cchistory:index', async () => {
  try {
    return { success: true, sessions: claudeHistory.loadHistoryIndex() };
  } catch (err) {
    return { success: false, error: err.message, sessions: [] };
  }
});

ipcMain.handle('cchistory:session', async (_event, sessionId) => {
  try {
    return { success: true, ...claudeHistory.loadSessionMessages(sessionId) };
  } catch (err) {
    return { success: false, error: err.message, messages: [] };
  }
});

ipcMain.handle('cc:version', async () => {
  return new Promise((resolve) => {
    execFile('claude', ['--version'], { timeout: 5000, shell: true }, (err, stdout) => {
      if (err) {
        resolve({ success: false, version: null, error: err.message });
      } else {
        resolve({ success: true, version: stdout.trim() });
      }
    });
  });
});

ipcMain.handle('cc:update', async () => {
  return new Promise((resolve) => {
    const child = spawn('npm', ['install', '-g', '@anthropic-ai/claude-code@latest'], {
      shell: true,
      timeout: 120000,
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (data) => { stdout += data; });
    child.stderr?.on('data', (data) => { stderr += data; });
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ success: true, output: stdout.trim() });
      } else {
        resolve({ success: false, error: stderr.trim() || stdout.trim() });
      }
    });
    child.on('error', (err) => {
      resolve({ success: false, error: err.message });
    });
  });
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  for (const sessionId of externalCliProcesses.keys()) {
    clearExternalCliTracker(sessionId);
  }
  for (const bridge of Object.values(bridges)) {
    bridge.abortAll();
  }
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
