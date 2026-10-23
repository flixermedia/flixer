"use strict";

const path = require("node:path");
const defaultLogFile = path.join(__dirname, "/logs/project-server.log");

module.exports = {
	apps: [
		{
			name: "api",
			script: `${process.env.WORKDIR}/dist/index.js`,
			cwd: process.env.WORKDIR,
			exec_mode: "cluster",
			// One process by default: setup state, the config store and the secrets are per process, so cluster workers
			// would each run their own wizard, race to write the same files and fight over the port during startup.
			instances: process.env.NODE_ENV === "test" ? 1 : process.env.NB_INSTANCES || 1,
			autorestart: true,
			max_memory_restart: process.env.MAX_MEMORY_RESTART || "750M",
			out_file: defaultLogFile,
			error_file: defaultLogFile,
			merge_logs: true,
			kill_timeout: 30000,
		},
	],
};
