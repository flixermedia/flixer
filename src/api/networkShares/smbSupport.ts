import { release } from "node:os";

/**
 * Whether this API can mount SMB shares itself. Inside a container `process.platform` is always "linux", so the host is
 * recognised by its kernel: Docker Desktop on macOS and Windows runs containers in a VM whose kernel is "linuxkit" (or
 * "WSL2"), and that cannot provide the mount propagation share mounting needs. SMB_MOUNT_SUPPORTED=true/false overrides.
 */
export function smbMountSupported(kernel: string = release(), override: string | undefined = process.env.SMB_MOUNT_SUPPORTED): boolean {
	const forced = override?.trim().toLowerCase();
	if (forced === "true" || forced === "1") {
		return true;
	}
	if (forced === "false" || forced === "0") {
		return false;
	}
	return !/linuxkit|wsl2|microsoft|docker-desktop/i.test(kernel);
}
