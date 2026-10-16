// Fork identity, shared by the main process and the renderer.
// Keep in sync with package.json and electron-builder.yml.

// Display name (window titles, tray, menus)
export const APP_NAME = 'r00tvpn'
// ASCII slug for files, pipes, sockets and scheduled tasks
export const APP_SLUG = 'r00tvpn'
// Must match appId in electron-builder.yml (Windows AppUserModelID, macOS bundle id)
export const APP_ID = 'io.github.soulless4235.r00tvpn'
// Own deep-link scheme; clash:// and mihomo:// stay supported for subscription import
export const APP_SCHEME = 'r00tvpn'
export const DEEP_LINK_SCHEMES = ['clash', 'mihomo', APP_SCHEME] as const

export const GITHUB_REPO = 'soulless4235/r00tvpn-'
export const REPO_URL = `https://github.com/${GITHUB_REPO}`

// The service's Telegram bot: trial and subscriptions, offered while the app has no profile
export const TELEGRAM_BOT_URL = 'https://t.me/r00tvpn_bot'
