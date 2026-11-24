const fs = require('fs');
const path = require('path');

const indexPath = 'captures.json';
const temporaryIndexPath = `${indexPath}.tmp`;
const captureFilename = /^\d{8}-\d{6}\.png$/;

function readCaptureIndex() {
	let data;
	try {
		data = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
	} catch (error) {
		if (error.code !== 'ENOENT') {
			throw error;
		}
		data = {};
	}
	return Object.prototype.hasOwnProperty.call(data, 'defaultBuilding') && data.buildings
		? { defaultBuilding: data.defaultBuilding, buildings: data.buildings }
		: { defaultBuilding: null, buildings: {} };
}

function captureFiles(directory) {
	return fs.readdirSync(directory, { withFileTypes: true })
		.filter(entry => entry.isFile() && captureFilename.test(entry.name))
		.map(entry => entry.name)
		.sort();
}

function orderedCaptureEntries(floors) {
	return Object.entries(floors).sort(([, a], [, b]) => (a.floor ?? Infinity) - (b.floor ?? Infinity));
}

function writeCaptureIndex(index) {
	const buildings = Object.fromEntries(Object.entries(index.buildings).map(([id, building]) => [id, {
		...building,
		floors: Object.fromEntries(orderedCaptureEntries(building.floors))
	}]));
	try {
		fs.writeFileSync(temporaryIndexPath, `${JSON.stringify({ ...index, buildings }, null, 2)}\n`);
		fs.renameSync(temporaryIndexPath, indexPath);
	} catch (error) {
		if (fs.existsSync(temporaryIndexPath)) {
			fs.unlinkSync(temporaryIndexPath);
		}
		throw error;
	}
}

function directoryKey(directory) {
	const normalized = path.normalize(directory);
	return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function copyPreviousCaptures(source, directory) {
	if (directoryKey(source) === directoryKey(directory) || !fs.existsSync(source)) {
		return;
	}
	const files = captureFiles(source);
	if (files.length) {
		fs.mkdirSync(directory, { recursive: true });
	}
	for (const filename of files) {
		try {
			fs.copyFileSync(path.join(source, filename), path.join(directory, filename), fs.constants.COPYFILE_EXCL);
		} catch (error) {
			if (error.code !== 'EEXIST') {
				throw error;
			}
		}
	}
}

function buildingDirectory(building, previous, usedDirectories) {
	if (previous) {
		return previous.directory;
	}
	let directory = building.folder;
	let suffix = 1;
	while (usedDirectories.has(directoryKey(directory))) {
		directory = `${building.folder} (${encodeURIComponent(building.id)}-${suffix++})`;
	}
	return directory;
}

function prepareBuilding(building, buildingFolder, previous) {
	const previousFloors = Object.entries(previous ? previous.floors : {});
	const floors = Object.create(null);
	const matchedRoutes = new Set();
	for (const floor of building.floors) {
		floor.directory = path.join(buildingFolder, floor.folder);
		const key = directoryKey(floor.directory);
		const sameDirectory = entry => directoryKey(entry.directory) === key;
		const previousFloor = previousFloors.find(([, entry]) => entry.siteId === floor.id || sameDirectory(entry));
		if (previousFloor) {
			const [route, entry] = previousFloor;
			if (!/^floor-?\d+(?:\.\d+)?$/.test(route)) {
				floor.route = route;
			}
			matchedRoutes.add(route);
			copyPreviousCaptures(entry.directory, floor.directory);
		}
		const { directory, route, number, id } = floor;
		const files = fs.existsSync(directory) ? captureFiles(directory) : [];
		if (files.length) {
			const previousLatest = previousFloor?.[1].latest;
			const latest = files.includes(previousLatest) ? previousLatest : files[files.length - 1];
			floors[route] = { directory, floor: number, siteId: id, latest, files };
		}
	}
	const currentRoutes = new Set(building.floors.map(floor => floor.route));
	for (const [route, entry] of previousFloors) {
		if (!matchedRoutes.has(route) && !currentRoutes.has(route) && fs.existsSync(entry.directory)) {
			floors[route] = entry;
		}
	}
	return { name: building.name, directory: buildingFolder, floors };
}

function prepareCaptureIndex(buildings) {
	const index = readCaptureIndex();
	index.buildings = Object.assign(Object.create(null), index.buildings);
	const usedDirectories = new Set(Object.values(index.buildings).map(building => directoryKey(building.directory)));
	index.defaultBuilding = buildings[0].id;
	for (const building of buildings) {
		const previous = index.buildings[building.id];
		const directory = buildingDirectory(building, previous, usedDirectories);
		usedDirectories.add(directoryKey(directory));
		index.buildings[building.id] = prepareBuilding(building, directory, previous);
	}
	writeCaptureIndex(index);
	return index;
}

function recordCapture(index, { buildingId, id, directory, route, number }, filename) {
	index.buildings[buildingId].floors[route] = {
		directory, floor: number, siteId: id, latest: filename, files: captureFiles(directory)
	};
	writeCaptureIndex(index);
}

function lockCaptureIndex(directory = process.cwd()) {
	const { tryLock, unlock } = require('fs-native-extensions');
	const lockFile = path.join(directory, `${indexPath}.lock`);
	const fd = fs.openSync(lockFile, 'a+');
	try {
		if (!tryLock(fd)) {
			throw new Error('A capture is already running in this working directory.');
		}
	} catch (error) {
		fs.closeSync(fd);
		throw error;
	}
	return () => {
		// Keep the file so all runs continue to lock the same filesystem object.
		try {
			unlock(fd);
		} finally {
			fs.closeSync(fd);
		}
	};
}

module.exports = { captureFilename, readCaptureIndex, orderedCaptureEntries, prepareCaptureIndex, recordCapture, lockCaptureIndex };
