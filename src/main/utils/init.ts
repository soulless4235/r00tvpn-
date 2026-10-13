import {
  appConfigPath,
  bundledCorePath,
  controledMihomoConfigPath,
  dataDir,
  downloadedCoreDir,
  isAppImage,
  logDir,
  mihomoCorePath,
  mihomoTestDir,
  mihomoWorkDir,
  profileConfigPath,
  profilePath,
  profilesDir,
  resourcesFilesDir,
  rulesDir,
  themesDir
} from './dirs'
import {
  defaultConfig,
  defaultControledMihomoConfig,
  defaultProfile,
  defaultProfileConfig
} from './template'
import { stringifyYaml } from './yaml'
import { chmod, copyFile, mkdir, writeFile, cp, rm, readdir, readFile, stat } from 'fs/promises'
import { existsSync } from 'fs'
import path from 'path'
import { GEO_FILES, linkGeoFiles, removeUnusedMetadb } from './geo'
import {
  startPacServer
} from '../resolve/server'
import { triggerSysProxy } from '../sys/sysproxy'
import {
  getAppConfig,
  getControledMihomoConfig,
  patchAppConfig,
  patchControledMihomoConfig
} from '../config'
import { app } from 'electron'
import { startSSIDCheck } from '../sys/ssid'
import { startNetworkDetection } from '../core/manager'
import { PORT_KEYS } from '../core/factory'
import { initKeyManager } from '../service/manager'
import { cleanupLogs } from './logs'
import { DEEP_LINK_SCHEMES } from '../../shared/brand'

async function initDirs(): Promise<void> {
  if (!existsSync(dataDir())) {
    await mkdir(dataDir())
  }
  const dirs = [
    themesDir(),
    profilesDir(),
    rulesDir(),
    mihomoWorkDir(),
    logDir(),
    mihomoTestDir(),
  ]
  await Promise.all(
    dirs.map(async (dir) => {
      if (!existsSync(dir)) {
        await mkdir(dir, { recursive: true })
      }
    })
  )
}

async function initConfig(): Promise<void> {
  const configTasks: Promise<void>[] = []

  if (!existsSync(appConfigPath())) {
    configTasks.push(writeFile(appConfigPath(), stringifyYaml(defaultConfig)))
  }
  if (!existsSync(profileConfigPath())) {
    configTasks.push(writeFile(profileConfigPath(), stringifyYaml(defaultProfileConfig)))
  }
  if (!existsSync(profilePath('default'))) {
    configTasks.push(writeFile(profilePath('default'), stringifyYaml(defaultProfile)))
  }
  if (!existsSync(controledMihomoConfigPath())) {
    configTasks.push(
      writeFile(controledMihomoConfigPath(), stringifyYaml(defaultControledMihomoConfig))
    )
  }

  if (configTasks.length > 0) {
    await Promise.all(configTasks)
  }
}

async function initFiles(): Promise<void> {
  const copy = async (file: string): Promise<void> => {
    const targetPath = path.join(mihomoWorkDir(), file)
    const sourcePath = path.join(resourcesFilesDir(), file)
    if (!existsSync(targetPath) && existsSync(sourcePath)) {
      await cp(sourcePath, targetPath, { recursive: true })
    }
  }
  await Promise.all(GEO_FILES.map(copy))
  await removeUnusedMetadb(mihomoWorkDir())
  await linkGeoFiles(mihomoTestDir())
  await syncAppImageCores()
}

// Keep the data-dir copy of the cores in step with the ones inside the AppImage.
// A refreshed copy loses setuid, so the app asks to grant the permission again.
async function syncAppImageCores(): Promise<void> {
  if (!isAppImage()) return
  for (const core of ['mihomo', 'mihomo-alpha'] as const) {
    const source = bundledCorePath(core)
    if (!existsSync(source)) continue
    const target = mihomoCorePath(core)
    const stampPath = `${target}.source`
    const { size, mtimeMs } = await stat(source)
    const stamp = `${size}:${mtimeMs}`
    if (existsSync(target) && existsSync(stampPath)) {
      if ((await readFile(stampPath, 'utf8')) === stamp) continue
    }
    await mkdir(downloadedCoreDir(), { recursive: true })
    // An older copy may be root-owned after a grant; unlinking it only needs write access to the dir
    await rm(target, { force: true })
    await copyFile(source, target)
    await chmod(target, 0o755)
    await writeFile(stampPath, stamp)
  }
}

