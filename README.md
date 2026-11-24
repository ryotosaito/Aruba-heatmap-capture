# Aruba Heatmap Capture

Capture PNG screenshots of Aruba AirWave VisualRF floor plans for a building. An optional local server lets you view the saved images in a browser.

## Setup

You need Node.js 18 or newer and npm, network access to your AirWave instance, and an AirWave account with access to the building in VisualRF. Keep the repository directory as your working directory for the commands below.

```sh
npm ci
```

Puppeteer downloads the pinned Chrome Headless Shell during installation. If your npm setup skips install scripts, run `npx puppeteer browsers install chrome-headless-shell` after `npm ci`.

Copy `.env.example` to `.env`.

```powershell
# Windows PowerShell
Copy-Item .env.example .env
```

```sh
# macOS or Linux
cp .env.example .env
```

Edit `.env` with your AirWave settings.

```dotenv
AW_BASE_URL=https://airwave.example.com/
AW_USERNAME=your-airwave-username
AW_PASSWORD=your-airwave-password
AW_BUILDING_ID=
```

`AW_BASE_URL` accepts URLs with or without a trailing `/`. Leave `AW_BUILDING_ID` empty to choose floors in the terminal. For unattended runs, set it to one building ID or a comma-separated list of IDs. The first selected building in the tree or the first configured ID is the default for URLs without a building prefix. If you already have a `.env`, rename the keys to match the `AW_` names above. `.env` is ignored by Git.

## Capture heatmaps

```sh
npm run capture
```

With `AW_BUILDING_ID` empty, the picker shows the network, campuses, buildings, and floor plans. Use **↑/↓** to move and **←/→** to collapse or expand a branch. Press **Space** to toggle a floor or all floors under a branch, **Enter** to capture the selection, or **Esc** to cancel. You can select floors across multiple buildings and campuses. With building IDs configured, the script captures all floors in those buildings directly.

The script waits for VisualRF to finish loading and saves only the map area as `<building>/<floor>/YYYYMMDD-HHMMSS.png` under the current working directory. The filename uses UTC. The script captures buildings in tree or ID list order and floors from lowest to highest using their AirWave VisualRF numbers. Buildings with the same name get distinct folders.

After each successful screenshot, the script updates `captures.json` with the floor number, floor directory, latest screenshot filename, and timestamped PNGs. Only one capture can write to a working directory at a time. The operating system unlocks `captures.json.lock` when the process exits, including after a forced stop. Leave the file in place so each run can lock the same file.

## View captures in a browser

Start the server from the same working directory as the capture script.

```sh
node server.js
```

Open the [capture list](http://localhost:3000/) to see the image URLs by building and floor.

- `/floor1/latest.png` serves AirWave floor 1 in the default building. Floor 0 uses `/floor0/latest.png`.
- `/building15/floor1/latest.png` serves floor 1 in the building whose AirWave ID is `15`. Use the full ID for buildings with UUIDs.
- To open an earlier capture, use its timestamped filename in either URL format.

The server reads `captures.json` on each request, so new captures appear without a restart. `latest.png` is a URL that the server resolves to a timestamped PNG. To use a custom floor URL, change the floor's key in its building's `floors` object in `captures.json` to a name such as `ground-floor` while the capture script is idle. Press `Ctrl+C` to stop the server.

## Tests

Run `npm test` after installing dependencies. The tests in `tests/` cover screenshot timing, cropping, the floor picker, failure cleanup, and lock recovery after a forced stop. The browser tests use Chrome Headless Shell and a local AirWave fixture. They need no AirWave credentials.
