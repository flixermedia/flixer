import { BadRequest, Conflict, NotFound, Unauthorized } from "@tsed/exceptions";
import { Inject, Injectable } from "@tsed/di";
import {
	generateAuthenticationOptions,
	generateRegistrationOptions,
	verifyAuthenticationResponse,
	verifyRegistrationResponse,
	type AuthenticationResponseJSON,
	type PublicKeyCredentialCreationOptionsJSON,
	type PublicKeyCredentialRequestOptionsJSON,
	type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { randomUUID } from "node:crypto";
import { DataSource, LessThan } from "typeorm";
import { DefaultDataSource } from "../../datasources/defaultDataSource.datasource.js";
import { PasskeyChallenge, type PasskeyChallengeType } from "../../entities/passkeyChallenge.entity.js";
import { PasskeyCredential } from "../../entities/passkeyCredential.entity.js";
import { UserPreference } from "../../entities/userPreference.entity.js";
import { AuthService, type AuthResult } from "./authService.js";

const CHALLENGE_LIFETIME_MS = 5 * 60 * 1000;
const MAX_PASSKEYS_PER_USER = 20;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface PublicPasskey {
	id: string;
	name: string;
	deviceType: string;
	backedUp: boolean;
	transports: string[];
	createdAt: Date;
	lastUsedAt: Date | null;
}

@Injectable()
export class PasskeyService {

	constructor(
		@Inject(DefaultDataSource) private readonly dataSource: DataSource,
		private readonly authService: AuthService,
	) {}

	async createRegistrationOptions(password: string | undefined, authorization?: string): Promise<PublicKeyCredentialCreationOptionsJSON> {
		const user = await this.authService.getAuthenticatedUser(authorization);
		await this.authService.assertPassword(authorization, password);
		const existing = await this.dataSource.getRepository(PasskeyCredential).findBy({ userId: user.id });

		if (existing.length >= MAX_PASSKEYS_PER_USER) {
			throw new BadRequest(`You can register at most ${MAX_PASSKEYS_PER_USER} passkeys.`);
		}

		const options = await generateRegistrationOptions({
			rpName: this.getRelyingPartyName(),
			rpID: this.getRelyingPartyId(),
			userName: user.username,
			userDisplayName: user.displayName,
			userID: new TextEncoder().encode(user.id),
			attestationType: "none",
			excludeCredentials: existing.map((credential) => ({
				id: credential.credentialId,
				transports: (credential.transports ?? undefined) as never,
			})),
			authenticatorSelection: { residentKey: "preferred", userVerification: "preferred" },
		});

		await this.storeChallenge(options.challenge, "registration", user.id);
		return options;
	}

	async verifyRegistration(response: unknown, name: string | undefined, authorization?: string): Promise<PublicPasskey> {
		const user = await this.authService.getAuthenticatedUser(authorization);
		const registration = response as RegistrationResponseJSON;

		// A failed registration is not an authentication failure, so it must not be a 401 (the client signs out on 401).
		let verification;
		try {
			verification = await verifyRegistrationResponse({
				response: registration,
				expectedChallenge: (challenge) => this.consumeChallenge(challenge, "registration", user.id),
				expectedOrigin: this.getAllowedOrigins(),
				expectedRPID: this.getRelyingPartyId(),
				requireUserVerification: false,
			});
		} catch (error) {
			throw new BadRequest(error instanceof Error ? error.message : "The passkey could not be verified.");
		}

		if (!verification.verified || !verification.registrationInfo) {
			throw new BadRequest("The passkey could not be verified.");
		}

		const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;
		const repository = this.dataSource.getRepository(PasskeyCredential);

		if (await repository.existsBy({ credentialId: credential.id })) {
			throw new Conflict("This passkey is already registered.");
		}

		const saved = await repository.save(
			repository.create({
				id: randomUUID(),
				userId: user.id,
				credentialId: credential.id,
				publicKey: Buffer.from(credential.publicKey),
				counter: credential.counter,
				transports: credential.transports ?? registration.response.transports ?? null,
				deviceType: credentialDeviceType,
				backedUp: credentialBackedUp,
				name: name?.trim() || this.defaultName(credentialDeviceType, credentialBackedUp),
				lastUsedAt: null,
			}),
		);

		return this.toPublicPasskey(saved);
	}

	async createAuthenticationOptions(): Promise<PublicKeyCredentialRequestOptionsJSON> {
		const options = await generateAuthenticationOptions({
			rpID: this.getRelyingPartyId(),
			userVerification: "preferred",
		});

		await this.storeChallenge(options.challenge, "authentication", null);
		return options;
	}

	async verifyAuthentication(response: unknown, expectedUserId: string | null = null): Promise<AuthResult> {
		const authentication = response as AuthenticationResponseJSON;
		const repository = this.dataSource.getRepository(PasskeyCredential);
		const credential =
			typeof authentication?.id === "string" ? await repository.findOneBy({ credentialId: authentication.id }) : null;

		if (!credential || (expectedUserId !== null && credential.userId !== expectedUserId)) {
			throw new Unauthorized("This passkey is not recognised.");
		}

		const verification = await this.verifyOrReject(() =>
			verifyAuthenticationResponse({
				response: authentication,
				expectedChallenge: (challenge) => this.consumeChallenge(challenge, "authentication", expectedUserId),
				expectedOrigin: this.getAllowedOrigins(),
				expectedRPID: this.getRelyingPartyId(),
				requireUserVerification: false,
				credential: {
					id: credential.credentialId,
					publicKey: new Uint8Array(credential.publicKey),
					counter: credential.counter,
					transports: (credential.transports ?? undefined) as never,
				},
			}),
		);

		if (!verification.verified) {
			throw new Unauthorized("The passkey could not be verified.");
		}

		credential.counter = verification.authenticationInfo.newCounter;
		credential.backedUp = verification.authenticationInfo.credentialBackedUp;
		credential.lastUsedAt = new Date();
		await repository.save(credential);

		const user = await this.dataSource.getRepository(User).findOneBy({ id: credential.userId });
		if (!user) {
			throw new Unauthorized("The account for this passkey no longer exists.");
		}

		return this.authService.issueAuthResult(user);
	}

	async createSecondFactorOptions(ticket: string): Promise<PublicKeyCredentialRequestOptionsJSON> {
		const userId = this.authService.readPasskeyTicket(ticket);
		const credentials = await this.dataSource.getRepository(PasskeyCredential).findBy({ userId });
		if (credentials.length === 0) {
			throw new BadRequest("This account has no passkeys.");
		}

		const options = await generateAuthenticationOptions({
			rpID: this.getRelyingPartyId(),
			userVerification: "preferred",
			allowCredentials: credentials.map((credential) => ({
				id: credential.credentialId,
				transports: (credential.transports ?? undefined) as never,
			})),
		});

		await this.storeChallenge(options.challenge, "authentication", userId);
		return options;
	}

	async verifySecondFactor(ticket: string, response: unknown): Promise<AuthResult> {
		const userId = this.authService.readPasskeyTicket(ticket);
		return this.verifyAuthentication(response, userId);
	}

	async listPasskeys(authorization?: string): Promise<PublicPasskey[]> {
		const user = await this.authService.getAuthenticatedUser(authorization);
		const credentials = await this.dataSource.getRepository(PasskeyCredential).find({
			where: { userId: user.id },
			order: { createdAt: "DESC" },
		});

		return credentials.map((credential) => this.toPublicPasskey(credential));
	}

	async deletePasskey(passkeyId: string, password: string | undefined, authorization?: string): Promise<{ id: string; deleted: true }> {
		const user = await this.authService.getAuthenticatedUser(authorization);
		await this.authService.assertPassword(authorization, password);
		if (!UUID_PATTERN.test(passkeyId)) {
			throw new BadRequest("Passkey ID must be a valid UUID.");
		}

		const id = passkeyId.toLowerCase();
		const repository = this.dataSource.getRepository(PasskeyCredential);
		const credential = await repository.findOneBy({ id, userId: user.id });

		if (!credential) {
			throw new NotFound("Passkey not found.");
		}

		await repository.remove(credential);
		// Without any passkeys left, requiring one at sign-in would lock the account out.
		if (!(await repository.existsBy({ userId: user.id }))) {
			await this.dataSource.getRepository(UserPreference).update({ userId: user.id }, { passkeyRequired: false });
		}
		return { id, deleted: true };
	}

	private async verifyOrReject<T>(verify: () => Promise<T>): Promise<T> {
		try {
			return await verify();
		} catch (error) {
			if (error instanceof Unauthorized) {
				throw error;
			}
			throw new Unauthorized(error instanceof Error ? error.message : "The passkey could not be verified.");
		}
	}

	private async storeChallenge(challenge: string, type: PasskeyChallengeType, userId: string | null): Promise<void> {
		const repository = this.dataSource.getRepository(PasskeyChallenge);
		await repository.delete({ expiresAt: LessThan(new Date()) });
		await repository.save(
			repository.create({ challenge, type, userId, expiresAt: new Date(Date.now() + CHALLENGE_LIFETIME_MS) }),
		);
	}

	// Challenges are single use: deleting the row is what authorises the verification.
	private async consumeChallenge(challenge: string, type: PasskeyChallengeType, userId: string | null): Promise<boolean> {
		const result = await this.dataSource
			.createQueryBuilder()
			.delete()
			.from(PasskeyChallenge)
			.where("challenge = :challenge AND type = :type AND expires_at > now()", { challenge, type })
			.returning("user_id")
			.execute();
		const rows = result.raw as { user_id: string | null }[];

		return rows.length === 1 && rows[0].user_id === userId;
	}

	private toPublicPasskey(credential: PasskeyCredential): PublicPasskey {
		return {
			id: credential.id,
			name: credential.name,
			deviceType: credential.deviceType,
			backedUp: credential.backedUp,
			transports: credential.transports ?? [],
			createdAt: credential.createdAt,
			lastUsedAt: credential.lastUsedAt,
		};
	}

	private defaultName(deviceType: string, backedUp: boolean): string {
		if (deviceType === "multiDevice") {
			return backedUp ? "Synced passkey" : "Passkey";
		}
		return "Security key";
	}

	private getRelyingPartyId(): string {
		return process.env.PASSKEY_RP_ID?.trim() || "localhost";
	}

	private getRelyingPartyName(): string {
		return process.env.PASSKEY_RP_NAME?.trim() || "Flixer";
	}

	private getAllowedOrigins(): string[] {
		const configured = process.env.PASSKEY_ORIGINS?.split(",")
			.map((origin) => origin.trim())
			.filter(Boolean);

		return configured?.length ? configured : ["https://localhost:5173"];
	}
}
