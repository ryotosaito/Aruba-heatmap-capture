const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { prepareCaptureIndex, readCaptureIndex } = require('../capture-index');

test('preserves current floor renames and skips old capture layouts', t => {
	const workspace = process.cwd();
	const temp = fs.realpathSync(os.tmpdir());
	const directory = fs.mkdtempSync(path.join(temp, 'aruba-index-test-'));
	t.after(() => {
		process.chdir(workspace);
		const target = fs.realpathSync(directory);
		assert.equal(path.dirname(target), temp);
		assert.match(path.basename(target), /^aruba-index-test-/);
		fs.rmSync(target, { recursive: true, force: true });
	});
	process.chdir(directory);

	const filename = '20261124-120000.png';
	const oldFolder = 'OfficeGround';
	const previousFolder = path.join('Office', 'First');
	fs.mkdirSync(oldFolder);
	fs.mkdirSync(previousFolder, { recursive: true });
	fs.writeFileSync(path.join(oldFolder, filename), 'old layout image');
	fs.writeFileSync(path.join(previousFolder, filename), 'indexed floor image');
	const oldEntry = { directory: oldFolder, latest: filename, files: [filename] };

	fs.writeFileSync('captures.json', JSON.stringify({ floor0: oldEntry }));
	assert.deepEqual(readCaptureIndex(), { defaultBuilding: null, buildings: {} });

	fs.writeFileSync('captures.json', JSON.stringify({
		defaultBuilding: '15',
		buildings: {
			'15': {
				name: 'Office', directory: 'Office',
				floors: { upper: { directory: previousFolder, siteId: 'first', floor: 1, latest: filename, files: [filename] } }
			}
		},
		legacy: { floor0: oldEntry }
	}));
	prepareCaptureIndex([{
		id: '15', name: 'Office', folder: 'Office',
		floors: [
			{ id: 'ground', number: 0, route: 'floor0', folder: 'Ground' },
			{ id: 'first', number: 1, route: 'floor1', folder: 'Renamed First' }
		]
	}]);

	const index = JSON.parse(fs.readFileSync('captures.json', 'utf8'));
	assert.deepEqual(Object.keys(index), ['defaultBuilding', 'buildings']);
	assert.deepEqual(Object.keys(index.buildings['15'].floors), ['upper']);
	const floor = index.buildings['15'].floors.upper;
	assert.equal(floor.directory, path.join('Office', 'Renamed First'));
	assert.equal(floor.latest, filename);
	assert.equal(fs.readFileSync(path.join(floor.directory, filename), 'utf8'), 'indexed floor image');
	assert.equal(fs.existsSync(path.join('Office', 'Ground')), false);
	assert.equal(fs.readFileSync(path.join(oldFolder, filename), 'utf8'), 'old layout image');
});
