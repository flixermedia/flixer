import { injectable, logger } from "@tsed/di";
import { DataSource } from "typeorm";
import { LOG_SUCCESSFUL_API_REQUESTS_SETTING, setLogSuccessfulApiRequests } from "../config/logger/requestLog.ts";
import { loadSecuritySettings } from "../config/loadSecuritySettings.ts";
import { User } from "../entities/user.entity.ts";
import { UserSession } from "../entities/userSession.entity.ts";
import { ExternalIdentity } from "../entities/externalIdentity.entity.ts";
import { ExternalAuthFlow } from "../entities/externalAuthFlow.entity.ts";
import { ExternalOAuthProvider } from "../entities/externalOAuthProvider.entity.ts";
import { CreateExternalIdentities1798300000021 } from "../migrations/createExternalIdentities1798300000021.ts";
import { CreateExternalAuthFlows1798300000022 } from "../migrations/createExternalAuthFlows1798300000022.ts";
import { LinkExternalAuthToPlugin1798300000023 } from "../migrations/linkExternalAuthToPlugin1798300000023.ts";
import { AddExternalAuthFlowNonce1798300000024 } from "../migrations/addExternalAuthFlowNonce1798300000024.ts";
import { AddExternalAuthFlowRedirectUri1798300000025 } from "../migrations/addExternalAuthFlowRedirectUri1798300000025.ts";
import { CreateExternalOAuthProviders1798300000026 } from "../migrations/createExternalOAuthProviders1798300000026.ts";
import { CreatePlaybackHistory1798300000027 } from "../migrations/createPlaybackHistory1798300000027.ts";
import { CreateUserMediaFeatures1798300000028 } from "../migrations/createUserMediaFeatures1798300000028.ts";
import { RepairPlaybackHistory1798300000029 } from "../migrations/repairPlaybackHistory1798300000029.ts";
import { AddMediaMatchConfidence1798300000030 } from "../migrations/addMediaMatchConfidence1798300000030.ts";
import { AddNetworkShareRegion1798300000031 } from "../migrations/addNetworkShareRegion1798300000031.ts";
import { MediaOrganizationPlan, MediaOrganizationPlanAudit, MediaOrganizationSettings } from "../entities/mediaOrganization.entity.ts";
import { CreateMediaOrganization1798300000032 } from "../migrations/createMediaOrganization1798300000032.ts";
import { AddMediaItemContentHash1798300000033 } from "../migrations/addMediaItemContentHash1798300000033.ts";
import { AddMediaLibraryWritePermissions1798300000034 } from "../migrations/addMediaLibraryWritePermissions1798300000034.ts";
import { Setting } from "../entities/setting.entity.ts";
import { UserPreference } from "../entities/userPreference.entity.ts";
import { UserAccessPolicy } from "../entities/userAccessPolicy.entity.ts";
import { GuideSettings, GuideSource } from "../entities/guideSource.entity.ts";
import { GuideProgramme } from "../entities/guideProgramme.entity.ts";
import { MailServerSettings } from "../entities/mailServerSettings.entity.ts";
import { MailDomain } from "../entities/mailDomain.entity.ts";
import { Mailbox } from "../entities/mailbox.entity.ts";
import { MailMessage } from "../entities/mailMessage.entity.ts";
import { CreateMailServer1798000000000 } from "../migrations/createMailServer1798000000000.ts";
import { CreateUserAccessPolicies1798200000000 } from "../migrations/createUserAccessPolicies1798200000000.ts";
import { CreatePayments1798300000000 } from "../migrations/createPayments1798300000000.ts";
import { CreatePaymentSignups1798300000001 } from "../migrations/createPaymentSignups1798300000001.ts";
import { AddPaymentProductRequiresPurchase1798300000002 } from "../migrations/addPaymentProductRequiresPurchase1798300000002.ts";
import { AddTrailerCacheSetting1798300000003 } from "../migrations/addTrailerCacheSetting1798300000003.ts";
import { NormalizeChapterTitles1798300000004 } from "../migrations/normalizeChapterTitles1798300000004.ts";
import { CreateAdvertisements1798300000005 } from "../migrations/createAdvertisements1798300000005.ts";
import { CreateAdvertisementAnalytics1798300000006 } from "../migrations/createAdvertisementAnalytics1798300000006.ts";
import { CreateViewingAnalytics1798300000007 } from "../migrations/createViewingAnalytics1798300000007.ts";
import { CreateListeningAnalytics1798300000008 } from "../migrations/createListeningAnalytics1798300000008.ts";
import { CreateUserWebhooks1798300000009 } from "../migrations/createUserWebhooks1798300000009.ts";
import { DefaultUserWebhookUrlRules1798300000010 } from "../migrations/defaultUserWebhookUrlRules1798300000010.ts";
import { CreateMediaSourceGroups1798300000011 } from "../migrations/createMediaSourceGroups1798300000011.ts";
import { CreateQuickConnectRequests1798300000012 } from "../migrations/createQuickConnectRequests1798300000012.ts";
import { CreateThemes1798300000013 } from "../migrations/createThemes1798300000013.ts";
import { CreateThemeVersions1798300000014 } from "../migrations/createThemeVersions1798300000014.ts";
import { CreateOidcProvider1798300000015 } from "../migrations/createOidcProvider1798300000015.ts";
import { RepairOidcConfiguration1798300000016 } from "../migrations/repairOidcConfiguration1798300000016.ts";
import { CreateOidcConsents1798300000017 } from "../migrations/createOidcConsents1798300000017.ts";
import { AddOidcSubscriptionSharing1798300000018 } from "../migrations/addOidcSubscriptionSharing1798300000018.ts";
import { AddOidcResourceScopes1798300000019 } from "../migrations/addOidcResourceScopes1798300000019.ts";
import { RemoveOidcSubscriptionClaim1798300000020 } from "../migrations/removeOidcSubscriptionClaim1798300000020.ts";
import { cleanupExpiredOidcArtifacts } from "../api/oidc/oidcCleanup.ts";
import { Advertisement } from "../entities/advertisement.entity.ts";
import { AdvertisementSettings } from "../entities/advertisementSettings.entity.ts";
import { PaymentConfigRow } from "../entities/paymentConfig.entity.ts";
import { PaymentProduct } from "../entities/paymentProduct.entity.ts";
import { PaymentPlan } from "../entities/paymentPlan.entity.ts";
import { PaymentCoupon } from "../entities/paymentCoupon.entity.ts";
import { PaymentCustomer } from "../entities/paymentCustomer.entity.ts";
import { PaymentMethod } from "../entities/paymentMethod.entity.ts";
import { PaymentOrder } from "../entities/paymentOrder.entity.ts";
import { PaymentEntitlement } from "../entities/paymentEntitlement.entity.ts";
import { PaymentSubscription } from "../entities/paymentSubscription.entity.ts";
import { PaymentEvent } from "../entities/paymentEvent.entity.ts";
import { PaymentSignup } from "../entities/paymentSignup.entity.ts";
import { AddUserOriginalAccess1798100000000 } from "../migrations/addUserOriginalAccess1798100000000.ts";
import { ApiKey } from "../entities/apiKey.entity.ts";
import { MediaLibrary } from "../entities/mediaLibrary.entity.ts";
import { MediaItem } from "../entities/mediaItem.entity.ts";
import { NetworkShare } from "../entities/networkShare.entity.ts";
import { WatchProgress } from "../entities/watchProgress.entity.ts";
import { Favorite } from "../entities/favorite.entity.ts";
import { Playlist } from "../entities/playlist.entity.ts";
import { PlaylistItem } from "../entities/playlistItem.entity.ts";
import { ListeningHistory } from "../entities/listeningHistory.entity.ts";
import { CreateChat1795500000000 } from "../migrations/createChat1795500000000.ts";
import { CreateNativePasskeyHandoffs1795600000000 } from "../migrations/createNativePasskeyHandoffs1795600000000.ts";
import { AddFriendshipsAndProfileVisibility1795700000000 } from "../migrations/addFriendshipsAndProfileVisibility1795700000000.ts";
import { AddFriendInviteTokens1795800000000 } from "../migrations/addFriendInviteTokens1795800000000.ts";
import { CreateSocialFriendInvites1795900000000 } from "../migrations/createSocialFriendInvites1795900000000.ts";
import { AddMediaSearchReset1796200000000 } from "../migrations/addMediaSearchReset1796200000000.ts";
import { AddMediaSearchContent1796300000000 } from "../migrations/addMediaSearchContent1796300000000.ts";
import { CreateGuideSources1796400000000 } from "../migrations/createGuideSources1796400000000.ts";
import { CreateGuideProgrammes1796500000000 } from "../migrations/createGuideProgrammes1796500000000.ts";
import { CreateSocial1795400000000 } from "../migrations/createSocial1795400000000.ts";
import { MediaCredit } from "../entities/mediaCredit.entity.ts";
import { PersonProfile } from "../entities/personProfile.entity.ts";
import { Notification } from "../entities/notification.entity.ts";
import { PushSubscription } from "../entities/pushSubscription.entity.ts";
import { PushKey } from "../entities/pushKey.entity.ts";
import { AddRequestServiceLibrary1794700000000 } from "../migrations/addRequestServiceLibrary1794700000000.ts";
import { CreateMediaRequests1794600000000 } from "../migrations/createMediaRequests1794600000000.ts";
import { CreateNotifications1794400000000 } from "../migrations/createNotifications1794400000000.ts";
import { CreatePersonProfiles1794200000000 } from "../migrations/createPersonProfiles1794200000000.ts";
import { AddPersonProfileImage1794300000000 } from "../migrations/addPersonProfileImage1794300000000.ts";
import { AddMediaCreditImage1794100000000 } from "../migrations/addMediaCreditImage1794100000000.ts";
import { AddMediaCreditPersonId1794000000000 } from "../migrations/addMediaCreditPersonId1794000000000.ts";
import { CreateMediaCredits1793900000000 } from "../migrations/createMediaCredits1793900000000.ts";
import { CreateMediaSegments1794500000000 } from "../migrations/createMediaSegments1794500000000.ts";
import { MediaSegment } from "../entities/mediaSegment.entity.ts";
import { PluginInstallation } from "../entities/pluginInstallation.entity.ts";
import { PluginRepository } from "../entities/pluginRepository.entity.ts";
import { PluginUpdateHistory } from "../entities/pluginUpdateHistory.entity.ts";
import { PluginStorageEntry } from "../entities/pluginStorageEntry.entity.ts";
import { PluginSecret } from "../entities/pluginSecret.entity.ts";
import { MediaRequest } from "../entities/mediaRequest.entity.ts";
import { RequestService } from "../entities/requestService.entity.ts";
import { RequestUserLimit } from "../entities/requestUserLimit.entity.ts";
import { RestoreCoreRequests1795300000000 } from "../migrations/restoreCoreRequests1795300000000.ts";
import { CreatePluginSecrets1795100000000 } from "../migrations/createPluginSecrets1795100000000.ts";
import { CreatePluginManager1794800000000 } from "../migrations/createPluginManager1794800000000.ts";
import { CreatePluginUpdateHistory1794900000000 } from "../migrations/createPluginUpdateHistory1794900000000.ts";
import { CreatePluginStorage1795000000000 } from "../migrations/createPluginStorage1795000000000.ts";
import { CreateWatchProgress1793800000000 } from "../migrations/createWatchProgress1793800000000.ts";
import { CreateNetworkShares1793600000000 } from "../migrations/createNetworkShares1793600000000.ts";
import { AddMediaItemLastSeenAt1793700000000 } from "../migrations/addMediaItemLastSeenAt1793700000000.ts";
import { CreateMediaItems1793400000000 } from "../migrations/createMediaItems1793400000000.ts";
import { AddMediaItemEditedFields1793500000000 } from "../migrations/addMediaItemEditedFields1793500000000.ts";
import { CreateMediaSearchOutbox1796100000000 } from "../migrations/createMediaSearchOutbox1796100000000.ts";
import { CreateMediaLibraries1793300000000 } from "../migrations/createMediaLibraries1793300000000.ts";
import { AddDevicesAndApiKeys1793100000000 } from "../migrations/addDevicesAndApiKeys1793100000000.ts";
import { AddUserDisabledAt1793200000000 } from "../migrations/addUserDisabledAt1793200000000.ts";
import { PasskeyChallenge } from "../entities/passkeyChallenge.entity.ts";
import { PasskeyCredential } from "../entities/passkeyCredential.entity.ts";
import { NativePasskeyHandoff } from "../entities/nativePasskeyHandoff.entity.ts";
import { AddUsername1792190000000 } from "../migrations/addUsername1792190000000.ts";
import { AddUserRole1792190300000 } from "../migrations/addUserRole1792190300000.ts";
import { CreateUserSessions1792191000000 } from "../migrations/createUserSessions1792191000000.ts";
import { CreateUsersTable1792186500000 } from "../migrations/createUsersTable1792186500000.ts";
import { CreateSettings1792238400000 } from "../migrations/createSettings1792238400000.ts";
import { CreatePasskeys1792300000000 } from "../migrations/createPasskeys1792300000000.ts";
import { AddUserDisplayName1792400000000 } from "../migrations/addUserDisplayName1792400000000.ts";
import { AddUserEmailVerified1792500000000 } from "../migrations/addUserEmailVerified1792500000000.ts";
import { AddUserPendingEmail1792600000000 } from "../migrations/addUserPendingEmail1792600000000.ts";
import { AddUserPasskeyRequired1792700000000 } from "../migrations/addUserPasskeyRequired1792700000000.ts";
import { AddUserAvatar1792800000000 } from "../migrations/addUserAvatar1792800000000.ts";
import { CreateUserPreferences1792900000000 } from "../migrations/createUserPreferences1792900000000.ts";
import { MoveUserSettingsToPreferences1793000000000 } from "../migrations/moveUserSettingsToPreferences1793000000000.ts";
import { synchronizeSettings } from "../config/settingsSync.ts";
import { appConfig } from "../config/store/appConfig.ts";
import { cleanupExpiredUserSessions } from "../jobs/sessionCleanupJob.ts";
import { AiRecommendationCache } from "../entities/aiRecommendationCache.entity.ts";
import { QuickConnectRequest } from "../entities/quickConnectRequest.entity.ts";
import { Theme } from "../entities/theme.entity.ts";
import { ThemeVersion } from "../entities/themeVersion.entity.ts";
import { PlaybackHistory } from "../entities/playbackHistory.entity.ts";
import { CreateAiRecommendationCaches1796600000000 } from "../migrations/createAiRecommendationCaches1796600000000.ts";
import { AddAiRecommendationCacheScopes1796700000000 } from "../migrations/addAiRecommendationCacheScopes1796700000000.ts";
import { AddRequestWebhookToken1796800000000 } from "../migrations/addRequestWebhookToken1796800000000.ts";
import { CreateIssueReports1796900000000 } from "../migrations/createIssueReports1796900000000.ts";
import { AddChatMls1797000000000 } from "../migrations/addChatMls1797000000000.ts";
import { EnsureChatMessageSequence1797100000000 } from "../migrations/ensureChatMessageSequence1797100000000.ts";
import { RepairChatMlsDevicePairingKey1797200000000 } from "../migrations/repairChatMlsDevicePairingKey1797200000000.ts";
import { RepairChatMlsDeviceApproval1797300000000 } from "../migrations/repairChatMlsDeviceApproval1797300000000.ts";
import { RepairChatMlsWelcomeMessage1797400000000 } from "../migrations/repairChatMlsWelcomeMessage1797400000000.ts";
import { RepairChatMlsWelcomeColumns1797500000000 } from "../migrations/repairChatMlsWelcomeColumns1797500000000.ts";
import { RepairChatMlsWelcomeSchema1797600000000 } from "../migrations/repairChatMlsWelcomeSchema1797600000000.ts";
import { CreateChatMlsHistoryBackups1797700000000 } from "../migrations/createChatMlsHistoryBackups1797700000000.ts";
import { AddChatMessageEncryption1797800000000 } from "../migrations/addChatMessageEncryption1797800000000.ts";
import { AddChatConversationEncryption1797900000000 } from "../migrations/addChatConversationEncryption1797900000000.ts";

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
				ExternalIdentity,
				ExternalAuthFlow,
				ExternalOAuthProvider,
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
				PlaybackHistory,
				MediaOrganizationSettings,
				MediaOrganizationPlan,
				MediaOrganizationPlanAudit,
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
				CreateExternalIdentities1798300000021,
				CreateExternalAuthFlows1798300000022,
				LinkExternalAuthToPlugin1798300000023,
				AddExternalAuthFlowNonce1798300000024,
				AddExternalAuthFlowRedirectUri1798300000025,
				CreateExternalOAuthProviders1798300000026,
				CreatePlaybackHistory1798300000027,
				CreateUserMediaFeatures1798300000028,
				RepairPlaybackHistory1798300000029,
				AddMediaMatchConfidence1798300000030,
				AddNetworkShareRegion1798300000031,
				CreateMediaOrganization1798300000032,
				AddMediaItemContentHash1798300000033,
				AddMediaLibraryWritePermissions1798300000034,
			],
			synchronize: false,
			migrationsRun: false,
		});

		await dataSource.initialize();
		await dataSource.runMigrations();
		await synchronizeSettings(dataSource);
		const requestLoggingSetting = await dataSource.getRepository(Setting).findOneBy({ key: LOG_SUCCESSFUL_API_REQUESTS_SETTING });
		setLogSuccessfulApiRequests(requestLoggingSetting?.value === true);
		await loadSecuritySettings(dataSource, (message) => logger().warn(message));
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
