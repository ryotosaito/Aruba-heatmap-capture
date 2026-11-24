const readline = require('readline');

function branch(label, children, expanded = false) {
	return { label, children, expanded, sites: children.flatMap(child => child.sites) };
}

function visibleRows(node, depth = 0, parent = null) {
	const row = { node, depth, parent };
	return node.expanded
		? [row, ...node.children.flatMap(child => visibleRows(child, depth + 1, node))]
		: [row];
}

function selectFloors(campuses, input = process.stdin, output = process.stdout) {
	const campusBranches = campuses.map(campus => {
		const buildingBranches = campus.buildings.map(building => {
			const floors = building.sites.map(site => ({ label: site.name, children: [], sites: [site] }));
			return branch(building.name, floors);
		});
		return branch(campus.name, buildingBranches);
	});
	const tree = branch('Network', campusBranches, true);
	const selected = new Set();
	const wasRaw = input.isRaw;
	const wasFlowing = input.readableFlowing === true;
	let cursor = 0;
	let offset = 0;
	let pageSize = 1;
	let drawnLines = 0;
	let message = '';

	function render() {
		const rows = visibleRows(tree);
		const height = output.rows || 24;
		const width = Math.max(1, (output.columns || 80) - 1);
		const lines = [
			`Select AirWave floor plans (${selected.size} selected)`,
			'Arrows: move/open/close  Space: toggle',
			'Enter: capture  Esc: cancel',
			message
		].slice(0, height - 1).map(line => line.slice(0, width));
		pageSize = height - lines.length;
		offset = Math.max(0, Math.min(offset, cursor, rows.length - pageSize));
		offset = Math.max(offset, cursor - pageSize + 1);
		rows.slice(offset, offset + pageSize).forEach(({ node, depth }, index) => {
			const count = node.sites.filter(site => selected.has(site)).length;
			const checked = count === node.sites.length ? 'x' : count ? '-' : ' ';
			const arrow = node.children.length ? (node.expanded ? 'v' : '>') : ' ';
			const label = node.label.replace(/[\x00-\x1f\x7f-\x9f]/g, ' ');
			const line = `${'  '.repeat(depth)}${arrow} [${checked}] ${label}`.slice(0, width);
			lines.push(offset + index === cursor ? `\x1b[7m${line}\x1b[0m` : line);
		});

		// Redraw in the current buffer to avoid switching the Windows console screen.
		const rewind = Math.min(drawnLines - 1, height - 1);
		const moveUp = rewind > 0 ? `\x1b[${rewind}A` : '';
		const clear = drawnLines ? '\x1b[J' : '';
		output.write(`${moveUp}\r${clear}${lines.join('\r\n')}`);
		drawnLines = lines.length;
	}

	return new Promise(resolve => {
		function finish(result) {
			input.removeListener('keypress', onKey);
			input.removeListener('end', cancel);
			output.removeListener('resize', render);
			input.setRawMode(wasRaw);
			if (!wasFlowing) {
				input.pause();
			}
			output.write('\r\n');
			resolve(result);
		}

		function cancel() {
			finish(null);
		}

		function onKey(_character, key = {}) {
			const rows = visibleRows(tree);
			const { node, parent } = rows[cursor];
			message = '';
			switch (key.name) {
				case 'c':
					if (key.ctrl) cancel();
					return;
				case 'escape':
					cancel();
					return;
				case 'return':
				case 'enter':
					if (selected.size) {
						const buildings = campuses.flatMap(campus => campus.buildings.map(building => ({
							...building,
							sites: building.sites.filter(site => selected.has(site))
						})));
						finish(buildings.filter(building => building.sites.length));
						return;
					}
					message = 'Select at least one floor plan to continue.';
					break;
				case 'space': {
					const clear = node.sites.every(site => selected.has(site));
					for (const site of node.sites) {
						if (clear) selected.delete(site);
						else selected.add(site);
					}
					break;
				}
				case 'up': cursor = Math.max(0, cursor - 1); break;
				case 'down': cursor = Math.min(rows.length - 1, cursor + 1); break;
				case 'pageup': cursor = Math.max(0, cursor - pageSize); break;
				case 'pagedown': cursor = Math.min(rows.length - 1, cursor + pageSize); break;
				case 'home': cursor = 0; break;
				case 'end': cursor = rows.length - 1; break;
				case 'left':
					if (node.expanded) node.expanded = false;
					else if (parent) cursor = rows.findIndex(row => row.node === parent);
					break;
				case 'right':
					if (node.expanded) cursor++;
					else if (node.children.length) node.expanded = true;
					break;
				default: return;
			}
			render();
		}

		readline.emitKeypressEvents(input);
		input.setRawMode(true);
		input.on('keypress', onKey);
		input.once('end', cancel);
		output.on('resize', render);
		render();
		input.resume();
	});
}

module.exports = { selectFloors };
