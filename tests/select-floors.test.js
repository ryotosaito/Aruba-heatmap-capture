const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { test } = require('node:test');
const { selectFloors } = require('../select-floors');

function terminal(t) {
	const input = new PassThrough();
	input.isRaw = false;
	input.setRawMode = mode => { input.isRaw = mode; };
	const output = new EventEmitter();
	output.rows = 16;
	output.columns = 80;
	const frames = [];
	output.write = frame => frames.push(frame);
	t.after(() => input.destroy());
	return { input, output, frames };
}

const campuses = [
	{ name: 'North', buildings: [{ name: 'Office', sites: [{ name: 'Ground' }, { name: 'First' }] }] },
	{ name: 'South', buildings: [{ name: 'Annex', sites: [{ name: 'Roof' }] }] }
];

const down = '\x1b[B';
const right = '\x1b[C';
const end = '\x1b[F';
const enter = '\r';

test('selects multiple branches and allows excluding an individual floor', async t => {
	const { input, output, frames } = terminal(t);
	const selection = selectFloors(campuses, input, output);
	input.write(enter);
	assert.match(frames.at(-1), /Select at least one floor plan/);

	input.write(`${down} ${right}${down}${right}${down} `);
	assert.match(frames.at(-1), /\[-\] Office/);
	input.write(`${end} ${enter}`);

	assert.deepEqual(await selection, [
		{ name: 'Office', sites: [{ name: 'First' }] },
		{ name: 'Annex', sites: [{ name: 'Roof' }] }
	]);
	assert.equal(input.isRaw, false);
	assert.equal(input.readableFlowing, false);
	assert.equal(output.listenerCount('resize'), 0);
});

test('redraws inside the console buffer and restores the terminal on cancel', async t => {
	const { input, output, frames } = terminal(t);
	const selection = selectFloors(campuses, input, output);
	input.write(`${down}${right}${down}${right}`);
	output.rows = 5;
	output.emit('resize');
	assert.ok(frames.at(-1).split('\r\n').length <= output.rows);
	assert.ok(frames.every(frame => !frame.includes('\x1b[?1049')));

	input.write('\x03');
	assert.equal(await selection, null);
	assert.equal(input.isRaw, false);
	assert.equal(input.readableFlowing, false);
	assert.equal(output.listenerCount('resize'), 0);
	assert.equal(frames.at(-1), '\r\n');
});
