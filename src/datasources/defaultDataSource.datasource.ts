import { injectable, logger } from "@tsed/di";
import { DataSource } from "typeorm";
import { User } from "../entities/user.entity.js";
import { UserSession } from "../entities/userSession.entity.js";
import { Setting } from "../entities/setting.entity.js";
import { UserPreference } from "../entities/userPreference.entity.js";
import { ApiKey } from "../entities/apiKey.entity.js";
import { MediaLibrary } from "../entities/mediaLibrary.entity.js";
import { MediaItem } from "../entities/mediaItem.entity.js";
import { NetworkShare } from "../entities/networkShare.entity.js";
import { WatchProgress } from "../entities/watchProgress.entity.js";
import { MediaCredit } from "../entities/mediaCredit.entity.js";
import { PersonProfile } from "../entities/personProfile.entity.js";
import { Notification } from "../entities/notification.entity.js";
import { PushSubscription } from "../entities/pushSubscription.entity.js";
import { PushKey } from "../entities/pushKey.entity.js";
import { AddRequestServiceLibrary1794700000000 } from "../migrations/addRequestServiceLibrary1794700000000.js";
import { CreateMediaRequests1794600000000 } from "../migrations/createMediaRequests1794600000000.js";
import { CreateNotifications1794400000000 } from "../migrations/createNotifications1794400000000.js";
import { CreatePersonProfiles1794200000000 } from "../migrations/createPersonProfiles1794200000000.js";
import { AddPersonProfileImage1794300000000 } from "../migrations/addPersonProfileImage1794300000000.js";
import { AddMediaCreditImage1794100000000 } from "../migrations/addMediaCreditImage1794100000000.js";
import { AddMediaCreditPersonId1794000000000 } from "../migrations/addMediaCreditPersonId1794000000000.js";
import { CreateMediaCredits1793900000000 } from "../migrations/createMediaCredits1793900000000.js";
import { CreateMediaSegments1794500000000 } from "../migrations/createMediaSegments1794500000000.js";
import { MediaSegment } from "../entities/mediaSegment.entity.js";
import { PluginInstallation } from "../entities/pluginInstallation.entity.js";
import { PluginRepository } from "../entities/pluginRepository.entity.js";
import { PluginUpdateHistory } from "../entities/pluginUpdateHistory.entity.js";
import { PluginStorageEntry } from "../entities/pluginStorageEntry.entity.js";
import { PluginSecret } from "../entities/pluginSecret.entity.js";
import { DropLegacyRequests1795200000000 } from "../migrations/dropLegacyRequests1795200000000.js";
import { CreatePluginSecrets1795100000000 } from "../migrations/createPluginSecrets1795100000000.js";
import { CreatePluginManager1794800000000 } from "../migrations/createPluginManager1794800000000.js";
import { CreatePluginUpdateHistory1794900000000 } from "../migrations/createPluginUpdateHistory1794900000000.js";
import { CreatePluginStorage1795000000000 } from "../migrations/createPluginStorage1795000000000.js";
import { CreateWatchProgress1793800000000 } from "../migrations/createWatchProgress1793800000000.js";
import { CreateNetworkShares1793600000000 } from "../migrations/createNetworkShares1793600000000.js";
import { AddMediaItemLastSeenAt1793700000000 } from "../migrations/addMediaItemLastSeenAt1793700000000.js";
import { CreateMediaItems1793400000000 } from "../migrations/createMediaItems1793400000000.js";
import { AddMediaItemEditedFields1793500000000 } from "../migrations/addMediaItemEditedFields1793500000000.js";
import { CreateMediaLibraries1793300000000 } from "../migrations/createMediaLibraries1793300000000.js";
import { AddDevicesAndApiKeys1793100000000 } from "../migrations/addDevicesAndApiKeys1793100000000.js";
import { AddUserDisabledAt1793200000000 } from "../migrations/addUserDisabledAt1793200000000.js";
import { PasskeyChallenge } from "../entities/passkeyChallenge.entity.js";
import { PasskeyCredential } from "../entities/passkeyCredential.entity.js";
import { AddUsername1792190000000 } from "../migrations/addUsername1792190000000.js";
import { AddUserRole1792190300000 } from "../migrations/addUserRole1792190300000.js";
import { CreateUserSessions1792191000000 } from "../migrations/createUserSessions1792191000000.js";
import { CreateUsersTable1792186500000 } from "../migrations/createUsersTable1792186500000.js";
import { CreateSettings1792238400000 } from "../migrations/createSettings1792238400000.js";
import { CreatePasskeys1792300000000 } from "../migrations/createPasskeys1792300000000.js";
import { AddUserDisplayName1792400000000 } from "../migrations/addUserDisplayName1792400000000.js";
import { AddUserEmailVerified1792500000000 } from "../migrations/addUserEmailVerified1792500000000.js";
import { AddUserPendingEmail1792600000000 } from "../migrations/addUserPendingEmail1792600000000.js";
import { AddUserPasskeyRequired1792700000000 } from "../migrations/addUserPasskeyRequired1792700000000.js";
import { AddUserAvatar1792800000000 } from "../migrations/addUserAvatar1792800000000.js";
import { CreateUserPreferences1792900000000 } from "../migrations/createUserPreferences1792900000000.js";
import { MoveUserSettingsToPreferences1793000000000 } from "../migrations/moveUserSettingsToPreferences1793000000000.js";
import { synchronizeSettings } from "../config/settingsSync.js";
import { appConfig } from "../config/store/appConfig.js";
import { cleanupExpiredUserSessions } from "../jobs/sessionCleanupJob.js";

