# r00tvpn

<p align="center">
  <img src="./build/icon.png" alt="r00tvpn" width="128" />
  <br>
  <br>
  <a href="https://github.com/Mozibeat/r00tvpn-/releases">
    <img src="https://img.shields.io/github/release/Mozibeat/r00tvpn-/all.svg">
  </a>
</p>
<h3 align="center">Десктопный клиент для <a href="https://github.com/MetaCubeX/mihomo">Mihomo</a></h3>

r00tvpn — форк [Koala Clash](https://github.com/coolcoala/koala-clash) под собственным брендом.
Desktop GUI for the Mihomo core (Windows, macOS, Linux), forked from Koala Clash.

## Возможности

- Режим TUN «из коробки», без установки службы
- Импорт подписок по ссылке и через deep-link (`clash://`, `mihomo://`, `r00tvpn://`)
- Режимы Rule / Global / Direct, системный прокси, логи и соединения
- Несколько цветовых тем
- Встроенное ядро Mihomo (stable; alpha — по выбору)
- Интерфейс на русском (по умолчанию), английском и китайском

## Загрузка

Установщики для Windows (`.exe`, portable `.7z`), macOS (`.dmg`, `.pkg`) и Linux (`.AppImage`, `.deb`)
публикуются в [Releases](https://github.com/Mozibeat/r00tvpn-/releases).

## Сборка

### Требования

- **Node.js** >= 20 и **pnpm** >= 9 (`corepack enable`)
- **Go** >= 1.22 — только для Windows-сборок (собирает `runner/`)
- **Git**

### Быстрый старт

```bash
git clone https://github.com/Mozibeat/r00tvpn-.git
cd r00tvpn-
pnpm install
pnpm dev
```

`pnpm install` запускает `scripts/prepare.mjs`, который скачивает ядро Mihomo, геобазы и
служебные бинарники в `extra/`. Повторно: `pnpm prepare` (или `pnpm prepare --arm64`).

### Команды

| Команда            | Описание                                                                  |
| ------------------ | ------------------------------------------------------------------------- |
| `pnpm dev`         | Режим разработки (renderer перезагружается сам, main — после перезапуска) |
| `pnpm lint`        | ESLint (с `--fix`)                                                        |
| `pnpm typecheck`   | Проверка типов TypeScript                                                 |
| `pnpm build:win`   | Сборка для Windows                                                        |
| `pnpm build:mac`   | Сборка для macOS                                                          |
| `pnpm build:linux` | Сборка для Linux                                                          |

Формат и архитектуру можно указать флагами: `pnpm build:linux AppImage --x64`, `pnpm build:mac dmg --arm64`.

Релизы собирает GitHub Actions — см. [docs/RELEASING.md](docs/RELEASING.md).

### Структура

```
src/
├── main/        # main-процесс Electron: ядро, конфиги, трей, системный прокси
├── renderer/    # интерфейс на React
├── preload/     # IPC-мост
└── shared/      # общий код; brand.ts — название, App ID, схема deep-link, репозиторий
runner/          # запуск с правами администратора через планировщик задач Windows (Go)
```

Как заменить иконки и другие элементы бренда — см. [docs/BRANDING.md](docs/BRANDING.md).

## Лицензия и авторство

Распространяется под [GPL-3.0](LICENSE).

- [Koala Clash](https://github.com/coolcoala/koala-clash) — coolcoala, исходный проект этого форка
- [Sparkle](https://github.com/xishang0128/sparkle) — xishang0128, на котором основан Koala Clash
- [Mihomo](https://github.com/MetaCubeX/mihomo) — MetaCubeX, прокси-ядро
- [sparkle-service](https://github.com/UruhaLushia/sparkle-service) — служба для привилегированного режима
