const puppeteer = require('puppeteer');
const convert = require('xml-js');
const unirest = require('unirest');
const fs = require('fs');
const path = require('path');
const { prepareCaptureIndex, recordCapture, lockCaptureIndex } = require('./capture-index');
const { selectFloors } = require('./select-floors');

require('dotenv').config();

const base = (process.env.AW_BASE_URL || '').replace(/\/+$/, '');
const username = process.env.AW_USERNAME;
const password = process.env.AW_PASSWORD;
const buildingIds = [...new Set((process.env.AW_BUILDING_ID || '').split(',').map(id => id.trim()).filter(Boolean))];

function airWaveRequest(request, jar) {
	return new Promise((resolve, reject) => {
		request.jar(jar).strictSSL(false).timeout(30000).end(response => {
			if (response.error) {
				reject(new Error(`AirWave request failed (${response.error.code || response.status}).`));
				return;
			}
			resolve(response);
		});
	});
}

function readFloorNumber(value) {
	return typeof value === 'string' && value.trim() ? Number(value) : NaN;
}

function folderName(name) {
	const clean = name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/, '');
	if (!clean || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(clean)) {
		return `_${clean}`;
	}
	return clean;
}

async function connectVisualRF() {
	const jar = unirest.jar();
	const login = await airWaveRequest(unirest.post(`${base}/LOGIN`)
		.headers({ 'Content-Type': 'application/x-www-form-urlencoded' })
		.send({ destination: '/', credential_0: username, credential_1: password }), jar);
	const token = login.headers['x-biscotti'];
	if (!token) {
		throw new Error('AirWave login did not return an X-BISCOTTI token.');
	}

	return async function getVisualRF(endpoint) {
		const response = await airWaveRequest(unirest.get(`${base}/visualrf/${endpoint}`)
			.headers({ 'Content-Type': 'application/xml', 'X-BISCOTTI': token }), jar);
		return convert.xml2js(response.body, { compact: true });
	};
}

function readBuilding(building, id = building._attributes.id) {
	const sites = [].concat(building.site || []).map(site => site._attributes);
	const name = building._attributes?.name || sites[0]?.building_name || id;
	return { id, name, sites };
}


async function selectBuildings(getVisualRF) {
	if (buildingIds.length) {
		const buildings = [];
		for (const id of buildingIds) {
			const data = await getVisualRF(`building.xml?id=${encodeURIComponent(id)}&buildings=&sites=`);
			buildings.push(readBuilding(data['visualrf:buildings'].building, id));
		}
		return buildings;
	}

	const data = await getVisualRF('campus.xml?buildings=&sites=');
	const campuses = [].concat(data['visualrf:campuses'].campus || []).map(campus => {
		const buildings = [].concat(campus.building || []).map(building => readBuilding(building))
			.filter(building => building.sites.length);
		for (const building of buildings) {
			building.sites.sort((a, b) => {
				const aNumber = readFloorNumber(a.floor);
				const bNumber = readFloorNumber(b.floor);
				return (Number.isFinite(aNumber) ? aNumber : Infinity) -
					(Number.isFinite(bNumber) ? bNumber : Infinity);
			});
		}
		return { name: campus._attributes.name, buildings };
	}).filter(campus => campus.buildings.length);
	if (!campuses.length) {
		throw new Error('AirWave returned no floor plans to select.');
	}
	return selectFloors(campuses);
}

