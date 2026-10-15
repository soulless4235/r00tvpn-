import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { ChevronRight, Gauge } from 'lucide-react'
import { useGroups } from '@renderer/hooks/use-groups'
import { useAppConfig } from '@renderer/hooks/use-app-config'
import { mihomoChangeProxy, mihomoCloseAllConnections, mihomoGroupDelay } from '@renderer/utils/ipc'
import { Spinner } from '@renderer/components/ui/spinner'
import { cn } from '@renderer/lib/utils'

type Member = ControllerProxiesDetail | ControllerGroupDetail

const GROUP_TYPES = new Set<string>(['Selector', 'URLTest', 'Fallback', 'LoadBalance', 'Relay'])
// A leading flag emoji (two regional indicator symbols), as subscription panels name nodes
const FLAG_RE = /^\p{Regional_Indicator}{2}/u

function lastDelay(member: Member): number | undefined {
  const { history } = member
  return history.length > 0 ? history[history.length - 1].delay : undefined
}

// 🇫🇮 -> "FI"
function flagToRegion(flag: string): string {
  return [...flag].map((c) => String.fromCharCode(c.codePointAt(0)! - 0x1f1e6 + 65)).join('')
}

// Same thresholds as the proxies page, so a node has one colour everywhere
function delayClass(delay: number | undefined): string {
  if (delay === undefined) return 'text-muted-foreground'
  if (delay === 0) return 'text-destructive'
  if (delay < 500) return 'text-success'
  return 'text-warning'
}

interface Section {
  key: string
  title: string
  items: Member[]
}

// The home screen's server picker: the main group's members, nodes grouped by country flag
const ServerList: React.FC<{ group: ControllerMixedGroup }> = ({ group }) => {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const { mutate } = useGroups()
  const { appConfig } = useAppConfig()
  const { autoCloseConnection = true } = appConfig || {}
  const [testing, setTesting] = useState(false)
  const selectable = group.type === 'Selector'

  const sections = useMemo<Section[]>(() => {
    const groupItems = group.all.filter((m) => GROUP_TYPES.has(m.type))
    const byFlag = new Map<string, Member[]>()
    for (const node of group.all.filter((m) => !GROUP_TYPES.has(m.type))) {
      const flag = node.name.match(FLAG_RE)?.[0] ?? ''
      byFlag.set(flag, [...(byFlag.get(flag) ?? []), node])
    }
    const regionTitle = (flag: string): string => {
      // Prefer the subscription's own country group name, e.g. "🇫🇮 Финляндия"
      const named = groupItems.find((g) => g.name.startsWith(flag))
      if (named) return named.name
      try {
        const name = new Intl.DisplayNames([i18n.language], { type: 'region' }).of(
          flagToRegion(flag)
        )
        return `${flag} ${name}`
      } catch {
        return flag
      }
    }
    const result: Section[] = []
    if (groupItems.length > 0) {
      result.push({ key: 'groups', title: t('pages.home.groupsSection'), items: groupItems })
    }
    const onlyUnflagged = byFlag.size === 1 && byFlag.has('')
    for (const [flag, items] of byFlag) {
      result.push({
        key: flag || 'other',
        title: flag
          ? regionTitle(flag)
          : t(onlyUnflagged ? 'pages.home.nodes' : 'pages.home.otherNodes'),
        items
      })
    }
    return result
  }, [group, i18n.language, t])

  const pick = async (name: string): Promise<void> => {
    if (!selectable || name === group.now) return
    await mihomoChangeProxy(group.name, name)
    if (autoCloseConnection) {
      await mihomoCloseAllConnections(group.name)
    }
    mutate()
  }

  const testLatency = async (): Promise<void> => {
    setTesting(true)
    try {
      await mihomoGroupDelay(group.name, group.testUrl)
    } catch {
      // unreachable nodes are reported per node in the list
    } finally {
      mutate()
      setTesting(false)
    }
  }

  const delayText = (delay: number | undefined): string =>
    delay === undefined
      ? '—'
      : delay === 0
        ? t('pages.home.noResponse')
        : t('pages.home.latencyMs', { ms: delay })

  return (
    <section
      aria-label={t('pages.home.servers')}
      className="flex h-full min-h-0 flex-col gap-3 rounded-2xl border border-stroke bg-card p-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 px-1.5">
        <div className="flex min-w-0 flex-col">
          <span className="text-base font-semibold">{t('pages.home.servers')}</span>
          <span className="flag-emoji truncate text-xs text-muted-foreground">{group.name}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={testLatency}
            disabled={testing}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-stroke px-2.5 text-xs text-foreground/85 transition-colors hover:bg-accent disabled:opacity-60 cursor-pointer"
          >
            {testing ? (
              <Spinner className="size-3.5" />
            ) : (
              <Gauge className="size-3.5" aria-hidden />
            )}
            {t('pages.home.testLatency')}
          </button>
          <button
            type="button"
            data-guide="home-group-selector"
            onClick={() => navigate('/proxies', { state: { fromHome: true } })}
            className="inline-flex h-8 items-center gap-0.5 rounded-lg px-2 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground cursor-pointer"
          >
            {t('pages.home.allGroups')}
            <ChevronRight className="size-3.5" aria-hidden />
          </button>
        </div>
      </div>

      {!selectable && (
        <p className="px-1.5 text-xs text-muted-foreground">{t('pages.home.fixedGroup')}</p>
      )}

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-0.5">
        {sections.map((section) => (
          <div key={section.key} className="flex flex-col gap-1">
            <div className="flag-emoji px-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {section.title}
            </div>
            {section.items.map((member) => {
              const selected = member.name === group.now
              const delay = lastDelay(member)
              const label =
                section.key === 'groups'
                  ? member.name
                  : member.name.replace(FLAG_RE, '').trim() || member.name
              const current = 'now' in member && member.now ? member.now : null
              return (
                <button
                  key={member.name}
                  type="button"
                  disabled={!selectable}
                  aria-pressed={selected}
                  onClick={() => pick(member.name)}
                  className={cn(
                    'flex min-h-11 w-full items-center gap-3 rounded-xl border px-3 py-2 text-left text-sm transition-colors',
                    selected
                      ? 'border-primary bg-accent text-foreground'
                      : 'border-transparent text-foreground/90 hover:bg-accent/60',
                    selectable ? 'cursor-pointer' : 'cursor-default'
                  )}
                >
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="flag-emoji truncate">{label}</span>
                    {current && (
                      <span className="flag-emoji truncate text-xs text-muted-foreground">
                        {current}
                      </span>
                    )}
                  </span>
                  <span className={cn('shrink-0 text-xs tabular-nums', delayClass(delay))}>
                    {delayText(delay)}
                  </span>
                </button>
              )
            })}
          </div>
        ))}
      </div>
    </section>
  )
}

export default ServerList
