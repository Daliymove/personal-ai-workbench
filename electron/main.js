// Electron 主进程 —— workbench-app 的"启动器"壳
// 职责：启动 Workbench 的 vite dev server（页面 + API 一体），
//       等端口就绪后打开窗口加载它，退出时关掉子进程。
const { app, BrowserWindow, Menu, dialog } = require('electron')
const { spawn, spawnSync } = require('child_process')
const fs = require('fs')
const net = require('net')
const path = require('path')

const APP_URL = 'http://127.0.0.1:5173'
const PORT = 5173

// 用户数据目录统一为与 app 名一致（默认继承 package.json 的 name: workbench-app）
// 必须最早设置：单实例锁与 runtimeRoot 都依赖它。旧版目录存在时自动迁移，保留用户数据
app.setPath('userData', path.join(app.getPath('appData'), 'PersonalWorkbench'))
const legacyUserData = path.join(app.getPath('appData'), 'workbench-app')
if (!fs.existsSync(app.getPath('userData')) &&
    fs.existsSync(path.join(legacyUserData, 'workbench-runtime'))) {
  try {
    fs.renameSync(legacyUserData, app.getPath('userData'))
    console.log('[runtime] 迁移旧用户数据目录:', legacyUserData, '->', app.getPath('userData'))
  } catch (err) {
    console.log('[runtime] 迁移失败（将重新解压）:', err.message)
  }
}

// 单实例锁：重复启动时聚焦已有窗口，避免多实例互相抢端口
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
}
app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) win.restore()
    win.focus()
  }
})

// Workbench 运行时位置：
//  - 开发模式：工作区里的 Workbench
//  - 打包版：首次启动从 seed.tar.gz 解压到 userData/workbench-runtime
//    （NSIS 只装归档，安装快；解压放在首次启动一次性完成）
const seedArchive = path.join(process.resourcesPath, 'seed.tar.gz')
const runtimeRoot = app.isPackaged
  ? path.join(app.getPath('userData'), 'workbench-runtime')
  : path.join(__dirname, '..')
const workbenchDir = path.join(runtimeRoot, 'Workbench')

