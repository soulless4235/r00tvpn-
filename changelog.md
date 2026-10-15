## 1.5.3

- Приложение сообщает панели подписки версию своего ядра: панели, которые это учитывают (например, Mikan), отдают все поддерживаемые протоколы — mieru, sudoku, TrustTunnel, ShadowQUIC, Hysteria2 с Gecko

## 1.5.2

- Задержки серверов проверяются сами сразу после подключения — нажимать «Проверить задержку» больше не нужно

## 1.5.1

- Новый дизайн «Графит»: тёмная графитовая тема с оранжевым акцентом, светлая пара, встроенный шрифт Onest
- Главный экран: карточка подключения и рядом список серверов по странам с проверкой задержки и выбором узла
- Новые иконки приложения и трея в стиле «Графит»
- Режим «Прямой» снова доступен в переключателе и в меню трея
- Режим TUN работает в AppImage
- Своя схема ссылок r00tvpn://, обновления — из репозитория r00tvpn

## 1.5.1-beta.1

Тестовая версия: автообновление её не раздаёт.

- Новый дизайн «Графит»: тёмная графитовая тема с оранжевым акцентом, светлая пара, встроенный шрифт Onest
- Главный экран: карточка подключения и рядом список серверов по странам с проверкой задержки и выбором узла
- Режим «Прямой» снова доступен в переключателе и в меню трея
- Режим TUN работает в AppImage
- Своя схема ссылок r00tvpn://, обновления — из репозитория r00tvpn

## 1.5.0

### r00tvpn

- Первый выпуск r00tvpn — форка Koala Clash 1.5.0 под собственным брендом
- Русский язык интерфейса по умолчанию
- Обновления и ссылки ведут на репозиторий soulless4235/r00tvpn-
- Установщик больше не удаляет Koala Clash и не импортирует его профили
- Правила брандмауэра Windows не затрагивают другие клиенты Mihomo

### Koala Clash 1.5.0

- alerts about kernel issues (configuration, antivirus, etc.)
- updating the profile even when the HWID limit is reached
- the look of the logs has been improved
- the size of the storage space has been reduced
- fixed logs size issue
- mixed/socks/etc ports from the profile are now being used
- minor fixes

## 1.4.1

- hotfix

## 1.4.0

- fixed bug with proxy providers
- added new headers: expand-proxy-groups, profile-web-page-name
- minor ui fixes
- added alert about expiring subscription
- new bugs :)

## 1.3.1

- fixed system proxy
- fixed bug from issue #89

## 1.3.0

- new update notifier
- improved ui on proxies page
- added default values for route-exclude-address
- added headers for hiding global mode and downloading custom css
- added yaml view in rules editor
- improved hwid (for Remnawave v2.8.0)
- fix setup public dns on macos
- added translations in monaco editor
- fixed ui for overrided GLOBAL selector



## 1.2.0

- reduced memory usage
- fix problem with deeplink alert after restart with autostart enabled
- implement hot reloading config
- fix bug with adding a rule at the end
- fixed an issue with retrieving data via a proxy
- fixed an issue with profile updates (please test)
- ui fixes
- other optimizations
