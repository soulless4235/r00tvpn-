// End-to-end smoke test of a packaged build. Drives the real UI with Playwright
// against local fixtures, so no external servers or credentials are involved.
//
//   node e2e/smoke.mjs <app executable> [--tun] [--appimage]
//
// Fixtures: a subscription server and two HTTP proxies standing in for the
// nodes "node-a" and "node-b". Each proxy records what it tunnelled, which is
// how the test tells which node the app really used.
//
// Linux only (skipped elsewhere): system proxy through gsettings (run inside
// dbus-run-session) and TUN (--tun; needs a setuid core: the deb postinst sets
// it, for --appimage the test grants it to the data-dir copy with sudo).
import { _electron } from 'playwright-core'
import { execFileSync } from 'child_process'
import fs from 'fs'
import http from 'http'
import net from 'net'
import os from 'os'
import path from 'path'

const [exe, ...flags] = process.argv.slice(2)
if (!exe) {
  console.error('usage: node e2e/smoke.mjs <app executable> [--tun] [--appimage]')
  process.exit(2)
}
const WITH_TUN = flags.includes('--tun')
const APPIMAGE = flags.includes('--appimage')
const isLinux = process.platform === 'linux'
const ARTIFACTS = path.resolve(process.env.E2E_ARTIFACTS || 'e2e-artifacts')
fs.mkdirSync(ARTIFACTS, { recursive: true })

const PORTS = { sub: 18080, target: 18081, mixed: 17890, nodeA: 17891, nodeB: 17892 }
const TARGET = `127.0.0.1:${PORTS.target}`

// ---------- fixtures ----------

// Only the local target is forwarded; anything else is recorded and refused.
// Under TUN a node's own outbound dial would be captured again and loop back.
function startNode(name, port) {
  const seen = []
  const server = http.createServer((req, res) => {
    // absolute-form request (plain HTTP proxying)
    const dest = new URL(req.url).host
    seen.push(dest)
    if (dest !== TARGET) return res.writeHead(403).end()
    const up = http.request(req.url, { method: req.method, headers: req.headers }, (r) => {
      res.writeHead(r.statusCode, r.headers)
      r.pipe(res)
    })
    up.on('error', () => res.destroy())
    req.pipe(up)
  })
  server.on('connect', (req, socket, head) => {
    seen.push(req.url)
    if (req.url !== TARGET) return socket.end('HTTP/1.1 403 Forbidden\r\n\r\n')
    const i = req.url.lastIndexOf(':')
    const up = net.connect(
      Number(req.url.slice(i + 1)),
      req.url.slice(0, i).replace(/^\[|\]$/g, '')
    )
    up.on('connect', () => {
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
      up.write(head)
      up.pipe(socket)
      socket.pipe(up)
    })
    up.on('error', () => socket.destroy())
    socket.on('error', () => up.destroy())
  })
  server.listen(port, '127.0.0.1')
  return { name, seen, server }
}

const nodes = [startNode('node-a', PORTS.nodeA), startNode('node-b', PORTS.nodeB)]

const target = http
  .createServer((req, res) => {
    const delay = req.url.startsWith('/slow') ? 6000 : 0
    setTimeout(() => res.end('ok'), delay)
  })
  .listen(PORTS.target, '127.0.0.1')

const subscription = `mixed-port: ${PORTS.mixed}
log-level: info
proxies:
  - { name: node-a, type: http, server: 127.0.0.1, port: ${PORTS.nodeA} }
  - { name: node-b, type: http, server: 127.0.0.1, port: ${PORTS.nodeB} }
proxy-groups:
  - { name: PROXY, type: select, proxies: [node-a, node-b] }
rules:
  - MATCH,PROXY
`
const userAgents = []
const sub = http
  .createServer((req, res) => {
    userAgents.push(req.headers['user-agent'] || '')
    res.writeHead(200, {
      'content-type': 'text/yaml; charset=utf-8',
      'profile-title': 'base64:' + Buffer.from('e2e').toString('base64'),
      'subscription-userinfo': 'upload=0; download=0; total=10737418240; expire=0'
    })
    res.end(req.method === 'HEAD' ? undefined : subscription)
  })
  .listen(PORTS.sub, '127.0.0.1')

// HTTP request through the app's mixed port
function viaApp(pathname) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port: PORTS.mixed,
        path: `http://${TARGET}${pathname}`,
        headers: { host: TARGET }
      },
      (res) => {
        let body = ''
        res.on('data', (c) => (body += c))
        res.on('end', () => resolve(body))
      }
    )
    req.setTimeout(15000, () => req.destroy(new Error('timeout')))
    req.on('error', reject)
    req.end()
  })
}

