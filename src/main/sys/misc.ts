import { exec, execFile, execSync, spawn } from 'child_process'
import { app, dialog, nativeTheme, shell } from 'electron'
import { readFile } from 'fs/promises'
import path from 'path'
import { promisify } from 'util'
import {
  dataDir,
  exePath,
  mihomoCorePath,
  profilePath,
  resourcesDir,
  resourcesFilesDir,
  taskDir
} from '../utils/dirs'
import { copyFileSync, writeFileSync } from 'fs'
import { t } from '../utils/i18n'
import { APP_NAME, APP_SLUG } from '../../shared/brand'

export const ELEVATE_TASK_NAME = `${APP_SLUG}-run`
export const RUNNER_EXE = `${APP_SLUG}-run.exe`

export function getFilePath(ext: string[]): string[] | undefined {
  return dialog.showOpenDialogSync({
    title: t('dialog.selectSubscriptionFile'),
    filters: [{ name: `${ext} file`, extensions: ext }],
    properties: ['openFile']
  })
}

export async function readTextFile(filePath: string): Promise<string> {
  return await readFile(filePath, 'utf8')
}

export function openFile(id: string): void {
  shell.openPath(profilePath(id))
}

export async function openUWPTool(): Promise<void> {
  const execFilePromise = promisify(execFile)
  const uwpToolPath = path.join(resourcesDir(), 'files', 'enableLoopback.exe')
  await execFilePromise(uwpToolPath)
}

export async function setupFirewall(): Promise<void> {
  const execPromise = promisify(exec)
  // Rule names carry the app prefix so other Mihomo GUIs' rules are left alone
  const removeCommand = `
  $rules = @("${APP_NAME} mihomo", "${APP_NAME} mihomo-alpha", "${APP_NAME}")
  foreach ($rule in $rules) {
    if (Get-NetFirewallRule -DisplayName $rule -ErrorAction SilentlyContinue) {
      Remove-NetFirewallRule -DisplayName $rule -ErrorAction SilentlyContinue
    }
  }
  `
  const createCommand = `
  New-NetFirewallRule -DisplayName "${APP_NAME} mihomo" -Direction Inbound -Action Allow -Program "${mihomoCorePath('mihomo')}" -Enabled True -Profile Any -ErrorAction SilentlyContinue
  New-NetFirewallRule -DisplayName "${APP_NAME} mihomo-alpha" -Direction Inbound -Action Allow -Program "${mihomoCorePath('mihomo-alpha')}" -Enabled True -Profile Any -ErrorAction SilentlyContinue
  New-NetFirewallRule -DisplayName "${APP_NAME}" -Direction Inbound -Action Allow -Program "${exePath()}" -Enabled True -Profile Any -ErrorAction SilentlyContinue
  `

  if (process.platform === 'win32') {
    await execPromise(removeCommand, { shell: 'powershell' })
    await execPromise(createCommand, { shell: 'powershell' })
  }
}

export function setNativeTheme(theme: 'system' | 'light' | 'dark'): void {
  nativeTheme.themeSource = theme
}

const elevateTaskXml = `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <Triggers />
  <Principals>
    <Principal id="Author">
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>HighestAvailable</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>Parallel</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>false</AllowHardTerminate>
    <StartWhenAvailable>false</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <IdleSettings>
      <StopOnIdleEnd>false</StopOnIdleEnd>
      <RestartOnIdle>false</RestartOnIdle>
    </IdleSettings>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <WakeToRun>false</WakeToRun>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <Priority>3</Priority>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>"${path.join(taskDir(), RUNNER_EXE)}"</Command>
      <Arguments>"${exePath()}"</Arguments>
    </Exec>
  </Actions>
</Task>
`

export function createElevateTaskSync(): void {
  const taskFilePath = path.join(taskDir(), `${ELEVATE_TASK_NAME}.xml`)
  writeFileSync(taskFilePath, Buffer.from(`\ufeff${elevateTaskXml}`, 'utf-16le'))
  copyFileSync(
    path.join(resourcesFilesDir(), RUNNER_EXE),
    path.join(taskDir(), RUNNER_EXE)
  )
  execSync(
    `%SystemRoot%\\System32\\schtasks.exe /create /tn "${ELEVATE_TASK_NAME}" /xml "${taskFilePath}" /f`
  )
}

export async function deleteElevateTask(): Promise<void> {
  try {
    execSync(`%SystemRoot%\\System32\\schtasks.exe /delete /tn "${ELEVATE_TASK_NAME}" /f`)
  } catch {
    // ignore
  }
}

export async function checkElevateTask(): Promise<boolean> {
  try {
    execSync(`%SystemRoot%\\System32\\schtasks.exe /query /tn "${ELEVATE_TASK_NAME}"`, { stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

export function resetAppConfig(): void {
  if (process.platform === 'win32') {
    spawn(
      'cmd',
      [
        '/C',
        `"timeout /t 2 /nobreak >nul && rmdir /s /q "${dataDir()}" && start "" "${exePath()}""`
      ],
      {
        shell: true,
        detached: true
      }
    ).unref()
  } else {
    const script = `while kill -0 ${process.pid} 2>/dev/null; do
  sleep 0.1
done
  rm -rf '${dataDir()}'
  ${process.argv.join(' ')} & disown
exit
`
    spawn('sh', ['-c', `"${script}"`], {
      shell: true,
      detached: true,
      stdio: 'ignore'
    })
  }
  app.quit()
}
