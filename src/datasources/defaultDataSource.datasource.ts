import { injectable, logger } from "@tsed/di";
import { DataSource } from "typeorm";
import { LOG_SUCCESSFUL_API_REQUESTS_SETTING, setLogSuccessfulApiRequests } from "../config/logger/requestLog.js";
import { User } from "../entities/user.entity.js";
import { UserSession } from "../entities/userSession.entity.js";
import { Setting } from "../entities/setting.entity.js";
import { UserPreference } from "../entities/userPreference.entity.js";
import { UserAccessPolicy } from "../entities/userAccessPolicy.entity.js";
import { GuideSettings, GuideSource } from "../entities/guideSource.entity.js";
import { GuideProgramme } from "../entities/guideProgramme.entity.js";
import { MailServerSettings } from "../entities/mailServerSettings.entity.js";
import { MailDomain } from "../entities/mailDomain.entity.js";
import { Mailbox } from "../entities/mailbox.entity.js";
import { MailMessage } from "../entities/mailMessage.entity.js";
import { CreateMailServer1798000000000 } from "../migrations/createMailServer1798000000000.js";
import { CreateUserAccessPolicies1798200000000 } from "../migrations/createUserAccessPolicies1798200000000.js";
import { CreatePayments1798300000000 } from "../migrations/createPayments1798300000000.js";
import { CreatePaymentSignups1798300000001 } from "../migrations/createPaymentSignups1798300000001.js";
import { AddPaymentProductRequiresPurchase1798300000002 } from "../migrations/addPaymentProductRequiresPurchase1798300000002.js";
import { AddTrailerCacheSetting1798300000003 } from "../migrations/addTrailerCacheSetting1798300000003.js";
import { NormalizeChapterTitles1798300000004 } from "../migrations/normalizeChapterTitles1798300000004.js";
import { CreateAdvertisements1798300000005 } from "../migrations/createAdvertisements1798300000005.js";
import { CreateAdvertisementAnalytics1798300000006 } from "../migrations/createAdvertisementAnalytics1798300000006.js";
import { CreateViewingAnalytics1798300000007 } from "../migrations/createViewingAnalytics1798300000007.js";
import { CreateListeningAnalytics1798300000008 } from "../migrations/createListeningAnalytics1798300000008.js";
import { CreateUserWebhooks1798300000009 } from "../migrations/createUserWebhooks1798300000009.js";
import { DefaultUserWebhookUrlRules1798300000010 } from "../migrations/defaultUserWebhookUrlRules1798300000010.js";
import { CreateMediaSourceGroups1798300000011 } from "../migrations/createMediaSourceGroups1798300000011.js";
import { CreateQuickConnectRequests1798300000012 } from "../migrations/createQuickConnectRequests1798300000012.js";
import { CreateThemes1798300000013 } from "../migrations/createThemes1798300000013.js";
import { CreateThemeVersions1798300000014 } from "../migrations/createThemeVersions1798300000014.js";
import { CreateOidcProvider1798300000015 } from "../migrations/createOidcProvider1798300000015.js";
import { RepairOidcConfiguration1798300000016 } from "../migrations/repairOidcConfiguration1798300000016.js";
import { CreateOidcConsents1798300000017 } from "../migrations/createOidcConsents1798300000017.js";
import { AddOidcSubscriptionSharing1798300000018 } from "../migrations/addOidcSubscriptionSharing1798300000018.js";
import { AddOidcResourceScopes1798300000019 } from "../migrations/addOidcResourceScopes1798300000019.js";
import { RemoveOidcSubscriptionClaim1798300000020 } from "../migrations/removeOidcSubscriptionClaim1798300000020.js";
import { cleanupExpiredOidcArtifacts } from "../api/oidc/oidcCleanup.js";
import { Advertisement } from "../entities/advertisement.entity.js";
import { AdvertisementSettings } from "../entities/advertisementSettings.entity.js";
import { PaymentConfigRow } from "../entities/paymentConfig.entity.js";
import { PaymentProduct } from "../entities/paymentProduct.entity.js";
import { PaymentPlan } from "../entities/paymentPlan.entity.js";
import { PaymentCoupon } from "../entities/paymentCoupon.entity.js";
import { PaymentCustomer } from "../entities/paymentCustomer.entity.js";
import { PaymentMethod } from "../entities/paymentMethod.entity.js";
import { PaymentOrder } from "../entities/paymentOrder.entity.js";
import { PaymentEntitlement } from "../entities/paymentEntitlement.entity.js";
import { PaymentSubscription } from "../entities/paymentSubscription.entity.js";
import { PaymentEvent } from "../entities/paymentEvent.entity.js";
import { PaymentSignup } from "../entities/paymentSignup.entity.js";
import { AddUserOriginalAccess1798100000000 } from "../migrations/addUserOriginalAccess1798100000000.js";
import { ApiKey } from "../entities/apiKey.entity.js";
import { MediaLibrary } from "../entities/mediaLibrary.entity.js";
import { MediaItem } from "../entities/mediaItem.entity.js";
import { NetworkShare } from "../entities/networkShare.entity.js";
import { WatchProgress } from "../entities/watchProgress.entity.js";
import { Favorite } from "../entities/favorite.entity.js";
import { Playlist } from "../entities/playlist.entity.js";
import { PlaylistItem } from "../entities/playlistItem.entity.js";
import { ListeningHistory } from "../entities/listeningHistory.entity.js";
import { CreateChat1795500000000 } from "../migrations/createChat1795500000000.js";
import { CreateNativePasskeyHandoffs1795600000000 } from "../migrations/createNativePasskeyHandoffs1795600000000.js";
import { AddFriendshipsAndProfileVisibility1795700000000 } from "../migrations/addFriendshipsAndProfileVisibility1795700000000.js";
import { AddFriendInviteTokens1795800000000 } from "../migrations/addFriendInviteTokens1795800000000.js";
import { CreateSocialFriendInvites1795900000000 } from "../migrations/createSocialFriendInvites1795900000000.js";
import { AddMediaSearchReset1796200000000 } from "../migrations/addMediaSearchReset1796200000000.js";
import { AddMediaSearchContent1796300000000 } from "../migrations/addMediaSearchContent1796300000000.js";
import { CreateGuideSources1796400000000 } from "../migrations/createGuideSources1796400000000.js";
import { CreateGuideProgrammes1796500000000 } from "../migrations/createGuideProgrammes1796500000000.js";
import { CreateSocial1795400000000 } from "../migrations/createSocial1795400000000.js";
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
import { MediaRequest } from "../entities/mediaRequest.entity.js";
import { RequestService } from "../entities/requestService.entity.js";
import { RequestUserLimit } from "../entities/requestUserLimit.entity.js";
import { RestoreCoreRequests1795300000000 } from "../migrations/restoreCoreRequests1795300000000.js";
import { CreatePluginSecrets1795100000000 } from "../migrations/createPluginSecrets1795100000000.js";
import { CreatePluginManager1794800000000 } from "../migrations/createPluginManager1794800000000.js";
import { CreatePluginUpdateHistory1794900000000 } from "../migrations/createPluginUpdateHistory1794900000000.js";
import { CreatePluginStorage1795000000000 } from "../migrations/createPluginStorage1795000000000.js";
import { CreateWatchProgress1793800000000 } from "../migrations/createWatchProgress1793800000000.js";
import { CreateNetworkShares1793600000000 } from "../migrations/createNetworkShares1793600000000.js";
import { AddMediaItemLastSeenAt1793700000000 } from "../migrations/addMediaItemLastSeenAt1793700000000.js";
import { CreateMediaItems1793400000000 } from "../migrations/createMediaItems1793400000000.js";
import { AddMediaItemEditedFields1793500000000 } from "../migrations/addMediaItemEditedFields1793500000000.js";
import { CreateMediaSearchOutbox1796100000000 } from "../migrations/createMediaSearchOutbox1796100000000.js";
import { CreateMediaLibraries1793300000000 } from "../migrations/createMediaLibraries1793300000000.js";
import { AddDevicesAndApiKeys1793100000000 } from "../migrations/addDevicesAndApiKeys1793100000000.js";
import { AddUserDisabledAt1793200000000 } from "../migrations/addUserDisabledAt1793200000000.js";
import { PasskeyChallenge } from "../entities/passkeyChallenge.entity.js";
import { PasskeyCredential } from "../entities/passkeyCredential.entity.js";
import { NativePasskeyHandoff } from "../entities/nativePasskeyHandoff.entity.js";
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
import { AiRecommendationCache } from "../entities/aiRecommendationCache.entity.js";
import { QuickConnectRequest } from "../entities/quickConnectRequest.entity.js";
import { Theme } from "../entities/theme.entity.js";
import { ThemeVersion } from "../entities/themeVersion.entity.js";
import { CreateAiRecommendationCaches1796600000000 } from "../migrations/createAiRecommendationCaches1796600000000.js";
import { AddAiRecommendationCacheScopes1796700000000 } from "../migrations/addAiRecommendationCacheScopes1796700000000.js";
import { AddRequestWebhookToken1796800000000 } from "../migrations/addRequestWebhookToken1796800000000.js";
import { CreateIssueReports1796900000000 } from "../migrations/createIssueReports1796900000000.js";
import { AddChatMls1797000000000 } from "../migrations/addChatMls1797000000000.js";
import { EnsureChatMessageSequence1797100000000 } from "../migrations/ensureChatMessageSequence1797100000000.js";
import { RepairChatMlsDevicePairingKey1797200000000 } from "../migrations/repairChatMlsDevicePairingKey1797200000000.js";
import { RepairChatMlsDeviceApproval1797300000000 } from "../migrations/repairChatMlsDeviceApproval1797300000000.js";
import { RepairChatMlsWelcomeMessage1797400000000 } from "../migrations/repairChatMlsWelcomeMessage1797400000000.js";
import { RepairChatMlsWelcomeColumns1797500000000 } from "../migrations/repairChatMlsWelcomeColumns1797500000000.js";
import { RepairChatMlsWelcomeSchema1797600000000 } from "../migrations/repairChatMlsWelcomeSchema1797600000000.js";
import { CreateChatMlsHistoryBackups1797700000000 } from "../migrations/createChatMlsHistoryBackups1797700000000.js";
import { AddChatMessageEncryption1797800000000 } from "../migrations/addChatMessageEncryption1797800000000.js";
import { AddChatConversationEncryption1797900000000 } from "../migrations/addChatConversationEncryption1797900000000.js";

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
				NativePasskeyHandoff,
				UserPreference,
				UserAccessPolicy,
				PaymentConfigRow,
				Advertisement,
				AdvertisementSettings,
				PaymentProduct,
				PaymentPlan,
				PaymentCoupon,
				PaymentCustomer,
				PaymentMethod,
				PaymentOrder,
				PaymentEntitlement,
				PaymentSubscription,
				PaymentEvent,
				PaymentSignup,
				ApiKey,
				MediaLibrary,
				MediaItem,
				MediaSegment,
				NetworkShare,
				WatchProgress,
				Favorite,
				Playlist,
				PlaylistItem,
				ListeningHistory,
				MediaCredit,
				PersonProfile,
				Notification,
				PushSubscription,
				PushKey,
				PluginRepository,
				PluginInstallation,
				PluginUpdateHistory,
				PluginStorageEntry,
				MediaRequest,
				RequestService,
				RequestUserLimit,
				PluginSecret,
				GuideSource,
				MailServerSettings,
				MailDomain,
				Mailbox,
				MailMessage,
				GuideSettings,
				GuideProgramme,
				AiRecommendationCache,
				QuickConnectRequest,
				Theme,
				ThemeVersion,
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
				RestoreCoreRequests1795300000000,
				CreateSocial1795400000000,
				CreateChat1795500000000,
				CreateNativePasskeyHandoffs1795600000000,
				AddFriendshipsAndProfileVisibility1795700000000,
				AddFriendInviteTokens1795800000000,
				CreateSocialFriendInvites1795900000000,
				CreateMediaSearchOutbox1796100000000,
				AddMediaSearchReset1796200000000,
				AddMediaSearchContent1796300000000,
				CreateGuideSources1796400000000,
				CreateGuideProgrammes1796500000000,
				CreateAiRecommendationCaches1796600000000,
				AddAiRecommendationCacheScopes1796700000000,
				AddRequestWebhookToken1796800000000,
				CreateIssueReports1796900000000,
				AddChatMls1797000000000,
				EnsureChatMessageSequence1797100000000,
				RepairChatMlsDevicePairingKey1797200000000,
				RepairChatMlsDeviceApproval1797300000000,
				RepairChatMlsWelcomeMessage1797400000000,
				RepairChatMlsWelcomeColumns1797500000000,
				RepairChatMlsWelcomeSchema1797600000000,
				CreateChatMlsHistoryBackups1797700000000,
				AddChatMessageEncryption1797800000000,
				AddChatConversationEncryption1797900000000,
				CreateMailServer1798000000000,
				AddUserOriginalAccess1798100000000,
				CreateUserAccessPolicies1798200000000,
				CreatePayments1798300000000,
				CreatePaymentSignups1798300000001,
				AddPaymentProductRequiresPurchase1798300000002,
				AddTrailerCacheSetting1798300000003,
				NormalizeChapterTitles1798300000004,
				CreateAdvertisements1798300000005,
				CreateAdvertisementAnalytics1798300000006,
				CreateViewingAnalytics1798300000007,
				CreateListeningAnalytics1798300000008,
				CreateUserWebhooks1798300000009,
				DefaultUserWebhookUrlRules1798300000010,
				CreateMediaSourceGroups1798300000011,
				CreateQuickConnectRequests1798300000012,
				CreateThemes1798300000013,
				CreateThemeVersions1798300000014,
				CreateOidcProvider1798300000015,
				RepairOidcConfiguration1798300000016,
				CreateOidcConsents1798300000017,
				AddOidcSubscriptionSharing1798300000018,
				AddOidcResourceScopes1798300000019,
				RemoveOidcSubscriptionClaim1798300000020,
			],
			synchronize: false,
			migrationsRun: false,
		});

		await dataSource.initialize();
		await dataSource.runMigrations();
		await synchronizeSettings(dataSource);
		const requestLoggingSetting = await dataSource.getRepository(Setting).findOneBy({ key: LOG_SUCCESSFUL_API_REQUESTS_SETTING });
		setLogSuccessfulApiRequests(requestLoggingSetting?.value === true);
		await cleanupExpiredUserSessions(dataSource);
		await cleanupExpiredOidcArtifacts(dataSource);
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
