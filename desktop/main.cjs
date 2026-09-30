/**
 * Hit Splitter as a desktop app: a window around the built web app.
 *
 * The app is served from a private `app://hit-splitter` origin instead of
 * file:// so module workers, IndexedDB and localStorage behave exactly as they
 * do in a browser. Songs and imported tracks live in the app's own profile
 * (~/Library/Application Support/Hit Splitter on a Mac).
 */
const { app, BrowserWindow, nativeTheme, net, protocol, screen, shell } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const SCHEME = 'app'
const ORIGIN = `${SCHEME}://hit-splitter`
const ROOT = path.join(__dirname, 'dist')
/** When set, the app checks itself, saves a screenshot to this path and quits (used by CI). */
const SMOKE_SCREENSHOT = process.env.HIT_SPLITTER_SMOKE

protocol.registerSchemesAsPrivileged([
  { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, codeCache: true } },
])

function serve(request) {
  const { pathname } = new URL(request.url)
  const file = path.normalize(path.join(ROOT, decodeURIComponent(pathname === '/' ? '/index.html' : pathname)))
  if (!file.startsWith(ROOT + path.sep)) return new Response('Not found', { status: 404 })
  return net.fetch(pathToFileURL(file).toString())
}

const boundsFile = () => path.join(app.getPath('userData'), 'window.json')

function savedBounds() {
  try {
    const bounds = JSON.parse(fs.readFileSync(boundsFile(), 'utf8'))
    // Forget the position if that display is gone.
    const area = screen.getDisplayMatching(bounds).workArea
    const visible = bounds.x < area.x + area.width && bounds.x + bounds.width > area.x && bounds.y < area.y + area.height && bounds.y + bounds.height > area.y
    return visible ? bounds : { width: bounds.width, height: bounds.height }
  } catch {
    return { width: 1440, height: 900 }
  }
}

function createWindow() {
  const win = new BrowserWindow({
    ...savedBounds(),
    minWidth: 760,
    minHeight: 560,
    title: 'Hit Splitter',
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#12141a' : '#f6f7fa',
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: false },
  })
  win.once('ready-to-show', () => win.show())
  win.on('close', () => {
    try {
      fs.writeFileSync(boundsFile(), JSON.stringify(win.getNormalBounds()))
    } catch {
      // Window size is a convenience; nothing else depends on it.
    }
  })
  // The window only ever shows the app; links to other sites open in the browser.
  const openOutside = (url) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
  }
  win.webContents.setWindowOpenHandler(({ url }) => {
    openOutside(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(ORIGIN)) {
      event.preventDefault()
      openOutside(url)
    }
  })
  void win.loadURL(`${ORIGIN}/index.html`)
  return win
}

/** Page code that starts the track-analysis worker the way the app does and reports whether it answers ('ok') or why not. */
function workerCheck() {
  const script = fs.readdirSync(path.join(ROOT, 'assets')).find((name) => /^analysis\.worker-.+\.js$/.test(name))
  if (!script) return `'the build has no analysis worker'`
  return `new Promise((resolve) => {
    const worker = new Worker(new URL(${JSON.stringify(`assets/${script}`)}, location.href), { type: 'module' })
    const done = (result) => { worker.terminate(); resolve(result) }
    worker.onmessage = () => done('ok')
    worker.onerror = (event) => { event.preventDefault(); done('error: ' + (event.message || 'the worker script did not load')) }
    worker.postMessage({ id: 1, samples: new Float32Array(22050), sampleRate: 22050 })
    setTimeout(() => done('no answer in 15 s'), 15000)
  }).catch((error) => 'cannot start: ' + error.message)`
}

/** Loads the example song, imports the demo beat, checks the analysis worker and reports what worked. */
async function smokeTest(win) {
  const page = win.webContents
  const run = (code) => page.executeJavaScript(code, true)
  const waitFor = async (code, ms) => {
    for (const end = Date.now() + ms; Date.now() < end; ) {
      if (await run(code).catch(() => false)) return true
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
    return false
  }
  const button = (label) => `Array.from(document.querySelectorAll('button')).find((b) => b.textContent.includes(${JSON.stringify(label)}))`
  const report = {}
  try {
    const loaded = await Promise.race([
      new Promise((resolve) => page.once('did-finish-load', () => resolve(true))),
      new Promise((resolve) => page.once('did-fail-load', (_event, code, description) => resolve(`${code} ${description}`))),
      new Promise((resolve) => setTimeout(() => resolve('timed out'), 30000)),
    ])
    if (loaded !== true) throw new Error(`the page did not load (${loaded})`)
    report.dictionary = await waitFor(`document.body.innerText.includes('Dictionary:')`, 30000)
    report.bars = await run(`document.querySelectorAll('.bar').length`)
    await run(`document.querySelectorAll('.pane-right .tab')[2].click()`)
    await waitFor(`!!${button('Try a demo beat')}`, 10000)
    await run(`${button('Try a demo beat')}.click()`)
    report.track = await waitFor(`document.body.innerText.includes('detected')`, 90000)
    report.summary = await run(`document.querySelector('.track-summary')?.innerText.replace(/\\n/g, ' | ') ?? ''`)
    report.worker = await run(workerCheck())
    fs.writeFileSync(SMOKE_SCREENSHOT, (await page.capturePage()).toPNG())
  } catch (error) {
    report.error = String(error)
  }
  const ok = Boolean(report.dictionary && report.bars > 0 && report.track && report.worker === 'ok')
  console.log(`[smoke] ${ok ? 'PASS' : 'FAIL'} ${JSON.stringify(report)}`)
  app.exit(ok ? 0 : 1)
}

app.whenReady().then(() => {
  protocol.handle(SCHEME, serve)
  const win = createWindow()
  if (SMOKE_SCREENSHOT) void smokeTest(win)
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
