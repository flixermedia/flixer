import { describe, expect, it, vi } from "vitest";
import type { DataSource } from "typeorm";
import { MailDomain } from "../../entities/mailDomain.entity.js";
import { Mailbox } from "../../entities/mailbox.entity.js";
import { MailDomainService } from "./mailDomainService.js";

function makeService(mailboxes: Array<Pick<Mailbox, "id" | "address" | "kind">>) {
	const domain = { id: "dom-1", domain: "example.com", allowSubdomains: false } as MailDomain;
	const domainRepo = {
		findOneBy: vi.fn().mockResolvedValue(domain),
		delete: vi.fn().mockResolvedValue({ affected: 1 }),
	};
	const mailboxRepo = {
		findBy: vi.fn().mockResolvedValue(mailboxes),
		delete: vi.fn().mockResolvedValue({ affected: mailboxes.length }),
	};
	const dataSource = {
		getRepository(entity: unknown) {
			if (entity === Mailbox) return mailboxRepo;
			return domainRepo;
		},
	} as unknown as DataSource;
	return {
		service: new MailDomainService(dataSource, {} as never),
		domainRepo,
		mailboxRepo,
	};
}

describe("MailDomainService.remove", () => {
	it("removes the default system mailbox automatically when deleting a domain", async () => {
		const { service, domainRepo, mailboxRepo } = makeService([
			{ id: "mb-sys", address: "noreply@example.com", kind: "system" },
		]);

		await service.remove("dom-1");

		expect(mailboxRepo.delete).toHaveBeenCalledWith(["mb-sys"]);
		expect(domainRepo.delete).toHaveBeenCalledWith({ id: "dom-1" });
	});

	it("still rejects deletion when non-system mailboxes exist", async () => {
		const { service, domainRepo, mailboxRepo } = makeService([
			{ id: "mb-sys", address: "noreply@example.com", kind: "system" },
			{ id: "mb-user", address: "alice@example.com", kind: "user" },
		]);

		await expect(service.remove("dom-1")).rejects.toThrow("Delete this domain's mailboxes before removing the domain.");
		expect(mailboxRepo.delete).not.toHaveBeenCalled();
		expect(domainRepo.delete).not.toHaveBeenCalled();
	});
});
