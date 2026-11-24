const express = require('express');
const path = require('path');
const { captureFilename, readCaptureIndex, orderedCaptureEntries } = require('./capture-index');

const app = express();

function ownEntry(entries, key) {
	return Object.prototype.hasOwnProperty.call(entries, key) ? entries[key] : undefined;
}

function imageLinks(floors, prefix, buildingId, buildingName) {
	return orderedCaptureEntries(floors).map(([route, floor]) => {
		const url = `${prefix}/${encodeURIComponent(route)}`;
		return {
			buildingId,
			building: buildingName,
			directory: floor.directory,
			floor: floor.floor,
			latest: `${url}/latest.png`,
			files: floor.files.map(filename => `${url}/${filename}`)
		};
	});
}

app.get('/', (req, res) => {
	const { defaultBuilding, buildings } = readCaptureIndex();
	const orderedBuildings = Object.entries(buildings).sort(([a], [b]) =>
		Number(b === defaultBuilding) - Number(a === defaultBuilding));
	const qualified = orderedBuildings.length > 1;
	const floors = orderedBuildings.flatMap(([id, building]) => {
		const prefix = qualified ? `/building${encodeURIComponent(id)}` : '';
		return imageLinks(building.floors, prefix, id, building.name);
	});
	res.json(floors);
});

app.get(['/:floor/:image', '/:building/:floor/:image'], (req, res) => {
	const { defaultBuilding, buildings } = readCaptureIndex();
	const { building: prefix, floor: route, image } = req.params;
	if (prefix && !prefix.startsWith('building')) {
		return res.sendStatus(404);
	}

	const buildingId = prefix ? prefix.slice('building'.length) : defaultBuilding;
	const building = ownEntry(buildings, buildingId);
	const floor = building && ownEntry(building.floors, route);
	if (!floor) {
		return res.sendStatus(404);
	}

	const isLatest = image === 'latest.png';
	const filename = isLatest ? floor.latest : image;
	if (!captureFilename.test(filename) || !floor.files.includes(filename)) {
		return res.sendStatus(404);
	}

	if (isLatest) {
		res.set('Cache-Control', 'no-store');
	}
	res.sendFile(path.join(floor.directory, filename), { root: process.cwd() });
});

app.listen(3000);
