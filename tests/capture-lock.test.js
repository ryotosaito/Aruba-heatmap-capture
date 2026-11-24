const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { lockCaptureIndex } = require('../capture-index');

test('blocks overlapping captures and recovers automatically after a forced stop', { timeout: 20000 }, async t => {
	const temp = await fs.realpath(os.tmpdir());
	const directory = await fs.mkdtemp(path.join(temp, 'aruba-capture-lock-test-'));
	const modulePath = require.resolve('../capture-index');
	const lockFile = path.join(directory, 'captures.json.lock');
	await fs.writeFile(lockFile, '');

	const owner = spawn(process.execPath, ['-e', `
		const { lockCaptureIndex } = require(${JSON.stringify(modulePath)});
		try {
			lockCaptureIndex();
			process.stdin.resume();
			process.send('locked');
		} catch (error) {
			console.error(error);
			process.exitCode = 1;
			process.disconnect();
		}
	`], { cwd: directory, stdio: ['pipe', 'ignore', 'inherit', 'ipc'], windowsHide: true });
	const stopped = once(owner, 'close');
	t.after(async () => {
		if (owner.exitCode === null && owner.signalCode === null) owner.kill('SIGKILL');
		await stopped;
		const target = await fs.realpath(directory);
		assert.equal(path.dirname(target), temp);
		assert.match(path.basename(target), /^aruba-capture-lock-test-/);
		await fs.rm(target, { recursive: true, force: true });
	});

	const [ready] = await Promise.race([once(owner, 'message'), stopped]);
	assert.equal(ready, 'locked');
	assert.throws(() => lockCaptureIndex(directory), /capture is already running/);

	assert.equal(owner.kill('SIGKILL'), true);
	await stopped;
	const unlock = lockCaptureIndex(directory);
	unlock();
	await fs.access(lockFile);
});