export const DefaultDataSource = injectable(Symbol.for("DefaultDataSource"))
	.type("typeorm:datasource")
	.asyncFactory(async () => {
		const url = appConfig().get("databaseUrl");
		if (!url) {
			throw new Error("DATABASE_URL must be set to initialize the PostgreSQL DataSource.");
		}

		const dataSource = new DataSource({
			type: "postgres",
			url,
			// Explicit so the pool is sized above INDEXER_MAX_WRITES and always leaves connections for web requests.
			extra: { max: Number.parseInt(process.env.DATABASE_POOL_MAX ?? "", 10) || 10 },
			entities: [
				User,
				UserSession,
				Setting,
				PasskeyCredential,
				PasskeyChallenge,
				UserPreference,
				ApiKey,
				MediaLibrary,
				MediaItem,
				MediaSegment,
				NetworkShare,
				WatchProgress,
				MediaCredit,
				PersonProfile,
				Notification,
				PushSubscription,
				PushKey,
				PluginRepository,
				PluginInstallation,
				PluginUpdateHistory,
				PluginStorageEntry,
				PluginSecret,
			],
			migrations: [
				CreateUsersTable1792186500000,
				AddUsername1792190000000,
				AddUserRole1792190300000,
				CreateUserSessions1792191000000,
				CreateSettings1792238400000,
				CreatePasskeys1792300000000,
				AddUserDisplayName1792400000000,
				AddUserEmailVerified1792500000000,
				AddUserPendingEmail1792600000000,
				AddUserPasskeyRequired1792700000000,
				AddUserAvatar1792800000000,
				CreateUserPreferences1792900000000,
				MoveUserSettingsToPreferences1793000000000,
				AddDevicesAndApiKeys1793100000000,
				AddUserDisabledAt1793200000000,
				CreateMediaLibraries1793300000000,
				CreateMediaItems1793400000000,
				AddMediaItemEditedFields1793500000000,
				CreateNetworkShares1793600000000,
				AddMediaItemLastSeenAt1793700000000,
				CreateWatchProgress1793800000000,
				CreateMediaCredits1793900000000,
				AddMediaCreditPersonId1794000000000,
				AddMediaCreditImage1794100000000,
				CreatePersonProfiles1794200000000,
				AddPersonProfileImage1794300000000,
				CreateNotifications1794400000000,
				CreateMediaSegments1794500000000,
				CreateMediaRequests1794600000000,
				AddRequestServiceLibrary1794700000000,
				CreatePluginManager1794800000000,
				CreatePluginUpdateHistory1794900000000,
				CreatePluginStorage1795000000000,
				CreatePluginSecrets1795100000000,
				DropLegacyRequests1795200000000,
			],
			synchronize: false,
			migrationsRun: false,
		});

		await dataSource.initialize();
		await dataSource.runMigrations();
		await synchronizeSettings(dataSource);
		await cleanupExpiredUserSessions(dataSource);
		logger().info("Connected to PostgreSQL.");

		return dataSource;
	})
	.hooks({
		$onDestroy(source) {
			return source.isInitialized ? source.destroy() : undefined;
		},
	})
	.token();

export type DefaultDataSource = DataSource;
