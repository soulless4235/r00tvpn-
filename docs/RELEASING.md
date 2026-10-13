# Сборка и релизы

Всё собирает GitHub Actions (`.github/workflows/build.yml`).

| Событие                                                          | Что происходит                                                                                |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| push в `main`, pull request                                      | проверки (ESLint, типы), сборка всех платформ, e2e-тест Linux; артефакты — во вкладке Actions |
| тег версии, напр. `1.5.1`                                        | то же + публикация GitHub Release                                                             |
| ручной запуск (Actions → Build → Run workflow) с полем `version` | то же + публикация GitHub Release с этой версией (тег создаётся сам)                          |

## Как выпустить версию

1. Добавьте раздел `## 1.5.1` в начало `changelog.md` — он станет описанием релиза.
2. Поднимите `version` в `package.json` (необязательно: CI берёт версию из тега).
3. Создайте тег **без `v`** и отправьте его:

   ```bash
   git tag 1.5.1 && git push origin 1.5.1
   ```

   Тег без `v`, потому что встроенное автообновление ищет файлы по адресу
   `releases/download/<версия>/` и `releases/tags/<версия>`.

4. После сборки в Releases появятся установщики и `latest.yml`. Уже установленные копии
   увидят обновление при следующей проверке (раз в 10 минут, пока приложение открыто).

Версия с суффиксом (`1.6.0-beta.1`) публикуется как pre-release и автообновлением не раздаётся.

## Артефакты

| Платформа                   | Файлы                                                    |
| --------------------------- | -------------------------------------------------------- |
| Windows x64 / arm64         | `r00tvpn_<arch>-setup.exe`, `r00tvpn_<arch>-portable.7z` |
| macOS Intel / Apple Silicon | `r00tvpn_<arch>.dmg`, `r00tvpn_<arch>.pkg`               |
| Linux x64 / arm64           | `r00tvpn_<arch>.AppImage`, `r00tvpn_<arch>.deb`          |

Автообновление внутри приложения работает для Windows (`setup.exe` / `portable.7z`) и macOS (`.pkg`).
На Linux обновляются вручную.

## Подпись кода (необязательно)

Без секретов сборки проходят, но:

- **Windows**: установщик не подписан — SmartScreen покажет «Неизвестный издатель».
- **macOS**: приложение подписано ad-hoc и не нотаризовано — при первом запуске нужно
  открыть его через контекстное меню «Открыть» (или `xattr -cr /Applications/r00tvpn.app`).

Секреты задаются в репозитории: Settings → Secrets and variables → Actions.

| Секрет                 | Что это                                                                                                |
| ---------------------- | ------------------------------------------------------------------------------------------------------ |
| `WIN_CSC_LINK`         | Сертификат подписи Windows (`.pfx`) в base64                                                           |
| `WIN_CSC_KEY_PASSWORD` | Пароль к `.pfx`                                                                                        |
| `MAC_CSC_LINK`         | `.p12` с сертификатами **Developer ID Application** (и **Developer ID Installer** для `.pkg`) в base64 |
| `MAC_CSC_KEY_PASSWORD` | Пароль к `.p12`                                                                                        |
| `APPLE_API_KEY_P8`     | Содержимое ключа App Store Connect API (`AuthKey_XXXX.p8`) — включает нотаризацию                      |
| `APPLE_API_KEY_ID`     | Key ID этого ключа                                                                                     |
| `APPLE_API_ISSUER`     | Issuer ID (App Store Connect → Users and Access → Integrations)                                        |

Base64 из файла: `base64 -i cert.p12 | pbcopy` (macOS) или
`[Convert]::ToBase64String([IO.File]::ReadAllBytes("cert.pfx")) | Set-Clipboard` (PowerShell).

Нотаризация включается, только если заданы и сертификат macOS, и все три `APPLE_API_*`.

Сертификаты: Apple — программа Apple Developer ($99/год). Windows — OV/EV-сертификат у
удостоверяющего центра (ключ теперь хранится на токене/HSM, поэтому для CI удобнее облачные
сервисы вроде Azure Trusted Signing; тогда шаг подписи в workflow нужно будет заменить).

## Локальная проверка

```bash
pnpm install
pnpm build:win            # или build:mac / build:linux
node e2e/smoke.mjs dist/win-unpacked/r00tvpn.exe
```

`e2e/smoke.mjs` проходит основной сценарий через интерфейс на локальных фикстурах (подписка и два
тестовых узла): импорт подписки, список прокси и выбор узла, режимы Rule/Global/Direct, логи,
соединения; на Linux — ещё системный прокси (gsettings) и TUN. Скриншоты и лог — в `e2e-artifacts/`.
Тест работает во временном профиле и на Windows/macOS не трогает системный прокси, но при запуске
приложение регистрирует себя обработчиком ссылок `clash://`, `mihomo://`, `r00tvpn://`.
