import { getAppConfig } from '../config'
import { version } from '../../../package.json'
import { APP_SLUG } from '../../shared/brand'

const CORE_VERSION_TIMEOUT_MS = 2000

// The running core's release number ("1.19.30"), or undefined for an alpha build or a
// core that is not up yet. Imported lazily: the API client and the config import each other.
async function coreVersion(): Promise<string | undefined> {
  try {
    const { mihomoVersion } = await import('../core/mihomoApi')
    const { version } = await Promise.race([
      mihomoVersion(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('core version timeout')), CORE_VERSION_TIMEOUT_MS)
      )
    ])
    return /^v?(\d+\.\d+\.\d+)$/.exec(version)?.[1]
  } catch {
    return undefined
  }
}

export async function getUserAgent(): Promise<string> {
  const { userAgent } = await getAppConfig()
  if (userAgent) {
    return userAgent
  }

  // Subscription panels choose the response format by User-Agent and some only
  // match known client tokens at the start (e.g. Marzban: ^clash.meta|^mihomo),
  // so lead with the Mihomo token to get a Clash YAML config back. The core's
  // version at the end lets a panel that reads it (Mikan) send every proxy type
  // this core knows instead of only the ones every core has.
  const core = await coreVersion()
  return `clash.meta ${APP_SLUG}/${version}` + (core ? ` mihomo/${core}` : '')
}