async function cleanup(): Promise<void> {
  // update cache
  const files = await readdir(dataDir())
  for (const file of files) {
    if (file.endsWith('.exe') || file.endsWith('.pkg') || file.endsWith('.7z')) {
      try {
        await rm(path.join(dataDir(), file))
      } catch {
        // ignore
      }
    }
  }
}

async function migration(): Promise<void> {
  const appConfig = await getAppConfig()
  const mihomoConfig = await getControledMihomoConfig()

  const mihomoConfigPatch: Partial<MihomoConfig> = {}

  for (const key in defaultControledMihomoConfig) {
    if (
      !(key in mihomoConfig) &&
      defaultControledMihomoConfig[key as keyof MihomoConfig] !== undefined
    ) {
      ;(mihomoConfigPatch as Record<string, unknown>)[key] =
        defaultControledMihomoConfig[key as keyof MihomoConfig]
    }
  }

  // 清理已弃用的配置
  if (mihomoConfig['external-controller-pipe' as keyof MihomoConfig]) {
    mihomoConfigPatch['external-controller-pipe' as keyof MihomoConfig] = undefined as never
  }
  if (mihomoConfig['external-controller-unix' as keyof MihomoConfig]) {
    mihomoConfigPatch['external-controller-unix' as keyof MihomoConfig] = undefined as never
  }

  if (mihomoConfig['external-controller'] === undefined) {
    mihomoConfigPatch['external-controller'] = ''
  }

  if (Object.keys(mihomoConfigPatch).length > 0) {
    await patchControledMihomoConfig(mihomoConfigPatch)
  }

  const appConfigPatch: Partial<AppConfig> = {}

  for (const key in defaultConfig) {
    if (!(key in appConfig) && defaultConfig[key as keyof AppConfig] !== undefined) {
      ;(appConfigPatch as Record<string, unknown>)[key] = defaultConfig[key as keyof AppConfig]
    }
  }

  // Before customPorts existed, a port that differs from the default was set by the user
  if (appConfig.customPorts === undefined) {
    appConfigPatch.customPorts = PORT_KEYS.filter(
      (key) => key in mihomoConfig && mihomoConfig[key] !== defaultControledMihomoConfig[key]
    )
  }

  // Migrate: the old sysProxy.enable toggle now maps to the new proxyMode toggle.
  // sysProxy.enable becomes a sub-toggle (default ON) that only writes proxy to the OS.
  const legacyAppConfig = appConfig as Partial<AppConfig>
  if (!('proxyMode' in legacyAppConfig)) {
    appConfigPatch.proxyMode = legacyAppConfig.sysProxy?.enable ?? false
    if (!legacyAppConfig.sysProxy?.enable) {
      appConfigPatch.sysProxy = { ...(legacyAppConfig.sysProxy ?? {}), enable: true }
    }
  }

  if (Object.keys(appConfigPatch).length > 0) {
    await patchAppConfig(appConfigPatch)
  }
}

function initDeeplink(): void {
  for (const scheme of DEEP_LINK_SCHEMES) {
    if (process.defaultApp) {
      if (process.argv.length >= 2) {
        app.setAsDefaultProtocolClient(scheme, process.execPath, [path.resolve(process.argv[1])])
      }
    } else {
      app.setAsDefaultProtocolClient(scheme)
    }
  }
}

export async function init(): Promise<void> {
  await initDirs()
  await Promise.all([initConfig(), initFiles()])
  await migration()

  const [appConfig] = await Promise.all([
    getAppConfig(),
    initKeyManager(),
    cleanup().catch(() => {
      // ignore
    })
  ])
  // Archiving can take a while and nothing at startup depends on it
  cleanupLogs().catch(() => {})

  const {
    sysProxy,
    proxyMode = false,
    onlyActiveDevice = false,
    networkDetection = false
  } = appConfig
  const writeSysProxy = proxyMode && sysProxy.enable

  const initTasks: Promise<void>[] = [
    startSSIDCheck()
  ]

  if (networkDetection) {
    initTasks.push(startNetworkDetection())
  }

  initTasks.push(
    (async (): Promise<void> => {
      try {
        if (writeSysProxy) {
          await startPacServer()
        }
        await triggerSysProxy(writeSysProxy, onlyActiveDevice)
      } catch {
        // ignore
      }
    })()
  )

  await Promise.all(initTasks)

  initDeeplink()
}
