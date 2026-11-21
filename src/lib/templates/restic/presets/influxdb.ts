import { DUMPS_DIR, exec, noDump, waitFor, type PresetDef } from './shared';

/** `influx backup` writes a folder: it is made in the container and copied out */
const tmp = '/tmp/dockit-backup';
const login =
	'export INFLUX_TOKEN="${INFLUX_TOKEN:-$DOCKER_INFLUXDB_INIT_ADMIN_TOKEN}"; [ -n "$INFLUX_TOKEN" ] || { echo "Set INFLUX_TOKEN to an operator token"; exit 1; }';

export default {
	label: 'InfluxDB 2 backup',
	description: 'influx backup, restored with influx restore --full. Needs an operator token.',
	keepsVolumes: false,
	hooks: (c, name) => {
		const dir = `${DUMPS_DIR}/${name}.influx`;
		return {
			'pre-backup': [
				`mkdir -p ${DUMPS_DIR}`,
				`${exec(c)} sh -c '${login}; rm -rf ${tmp}; influx backup ${tmp}'`,
				`rm -rf ${dir}.tmp`,
				`docker cp ${c}:${tmp} ${dir}.tmp`,
				`${exec(c)} rm -rf ${tmp}`,
				`rm -rf ${dir}`,
				`mv ${dir}.tmp ${dir}`
			].join('\n'),
			'post-restore': [
				noDump(dir, '-d'),
				waitFor(`${exec(c)} influx ping`, c),
				`${exec(c)} rm -rf ${tmp}`,
				`docker cp ${dir} ${c}:${tmp}`,
				`${exec(c)} sh -c '${login}; influx restore --full ${tmp}'`,
				`${exec(c)} rm -rf ${tmp}`
			].join('\n')
		};
	}
} satisfies PresetDef;
