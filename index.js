const puppeteer = require('puppeteer');
const convert = require('xml-js');
const unirest = require('unirest');
const fs = require('fs');

require('dotenv').config();

const base = process.env.BASE_URL;
const username = process.env.USERNAME;
const password = process.env.PASSWORD;
const building_id = process.env.BUILDING_ID

async function sleep(delay) {
	return new Promise(resolve => setTimeout(resolve, delay));
}

function get_building() {
	const cookie_jar = unirest.jar();
	return new Promise((resolve) => {
		unirest.post(base + '/LOGIN')
			.jar(cookie_jar)
			.strictSSL(false)
			.headers({
				'Content-Type': 'application/x-www-form-urlencoded'
			})
			.send({
				destination: '/',
				credential_0: username,
				credential_1: password,
			})
			.end(function(resp) {
				const token = resp.headers ? resp.headers['x-biscotti'] : null;
				if (token) {
					unirest.get(`${base}visualrf/building.xml?id=${building_id}&buildings=&sites=`)
					.jar(cookie_jar)
					.strictSSL(false)
					.headers({
						'Content-Type': 'application/xml',
						'X-BISCOTTI': token
					})
					.end(function (res) {
						resolve(JSON.parse(convert.xml2json(res.body, {compact: true}))['visualrf:buildings'].building);
					});
				} else {
					console.error('there should be a token in header with successful login');
				}
			});
	});
}

(async () => {
	const building = await get_building();
	const sites = building.site;
	console.error("launching browser...");
	const browser = await puppeteer.launch({
		//headless: false,
		ignoreHTTPSErrors: true,
		defaultViewport: {
			width: 1080,
			height: 720.
		}
	});
	const page = await browser.newPage();
	console.error("browser launched");
	console.error("accessing login page...");
	await page.goto(base);
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

	for (let i in sites) {
		const dirname = `${sites[i]._attributes.building_name}${sites[i]._attributes.name}`
		const filename = new Date().toISOString().
			replace(/T/, ' ').
			replace(/\..+/, '').
			replace(/-/g, '').
			replace(/:/g, '').
			replace(/ /, '-')
			+ '.png';

		console.error(`retrieving heatmap ${dirname}... (` + (parseInt(i)+1) + `/${sites.length})`);
		await Promise.all([
			page.waitForNavigation(),
			page.waitForSelector('svg'),
			page.goto(`${base}vrf?site_id=${sites[i]._attributes.id}`)
		]);
		console.error(page.url());
		await page.click('.vrf_sidebar_dismisser'); 
		await sleep(2000);

		console.error("saving screenshot...");
		if (!fs.existsSync(dirname)){
			fs.mkdirSync(dirname);
		}
		await page.screenshot({path: `${dirname}/${filename}`});
		const linkname = `${dirname}/latest.png`;
		if (fs.existsSync(linkname)){
			fs.unlinkSync(linkname);
		}
		fs.symlinkSync(filename, linkname);
		console.error(`screenshot saved! (${dirname}/${filename})`);
	}

	await browser.close();
})();
