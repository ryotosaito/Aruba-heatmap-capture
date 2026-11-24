const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { lockCaptureIndex } = require('../capture-index');

const captureScript = path.join(__dirname, '..', 'capture.js');
const mapPage = `<!doctype html>
<style>
  #vrf_background_control { width: 180px; height: 100px; background: green }
  .vrf_sidebar:not(.dismiss) + .vrf_mapwidget #vrf_background_control { width: 240px }
  .vrf_mapwidget.loading_background #vrf_background_control { height: 160px }
</style>
<header>Outside the map</header>
<main class="vrf_page loading">
  <aside class="vrf_sidebar">Sidebar</aside>
  <div class="vrf_mapwidget loading_background"><div id="vrf_background_control"></div></div>
</main>
<script>
  setTimeout(() => {
    const sidebar = document.querySelector('.vrf_sidebar');
    sidebar.replaceWith(sidebar.cloneNode(false));
    document.querySelector('.vrf_mapwidget').classList.remove('loading_background');
  }, 500);
</script>`;

async function runCapture(t, { failAnnex = false } = {}) {
	const temp = await fs.realpath(os.tmpdir());
	const directory = await fs.mkdtemp(path.join(temp, 'aruba-capture-test-'));
	t.after(async () => {
		const target = await fs.realpath(directory);
		assert.equal(path.dirname(target), temp);
		assert.match(path.basename(target), /^aruba-capture-test-/);
		await fs.rm(target, { recursive: true, force: true });
	});

	const requestedFloors = [];
	const server = http.createServer((request, response) => {
		const url = new URL(request.url, 'http://localhost');
		if (request.method === 'POST' && url.pathname === '/LOGIN') {
			request.resume();
			return response.writeHead(200, { 'X-BISCOTTI': 'fixture-token' }).end();
		}
		if (url.pathname === '/visualrf/building.xml') {
			if (request.headers['x-biscotti'] !== 'fixture-token') {
				return response.writeHead(403).end();
			}
			const id = url.searchParams.get('id');
			const name = id === '15' ? 'Office' : 'Annex';
			const floors = id === '15'
				? '<site id="first" name="First" floor="1.0"/><site id="ground" name="Ground" floor="0.0"/>'
				: '<site id="annex" name="First" floor="1.0"/>';
			return response.end(`<visualrf:buildings><building name="${name}">${floors}</building></visualrf:buildings>`);
		}

		response.setHeader('Content-Type', 'text/html');
		if (url.pathname === '/') {
			return response.end(`<input id="login-username-id"><input id="login-password-id" type="password">
				<button id="login-button" onclick="location.href='/home'">Log in</button>`);
		}
		if (url.pathname === '/home') return response.end('Home');
		if (url.pathname === '/vrf') {
			const id = url.searchParams.get('site_id');
			requestedFloors.push(id);
			if (failAnnex && id === 'annex') return request.socket.destroy();
			return response.end(mapPage);
		}
		response.writeHead(404).end();
	});
	server.listen(0, '127.0.0.1');
	t.after(() => new Promise(resolve => server.close(resolve)));
	await once(server, 'listening');

	const child = spawn(process.execPath, [captureScript], {
		cwd: directory,
		windowsHide: true,
		signal: t.signal,
		env: {
			...process.env,
			AW_BASE_URL: `http://127.0.0.1:${server.address().port}/`,
			AW_USERNAME: 'fixture-user',
			AW_PASSWORD: 'fixture-password',
			AW_BUILDING_ID: '15, 26'
		}
	});
	let stderr = '';
	child.stderr.setEncoding('utf8');
	child.stderr.on('data', data => { stderr += data; });
	child.stdout.resume();
	const [status] = await once(child, 'close');
	return { directory, requestedFloors, status, stderr };
}

test('waits for the map widget, dismisses the sidebar, and crops each indexed PNG', { timeout: 30000 }, async t => {
	const { directory, requestedFloors, status, stderr } = await runCapture(t);
	assert.equal(status, 0, stderr);
	assert.deepEqual(requestedFloors, ['ground', 'first', 'annex']);
	const index = JSON.parse(await fs.readFile(path.join(directory, 'captures.json'), 'utf8'));
	assert.equal(index.defaultBuilding, '15');
	assert.deepEqual(Object.keys(index.buildings['15'].floors), ['floor0', 'floor1']);
	assert.deepEqual(Object.keys(index.buildings['26'].floors), ['floor1']);
	for (const building of Object.values(index.buildings)) {
		for (const floor of Object.values(building.floors)) {
			const png = await fs.readFile(path.join(directory, floor.directory, floor.latest));
			assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
			assert.equal(png.readUInt32BE(16), 180);
			assert.equal(png.readUInt32BE(20), 100);
		}
	}
});

test('reports the failing floor and releases the lock while keeping saved captures', { timeout: 30000 }, async t => {
	const { directory, status, stderr } = await runCapture(t, { failAnnex: true });
	assert.equal(status, 1, stderr);
	assert.match(stderr, /Annex[\\/]First:.*ERR_EMPTY_RESPONSE/);
	const index = JSON.parse(await fs.readFile(path.join(directory, 'captures.json'), 'utf8'));
	assert.deepEqual(Object.keys(index.buildings['15'].floors), ['floor0', 'floor1']);
	assert.deepEqual(index.buildings['26'].floors, {});
	const unlock = lockCaptureIndex(directory);
	unlock();
});