// Direct request with no proxy settings at all (captured only by TUN)
function directGet(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      res.resume()
      res.on('end', () => resolve(res.statusCode))
    })
    req.setTimeout(15000, () => req.destroy(new Error('timeout')))
    req.on('error', reject)
  })
}

// Runs fn and returns the name of the node that received a matching request, or null.
// Requests a node refuses fail on the client side; reaching the node is what counts.
async function whichNode(fn, match = (dest) => dest === TARGET, { mayFail = false } = {}) {
  const before = nodes.map((n) => n.seen.length)
  await (mayFail ? fn().catch(() => {}) : fn())
  await sleep(300)
  const hit = nodes.find((n, i) => n.seen.slice(before[i]).some(match))
  return hit ? hit.name : null
}

// ---------- app helpers ----------

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'r00tvpn-e2e-'))
const env = {
  ...process.env,
  HOME: home,
  XDG_CONFIG_HOME: path.join(home, '.config'),
  XDG_CURRENT_DESKTOP: process.env.XDG_CURRENT_DESKTOP || 'GNOME',
  // keep the developer's own clash:// and mihomo:// handlers untouched
  R00TVPN_SKIP_PROTOCOL_REGISTRATION: '1'
}
const dataDir = path.join(env.XDG_CONFIG_HOME, 'r00tvpn')

let electronApp
let page

async function launch() {
  electronApp = await _electron.launch({
    executablePath: exe,
    env,
    // Linux follows XDG_CONFIG_HOME; Windows and macOS need the switch.
    // noadmin: skip the Windows elevated-task setup and its first-run notice
    args: [`--user-data-dir=${dataDir}`, ...(process.platform === 'win32' ? ['noadmin'] : [])],
    timeout: 90000
  })
  // Never drive the app against a real profile
  const userData = await electronApp.evaluate(({ app }) => app.getPath('userData'))
  if (path.resolve(userData) !== path.resolve(dataDir)) {
    await electronApp.close()
    throw new Error(`userData is ${userData}, not the test dir ${dataDir}; refusing to continue`)
  }
  electronApp
    .process()
    .stderr?.on('data', (d) => fs.appendFileSync(path.join(ARTIFACTS, 'app.log'), d))
  electronApp
    .process()
    .stdout?.on('data', (d) => fs.appendFileSync(path.join(ARTIFACTS, 'app.log'), d))
  page = await waitFor(
    () => electronApp.windows().find((w) => /index\.html/.test(w.url())),
    'main window',
    60000
  )
  await page.waitForLoadState('domcontentloaded')
}

