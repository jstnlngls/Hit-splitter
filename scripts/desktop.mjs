#!/usr/bin/env node
/**
 * Builds Hit Splitter as a Mac app.
 *
 *   node scripts/desktop.mjs start    build and open the app (needs Electron's binary)
 *   node scripts/desktop.mjs package  build Hit Splitter.app for Apple silicon and Intel;
 *                                     on a Mac, also sign it ad hoc and wrap it in a .dmg
 *   node scripts/desktop.mjs install  build it for this Mac and put it in /Applications
 *   node scripts/desktop.mjs smoke    launch the packaged app, check it works, and quit
 */
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const NAME = 'Hit Splitter'
const stageDir = path.join(root, '.desktop', 'app')
const releaseDir = path.join(root, 'release')
const onMac = process.platform === 'darwin'
const ARCH_LABEL = { arm64: 'apple-silicon', x64: 'intel' }

const run = (command, args, options = {}) => execFileSync(command, args, { stdio: 'inherit', cwd: root, ...options })

/** Builds the web app for the desktop and lays out what goes inside the .app. */
function stage() {
  fs.rmSync(stageDir, { recursive: true, force: true })
  run(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), 'build', '--outDir', path.join(stageDir, 'dist'), '--emptyOutDir'], {
    env: { ...process.env, VITE_TARGET: 'desktop' },
  })
  fs.copyFileSync(path.join(root, 'desktop/main.cjs'), path.join(stageDir, 'main.cjs'))
  const manifest = { name: pkg.name, productName: NAME, version: pkg.version, description: pkg.description, main: 'main.cjs' }
  fs.writeFileSync(path.join(stageDir, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`)
}

function start() {
  stage()
  const electron = path.join(root, 'node_modules/.bin/electron')
  run(electron, [stageDir])
}

/** Packages Hit Splitter.app for each architecture; on a Mac, also signs it ad hoc. */
async function buildApps(archs) {
  stage()
  const { packager } = await import('@electron/packager')
  const outputs = await packager({
    dir: stageDir,
    name: NAME,
    platform: 'darwin',
    arch: archs,
    out: releaseDir,
    overwrite: true,
    asar: true,
    prune: false,
    quiet: true,
    icon: path.join(root, 'desktop/icon.icns'),
    appBundleId: 'io.github.jstnlngls.hitsplitter',
    appCategoryType: 'public.app-category.music',
    appVersion: pkg.version,
    buildVersion: pkg.version,
    electronVersion: pkg.devDependencies.electron.replace(/^[^\d]*/, ''),
    darwinDarkModeSupport: true,
  })
  return outputs.map((dir) => {
    const appPath = path.join(dir, `${NAME}.app`)
    if (onMac) {
      // No Apple developer certificate here, so sign ad hoc: Apple silicon
      // refuses to run unsigned code, and a fresh signature covers our changes.
      run('codesign', ['--force', '--deep', '--sign', '-', appPath])
      run('codesign', ['--verify', '--deep', '--strict', appPath])
    }
    return { arch: archs.find((a) => dir.endsWith(`-${a}`)), dir, appPath }
  })
}

async function packageApp() {
  for (const { arch, dir, appPath } of await buildApps(['arm64', 'x64'])) {
    const base = `Hit-Splitter-${pkg.version}-mac-${ARCH_LABEL[arch]}`
    if (onMac) {
      const dmgRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hit-splitter-dmg-'))
      run('cp', ['-R', appPath, dmgRoot])
      fs.symlinkSync('/Applications', path.join(dmgRoot, 'Applications'))
      const dmg = path.join(releaseDir, `${base}.dmg`)
      // hdiutil sometimes reports "resource busy" on a busy machine; try a few times.
      for (let attempt = 1; ; attempt++) {
        try {
          run('hdiutil', ['create', '-volname', NAME, '-srcfolder', dmgRoot, '-ov', '-format', 'UDZO', dmg])
          break
        } catch (error) {
          if (attempt === 3) throw error
          await new Promise((resolve) => setTimeout(resolve, 5000))
        }
      }
      fs.rmSync(dmgRoot, { recursive: true, force: true })
      console.log(`Built ${path.relative(root, dmg)}`)
    } else {
      const zip = path.join(releaseDir, `${base}.zip`)
      run('zip', ['-qry', zip, `${NAME}.app`], { cwd: dir })
      console.log(`Built ${path.relative(root, zip)} (unsigned: sign it on a Mac with codesign --force --deep --sign -)`)
    }
  }
}

/**
 * Builds the app for this Mac and puts it in /Applications, replacing any copy
 * already there. An app built on the Mac itself was never downloaded, so it
 * opens without the Gatekeeper prompt. Songs live in the app's profile, not
 * the bundle, so they carry over.
 */
async function install() {
  if (!onMac) throw new Error('install puts the app in /Applications, so run it on a Mac')
  const target = path.join('/Applications', `${NAME}.app`)
  const running = () => spawnSync('pgrep', ['-x', NAME]).status === 0
  if (running()) throw new Error(`Quit ${NAME} first, then run this again`)
  const [{ appPath }] = await buildApps([process.arch === 'arm64' ? 'arm64' : 'x64'])
  if (running()) throw new Error(`Quit ${NAME} first, then run this again`)
  fs.rmSync(target, { recursive: true, force: true })
  run('ditto', [appPath, target])
  console.log(`Installed ${target}`)
}

function smoke() {
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
  const binary = path.join(releaseDir, `${NAME}-darwin-${arch}`, `${NAME}.app`, 'Contents/MacOS', NAME)
  if (!fs.existsSync(binary)) throw new Error(`Package the app first: ${binary} is missing`)
  const screenshot = path.join(releaseDir, 'smoke.png')
  const result = spawnSync(binary, [], {
    stdio: 'inherit',
    timeout: 180_000,
    env: { ...process.env, HIT_SPLITTER_SMOKE: screenshot, ELECTRON_ENABLE_LOGGING: '1' },
  })
  if (result.status !== 0) {
    console.error(`Smoke test failed (${result.error?.message ?? `exit ${result.status}`})`)
    process.exit(1)
  }
}

const command = process.argv[2]
const commands = { stage, start, package: packageApp, install, smoke }
if (!commands[command]) {
  console.error(`Usage: node scripts/desktop.mjs <${Object.keys(commands).join('|')}>`)
  process.exit(1)
}
await commands[command]()
