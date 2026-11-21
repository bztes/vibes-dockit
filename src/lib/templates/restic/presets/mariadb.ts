import { mysqlPreset } from './mysql';

export default mysqlPreset('MariaDB dump', {
	dump: 'mariadb-dump',
	admin: 'mariadb-admin',
	client: 'mariadb',
	password: '${MARIADB_ROOT_PASSWORD:-$MYSQL_ROOT_PASSWORD}'
});
