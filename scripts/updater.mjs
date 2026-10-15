import yaml from 'yaml'
import { createHash } from 'crypto'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'fs'
import { extractVersionSection } from './changelog.mjs'

const pkg = readFileSync('package.json', 'utf-8')
const rawChangelog = readFileSync('changelog.md', 'utf-8')
const { version, repository } = JSON.parse(pkg)
const { productName } = yaml.parse(readFileSync('electron-builder.yml', 'utf-8'))

// https://github.com/<owner>/<repo>.git -> https://github.com/<owner>/<repo>
const repoUrl = repository.url.replace(/\.git$/, '')
// electron-builder names artifacts after productName; GitHub turns spaces into dots
const asset = productName.replace(/ /g, '.')

let changelog = extractVersionSection(rawChangelog, version)
const downloadUrl = `${repoUrl}/releases/download/${version}`
const latest = {
  version,
  changelog
}

// The in-app updater checks a download against these. Taking them from here, not from the
// GitHub API, keeps updates working past the API's 60 requests an hour per address, which
// everyone behind one VPN server shares.
if (existsSync('dist')) {
  latest.sha256 = Object.fromEntries(
    readdirSync('dist', { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .sort()
      .map((file) => [
        file,
        createHash('sha256')
          .update(readFileSync(`dist/${file}`))
          .digest('hex')
      ])
  )
}

const badge = (format, label, logo) =>
  `https://img.shields.io/badge/${format}-default?style=flat&logo=${logo}&label=${encodeURIComponent(label)}`

const link = (file, format, label, logo) =>
  `<a href="${downloadUrl}/${file}"><img src="${badge(format, label, logo)}"></a>`

if (process.env.SKIP_CHANGELOG !== '1') {
  changelog += '\n### Скачать / Download\n\n#### Windows 10/11\n\n'
  changelog += link(`${asset}_x64-setup.exe`, 'EXE', '64-bit', 'windows') + ' '
  changelog += link(`${asset}_arm64-setup.exe`, 'EXE', 'ARM64', 'windows') + ' '
  changelog += link(`${asset}_x64-portable.7z`, '7Z', 'Portable 64-bit', 'windows') + '\n\n'
  changelog += '\n#### macOS 11+\n\n'
  changelog += link(`${asset}_x64.dmg`, 'DMG', 'Intel', 'apple') + ' '
  changelog += link(`${asset}_arm64.dmg`, 'DMG', 'Apple Silicon', 'apple') + ' '
  changelog += link(`${asset}_x64.pkg`, 'PKG', 'Intel', 'apple') + ' '
  changelog += link(`${asset}_arm64.pkg`, 'PKG', 'Apple Silicon', 'apple') + '\n\n'
  changelog += '\n#### Linux\n\n'
  changelog += link(`${asset}_x86_64.AppImage`, 'AppImage', '64-bit', 'linux') + ' '
  changelog += link(`${asset}_arm64.AppImage`, 'AppImage', 'ARM64', 'linux') + ' '
  changelog += link(`${asset}_amd64.deb`, 'DEB', '64-bit', 'debian') + ' '
  changelog += link(`${asset}_arm64.deb`, 'DEB', 'ARM64', 'debian')
}
writeFileSync('latest.yml', yaml.stringify(latest))
writeFileSync('changelog.md', changelog)
writeFileSync('rawChangelog.md', rawChangelog)
