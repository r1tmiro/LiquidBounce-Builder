# NIGHT SHIFT

An **unofficial Among Us-inspired 3D horror prototype**, built with Electron,
Three.js and a Node.js authoritative multiplayer server. This is a playable
small indie prototype, **not a commercial AAA production** or an official Among
Us release. Among Us belongs to Innersloth; this project is not affiliated with
or endorsed by them. All included model geometry, textures and sounds were
created procedurally for this project.

## Скачать / Download (Windows 10/11, x64)

The Windows workflow builds both an installer and a single-file portable EXE:

- [NightShift-Setup-1.0.0.exe](https://github.com/r1tmiro/LiquidBounce-Builder/releases/download/nightshift-prototype-1.0.0/NightShift-Setup-1.0.0.exe)
- [NightShift-Portable-1.0.0.exe](https://github.com/r1tmiro/LiquidBounce-Builder/releases/download/nightshift-prototype-1.0.0/NightShift-Portable-1.0.0.exe)
- [Builds and test results](https://github.com/r1tmiro/LiquidBounce-Builder/actions/workflows/nightshift-windows.yml)

**Unsigned software:** Windows may display a publisher/SmartScreen warning. Only
run a build you trust; verify its SHA-256 against the release checksums. No
administrator privileges are needed for the portable build. The installer lets
you choose the installation directory.

## Что есть в игре

- 3D-корабль: девять помещений и кольцевые коридоры, фонарь, мерцающий свет,
  туман, bloom, цветокоррекция, зерно и хроматические искажения.
- Десять участников; два случайно выбранных предателя. В одиночном режиме
  остальные участники — боты.
- Восемь мини-игр: провода, питание, сканирование, топливо, загрузка данных,
  мусор, последовательность реактора и рычаги коллекторов.
- Убийства, тела, сообщения о находке, экстренная кнопка, голосование,
  текстовый чат на собрании, призраки и условия победы.
- Вентиляция и саботаж света/реактора для предателей.
- Синтезированные шаги, сердцебиение, тревоги и фоновый гул (Web Audio).
- Встроенный WebSocket-сервер: комнаты, синхронизация, заполнение ботами.
- 16 моделей GLB, собранных скриптом в Blender 4.2.

## Управление

| Клавиша | Действие |
|---|---|
| WASD / стрелки | Движение |
| Мышь | Осмотр (нажмите на сцену для захвата курсора) |
| Shift | Бег |
| E | Задание / сообщение о теле / кнопка собрания / ремонт саботажа |
| F | Фонарь (батарея расходуется, в выключенном состоянии восстанавливается) |
| Q | Вентиляция — только предатель, рядом с люком |
| R | Убийство — только предатель, на близком расстоянии |
| B / N | Саботаж света / реактора — только предатель |
| M | Карта (ещё раз M или щелчок — закрыть) |
| Esc | Закрыть задание / пропустить голосование / меню паузы |

Жёлтые кольца на полу обозначают доступные вам задания. Экипаж побеждает после
выполнения всех своих заданий или изгнания всех предателей. Предатели побеждают
при численном равенстве, отказе реактора или истечении пяти минут. Мёртвые
игроки могут продолжать задания, но не голосовать. Чтобы убрать экран смерти,
нажмите **CONTINUE AS GHOST**.

## Онлайн: как играть с другом

**Важно: один код комнаты не заменяет адрес сервера. Публичного постоянного
сервера/матчмейкинга у проекта нет.**

### В одной локальной сети

1. Хозяин запускает EXE: встроенный сервер слушает порт **7777** (если он занят,
   приложение выбирает свободный порт и показывает актуальный адрес).
2. Выбирает **HOST ONLINE**, оставляет локальный адрес сервера, задаёт код
   комнаты и имя, нажимает CONNECT.
3. Передаёт другу **адрес из лобби** (например `ws://192.168.1.50:7777/ws`) и код.
4. Друг выбирает **JOIN ONLINE**, вводит адрес хозяина и тот же код.
5. После подключения всех игроков **каждый нажимает READY**. До этого раунд не
   начинается; свободные места заполнят боты.

Если Windows Firewall запросит доступ, разрешите его только в той доверенной
сети, где действительно хотите играть. Не отключайте брандмауэр целиком.

### Через интернет

Нужен доступный обоим игрокам сервер: например VPS, доверенная VPN-сеть или
настроенный на стороне хозяина проброс TCP-порта. За CGNAT обычный проброс порта
может не работать. Для подключения из HTTPS-браузера используйте **WSS** через
reverse proxy с TLS. Не используйте `localhost` как адрес сервера друга — это
адрес **его собственного** компьютера.

Для самостоятельного сервера (Node.js 22+):

```sh
npm ci
npm run build
npm run server
# Или другой порт:
node src/server/server.js --port 8080
```

Веб-версия доступна на HTTP-порту сервера. В браузере оба игрока могут указать
одинаковый адрес `/ws` этого сервера. В Arena live preview адрес автоматически
строится от текущего host и использует WSS на HTTPS-странице.

## Development

```sh
npm ci
npm run build
npm start                     # Electron desktop
npm run server                # Browser + WebSocket server on 0.0.0.0:7777
npm run test:logic            # Navigation, simulation, minigames, real sockets
npm run test:render           # Headless WebGL browser integration + screenshots
npm test                      # Both sets
npm run dist:win              # Windows NSIS + portable, best run on Windows
```

Electron's official runtime is downloaded by `npm start` on first use. For
explicit installation: `node node_modules/electron/install.js`. Browser tests
use bundled headless Chromium on Linux. On Windows/macOS, set `CHROME_PATH` to
an installed Chrome/Chromium executable. Test output is in `artifacts/` and is
not committed. `dist/` is generated and must be rebuilt after source changes.

### Models

Run `tools/blender/build_assets.py` with Blender 4.2's Python (`bpy`) or via:

```sh
blender --background --python tools/blender/build_assets.py
blender --background --python tools/blender/render_previews.py
```

GLBs are committed in `assets/models/`; Blender is **not required** to play or
build the application. The manifest records byte sizes for all models.

### Architecture

- `src/shared/sim/` — collision, A*, game rules, bot AI (shared browser/server).
- `src/shared/map/` — level layout, task positions, lights, props.
- `src/server/` — HTTP and authoritative WebSocket room server.
- `src/renderer/` — first-person Three.js view, DOM UI, canvas minigames, audio.
- `src/main/` — Electron window, restricted preload, custom asset protocol,
  embedded server and Windows smoke-test entry point.
- `.github/workflows/nightshift-windows.yml` — native Windows build, Electron
  startup test, packaged executable test, installer, checksums and prerelease.

## Scope and limitations

This is a prototype: bot strategy/animations are simple; no voice chat,
accounts, matchmaking, reconnection, saved progression, dedicated anti-cheat,
controller/mobile support or accessibility certification. The interface is in
English. The direct server is intended for small, trusted groups, not as a
hardened public hosting service. Rendering cost depends heavily on GPU;
reduce quality/bloom in Settings on slower hardware. Automated tests do not
replace a long manual playtest on every Windows/GPU combination.