// 加载页：首次启动解压 seed 期间显示，避免窗口空白无反馈。
// 文案按需传入：真正解压时才提示 1~2 分钟，普通启动只显示短提示。
function loadingHtml(tip) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;height:100vh;display:flex;align-items:center;justify-content:center;background:#f5f0e6;font-family:'Noto Serif SC','Source Han Serif SC',serif;color:#4a433c}
.box{text-align:center}
.title{font-size:30px;font-weight:500;color:#1b365d}
.sub{margin-top:14px;font-size:14px}
.tip{margin-top:10px;font-size:12px;color:#6b6158}
.dot{display:inline-block;width:6px;height:6px;margin:0 3px;border-radius:50%;background:#537d96;animation:blink 1.2s infinite}
.dot:nth-child(2){animation-delay:.2s}.dot:nth-child(3){animation-delay:.4s}
@keyframes blink{0%,80%,100%{opacity:.2}40%{opacity:1}}
</style></head><body><div class="box">
<div class="title">Personal Workbench</div>
<div class="sub">正在准备运行环境<span class="dot"></span><span class="dot"></span><span class="dot"></span></div>
<div class="tip">${tip}</div>
</div></body></html>`
}

// 解压完成标记：生产=server-bundle.cjs 存在；开发=vite bin 存在
function runtimeMarker() {
  return app.isPackaged
    ? path.join(workbenchDir, 'server', 'server-bundle.cjs')
    : path.join(workbenchDir, 'node_modules', 'vite', 'bin', 'vite.js')
}

// 同步判断是否需要解压 seed（首次安装或版本变化）
function checkNeedExtract() {
  if (!app.isPackaged) return false
  const marker = runtimeMarker()
  const bundleVersion = readVersionFile(path.join(process.resourcesPath, 'seed-version.txt'))
  const localVersion = readVersionFile(path.join(runtimeRoot, '.seed-version'))
  return !fs.existsSync(marker) ||
    (bundleVersion !== null && bundleVersion !== localVersion)
}

function readVersionFile(file) {
  try {
    return fs.readFileSync(file, 'utf8').trim()
  } catch {
    return null
  }
}

function ensureRuntimeAsync() {
  return new Promise((resolve, reject) => {
    if (!app.isPackaged) { resolve(); return }
    const marker = runtimeMarker()
    const bundleVersion = readVersionFile(path.join(process.resourcesPath, 'seed-version.txt'))
    const localVersion = readVersionFile(path.join(runtimeRoot, '.seed-version'))
    const needExtract = checkNeedExtract()

    if (!needExtract) {
      console.log('[runtime] seed 已就绪:', workbenchDir)
      resolve()
      return
    }

    if (bundleVersion !== null && localVersion !== null && bundleVersion !== localVersion) {
      console.log('[runtime] seed 版本变化 (' + localVersion + ' -> ' + bundleVersion + ')，重新解压')
      // 只重建 Workbench，保留个人知识库（用户数据，可能已写入自己的内容）
      fs.rmSync(path.join(runtimeRoot, 'Workbench'), { recursive: true, force: true })
    } else {
      console.log('[runtime] 首次启动，解压 seed ...')
    }

    fs.mkdirSync(runtimeRoot, { recursive: true })
    // windowsHide：tar 是 console 程序，不隐藏会在 GUI 应用里弹黑框；
    // 输出改管道转发到日志，不再继承（继承也会引起控制台行为）
    const child = spawn('tar', ['-xzf', seedArchive, '-C', runtimeRoot], {
      stdio: 'pipe',
      windowsHide: true
    })
    child.stdout.on('data', (d) => console.log('[tar]', String(d).trim()))
    child.stderr.on('data', (d) => console.log('[tar:err]', String(d).trim()))
    child.on('exit', (code) => {
      if (code !== 0) {
        reject(new Error('seed 解压失败（' + seedArchive + '）'))
        return
      }
      if (!fs.existsSync(marker)) {
        reject(new Error('seed 解压后缺少 vite，部署异常'))
        return
      }
      if (bundleVersion !== null) {
        fs.writeFileSync(path.join(runtimeRoot, '.seed-version'), bundleVersion, 'utf8')
      }
      console.log('[runtime] seed 解压完成')
      resolve()
    })
    child.on('error', reject)
  })
}

let serverProcess = null
let win = null

// 轮询 TCP 端口，直到 vite 就绪或超时
function waitForPort(port, timeoutMs = 40000) {
  const deadline = Date.now() + timeoutMs
  return new Promise((resolve, reject) => {
    const tryConnect = () => {
      const socket = net.connect(port, '127.0.0.1')
      socket.once('connect', () => {
        socket.destroy()
        resolve()
      })
      socket.once('error', () => {
        socket.destroy()
        if (Date.now() > deadline) {
          reject(new Error(`等待端口 ${port} 超时（vite 可能启动失败）`))
        } else {
          setTimeout(tryConnect, 300)
        }
      })
    }
    tryConnect()
  })
}

function startViteServer() {
  // 生产：单文件 server-bundle.cjs（esbuild 产物，自带 API + 静态服务）
  // 开发：vite dev server（--strictPort 固定端口，避免悄悄换端口壳等错）
  const serverEntry = app.isPackaged
    ? path.join(workbenchDir, 'server', 'server-bundle.cjs')
    : path.join(workbenchDir, 'node_modules', 'vite', 'bin', 'vite.js')
  const args = app.isPackaged
    ? [serverEntry, '--port', String(PORT)]
    : [serverEntry, '--strictPort']
  serverProcess = spawn('node', args, {
    cwd: workbenchDir,
    stdio: 'pipe',
    windowsHide: true
  })
  serverProcess.stdout.on('data', (d) => console.log('[vite]', String(d).trim()))
  serverProcess.stderr.on('data', (d) => console.log('[vite:err]', String(d).trim()))
  serverProcess.on('exit', (code) => {
    console.log('[vite] 子进程退出, code =', code)
    // code 非 0（正常关闭时 kill 触发 code 为 null）：启动失败，多半是端口被占
    if (win && !win.isDestroyed() && code !== null && code !== 0) {
      dialog.showErrorBox(
        '启动失败',
        'Workbench 服务启动失败（端口 ' + PORT + ' 被占用？）。\n请关闭其他运行中的 Personal Workbench 实例后重试。'
      )
      app.quit()
    }
  })
}

function createWindow(tip) {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: 'Personal AI Workbench',
    // 窗口/任务栏图标（dev 模式生效；打包后 exe 内嵌图标）
    icon: path.join(__dirname, '../build/icon.png'),
    autoHideMenuBar: true,
    backgroundColor: '#f5f0e6',
    webPreferences: {
      contextIsolation: true
    }
  })

  // 先显示加载页：打包版首次启动要异步解压 seed，避免窗口空白无反馈
  win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(loadingHtml(tip)))

  // 菜单已置空，默认调试快捷键全灭；只在开发模式（未打包）补回 F12
  if (!app.isPackaged) {
    win.webContents.on('before-input-event', (event, input) => {
      if (input.type === 'keyDown' && input.key === 'F12') {
        win.webContents.toggleDevTools()
        event.preventDefault()
      }
    })
  }

  win.webContents.on('did-fail-load', (_e, code, desc) => {
    console.error('[window] 加载失败:', code, desc)
  })
}

async function boot() {
  try {
    await ensureRuntimeAsync()
    startViteServer()
    await waitForPort(PORT)
    win.loadURL(APP_URL)
  } catch (err) {
    dialog.showErrorBox('启动失败', String(err.message || err))
    app.quit()
  }
}

app.whenReady().then(() => {
  if (!gotLock) return
  Menu.setApplicationMenu(null)
  // 按需文案：真正要解压才提示 1~2 分钟，普通启动只显示短提示
  const tip = checkNeedExtract()
    ? '首次启动，正在解压运行环境（约 1~2 分钟），请稍候'
    : '正在启动…'
  createWindow(tip) // 立即显示加载窗口，解压/启动在后台异步进行
  boot()
})

app.on('window-all-closed', () => {
  app.quit()
})

// 退出时带走 vite 子进程
app.on('will-quit', () => {
  if (serverProcess && !serverProcess.killed) {
    serverProcess.kill()
  }
})
