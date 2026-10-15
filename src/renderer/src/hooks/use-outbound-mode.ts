import { useCallback } from 'react'
import { useAppConfig } from '@renderer/hooks/use-app-config'
import { useControledMihomoConfig } from '@renderer/hooks/use-controled-mihomo-config'
import { useGroups } from '@renderer/hooks/use-groups'
import { mihomoCloseAllConnections, patchMihomoConfig } from '@renderer/utils/ipc'

// Shared by the sidebar switcher and the home screen so both switch the same way
export function useOutboundMode(): {
  mode: OutboundMode | undefined
  setMode: (mode: OutboundMode) => Promise<void>
} {
  const { controledMihomoConfig, patchControledMihomoConfig } = useControledMihomoConfig()
  const { mutate: mutateGroups } = useGroups()
  const { appConfig } = useAppConfig()
  const { autoCloseConnection = true } = appConfig || {}

  const setMode = useCallback(
    async (mode: OutboundMode): Promise<void> => {
      await patchControledMihomoConfig({ mode })
      await patchMihomoConfig({ mode })
      if (autoCloseConnection) {
        await mihomoCloseAllConnections()
      }
      mutateGroups()
      window.electron.ipcRenderer.send('updateTrayMenu')
    },
    [patchControledMihomoConfig, autoCloseConnection, mutateGroups]
  )

  return { mode: controledMihomoConfig?.mode, setMode }
}