// Two quits within 500 ms skip the confirm dialog, like a real double quit
async function quit() {
  const closed = new Promise((r) => electronApp.once('close', r))
  await electronApp.evaluate(({ app }) => {
    app.quit()
    setTimeout(() => app.quit(), 100)
  })
  await Promise.race([closed, sleep(15000)])
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function waitFor(fn, what, timeout = 20000) {
  const end = Date.now() + timeout
  let last
  while (Date.now() < end) {
    try {
      const v = await fn()
      if (v) return v
    } catch (e) {
      last = e
    }
    await sleep(300)
  }
  throw new Error(`timed out waiting for ${what}${last ? `: ${last.message}` : ''}`)
}

async function inv(channel, ...args) {
  const r = await page.evaluate(
    ([c, a]) => window.electron.ipcRenderer.invoke(c, ...a),
    [channel, args]
  )
  if (r && typeof r === 'object' && 'invokeError' in r)
    throw new Error(`${channel}: ${r.invokeError}`)
  return r
}

async function go(hash) {
  await page.evaluate((h) => (location.hash = h), hash)
  await page.waitForTimeout(800)
}

const bodyText = () => page.locator('body').innerText()
const power = () => page.locator('[data-guide="home-power-toggle"]').click()
// gsettings('mode') -> org.gnome.system.proxy mode; gsettings('host', 'http') -> org.gnome.system.proxy.http host
const gsettings = (key, sub) =>
  execFileSync('gsettings', [
    'get',
    sub ? `org.gnome.system.proxy.${sub}` : 'org.gnome.system.proxy',
    key
  ])
    .toString()
    .trim()
const tunUp = (dev) => {
  try {
    execFileSync('ip', ['link', 'show', dev], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

// ---------- checks ----------

const results = []
let step = 0
async function check(name, fn) {
  step++
  const shot = path.join(
    ARTIFACTS,
    `${String(step).padStart(2, '0')}-${name.replace(/\W+/g, '-')}.png`
  )
  try {
    await fn()
    results.push({ name, ok: true })
    console.log(`PASS  ${name}`)
  } catch (e) {
    results.push({ name, ok: false, error: e.message })
    console.log(`FAIL  ${name}\n      ${e.message}`)
  }
  await page?.screenshot({ path: shot }).catch(() => {})
}

async function tunCheck() {
  await go('#/settings')
  await page.getByRole('tab', { name: 'Режим TUN' }).click()
  await go('#/home')
  await power()
  const dev = await waitFor(async () => {
    const cfg = await inv('mihomoConfig')
    return cfg.tun?.enable && cfg.tun.device
  }, 'tun enabled in core')
  await waitFor(() => tunUp(dev), `interface ${dev}`)
  // No proxy configured for this request: only the TUN can hand it to node-b.
  // The interface shows up before auto-route installs its rules, so retry for a while.
  let node = null
  await waitFor(async () => {
    node = await whichNode(
      () => directGet('http://1.1.1.1/'),
      (dest) => dest === '1.1.1.1:80',
      { mayFail: true }
    )
    return node === 'node-b'
  }, `request outside any proxy to reach node-b (last went via ${node})`).catch((e) => {
    throw new Error(`${e.message}; last went via ${node}`)
  })
  await power()
  await waitFor(() => !tunUp(dev), `interface ${dev} removed`)
}

try {
  await launch()

  await check('russian UI and window title', async () => {
    await page.getByText('Профилей пока нет').waitFor({ timeout: 20000 })
    assert((await page.title()) === 'r00tvpn', `title: ${await page.title()}`)
    // skip the onboarding tour, its overlay would swallow clicks
    await page.evaluate(() => localStorage.setItem('tourShown', 'true'))
    await page.reload()
    await page.getByText('Профилей пока нет').waitFor({ timeout: 20000 })
  })

  if (APPIMAGE) {
    await check('appimage runs the core from the data dir', async () => {
      const copy = path.join(dataDir, 'sidecar', 'mihomo')
      assert(fs.existsSync(copy), `${copy} missing`)
      const running = execFileSync('ps', ['-eo', 'args']).toString()
      assert(running.includes(copy), 'mihomo is not running from the copy')
    })
  }

  await check('import subscription by URL', async () => {
    await page.locator('[data-guide="home-add-profile-btn"]').click()
    await page
      .locator('[data-guide="profile-import-url-input"]')
      .fill(`http://127.0.0.1:${PORTS.sub}/sub`)
    await page.locator('[data-guide="profile-import-submit"]').click()
    const cfg = await waitFor(async () => {
      const c = await inv('getProfileConfig')
      return c.items?.length === 1 && c
    }, 'profile added')
    assert(cfg.items[0].name === 'e2e', `profile name: ${cfg.items[0].name}`)
    assert(
      userAgents.some((ua) => ua.startsWith('clash.meta r00tvpn/')),
      `User-Agent: ${userAgents.join(' | ')}`
    )
  })

  await check('proxy list', async () => {
    const group = await waitFor(
      async () => (await inv('mihomoGroups'))?.find((g) => g.name === 'PROXY'),
      'PROXY group'
    )
    const names = group.all.map((p) => p.name).join(',')
    assert(names === 'node-a,node-b', `PROXY members: ${names}`)
  })

  await check('system proxy on', async () => {
    // Outside the isolated Linux dbus session this would point the whole
    // machine at the fixture nodes, which refuse everything but the target
    if (!isLinux) await inv('patchAppConfig', { sysProxy: { enable: false, mode: 'manual' } })
    await go('#/settings')
    await page.getByRole('tab', { name: 'Режим прокси' }).click()
    await go('#/home')
    await power()
    await waitFor(
      async () => (await inv('mihomoConfig'))['mixed-port'] === PORTS.mixed,
      'mixed port'
    )
    if (isLinux) {
      await waitFor(() => gsettings('mode') === "'manual'", 'gsettings proxy mode manual')
      // the helper sets the mode before the host and port: wait for those too
      let proxy = ''
      await waitFor(() => {
        proxy = `${gsettings('host', 'http')}:${gsettings('port', 'http')}`
        return proxy === `'127.0.0.1':${PORTS.mixed}`
      }, 'gsettings http proxy 127.0.0.1').catch(() => {
        throw new Error(`http proxy ${proxy}`)
      })
    }
    const node = await whichNode(() => viaApp('/'))
    assert(node === 'node-a', `went via ${node}, expected the default node-a`)
  })

  await check('latency tested on its own after connecting', async () => {
    // a node shows "—" until a delay test has run; nobody taps the button here
    const nodeA = page.getByRole('button', { name: /^node-a\b/ })
    await waitFor(
      async () => !(await nodeA.innerText()).trim().endsWith('—'),
      'node-a latency after connecting'
    )
  })

  await check('select node in the UI', async () => {
    // the home screen lists the main group's nodes next to the connect button
    await go('#/home')
    await page.getByRole('button', { name: /^node-b\b/ }).click()
    await waitFor(
      async () => (await inv('mihomoGroups')).find((g) => g.name === 'PROXY').now === 'node-b',
      'node-b selected'
    )
    const node = await whichNode(() => viaApp('/'))
    assert(node === 'node-b', `went via ${node}, expected node-b`)
  })

  await check('outbound modes rule / global / direct', async () => {
    // GLOBAL defaults to DIRECT, so global and direct both bypass the nodes here
    for (const [icon, mode, expected] of [
      ['globe', 'global', null],
      ['chevrons-right', 'direct', null],
      ['route', 'rule', 'node-b']
    ]) {
      await page.locator(`button:has(svg.lucide-${icon})`).first().click()
      await waitFor(async () => (await inv('mihomoConfig')).mode === mode, `mode ${mode}`)
      const node = await whichNode(() => viaApp('/'))
      assert(node === expected, `${mode}: went via ${node}, expected ${expected}`)
    }
  })

  await check('connections page', async () => {
    const slow = viaApp('/slow')
    await go('#/connections')
    await waitFor(
      async () => /^node(\.exe)?$/m.test(await bodyText()),
      'connection of the test process'
    )
    await slow
  })

  await check('logs page', async () => {
    await go('#/logs')
    // the list is virtualised, so narrow it with the filter box instead of scrolling
    await page.getByPlaceholder('Фильтр').fill(String(PORTS.target))
    await waitFor(async () => (await bodyText()).includes(TARGET), `log line for ${TARGET}`)
  })

  await check('system proxy off', async () => {
    await go('#/home')
    await power()
    await waitFor(async () => (await inv('getAppConfig')).proxyMode === false, 'proxy mode off')
    if (isLinux) await waitFor(() => gsettings('mode') === "'none'", 'gsettings proxy mode none')
  })

  if (WITH_TUN && isLinux) {
    if (APPIMAGE) {
      // Stand-in for the pkexec grant the app asks for; it needs a restart to apply
      await quit()
      const copy = path.join(dataDir, 'sidecar', 'mihomo')
      execFileSync('sudo', ['chown', 'root:root', copy])
      execFileSync('sudo', ['chmod', '+sx', copy])
      await launch()
    }
    await check('TUN captures traffic without proxy settings', tunCheck)
  }

  await quit()
} catch (e) {
  results.push({ name: 'harness', ok: false, error: e.stack || String(e) })
  console.log(`FAIL  harness\n      ${e.stack || e}`)
  await page?.screenshot({ path: path.join(ARTIFACTS, 'harness-failure.png') }).catch(() => {})
  await electronApp?.close().catch(() => {})
} finally {
  fs.writeFileSync(path.join(ARTIFACTS, 'results.json'), JSON.stringify(results, null, 2))
  for (const s of [sub, target, ...nodes.map((n) => n.server)]) s.close()
}

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
if (process.env.GITHUB_ACTIONS) reportToGitHub()
process.exit(failed.length ? 1 : 0)

// Annotations and the job summary show on the run page without signing in,
// unlike step logs
function reportToGitHub() {
  const esc = (s) => String(s).replace(/%/g, '%25').replace(/\r/g, '').replace(/\n/g, '%0A')
  const label = path.basename(exe)
  let appLog = ''
  try {
    appLog = fs
      .readFileSync(path.join(ARTIFACTS, 'app.log'), 'utf8')
      .split('\n')
      .slice(-25)
      .join('\n')
  } catch {
    // no output captured
  }
  for (const r of failed) {
    const detail =
      r.name === 'harness' && appLog ? `${r.error}\n--- app.log (tail) ---\n${appLog}` : r.error
    console.log(`::error title=e2e ${label}: ${esc(r.name)}::${esc(detail)}`)
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    const rows = results.map(
      (r) =>
        `| ${r.ok ? 'pass' : '**FAIL**'} | ${r.name} | ${r.ok ? '' : String(r.error).split('\n')[0].replace(/\|/g, '\\|')} |`
    )
    const summary = [`### e2e: ${label}`, '', '| | check | error |', '|---|---|---|', ...rows, '']
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary.join('\n') + '\n')
  }
}
