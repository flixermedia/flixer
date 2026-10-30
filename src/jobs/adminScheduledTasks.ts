export const ADMIN_SCHEDULED_TASKS = [
	{
		id: "scan-libraries",
		queue: "admin-task-scan-libraries",
		name: "Scan media libraries",
		category: "Library",
		description: "Looks for new, changed and removed files in all libraries.",
		defaultCron: "0 */12 * * *",
	},
	{
		id: "refresh-metadata",
		queue: "admin-task-refresh-metadata",
		name: "Refresh metadata",
		category: "Library",
		description: "Refreshes artwork and descriptions across all libraries.",
		defaultCron: "0 3 * * 0",
	},
	{
		id: "trickplay",
		queue: "admin-task-trickplay",
		name: "Generate trickplay thumbnails",
		category: "Library",
		description: "Creates missing seek-preview images for video files.",
		defaultCron: "0 4 * * *",
	},
	{
		id: "clean-transcode",
		queue: "admin-task-clean-transcode",
		name: "Clean transcode directory",
		category: "Maintenance",
		description: "Deletes transcode cache files older than 24 hours.",
		defaultCron: "0 */6 * * *",
	},
	{
		id: "clean-logs",
		queue: "admin-task-clean-logs",
		name: "Clean log files",
		category: "Maintenance",
		description: "Removes rotated log files older than 30 days.",
		defaultCron: "0 2 * * *",
	},
	{
		id: "optimize-database",
		queue: "admin-task-optimize-database",
		name: "Optimise database",
		category: "Maintenance",
		description: "Runs PostgreSQL VACUUM ANALYZE to refresh statistics and reclaim space.",
		defaultCron: "",
	},
] as const;

export type AdminScheduledTaskId = (typeof ADMIN_SCHEDULED_TASKS)[number]["id"];

export interface AdminScheduledTaskConfig {
	enabled: boolean;
	cron: string;
}

export type AdminScheduledTaskConfigs = Record<AdminScheduledTaskId, AdminScheduledTaskConfig>;

export const ADMIN_SCHEDULED_TASKS_SETTING = "admin_scheduled_tasks";

export function defaultAdminScheduledTaskConfigs(): AdminScheduledTaskConfigs {
	return Object.fromEntries(
		ADMIN_SCHEDULED_TASKS.map(({ id, defaultCron }) => [id, { enabled: defaultCron !== "", cron: defaultCron }]),
	) as AdminScheduledTaskConfigs;
}

export function isAdminScheduledTaskId(value: string): value is AdminScheduledTaskId {
	return ADMIN_SCHEDULED_TASKS.some(({ id }) => id === value);
}