async function planBuilding({ id, name, sites }, getVisualRF) {
	const floors = await Promise.all(sites.map(async site => {
		let number = readFloorNumber(site.floor);
		if (!Number.isFinite(number)) {
			const details = await getVisualRF(`site.xml?id=${encodeURIComponent(site.id)}`);
			number = readFloorNumber(details['visualrf:sites'].site._attributes.floor);
		}
		if (!Number.isFinite(number)) {
			throw new Error(`AirWave did not return a floor number for ${site.name}.`);
		}
		return {
			id: site.id,
			buildingId: id,
			number,
			route: `floor${number}`,
			folder: folderName(site.name)
		};
	}));
	if (new Set(floors.map(floor => floor.number)).size !== floors.length) {
		throw new Error(`AirWave returned duplicate floor numbers for ${name}.`);
	}
	const folders = floors.map(floor => process.platform === 'win32' ? floor.folder.toLowerCase() : floor.folder);
	if (new Set(folders).size !== floors.length) {
		throw new Error(`Multiple floors in ${name} resolve to the same capture directory.`);
	}
	return { id, name, folder: folderName(name), floors: floors.sort((a, b) => a.number - b.number) };
}

async function captureFloors(browser, buildings, index) {
	const page = await browser.newPage();
	console.error("browser launched");
	console.error("accessing login page...");
	await page.goto(`${base}/`);
	console.error(page.url());
	await page.waitForSelector('#login-username-id')
	await page.type('#login-username-id', username);
	await page.type('#login-password-id', password);
	await Promise.all([
		page.waitForNavigation(),
		page.click('#login-button'),
		console.error("logging in..."),
	]);
	console.error("logged in");

	const readyWidgetSelector = '.vrf_mapwidget:not(.loading_background)';
	const floors = buildings.flatMap(building => building.floors);
	for (const [i, floor] of floors.entries()) {
		const { directory, id } = floor;
		const filename = new Date().toISOString().
			replace(/T/, ' ').
			replace(/\..+/, '').
			replace(/-/g, '').
			replace(/:/g, '').
			replace(/ /, '-')
			+ '.png';

		console.error(`retrieving heatmap ${directory}... (${i + 1}/${floors.length})`);
		try {
			await page.goto(`${base}/vrf?site_id=${encodeURIComponent(id)}`);
			await page.waitForSelector(readyWidgetSelector);
			await page.waitForSelector('.vrf_sidebar');
			await page.$eval('.vrf_sidebar', sidebar => {
				// Keep the map still while Chromium crops the screenshot.
				sidebar.style.transition = 'none';
				sidebar.classList.add('dismiss');
			});
			const map = await page.waitForSelector(`${readyWidgetSelector} #vrf_background_control`, { visible: true });

			console.error("saving screenshot...");
			fs.mkdirSync(directory, { recursive: true });
			const screenshotPath = path.join(directory, filename);
			await page.$$eval('.vrf_zoombar', bars => bars.forEach(bar => bar.remove()));
			await map.screenshot({ path: screenshotPath });
			recordCapture(index, floor, filename);
			console.error(`screenshot saved! (${screenshotPath})`);
		} catch (error) {
			throw new Error(`${directory}: ${error.message}`);
		}
	}
}

async function main() {
	if (!base) {
		throw new Error('Set AW_BASE_URL to your AirWave URL.');
	}
	if (!buildingIds.length && (!process.stdin.isTTY || !process.stdout.isTTY)) {
		throw new Error('Set AW_BUILDING_ID for non-interactive capture, or run in a terminal to select floors.');
	}
	if (!buildingIds.length) {
		console.error('Loading AirWave floor plans...');
	}

	const getVisualRF = await connectVisualRF();
	const selection = await selectBuildings(getVisualRF);
	if (!selection) {
		console.error('Capture canceled.');
		return;
	}
	const buildings = await Promise.all(selection.map(building => planBuilding(building, getVisualRF)));

	const unlock = lockCaptureIndex();
	try {
		const index = prepareCaptureIndex(buildings);
		console.error("launching browser...");
		const browser = await puppeteer.launch({
			headless: 'shell',
			acceptInsecureCerts: true,
			defaultViewport: {
				width: 1080,
				height: 720
			}
		});
		try {
			await captureFloors(browser, buildings, index);
		} finally {
			await browser.close();
		}
	} finally {
		unlock();
	}
}

main().catch(error => {
	console.error(error);
	process.exitCode = 1;
});
