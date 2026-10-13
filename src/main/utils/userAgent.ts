import { getAppConfig } from '../config'
import { version } from '../../../package.json'
import { APP_SLUG } from '../../shared/brand'

export async function getUserAgent(): Promise<string> {
  const { userAgent } = await getAppConfig()
  if (userAgent) {
    return userAgent
  }

  // Subscription panels choose the response format by User-Agent and some only
  // match known client tokens at the start (e.g. Marzban: ^clash.meta|^mihomo),
  // so lead with the Mihomo token to get a Clash YAML config back
  return `clash.meta ${APP_SLUG}/${version}`
}
