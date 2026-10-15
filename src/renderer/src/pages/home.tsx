import { toast } from 'sonner'
import BasePage from '@renderer/components/base/base-page'
import { useAppConfig } from '@renderer/hooks/use-app-config'
import { useControledMihomoConfig } from '@renderer/hooks/use-controled-mihomo-config'
import { useProfileConfig } from '@renderer/hooks/use-profile-config'
import { useGroups } from '@renderer/hooks/use-groups'
import { triggerSysProxy, updateTrayIcon, mihomoHotReloadConfig } from '@renderer/utils/ipc'
import { useTranslation } from 'react-i18next'
import { memo, useEffect, useMemo, useState } from 'react'
import dayjs from 'dayjs'
import {
  InfinityIcon,
  WifiOff,
  PlusCircle,
  Globe,
  ArrowUp,
  ArrowDown,
  RefreshCcw,
  CalendarClock,
  CreditCard,
  Power,
  TriangleAlert,
  Route,
  ChevronsRight
} from 'lucide-react'
import ServerList from '@renderer/components/home/server-list'
import TrafficSparkline from '@renderer/components/home/traffic-sparkline'
import { useOutboundMode } from '@renderer/hooks/use-outbound-mode'
import { cn } from '@renderer/lib/utils'
import { SiTelegram } from 'react-icons/si'
import EditInfoModal from '@renderer/components/profiles/edit-info-modal'
import { Spinner } from '@renderer/components/ui/spinner'
import { CharacterMorph } from '@renderer/components/ui/character-morph'
import { calcTraffic } from '@renderer/utils/calc'
import { useTrafficStore } from '@renderer/store/traffic-store'
import { reopenCoreError, useCoreLifecycleStore } from '@renderer/store/core-lifecycle-store'

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${(bytes / Math.pow(1024, i)).toFixed(i > 1 ? 1 : 0)} ${units[i]}`
}

// Days left at which the stats block is replaced by the renewal notice
const EXPIRY_WARNING_DAYS = 3

// Module-level variable: persists across component mounts/unmounts
let connectionStartTime: number | null = null

const ConnectedTimer = memo(({ active }: { active: boolean }) => {
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    if (!active) {
      connectionStartTime = null
      setElapsed(0)
      return undefined
    }

    if (connectionStartTime === null) {
      connectionStartTime = Date.now()
    }

    const updateElapsed = (): void => {
      setElapsed(Math.floor((Date.now() - connectionStartTime!) / 1000))
    }
    updateElapsed()
    const interval = setInterval(updateElapsed, 1000)
    return () => clearInterval(interval)
  }, [active])

  const hours = Math.floor(elapsed / 3600)
  const minutes = Math.floor((elapsed % 3600) / 60)
  const seconds = elapsed % 60
  return (
    <span>
      {String(hours).padStart(2, '0')}:{String(minutes).padStart(2, '0')}:
      {String(seconds).padStart(2, '0')}
    </span>
  )
})
ConnectedTimer.displayName = 'ConnectedTimer'

const Home: React.FC = () => {
  const { t } = useTranslation()
  const { appConfig, patchAppConfig } = useAppConfig()
  const {
    mainSwitchMode = 'tun',
    sysProxy,
    proxyMode = false,
    onlyActiveDevice = false
  } = appConfig || {}
  const { enable: writeSysProxy = true, mode } = sysProxy || {}
  const { controledMihomoConfig, patchControledMihomoConfig } = useControledMihomoConfig()
  const { tun } = controledMihomoConfig || {}
  const { 'mixed-port': mixedPort } = controledMihomoConfig || {}
  const sysProxyDisabled = mixedPort == 0

  const { profileConfig, addProfileItem } = useProfileConfig()
  const { groups } = useGroups()
  const { mode: outboundMode, setMode: setOutboundMode } = useOutboundMode()
  const hasProfiles = (profileConfig?.items?.length ?? 0) > 0
  const [showEditModal, setShowEditModal] = useState(false)
  const [editingItem, setEditingItem] = useState<ProfileItem | null>(null)
  const [updating, setUpdating] = useState(false)

  const handleAddProfile = (): void => {
    const newProfile: ProfileItem = {
      id: '',
      name: '',
      type: 'remote',
      url: '',
      useProxy: false,
      autoUpdate: true
    }
    setEditingItem(newProfile)
    setShowEditModal(true)
  }

  const trafficInfo = useTrafficStore((s) => s.traffic)

  const [loading, setLoading] = useState(false)
  const [loadingDirection, setLoadingDirection] = useState<'connecting' | 'disconnecting'>(
    'connecting'
  )

  // A dead core cannot carry traffic, whatever the saved switch state says
  const coreProblem = useCoreLifecycleStore((s) => s.coreState.status === 'error')
  const isSelected = !coreProblem && ((tun?.enable ?? false) || proxyMode)

  const isDisabled =
    loading ||
    (!coreProblem &&
      mainSwitchMode === 'sysproxy' &&
      writeSysProxy &&
      mode == 'manual' &&
      sysProxyDisabled)

  const status = loading
    ? loadingDirection === 'connecting'
      ? t('pages.home.connecting')
      : t('pages.home.disconnecting')
    : coreProblem
      ? t('pages.home.coreProblem')
      : isSelected
        ? t('pages.home.connected')
        : t('pages.home.disconnected')
  const statusWidthTexts = [
    t('pages.home.connecting'),
    t('pages.home.disconnecting'),
    t('pages.home.connected'),
    t('pages.home.disconnected'),
    t('pages.home.coreProblem')
  ]
  const showConnectedTimer = !loading && isSelected

  // Current profile & subscription
  const currentProfile = useMemo(() => {
    if (!profileConfig?.current || !profileConfig?.items) return null
    return profileConfig.items.find((item) => item.id === profileConfig.current) ?? null
  }, [profileConfig])

  const handleUpdateProfile = async (): Promise<void> => {
    if (!currentProfile || updating) return
    setUpdating(true)
    try {
      await addProfileItem(currentProfile)
    } catch (e) {
      toast.error(`${e}`)
    } finally {
      setUpdating(false)
    }
  }

  const subscription = currentProfile?.extra
  const trafficUsed = (subscription?.upload ?? 0) + (subscription?.download ?? 0)
  const trafficTotal = subscription?.total ?? 0
  const trafficRemaining = trafficTotal > 0 ? trafficTotal - trafficUsed : 0
  const expireTimestamp = subscription?.expire ?? 0
  const expireDate =
    expireTimestamp > 0 ? dayjs.unix(expireTimestamp).format('L') : t('pages.home.never')

  // Re-evaluate the countdown while the window stays open so the notice appears on time
  const [expiryTick, setExpiryTick] = useState(0)
  useEffect(() => {
    if (expireTimestamp <= 0) return undefined
    const interval = setInterval(() => setExpiryTick((n) => n + 1), 60_000)
    return () => clearInterval(interval)
  }, [expireTimestamp])

  const { daysRemaining, isExpired } = useMemo(() => {
    if (expireTimestamp <= 0) return { daysRemaining: 0, isExpired: false }
    const expiresAt = dayjs.unix(expireTimestamp)
    return {
      daysRemaining: Math.max(0, expiresAt.diff(dayjs(), 'day')),
      isExpired: expiresAt.isBefore(dayjs())
    }
  }, [expireTimestamp, expiryTick])

  const showExpiryNotice = expireTimestamp > 0 && daysRemaining <= EXPIRY_WARNING_DAYS
  const renewAction =
    currentProfile?.homeName && currentProfile?.home
      ? { url: currentProfile.home, label: currentProfile.homeName }
      : currentProfile?.supportUrl
        ? { url: currentProfile.supportUrl, label: t('pages.home.renewSubscription') }
        : null
  const expiryTitle = isExpired
    ? t('pages.home.subscriptionExpired')
    : daysRemaining === 0
      ? t('pages.home.subscriptionExpiringToday')
      : t('pages.home.subscriptionExpiring', { count: daysRemaining })

  const firstGroup = groups?.[0]
  // "Авто · 🇫🇮 VLESS Vision" when the selection is itself a group
  const viaLabel = useMemo(() => {
    if (!firstGroup?.now) return null
    const selected = firstGroup.all.find((m) => m.name === firstGroup.now)
    return selected && 'now' in selected && selected.now
      ? `${firstGroup.now} · ${selected.now}`
      : firstGroup.now
  }, [firstGroup])
  // A provider can lock the routing mode for its profile, as in the sidebar
  const globalModeAllowed = currentProfile?.globalMode !== false
  const modeOptions = [
    { value: 'rule' as const, icon: Route, label: t('sider.rules') },
    { value: 'global' as const, icon: Globe, label: t('common.global') },
    { value: 'direct' as const, icon: ChevronsRight, label: t('common.direct') }
  ]
  const supportUrl = currentProfile?.supportUrl
  const supportLinkInfo = useMemo(() => {
    if (!supportUrl) return null
    try {
      const parsed = new URL(supportUrl)
      const normalized = `${parsed.hostname}${parsed.pathname}`.toLowerCase()
      return {
        href: parsed.toString(),
        isTelegram:
          parsed.protocol === 'tg:' ||
          normalized.includes('t.me') ||
          normalized.includes('telegram')
      }
    } catch {
      return null
    }
  }, [supportUrl])

  const onValueChange = async (enable: boolean): Promise<void> => {
    setLoading(true)
    setLoadingDirection(enable ? 'connecting' : 'disconnecting')
    try {
      if (enable) {
        if (mainSwitchMode === 'tun') {
          await patchControledMihomoConfig({ tun: { enable: true }, dns: { enable: true } })
          await mihomoHotReloadConfig()
        } else {
          if (writeSysProxy && mode == 'manual' && sysProxyDisabled) return
          await patchAppConfig({ proxyMode: true })
          await mihomoHotReloadConfig()
          if (writeSysProxy) {
            await triggerSysProxy(true, onlyActiveDevice)
          }
        }
      } else {
        const tunWasEnabled = tun?.enable ?? false
        const proxyModeWasEnabled = proxyMode
        if (tunWasEnabled) {
          await patchControledMihomoConfig({ tun: { enable: false } })
        }
        if (proxyModeWasEnabled) {
          if (writeSysProxy) {
            await triggerSysProxy(false, onlyActiveDevice)
          }
          await patchAppConfig({ proxyMode: false })
        }
        if (tunWasEnabled || proxyModeWasEnabled) {
          await mihomoHotReloadConfig()
        }
      }
      window.electron.ipcRenderer.send('updateFloatingWindow')
      window.electron.ipcRenderer.send('updateTrayMenu')
      await updateTrayIcon()
    } catch (e) {
      toast.error(`${e}`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <BasePage>
      {!hasProfiles ? (
        <div className="h-full w-full flex items-center justify-center">
          <div className="flex flex-col items-center gap-4 max-w-75 rounded-2xl border border-stroke bg-card/50 backdrop-blur-xl p-8">
            <WifiOff className="size-16 text-muted-foreground" />
            <h2 className="text-xl font-bold text-foreground">{t('pages.profiles.emptyTitle')}</h2>
            <p className="text-sm font-medium text-muted-foreground text-center">
              {t('pages.profiles.emptyDescription')}
            </p>
            <button
              onClick={handleAddProfile}
              data-guide="home-add-profile-btn"
              className="flex items-center gap-2 rounded-xl bg-primary px-6 py-3 font-semibold text-primary-foreground transition hover:brightness-105 cursor-pointer"
            >
              <PlusCircle className="size-5" />
              <span className="text-sm font-medium">{t('pages.profiles.addProfile')}</span>
            </button>
          </div>
          {showEditModal && editingItem && (
            <EditInfoModal
              item={editingItem}
              isCurrent={false}
              updateProfileItem={async (item: ProfileItem) => {
                await addProfileItem(item)
                setShowEditModal(false)
                setEditingItem(null)
              }}
              onClose={() => {
                setShowEditModal(false)
                setEditingItem(null)
              }}
            />
          )}
        </div>
      ) : (
        <div className="flex h-full flex-wrap gap-3 overflow-y-auto px-2 pb-2">
          {/* Connection card */}
          <section
            aria-label={status}
            className="flex h-full min-w-0 flex-[1_1_300px] flex-col gap-4 overflow-y-auto rounded-2xl border border-stroke bg-card p-5"
          >
            {currentProfile && (
              <div className="flex flex-col gap-2">
                <div data-guide="home-profile-header" className="flex items-center gap-2.5">
                  {currentProfile.logo && (
                    <img
                      src={currentProfile.logo}
                      alt=""
                      className="size-8 rounded-full"
                      onError={(e) => {
                        ;(e.target as HTMLImageElement).style.display = 'none'
                      }}
                    />
                  )}
                  <span className="min-w-0 flex-1 truncate text-base font-semibold">
                    {currentProfile.name}
                  </span>
                  {currentProfile.type === 'remote' && (
                    <button
                      type="button"
                      onClick={handleUpdateProfile}
                      disabled={updating}
                      aria-label={t('common.update')}
                      className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50 cursor-pointer"
                    >
                      <RefreshCcw className={`size-4 ${updating ? 'animate-spin' : ''}`} />
                    </button>
                  )}
                </div>
                {currentProfile.announce && (
                  <div
                    data-guide="home-profile-announce"
                    className="whitespace-pre-line text-sm text-muted-foreground"
                  >
                    {currentProfile.announce}
                  </div>
                )}
              </div>
            )}

            {/* Subscription expiry notice replaces the stats near the end of the period */}
            {subscription && showExpiryNotice ? (
              <div
                role="status"
                className="rounded-xl border border-destructive/40 bg-destructive/10 p-3"
              >
                <div className="flex items-center gap-2.5">
                  <CalendarClock className="size-5 shrink-0 text-destructive" aria-hidden />
                  <p className="text-sm font-semibold leading-snug text-destructive">
                    {expiryTitle}
                  </p>
                </div>
                <p className="mt-1.5 text-xs text-muted-foreground">
                  {isExpired
                    ? t('pages.home.subscriptionExpiredHint')
                    : t('pages.home.subscriptionExpiringHint', { date: expireDate })}
                </p>
                {renewAction && (
                  <button
                    type="button"
                    onClick={() => open(renewAction.url)}
                    className="mt-3 flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground transition hover:brightness-105 active:scale-[0.99] cursor-pointer"
                  >
                    <CreditCard className="size-4 shrink-0" aria-hidden />
                    <span className="truncate">{renewAction.label}</span>
                  </button>
                )}
              </div>
            ) : (
              subscription && (
                <div className="grid grid-cols-3 gap-1 rounded-xl bg-secondary/60 p-2 text-center">
                  <div className="flex flex-col items-center gap-0.5">
                    <span className="text-[11px] leading-tight text-muted-foreground">
                      {t('pages.home.trafficRemaining').replace(/:$/, '')}
                    </span>
                    <span className="text-sm font-semibold">
                      {trafficTotal > 0 ? (
                        formatBytes(trafficRemaining)
                      ) : (
                        <InfinityIcon className="size-4" />
                      )}
                    </span>
                  </div>
                  <div className="flex flex-col items-center gap-0.5">
                    <span className="text-[11px] leading-tight text-muted-foreground">
                      {t('pages.home.daysRemaining').replace(/:$/, '')}
                    </span>
                    <span className="text-sm font-semibold">
                      {expireTimestamp > 0 ? daysRemaining : <InfinityIcon className="size-4" />}
                    </span>
                  </div>
                  <div className="flex flex-col items-center gap-0.5">
                    <span className="text-[11px] leading-tight text-muted-foreground">
                      {t('pages.home.expires').replace(/:$/, '')}
                    </span>
                    <span className="text-sm font-semibold">{expireDate}</span>
                  </div>
                </div>
              )
            )}

            {/* Status and connection time */}
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <span
                  aria-hidden
                  className={cn(
                    'size-2 rounded-full',
                    coreProblem
                      ? 'bg-destructive'
                      : isSelected
                        ? 'bg-primary'
                        : 'bg-muted-foreground/60'
                  )}
                />
                <CharacterMorph
                  texts={[status]}
                  reserveTexts={statusWidthTexts}
                  interval={3000}
                  className={cn(
                    'h-5 leading-none [&>span:last-child]:justify-self-start',
                    coreProblem
                      ? 'text-destructive'
                      : isSelected
                        ? 'text-primary'
                        : 'text-muted-foreground'
                  )}
                />
              </div>
              <div
                className={cn(
                  'text-4xl font-bold tracking-tight tabular-nums',
                  showConnectedTimer ? 'text-foreground' : 'text-muted-foreground/60'
                )}
              >
                <ConnectedTimer active={isSelected} />
              </div>
              {viaLabel && (
                <div className="flag-emoji truncate text-sm text-muted-foreground">
                  {t('pages.home.via', { name: viaLabel })}
                </div>
              )}
            </div>

            <button
              type="button"
              disabled={isDisabled}
              onClick={() => (coreProblem ? reopenCoreError() : onValueChange(!isSelected))}
              data-guide="home-power-toggle"
              className={cn(
                'flex h-12 w-full shrink-0 items-center justify-center gap-2 rounded-xl text-[15px] font-semibold transition active:scale-[0.99] disabled:opacity-60 cursor-pointer',
                coreProblem
                  ? 'border border-destructive text-destructive hover:bg-destructive/10'
                  : isSelected || loading
                    ? 'border border-stroke text-foreground hover:bg-accent'
                    : 'bg-primary text-primary-foreground hover:brightness-105'
              )}
            >
              {loading ? (
                <>
                  <Spinner className="size-4" />
                  {status}
                </>
              ) : coreProblem ? (
                <>
                  <TriangleAlert className="size-4" aria-hidden />
                  {t('pages.home.coreProblem')}
                </>
              ) : (
                <>
                  <Power className="size-4" aria-hidden />
                  {isSelected ? t('pages.home.disconnect') : t('pages.home.connect')}
                </>
              )}
            </button>

            <div className="flex flex-col gap-2">
              <div className="flex justify-between text-xs tabular-nums text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <ArrowUp className="size-3.5" aria-hidden />
                  {calcTraffic(trafficInfo.upTotal)}
                </span>
                <span className="inline-flex items-center gap-1">
                  <ArrowDown className="size-3.5" aria-hidden />
                  {calcTraffic(trafficInfo.downTotal)}
                </span>
              </div>
              <TrafficSparkline active={showConnectedTimer} />
            </div>

            {globalModeAllowed && outboundMode && (
              <div
                role="group"
                aria-label={t('pages.home.routingMode')}
                className="flex shrink-0 rounded-xl border border-stroke bg-background p-1"
              >
                {modeOptions.map(({ value, icon: Icon, label }) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={outboundMode === value}
                    onClick={() => setOutboundMode(value)}
                    className={cn(
                      'flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg px-2 text-xs font-medium transition-colors cursor-pointer',
                      outboundMode === value
                        ? 'bg-secondary text-foreground'
                        : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    <Icon className="size-3.5 shrink-0" aria-hidden />
                    <span className="truncate">{label}</span>
                  </button>
                ))}
              </div>
            )}

            {supportLinkInfo && (
              <div className="mt-auto flex justify-center text-sm text-muted-foreground">
                <button
                  data-guide="home-support-link"
                  type="button"
                  onClick={() => open(supportLinkInfo.href)}
                  className="inline-flex items-center gap-1.5 transition-colors hover:text-foreground cursor-pointer"
                >
                  {supportLinkInfo.isTelegram ? (
                    <SiTelegram className="size-4" />
                  ) : (
                    <Globe className="size-4" />
                  )}
                  <span>{t('pages.profiles.support')}</span>
                </button>
              </div>
            )}
          </section>

          {firstGroup && (
            <div className="flex h-full min-h-80 min-w-0 flex-[1_1_340px] flex-col">
              <ServerList group={firstGroup} connected={showConnectedTimer} />
            </div>
          )}
        </div>
      )}
    </BasePage>
  )
}

export default Home
