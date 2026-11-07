export declare const routes: readonly [{
    readonly method: "post";
    readonly path: "/admin/mail/mailboxes/generate-user-addresses";
    readonly operationId: "adminMailControllerGenerateUserAddresses";
    readonly pathParameters: readonly [];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "post";
    readonly path: "/admin/database-transfer/restore-writes";
    readonly operationId: "adminDatabaseTransferControllerRestoreWrites";
    readonly pathParameters: readonly [];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "post";
    readonly path: "/auth/passkeys/native-handoff/exchange";
    readonly operationId: "passkeyControllerExchangeNativeHandoff";
    readonly pathParameters: readonly [];
    readonly hasBody: true;
    readonly hasQuery: false;
}, {
    readonly method: "post";
    readonly path: "/auth/passkeys/native-handoff/options";
    readonly operationId: "passkeyControllerNativeHandoffOptions";
    readonly pathParameters: readonly [];
    readonly hasBody: true;
    readonly hasQuery: false;
}, {
    readonly method: "post";
    readonly path: "/auth/passkeys/second-factor/options";
    readonly operationId: "passkeyControllerSecondFactorOptions";
    readonly pathParameters: readonly [];
    readonly hasBody: true;
    readonly hasQuery: false;
}, {
    readonly method: "post";
    readonly path: "/auth/passkeys/native-handoff/verify";
    readonly operationId: "passkeyControllerVerifyNativeHandoff";
    readonly pathParameters: readonly [];
    readonly hasBody: true;
    readonly hasQuery: false;
}, {
    readonly method: "post";
    readonly path: "/auth/passkeys/second-factor/verify";
    readonly operationId: "passkeyControllerSecondFactorVerify";
    readonly pathParameters: readonly [];
    readonly hasBody: true;
    readonly hasQuery: false;
}, {
    readonly method: "post";
    readonly path: "/auth/passkeys/native-handoff/start";
    readonly operationId: "passkeyControllerStartNativeHandoff";
    readonly pathParameters: readonly [];
    readonly hasBody: true;
    readonly hasQuery: false;
}, {
    readonly method: "get";
    readonly path: "/internal/ai/runtime-configuration";
    readonly operationId: "aiControllerRuntimeConfiguration";
    readonly pathParameters: readonly [];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "delete";
    readonly path: "/internal/ai/recommendation-cache";
    readonly operationId: "aiControllerClearRecommendationCache";
    readonly pathParameters: readonly [];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "put";
    readonly path: "/notifications/push/subscription";
    readonly operationId: "notificationsControllerSubscribe";
    readonly pathParameters: readonly [];
    readonly hasBody: true;
    readonly hasQuery: false;
}, {
    readonly method: "post";
    readonly path: "/auth/passkeys/register/options";
    readonly operationId: "passkeyControllerRegistrationOptions";
    readonly pathParameters: readonly [];
    readonly hasBody: true;
    readonly hasQuery: false;
}, {
    readonly method: "post";
    readonly path: "/notifications/push/unsubscribe";
    readonly operationId: "notificationsControllerUnsubscribe";
    readonly pathParameters: readonly [];
    readonly hasBody: true;
    readonly hasQuery: false;
}, {
    readonly method: "post";
    readonly path: "/auth/passkeys/register/verify";
    readonly operationId: "passkeyControllerRegistrationVerify";
    readonly pathParameters: readonly [];
    readonly hasBody: true;
    readonly hasQuery: false;
}, {
    readonly method: "post";
    readonly path: "/admin/requests/webhook/rotate";
    readonly operationId: "adminRequestsControllerRotateWebhookCredentials";
    readonly pathParameters: readonly [];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "get";
    readonly path: "/admin/media-libraries/browse";
    readonly operationId: "mediaLibrariesControllerBrowse";
    readonly pathParameters: readonly [];
    readonly hasBody: false;
    readonly hasQuery: true;
}, {
    readonly method: "get";
    readonly path: "/indexer/media/intro-segments";
    readonly operationId: "indexerApiControllerExistingIntroSegments";
    readonly pathParameters: readonly [];
    readonly hasBody: false;
    readonly hasQuery: true;
}, {
    readonly method: "post";
    readonly path: "/indexer/media/intro-segments";
    readonly operationId: "indexerApiControllerUpdateIntroSegments";
    readonly pathParameters: readonly [];
    readonly hasBody: true;
    readonly hasQuery: false;
}, {
    readonly method: "post";
    readonly path: "/admin/requests/services/test";
    readonly operationId: "adminRequestsControllerTestService";
    readonly pathParameters: readonly [];
    readonly hasBody: true;
    readonly hasQuery: false;
}, {
    readonly method: "get";
    readonly path: "/admin/network-shares/support";
    readonly operationId: "networkSharesControllerSupport";
    readonly pathParameters: readonly [];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "get";
    readonly path: "/admin/payments/subscriptions";
    readonly operationId: "adminPaymentsControllerSubscriptions";
    readonly pathParameters: readonly [];
    readonly hasBody: false;
    readonly hasQuery: true;
}, {
    readonly method: "get";
    readonly path: "/internal/ai/library-context";
    readonly operationId: "aiControllerLibraryContext";
    readonly pathParameters: readonly [];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "post";
    readonly path: "/auth/passkeys/login/options";
    readonly operationId: "passkeyControllerLoginOptions";
    readonly pathParameters: readonly [];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "get";
    readonly path: "/admin/media-libraries/roots";
    readonly operationId: "mediaLibrariesControllerListRoots";
    readonly pathParameters: readonly [];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "get";
    readonly path: "/admin/payments/scope-search";
    readonly operationId: "adminPaymentsControllerScopeSearch";
    readonly pathParameters: readonly [];
    readonly hasBody: false;
    readonly hasQuery: true;
}, {
    readonly method: "get";
    readonly path: "/recommendations/home/music";
    readonly operationId: "recommendationsControllerMusicRecommendations";
    readonly pathParameters: readonly [];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "post";
    readonly path: "/auth/passkeys/login/verify";
    readonly operationId: "passkeyControllerLoginVerify";
    readonly pathParameters: readonly [];
    readonly hasBody: true;
    readonly hasQuery: false;
}, {
    readonly method: "get";
    readonly path: "/admin/plugins/repositories";
    readonly operationId: "pluginsControllerRepositories";
    readonly pathParameters: readonly [];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "post";
    readonly path: "/admin/plugins/repositories";
    readonly operationId: "pluginsControllerAddRepository";
    readonly pathParameters: readonly [];
    readonly hasBody: true;
    readonly hasQuery: false;
}, {
    readonly method: "post";
    readonly path: "/admin/payments/config/test";
    readonly operationId: "adminPaymentsControllerTest";
    readonly pathParameters: readonly [];
    readonly hasBody: true;
    readonly hasQuery: false;
}, {
    readonly method: "put";
    readonly path: "/admin/indexer/concurrency";
    readonly operationId: "adminIndexerControllerSetConcurrency";
    readonly pathParameters: readonly [];
    readonly hasBody: true;
    readonly hasQuery: false;
}, {
    readonly method: "get";
    readonly path: "/notifications/push/status";
    readonly operationId: "notificationsControllerPushStatus";
    readonly pathParameters: readonly [];
    readonly hasBody: false;
    readonly hasQuery: true;
}, {
    readonly method: "get";
    readonly path: "/admin/payments/currencies";
    readonly operationId: "adminPaymentsControllerCurrencies";
    readonly pathParameters: readonly [];
    readonly hasBody: false;
    readonly hasQuery: true;
}, {
    readonly method: "get";
    readonly path: "/admin/ai/recommendations";
    readonly operationId: "aiAdminControllerRecommendations";
    readonly pathParameters: readonly [];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "patch";
    readonly path: "/auth/me/passkey-required";
    readonly operationId: "authControllerSetPasskeyRequired";
    readonly pathParameters: readonly [];
    readonly hasBody: true;
    readonly hasQuery: false;
}, {
    readonly method: "post";
    readonly path: "/auth/resend-verification";
    readonly operationId: "authControllerResendVerification";
    readonly pathParameters: readonly [];
    readonly hasBody: true;
    readonly hasQuery: false;
}, {
    readonly method: "get";
    readonly path: "/indexer/media/intro-sync";
    readonly operationId: "indexerApiControllerIntroSyncCandidates";
    readonly pathParameters: readonly [];
    readonly hasBody: false;
    readonly hasQuery: true;
}, {
    readonly method: "put";
    readonly path: "/admin/backups/passphrase";
    readonly operationId: "adminBackupsControllerSetPassphrase";
    readonly pathParameters: readonly [];
    readonly hasBody: true;
    readonly hasQuery: false;
}, {
    readonly method: "delete";
    readonly path: "/admin/backups/passphrase";
    readonly operationId: "adminBackupsControllerClearPassphrase";
    readonly pathParameters: readonly [];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "post";
    readonly path: "/payments/signup/complete";
    readonly operationId: "paymentsControllerSignupComplete";
    readonly pathParameters: readonly [];
    readonly hasBody: true;
    readonly hasQuery: false;
}, {
    readonly method: "get";
    readonly path: "/requests/images/discogs";
    readonly operationId: "requestImagesControllerDiscogs";
    readonly pathParameters: readonly [];
    readonly hasBody: false;
    readonly hasQuery: true;
}, {
    readonly method: "get";
    readonly path: "/admin/requests/services";
    readonly operationId: "adminRequestsControllerListServices";
    readonly pathParameters: readonly [];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "post";
    readonly path: "/admin/requests/services";
    readonly operationId: "adminRequestsControllerCreateService";
    readonly pathParameters: readonly [];
    readonly hasBody: true;
    readonly hasQuery: false;
}, {
    readonly method: "get";
    readonly path: "/admin/database-transfer";
    readonly operationId: "adminDatabaseTransferControllerStatus";
    readonly pathParameters: readonly [];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "post";
    readonly path: "/admin/database-transfer";
    readonly operationId: "adminDatabaseTransferControllerStart";
    readonly pathParameters: readonly [];
    readonly hasBody: true;
    readonly hasQuery: false;
}, {
    readonly method: "get";
    readonly path: "/admin/overview/activity";
    readonly operationId: "overviewControllerActivityList";
    readonly pathParameters: readonly [];
    readonly hasBody: false;
    readonly hasQuery: true;
}, {
    readonly method: "get";
    readonly path: "/admin/payments/products";
    readonly operationId: "adminPaymentsControllerProducts";
    readonly pathParameters: readonly [];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "post";
    readonly path: "/admin/payments/products";
    readonly operationId: "adminPaymentsControllerCreateProduct";
    readonly pathParameters: readonly [];
    readonly hasBody: true;
    readonly hasQuery: false;
}, {
    readonly method: "post";
    readonly path: "/setup/recovery/request";
    readonly operationId: "setupControllerRequestRecoveryKey";
    readonly pathParameters: readonly [];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "put";
    readonly path: "/admin/ai/configuration";
    readonly operationId: "aiAdminControllerUpdateConfiguration";
    readonly pathParameters: readonly [];
    readonly hasBody: true;
    readonly hasQuery: false;
}, {
    readonly method: "get";
    readonly path: "/admin/requests/webhook";
    readonly operationId: "adminRequestsControllerGetWebhookCredentials";
    readonly pathParameters: readonly [];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "get";
    readonly path: "/notifications/push/key";
    readonly operationId: "notificationsControllerPushKey";
    readonly pathParameters: readonly [];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "get";
    readonly path: "/chat/encryption/status";
    readonly operationId: "chatControllerEncryptionStatus";
    readonly pathParameters: readonly [];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "post";
    readonly path: "/admin/mail/diagnostics";
    readonly operationId: "adminMailControllerDiagnostics";
    readonly pathParameters: readonly [];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "post";
    readonly path: "/payments/methods/setup";
    readonly operationId: "paymentsControllerBeginMethod";
    readonly pathParameters: readonly [];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "get";
    readonly path: "/admin/payments/coupons";
    readonly operationId: "adminPaymentsControllerCoupons";
    readonly pathParameters: readonly [];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "post";
    readonly path: "/admin/payments/coupons";
    readonly operationId: "adminPaymentsControllerCreateCoupon";
    readonly pathParameters: readonly [];
    readonly hasBody: true;
    readonly hasQuery: false;
}, {
    readonly method: "get";
    readonly path: "/settings/registration";
    readonly operationId: "settingsControllerRegistrationStatus";
    readonly pathParameters: readonly [];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "get";
    readonly path: "/admin/scheduled-tasks";
    readonly operationId: "adminScheduledTasksControllerList";
    readonly pathParameters: readonly [];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "get";
    readonly path: "/admin/media-libraries";
    readonly operationId: "mediaLibrariesControllerList";
    readonly pathParameters: readonly [];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "post";
    readonly path: "/admin/media-libraries";
    readonly operationId: "mediaLibrariesControllerCreate";
    readonly pathParameters: readonly [];
    readonly hasBody: true;
    readonly hasQuery: false;
}, {
    readonly method: "post";
    readonly path: "/admin/indexer/refresh";
    readonly operationId: "adminIndexerControllerRefresh";
    readonly pathParameters: readonly [];
    readonly hasBody: true;
    readonly hasQuery: false;
}, {
    readonly method: "get";
    readonly path: "/admin/plugins/catalog";
    readonly operationId: "pluginsControllerCatalog";
    readonly pathParameters: readonly [];
    readonly hasBody: false;
    readonly hasQuery: true;
}, {
    readonly method: "put";
    readonly path: "/admin/search/settings";
    readonly operationId: "adminMediaSearchControllerSaveSettings";
    readonly pathParameters: readonly [];
    readonly hasBody: true;
    readonly hasQuery: false;
}, {
    readonly method: "post";
    readonly path: "/profiles/me/listening";
    readonly operationId: "profilesControllerListening";
    readonly pathParameters: readonly [];
    readonly hasBody: true;
    readonly hasQuery: false;
}, {
    readonly method: "post";
    readonly path: "/payments/signup/setup";
    readonly operationId: "paymentsControllerSignupSetup";
    readonly pathParameters: readonly [];
    readonly hasBody: true;
    readonly hasQuery: false;
}, {
    readonly method: "get";
    readonly path: "/admin/payments/config";
    readonly operationId: "adminPaymentsControllerGetConfig";
    readonly pathParameters: readonly [];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "put";
    readonly path: "/admin/payments/config";
    readonly operationId: "adminPaymentsControllerPutConfig";
    readonly pathParameters: readonly [];
    readonly hasBody: true;
    readonly hasQuery: false;
}, {
    readonly method: "get";
    readonly path: "/admin/payments/orders";
    readonly operationId: "adminPaymentsControllerOrders";
    readonly pathParameters: readonly [];
    readonly hasBody: false;
    readonly hasQuery: true;
}, {
    readonly method: "get";
    readonly path: "/recommendations/home";
    readonly operationId: "recommendationsControllerHomeRecommendations";
    readonly pathParameters: readonly [];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "put";
    readonly path: "/admin/guide/channels";
    readonly operationId: "adminGuideControllerUpdateChannels";
    readonly pathParameters: readonly [];
    readonly hasBody: true;
    readonly hasQuery: false;
}, {
    readonly method: "put";
    readonly path: "/admin/guide/settings";
    readonly operationId: "adminGuideControllerUpdateSettings";
    readonly pathParameters: readonly [];
    readonly hasBody: true;
    readonly hasQuery: false;
}, {
    readonly method: "get";
    readonly path: "/streamer/media-roots";
    readonly operationId: "streamerRootsControllerList";
    readonly pathParameters: readonly [];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "get";
    readonly path: "/streamer/transcoding";
    readonly operationId: "streamerRootsControllerTranscoding";
    readonly pathParameters: readonly [];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "get";
    readonly path: "/admin/indexer/status";
    readonly operationId: "adminIndexerControllerStatus";
    readonly pathParameters: readonly [];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "get";
    readonly path: "/admin/requests/users";
    readonly operationId: "adminRequestsControllerListUsers";
    readonly pathParameters: readonly [];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "post";
    readonly path: "/admin/search/rebuild";
    readonly operationId: "adminMediaSearchControllerRebuild";
    readonly pathParameters: readonly [];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "get";
    readonly path: "/admin/network-shares";
    readonly operationId: "networkSharesControllerList";
    readonly pathParameters: readonly [];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "post";
    readonly path: "/admin/network-shares";
    readonly operationId: "networkSharesControllerCreate";
    readonly pathParameters: readonly [];
    readonly hasBody: true;
    readonly hasQuery: false;
}, {
    readonly method: "get";
    readonly path: "/admin/access/options";
    readonly operationId: "adminAccessControllerOptions";
    readonly pathParameters: readonly [];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "get";
    readonly path: "/notifications/config";
    readonly operationId: "notificationsControllerConfig";
    readonly pathParameters: readonly [];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "post";
    readonly path: "/admin/backups/upload";
    readonly operationId: "adminBackupsControllerUpload";
    readonly pathParameters: readonly [];
    readonly hasBody: true;
    readonly hasQuery: false;
}, {
    readonly method: "get";
    readonly path: "/admin/mail/mailboxes";
    readonly operationId: "adminMailControllerListMailboxes";
    readonly pathParameters: readonly [];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "post";
    readonly path: "/admin/mail/mailboxes";
    readonly operationId: "adminMailControllerCreateMailbox";
    readonly pathParameters: readonly [];
    readonly hasBody: true;
    readonly hasQuery: false;
}, {
    readonly method: "get";
    readonly path: "/admin/mail/templates";
    readonly operationId: "adminMailControllerListTemplates";
    readonly pathParameters: readonly [];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "get";
    readonly path: "/admin/payments/stats";
    readonly operationId: "adminPaymentsControllerStats";
    readonly pathParameters: readonly [];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "get";
    readonly path: "/admin/payments/plans";
    readonly operationId: "adminPaymentsControllerPlans";
    readonly pathParameters: readonly [];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "post";
    readonly path: "/admin/payments/plans";
    readonly operationId: "adminPaymentsControllerCreatePlan";
    readonly pathParameters: readonly [];
    readonly hasBody: true;
    readonly hasQuery: false;
}, {
    readonly method: "post";
    readonly path: "/settings/email/test";
    readonly operationId: "settingsControllerSendTestEmail";
    readonly pathParameters: readonly [];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "get";
    readonly path: "/admin/guide/sources";
    readonly operationId: "adminGuideControllerSources";
    readonly pathParameters: readonly [];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "post";
    readonly path: "/admin/guide/sources";
    readonly operationId: "adminGuideControllerCreateSource";
    readonly pathParameters: readonly [];
    readonly hasBody: true;
    readonly hasQuery: false;
}, {
    readonly method: "post";
    readonly path: "/indexer/media/items";
    readonly operationId: "indexerApiControllerUpsertItem";
    readonly pathParameters: readonly [];
    readonly hasBody: true;
    readonly hasQuery: false;
}, {
    readonly method: "get";
    readonly path: "/admin/indexer/tasks";
    readonly operationId: "adminIndexerControllerTasks";
    readonly pathParameters: readonly [];
    readonly hasBody: false;
    readonly hasQuery: true;
}, {
    readonly method: "get";
    readonly path: "/media/search/genres";
    readonly operationId: "mediaHomeControllerGenres";
    readonly pathParameters: readonly [];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "get";
    readonly path: "/admin/search/status";
    readonly operationId: "adminMediaSearchControllerStatus";
    readonly pathParameters: readonly [];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "post";
    readonly path: "/admin/notifications";
    readonly operationId: "adminNotificationsControllerSend";
    readonly pathParameters: readonly [];
    readonly hasBody: true;
    readonly hasQuery: false;
}, {
    readonly method: "get";
    readonly path: "/chat/history-backup";
    readonly operationId: "chatControllerChatHistoryBackup";
    readonly pathParameters: readonly [];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "put";
    readonly path: "/chat/history-backup";
    readonly operationId: "chatControllerSaveChatHistoryBackup";
    readonly pathParameters: readonly [];
    readonly hasBody: true;
    readonly hasQuery: false;
}, {
    readonly method: "post";
    readonly path: "/admin/updates/apply";
    readonly operationId: "adminUpdatesControllerApply";
    readonly pathParameters: readonly [];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "get";
    readonly path: "/admin/mail/settings";
    readonly operationId: "adminMailControllerGetSettings";
    readonly pathParameters: readonly [];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "put";
    readonly path: "/admin/mail/settings";
    readonly operationId: "adminMailControllerUpdateSettings";
    readonly pathParameters: readonly [];
    readonly hasBody: true;
    readonly hasQuery: false;
}, {
    readonly method: "get";
    readonly path: "/admin/mail/messages";
    readonly operationId: "adminMailControllerListMessages";
    readonly pathParameters: readonly [];
    readonly hasBody: false;
    readonly hasQuery: true;
}, {
    readonly method: "post";
    readonly path: "/admin/search/reset";
    readonly operationId: "adminMediaSearchControllerReset";
    readonly pathParameters: readonly [];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "post";
    readonly path: "/notifications/read";
    readonly operationId: "notificationsControllerMarkRead";
    readonly pathParameters: readonly [];
    readonly hasBody: true;
    readonly hasQuery: false;
}, {
    readonly method: "get";
    readonly path: "/chat/conversations";
    readonly operationId: "chatControllerList";
    readonly pathParameters: readonly [];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "post";
    readonly path: "/chat/conversations";
    readonly operationId: "chatControllerStart";
    readonly pathParameters: readonly [];
    readonly hasBody: true;
    readonly hasQuery: false;
}, {
    readonly method: "get";
    readonly path: "/admin/mail/domains";
    readonly operationId: "adminMailControllerListDomains";
    readonly pathParameters: readonly [];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "post";
    readonly path: "/admin/mail/domains";
    readonly operationId: "adminMailControllerCreateDomain";
    readonly pathParameters: readonly [];
    readonly hasBody: true;
    readonly hasQuery: false;
}, {
    readonly method: "post";
    readonly path: "/auth/verify-email";
    readonly operationId: "authControllerVerifyEmail";
    readonly pathParameters: readonly [];
    readonly hasBody: true;
    readonly hasQuery: false;
}, {
    readonly method: "get";
    readonly path: "/indexer/libraries";
    readonly operationId: "indexerApiControllerListLibraries";
    readonly pathParameters: readonly [];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "get";
    readonly path: "/requests/discover";
    readonly operationId: "requestsControllerDiscover";
    readonly pathParameters: readonly [];
    readonly hasBody: false;
    readonly hasQuery: true;
}, {
    readonly method: "get";
    readonly path: "/admin/media/items";
    readonly operationId: "adminMediaControllerList";
    readonly pathParameters: readonly [];
    readonly hasBody: false;
    readonly hasQuery: true;
}, {
    readonly method: "get";
    readonly path: "/admin/mail/status";
    readonly operationId: "adminMailControllerStatus";
    readonly pathParameters: readonly [];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "post";
    readonly path: "/payments/checkout";
    readonly operationId: "paymentsControllerCheckout";
    readonly pathParameters: readonly [];
    readonly hasBody: true;
    readonly hasQuery: false;
}, {
    readonly method: "post";
    readonly path: "/auth/me/password";
    readonly operationId: "authControllerChangePassword";
    readonly pathParameters: readonly [];
    readonly hasBody: true;
    readonly hasQuery: false;
}, {
    readonly method: "get";
    readonly path: "/playback/samples";
    readonly operationId: "playbackControllerListSamples";
    readonly pathParameters: readonly [];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "get";
    readonly path: "/indexer/settings";
    readonly operationId: "indexerApiControllerGetSettings";
    readonly pathParameters: readonly [];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "post";
    readonly path: "/payments/methods";
    readonly operationId: "paymentsControllerAddMethod";
    readonly pathParameters: readonly [];
    readonly hasBody: true;
    readonly hasQuery: false;
}, {
    readonly method: "post";
    readonly path: "/recommendations";
    readonly operationId: "recommendationsControllerRecommend";
    readonly pathParameters: readonly [];
    readonly hasBody: true;
    readonly hasQuery: false;
}, {
    readonly method: "get";
    readonly path: "/admin/ai/status";
    readonly operationId: "aiAdminControllerStatus";
    readonly pathParameters: readonly [];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "get";
    readonly path: "/requests/config";
    readonly operationId: "requestsControllerConfig";
    readonly pathParameters: readonly [];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "get";
    readonly path: "/requests/search";
    readonly operationId: "requestsControllerSearch";
    readonly pathParameters: readonly [];
    readonly hasBody: false;
    readonly hasQuery: true;
}, {
    readonly method: "post";
    readonly path: "/admin/mail/send";
    readonly operationId: "adminMailControllerSend";
    readonly pathParameters: readonly [];
    readonly hasBody: true;
    readonly hasQuery: false;
}, {
    readonly method: "get";
    readonly path: "/payments/status";
    readonly operationId: "paymentsControllerStatus";
    readonly pathParameters: readonly [];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "post";
    readonly path: "/payments/access";
    readonly operationId: "paymentsControllerAccess";
    readonly pathParameters: readonly [];
    readonly hasBody: true;
    readonly hasQuery: false;
}, {
    readonly method: "get";
    readonly path: "/setup/progress";
    readonly operationId: "setupControllerProgress";
    readonly pathParameters: readonly [];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "post";
    readonly path: "/setup/complete";
    readonly operationId: "setupControllerComplete";
    readonly pathParameters: readonly [];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "post";
    readonly path: "/admin/ai/retry";
    readonly operationId: "aiAdminControllerRetry";
    readonly pathParameters: readonly [];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "post";
    readonly path: "/auth/me/delete";
    readonly operationId: "authControllerDeleteMe";
    readonly pathParameters: readonly [];
    readonly hasBody: true;
    readonly hasQuery: false;
}, {
    readonly method: "post";
    readonly path: "/auth/me/avatar";
    readonly operationId: "avatarControllerUpload";
    readonly pathParameters: readonly [];
    readonly hasBody: true;
    readonly hasQuery: false;
}, {
    readonly method: "delete";
    readonly path: "/auth/me/avatar";
    readonly operationId: "avatarControllerRemove";
    readonly pathParameters: readonly [];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "get";
    readonly path: "/jobs/schedules";
    readonly operationId: "jobsControllerGetSchedules";
    readonly pathParameters: readonly [];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "get";
    readonly path: "/admin/api-keys";
    readonly operationId: "apiKeysControllerList";
    readonly pathParameters: readonly [];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "post";
    readonly path: "/admin/api-keys";
    readonly operationId: "apiKeysControllerCreate";
    readonly pathParameters: readonly [];
    readonly hasBody: true;
    readonly hasQuery: false;
}, {
    readonly method: "get";
    readonly path: "/plugins/search";
    readonly operationId: "pluginRuntimeControllerSearchSections";
    readonly pathParameters: readonly [];
    readonly hasBody: false;
    readonly hasQuery: true;
}, {
    readonly method: "get";
    readonly path: "/admin/overview";
    readonly operationId: "overviewControllerGet";
    readonly pathParameters: readonly [];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "get";
    readonly path: "/payments/plans";
    readonly operationId: "paymentsControllerPlans";
    readonly pathParameters: readonly [];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "post";
    readonly path: "/payments/quote";
    readonly operationId: "paymentsControllerQuote";
    readonly pathParameters: readonly [];
    readonly hasBody: true;
    readonly hasQuery: false;
}, {
    readonly method: "post";
    readonly path: "/auth/register";
    readonly operationId: "authControllerRegister";
    readonly pathParameters: readonly [];
    readonly hasBody: true;
    readonly hasQuery: false;
}, {
    readonly method: "get";
    readonly path: "/auth/sessions";
    readonly operationId: "authControllerListSessions";
    readonly pathParameters: readonly [];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "get";
    readonly path: "/auth/passkeys";
    readonly operationId: "passkeyControllerList";
    readonly pathParameters: readonly [];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "get";
    readonly path: "/admin/streams";
    readonly operationId: "streamsControllerListSessions";
    readonly pathParameters: readonly [];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "get";
    readonly path: "/admin/devices";
    readonly operationId: "devicesControllerList";
    readonly pathParameters: readonly [];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "get";
    readonly path: "/admin/plugins";
    readonly operationId: "pluginsControllerInstalled";
    readonly pathParameters: readonly [];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "get";
    readonly path: "/plugins/pages";
    readonly operationId: "pluginRuntimeControllerListPages";
    readonly pathParameters: readonly [];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "post";
    readonly path: "/access/unlock";
    readonly operationId: "accessControllerUnlock";
    readonly pathParameters: readonly [];
    readonly hasBody: true;
    readonly hasQuery: false;
}, {
    readonly method: "get";
    readonly path: "/notifications";
    readonly operationId: "notificationsControllerList";
    readonly pathParameters: readonly [];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "get";
    readonly path: "/favorites/ids";
    readonly operationId: "favoritesControllerIds";
    readonly pathParameters: readonly [];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "get";
    readonly path: "/issues/config";
    readonly operationId: "issueReportsControllerConfiguration";
    readonly pathParameters: readonly [];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "get";
    readonly path: "/admin/updates";
    readonly operationId: "adminUpdatesControllerStatus";
    readonly pathParameters: readonly [];
    readonly hasBody: false;
    readonly hasQuery: true;
}, {
    readonly method: "get";
    readonly path: "/admin/backups";
    readonly operationId: "adminBackupsControllerStatus";
    readonly pathParameters: readonly [];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "post";
    readonly path: "/admin/backups";
    readonly operationId: "adminBackupsControllerCreate";
    readonly pathParameters: readonly [];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "get";
    readonly path: "/mail/messages";
    readonly operationId: "userMailControllerList";
    readonly pathParameters: readonly [];
    readonly hasBody: false;
    readonly hasQuery: true;
}, {
    readonly method: "get";
    readonly path: "/setup/status";
    readonly operationId: "setupControllerStatus";
    readonly pathParameters: readonly [];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "get";
    readonly path: "/media/search";
    readonly operationId: "mediaHomeControllerSearch";
    readonly pathParameters: readonly [];
    readonly hasBody: false;
    readonly hasQuery: true;
}, {
    readonly method: "post";
    readonly path: "/chat/devices";
    readonly operationId: "chatControllerRegisterMlsDevice";
    readonly pathParameters: readonly [];
    readonly hasBody: true;
    readonly hasQuery: false;
}, {
    readonly method: "get";
    readonly path: "/chat/devices";
    readonly operationId: "chatControllerMlsDevices";
    readonly pathParameters: readonly [];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "get";
    readonly path: "/admin/issues";
    readonly operationId: "adminIssueReportsControllerList";
    readonly pathParameters: readonly [];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "post";
    readonly path: "/setup/reset";
    readonly operationId: "setupControllerReset";
    readonly pathParameters: readonly [];
    readonly hasBody: true;
    readonly hasQuery: false;
}, {
    readonly method: "post";
    readonly path: "/auth/logout";
    readonly operationId: "authControllerLogout";
    readonly pathParameters: readonly [];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "get";
    readonly path: "/preferences";
    readonly operationId: "preferencesControllerGet";
    readonly pathParameters: readonly [];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "patch";
    readonly path: "/preferences";
    readonly operationId: "preferencesControllerUpdate";
    readonly pathParameters: readonly [];
    readonly hasBody: true;
    readonly hasQuery: false;
}, {
    readonly method: "get";
    readonly path: "/admin/guide";
    readonly operationId: "adminGuideControllerOverview";
    readonly pathParameters: readonly [];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "get";
    readonly path: "/jobs/queues";
    readonly operationId: "jobsControllerGetQueues";
    readonly pathParameters: readonly [];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "get";
    readonly path: "/admin/users";
    readonly operationId: "adminUsersControllerList";
    readonly pathParameters: readonly [];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "post";
    readonly path: "/admin/users";
    readonly operationId: "adminUsersControllerCreate";
    readonly pathParameters: readonly [];
    readonly hasBody: true;
    readonly hasQuery: false;
}, {
    readonly method: "post";
    readonly path: "/access/lock";
    readonly operationId: "accessControllerLock";
    readonly pathParameters: readonly [];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "get";
    readonly path: "/chat/unread";
    readonly operationId: "chatControllerUnread";
    readonly pathParameters: readonly [];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "get";
    readonly path: "/profiles/me";
    readonly operationId: "profilesControllerMe";
    readonly pathParameters: readonly [];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "put";
    readonly path: "/profiles/me";
    readonly operationId: "profilesControllerSetVisibility";
    readonly pathParameters: readonly [];
    readonly hasBody: true;
    readonly hasQuery: false;
}, {
    readonly method: "post";
    readonly path: "/themes/sync";
    readonly operationId: "themesControllerSync";
    readonly pathParameters: readonly [];
    readonly hasBody: true;
    readonly hasQuery: false;
}, {
    readonly method: "get";
    readonly path: "/payments/me";
    readonly operationId: "paymentsControllerMe";
    readonly pathParameters: readonly [];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "post";
    readonly path: "/setup/flow";
    readonly operationId: "setupControllerFlow";
    readonly pathParameters: readonly [];
    readonly hasBody: true;
    readonly hasQuery: false;
}, {
    readonly method: "post";
    readonly path: "/auth/login";
    readonly operationId: "authControllerLogin";
    readonly pathParameters: readonly [];
    readonly hasBody: true;
    readonly hasQuery: false;
}, {
    readonly method: "get";
    readonly path: "/media/home";
    readonly operationId: "mediaHomeControllerGetHome";
    readonly pathParameters: readonly [];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "get";
    readonly path: "/access/me";
    readonly operationId: "accessControllerMe";
    readonly pathParameters: readonly [];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "get";
    readonly path: "/favorites";
    readonly operationId: "favoritesControllerList";
    readonly pathParameters: readonly [];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "get";
    readonly path: "/playlists";
    readonly operationId: "playlistsControllerList";
    readonly pathParameters: readonly [];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "post";
    readonly path: "/playlists";
    readonly operationId: "playlistsControllerCreate";
    readonly pathParameters: readonly [];
    readonly hasBody: true;
    readonly hasQuery: false;
}, {
    readonly method: "get";
    readonly path: "/settings";
    readonly operationId: "settingsControllerList";
    readonly pathParameters: readonly [];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "get";
    readonly path: "/requests";
    readonly operationId: "requestsControllerList";
    readonly pathParameters: readonly [];
    readonly hasBody: false;
    readonly hasQuery: true;
}, {
    readonly method: "post";
    readonly path: "/requests";
    readonly operationId: "requestsControllerCreate";
    readonly pathParameters: readonly [];
    readonly hasBody: true;
    readonly hasQuery: false;
}, {
    readonly method: "get";
    readonly path: "/profiles";
    readonly operationId: "profilesControllerDirectory";
    readonly pathParameters: readonly [];
    readonly hasBody: false;
    readonly hasQuery: true;
}, {
    readonly method: "get";
    readonly path: "/version";
    readonly operationId: "versionControllerGet";
    readonly pathParameters: readonly [];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "get";
    readonly path: "/auth/me";
    readonly operationId: "authControllerMe";
    readonly pathParameters: readonly [];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "patch";
    readonly path: "/auth/me";
    readonly operationId: "authControllerUpdateMe";
    readonly pathParameters: readonly [];
    readonly hasBody: true;
    readonly hasQuery: false;
}, {
    readonly method: "post";
    readonly path: "/parties";
    readonly operationId: "partiesControllerCreate";
    readonly pathParameters: readonly [];
    readonly hasBody: true;
    readonly hasQuery: false;
}, {
    readonly method: "get";
    readonly path: "/friends";
    readonly operationId: "friendsControllerList";
    readonly pathParameters: readonly [];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "get";
    readonly path: "/mail/me";
    readonly operationId: "userMailControllerMe";
    readonly pathParameters: readonly [];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "get";
    readonly path: "/issues";
    readonly operationId: "issueReportsControllerList";
    readonly pathParameters: readonly [];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "post";
    readonly path: "/issues";
    readonly operationId: "issueReportsControllerCreate";
    readonly pathParameters: readonly [];
    readonly hasBody: true;
    readonly hasQuery: false;
}, {
    readonly method: "get";
    readonly path: "/users";
    readonly operationId: "userControllerListUsers";
    readonly pathParameters: readonly [];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "get";
    readonly path: "/guide";
    readonly operationId: "guideControllerGet";
    readonly pathParameters: readonly [];
    readonly hasBody: false;
    readonly hasQuery: true;
}, {
    readonly method: "post";
    readonly path: "/admin/payments/subscriptions/{subscriptionId}/cancel";
    readonly operationId: "adminPaymentsControllerCancelSubscription";
    readonly pathParameters: readonly ["subscriptionId"];
    readonly hasBody: true;
    readonly hasQuery: false;
}, {
    readonly method: "get";
    readonly path: "/internal/ai/users/{userId}/recommendation-context";
    readonly operationId: "aiControllerRecommendationContext";
    readonly pathParameters: readonly ["userId"];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "get";
    readonly path: "/internal/ai/users/{userId}/recommendation-cache";
    readonly operationId: "aiControllerRecommendationCacheState";
    readonly pathParameters: readonly ["userId"];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "put";
    readonly path: "/internal/ai/users/{userId}/recommendation-cache";
    readonly operationId: "aiControllerSaveRecommendationCache";
    readonly pathParameters: readonly ["userId"];
    readonly hasBody: true;
    readonly hasQuery: false;
}, {
    readonly method: "post";
    readonly path: "/admin/ai/users/{userId}/recommendations/refresh";
    readonly operationId: "aiAdminControllerRefreshUserRecommendations";
    readonly pathParameters: readonly ["userId"];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "post";
    readonly path: "/payments/subscriptions/{subscriptionId}/cancel";
    readonly operationId: "paymentsControllerCancel";
    readonly pathParameters: readonly ["subscriptionId"];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "post";
    readonly path: "/payments/subscriptions/{subscriptionId}/resume";
    readonly operationId: "paymentsControllerResume";
    readonly pathParameters: readonly ["subscriptionId"];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "post";
    readonly path: "/playback/guide-channels/{id}/playback-info";
    readonly operationId: "playbackControllerChannelPlaybackInfo";
    readonly pathParameters: readonly ["id"];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "post";
    readonly path: "/admin/indexer/queues/{queue}/cancel-active";
    readonly operationId: "adminIndexerControllerCancelActive";
    readonly pathParameters: readonly ["queue"];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "post";
    readonly path: "/admin/payments/users/{userId}/waive-signup";
    readonly operationId: "adminPaymentsControllerWaiveSignup";
    readonly pathParameters: readonly ["userId"];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "post";
    readonly path: "/admin/indexer/queues/{queue}/clear-failed";
    readonly operationId: "adminIndexerControllerClearFailed";
    readonly pathParameters: readonly ["queue"];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "post";
    readonly path: "/admin/media/items/{id}/subtitles/download";
    readonly operationId: "adminMediaControllerDownloadSubtitle";
    readonly pathParameters: readonly ["id"];
    readonly hasBody: true;
    readonly hasQuery: false;
}, {
    readonly method: "get";
    readonly path: "/chat/conversations/{id}/mls/key-packages";
    readonly operationId: "chatControllerMlsKeyPackages";
    readonly pathParameters: readonly ["id"];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "post";
    readonly path: "/admin/plugins/repositories/{id}/refresh";
    readonly operationId: "pluginsControllerRefreshRepository";
    readonly pathParameters: readonly ["id"];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "post";
    readonly path: "/admin/media/items/{id}/subtitles/search";
    readonly operationId: "adminMediaControllerSearchSubtitles";
    readonly pathParameters: readonly ["id"];
    readonly hasBody: true;
    readonly hasQuery: false;
}, {
    readonly method: "post";
    readonly path: "/admin/payments/orders/{orderId}/refund";
    readonly operationId: "adminPaymentsControllerRefund";
    readonly pathParameters: readonly ["orderId"];
    readonly hasBody: true;
    readonly hasQuery: false;
}, {
    readonly method: "patch";
    readonly path: "/admin/payments/grants/{grantId}/revoke";
    readonly operationId: "adminPaymentsControllerRevoke";
    readonly pathParameters: readonly ["grantId"];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "post";
    readonly path: "/admin/indexer/libraries/{id}/segments";
    readonly operationId: "adminIndexerControllerQueueSegments";
    readonly pathParameters: readonly ["id"];
    readonly hasBody: true;
    readonly hasQuery: false;
}, {
    readonly method: "post";
    readonly path: "/chat/devices/{deviceId}/key-packages";
    readonly operationId: "chatControllerAddMlsKeyPackage";
    readonly pathParameters: readonly ["deviceId"];
    readonly hasBody: true;
    readonly hasQuery: false;
}, {
    readonly method: "get";
    readonly path: "/chat/devices/{deviceId}/key-packages";
    readonly operationId: "chatControllerDeviceMlsKeyPackages";
    readonly pathParameters: readonly ["deviceId"];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "get";
    readonly path: "/chat/conversations/{id}/mls/welcomes";
    readonly operationId: "chatControllerMlsWelcomes";
    readonly pathParameters: readonly ["id"];
    readonly hasBody: false;
    readonly hasQuery: true;
}, {
    readonly method: "post";
    readonly path: "/chat/conversations/{id}/mls/welcomes";
    readonly operationId: "chatControllerStoreMlsWelcome";
    readonly pathParameters: readonly ["id"];
    readonly hasBody: true;
    readonly hasQuery: false;
}, {
    readonly method: "get";
    readonly path: "/admin/payments/users/{userId}/grants";
    readonly operationId: "adminPaymentsControllerGrants";
    readonly pathParameters: readonly ["userId"];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "post";
    readonly path: "/admin/payments/users/{userId}/grants";
    readonly operationId: "adminPaymentsControllerGrant";
    readonly pathParameters: readonly ["userId"];
    readonly hasBody: true;
    readonly hasQuery: false;
}, {
    readonly method: "post";
    readonly path: "/playback/samples/{id}/playback-info";
    readonly operationId: "playbackControllerPlaybackInfo";
    readonly pathParameters: readonly ["id"];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "post";
    readonly path: "/indexer/libraries/{id}/remove-paths";
    readonly operationId: "indexerApiControllerRemoveItemsAtPaths";
    readonly pathParameters: readonly ["id"];
    readonly hasBody: true;
    readonly hasQuery: false;
}, {
    readonly method: "post";
    readonly path: "/admin/indexer/queues/{queue}/resume";
    readonly operationId: "adminIndexerControllerResume";
    readonly pathParameters: readonly ["queue"];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "post";
    readonly path: "/admin/network-shares/{id}/reconnect";
    readonly operationId: "networkSharesControllerReconnect";
    readonly pathParameters: readonly ["id"];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "post";
    readonly path: "/admin/mail/domains/{id}/rotate-dkim";
    readonly operationId: "adminMailControllerRotateDkim";
    readonly pathParameters: readonly ["id"];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "post";
    readonly path: "/admin/mail/templates/{name}/preview";
    readonly operationId: "adminMailControllerPreviewTemplate";
    readonly pathParameters: readonly ["name"];
    readonly hasBody: true;
    readonly hasQuery: false;
}, {
    readonly method: "post";
    readonly path: "/payments/methods/{methodId}/default";
    readonly operationId: "paymentsControllerMakeDefault";
    readonly pathParameters: readonly ["methodId"];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "put";
    readonly path: "/admin/payments/products/{productId}";
    readonly operationId: "adminPaymentsControllerUpdateProduct";
    readonly pathParameters: readonly ["productId"];
    readonly hasBody: true;
    readonly hasQuery: false;
}, {
    readonly method: "delete";
    readonly path: "/admin/payments/products/{productId}";
    readonly operationId: "adminPaymentsControllerDeleteProduct";
    readonly pathParameters: readonly ["productId"];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "post";
    readonly path: "/admin/indexer/queues/{queue}/pause";
    readonly operationId: "adminIndexerControllerPause";
    readonly pathParameters: readonly ["queue"];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "post";
    readonly path: "/admin/backups/{name}/download-link";
    readonly operationId: "adminBackupsControllerDownloadLink";
    readonly pathParameters: readonly ["name"];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "post";
    readonly path: "/playback/items/{id}/playback-info";
    readonly operationId: "playbackControllerItemPlaybackInfo";
    readonly pathParameters: readonly ["id"];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "post";
    readonly path: "/admin/indexer/libraries/{id}/scan";
    readonly operationId: "adminIndexerControllerScan";
    readonly pathParameters: readonly ["id"];
    readonly hasBody: true;
    readonly hasQuery: false;
}, {
    readonly method: "post";
    readonly path: "/chat/conversations/{id}/downgrade";
    readonly operationId: "chatControllerDowngradeToPlaintext";
    readonly pathParameters: readonly ["id"];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "get";
    readonly path: "/payments/orders/{orderId}/receipt";
    readonly operationId: "paymentsControllerReceipt";
    readonly pathParameters: readonly ["orderId"];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "post";
    readonly path: "/payments/orders/{orderId}/confirm";
    readonly operationId: "paymentsControllerConfirm";
    readonly pathParameters: readonly ["orderId"];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "put";
    readonly path: "/admin/payments/coupons/{couponId}";
    readonly operationId: "adminPaymentsControllerUpdateCoupon";
    readonly pathParameters: readonly ["couponId"];
    readonly hasBody: true;
    readonly hasQuery: false;
}, {
    readonly method: "delete";
    readonly path: "/admin/payments/coupons/{couponId}";
    readonly operationId: "adminPaymentsControllerDeleteCoupon";
    readonly pathParameters: readonly ["couponId"];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "post";
    readonly path: "/recommendations/similar/{itemId}";
    readonly operationId: "recommendationsControllerSimilar";
    readonly pathParameters: readonly ["itemId"];
    readonly hasBody: true;
    readonly hasQuery: false;
}, {
    readonly method: "post";
    readonly path: "/auth/passkeys/{passkeyId}/delete";
    readonly operationId: "passkeyControllerRemove";
    readonly pathParameters: readonly ["passkeyId"];
    readonly hasBody: true;
    readonly hasQuery: false;
}, {
    readonly method: "post";
    readonly path: "/admin/guide/sources/{id}/refresh";
    readonly operationId: "adminGuideControllerRefreshSource";
    readonly pathParameters: readonly ["id"];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "get";
    readonly path: "/admin/media/items/{id}/subtitles";
    readonly operationId: "adminMediaControllerListSubtitles";
    readonly pathParameters: readonly ["id"];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "delete";
    readonly path: "/admin/media/items/{id}/subtitles";
    readonly operationId: "adminMediaControllerRemoveSubtitle";
    readonly pathParameters: readonly ["id"];
    readonly hasBody: false;
    readonly hasQuery: true;
}, {
    readonly method: "get";
    readonly path: "/chat/conversations/{id}/messages";
    readonly operationId: "chatControllerMessages";
    readonly pathParameters: readonly ["id"];
    readonly hasBody: false;
    readonly hasQuery: true;
}, {
    readonly method: "post";
    readonly path: "/chat/conversations/{id}/messages";
    readonly operationId: "chatControllerSend";
    readonly pathParameters: readonly ["id"];
    readonly hasBody: true;
    readonly hasQuery: false;
}, {
    readonly method: "post";
    readonly path: "/admin/mail/templates/{name}/test";
    readonly operationId: "adminMailControllerTestTemplate";
    readonly pathParameters: readonly ["name"];
    readonly hasBody: true;
    readonly hasQuery: false;
}, {
    readonly method: "post";
    readonly path: "/admin/scheduled-tasks/{id}/stop";
    readonly operationId: "adminScheduledTasksControllerStop";
    readonly pathParameters: readonly ["id"];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "post";
    readonly path: "/indexer/media/items/{id}/lyrics";
    readonly operationId: "indexerApiControllerUpsertItemLyrics";
    readonly pathParameters: readonly ["id"];
    readonly hasBody: true;
    readonly hasQuery: false;
}, {
    readonly method: "delete";
    readonly path: "/admin/plugins/repositories/{id}";
    readonly operationId: "pluginsControllerRemoveRepository";
    readonly pathParameters: readonly ["id"];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "post";
    readonly path: "/admin/access/users/{id}/preview";
    readonly operationId: "adminAccessControllerPreview";
    readonly pathParameters: readonly ["id"];
    readonly hasBody: true;
    readonly hasQuery: false;
}, {
    readonly method: "post";
    readonly path: "/chat/devices/{deviceId}/approve";
    readonly operationId: "chatControllerApproveMlsDevice";
    readonly pathParameters: readonly ["deviceId"];
    readonly hasBody: true;
    readonly hasQuery: false;
}, {
    readonly method: "post";
    readonly path: "/chat/conversations/{id}/upgrade";
    readonly operationId: "chatControllerUpgradeToEncrypted";
    readonly pathParameters: readonly ["id"];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "post";
    readonly path: "/chat/conversations/{id}/members";
    readonly operationId: "chatControllerAddMembers";
    readonly pathParameters: readonly ["id"];
    readonly hasBody: true;
    readonly hasQuery: false;
}, {
    readonly method: "post";
    readonly path: "/admin/scheduled-tasks/{id}/run";
    readonly operationId: "adminScheduledTasksControllerRun";
    readonly pathParameters: readonly ["id"];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "post";
    readonly path: "/admin/media/items/{id}/refresh";
    readonly operationId: "adminMediaControllerRefresh";
    readonly pathParameters: readonly ["id"];
    readonly hasBody: true;
    readonly hasQuery: false;
}, {
    readonly method: "post";
    readonly path: "/friends/invites/{token}/accept";
    readonly operationId: "friendsControllerAcceptInvite";
    readonly pathParameters: readonly ["token"];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "post";
    readonly path: "/admin/mail/domains/{id}/verify";
    readonly operationId: "adminMailControllerVerifyDomain";
    readonly pathParameters: readonly ["id"];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "post";
    readonly path: "/admin/media/items/{id}/images";
    readonly operationId: "adminMediaControllerAddImage";
    readonly pathParameters: readonly ["id"];
    readonly hasBody: true;
    readonly hasQuery: true;
}, {
    readonly method: "get";
    readonly path: "/playlists/containing/{itemId}";
    readonly operationId: "playlistsControllerContaining";
    readonly pathParameters: readonly ["itemId"];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "put";
    readonly path: "/admin/payments/plans/{planId}";
    readonly operationId: "adminPaymentsControllerUpdatePlan";
    readonly pathParameters: readonly ["planId"];
    readonly hasBody: true;
    readonly hasQuery: false;
}, {
    readonly method: "delete";
    readonly path: "/admin/payments/plans/{planId}";
    readonly operationId: "adminPaymentsControllerDeletePlan";
    readonly pathParameters: readonly ["planId"];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "get";
    readonly path: "/admin/payments/users/{userId}";
    readonly operationId: "adminPaymentsControllerUserOverview";
    readonly pathParameters: readonly ["userId"];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "get";
    readonly path: "/jobs/queues/{queueName}/jobs";
    readonly operationId: "jobsControllerFindJobs";
    readonly pathParameters: readonly ["queueName"];
    readonly hasBody: false;
    readonly hasQuery: true;
}, {
    readonly method: "post";
    readonly path: "/jobs/queues/{queueName}/jobs";
    readonly operationId: "jobsControllerEnqueue";
    readonly pathParameters: readonly ["queueName"];
    readonly hasBody: true;
    readonly hasQuery: false;
}, {
    readonly method: "post";
    readonly path: "/indexer/libraries/{id}/prune";
    readonly operationId: "indexerApiControllerPruneLibrary";
    readonly pathParameters: readonly ["id"];
    readonly hasBody: true;
    readonly hasQuery: false;
}, {
    readonly method: "put";
    readonly path: "/admin/requests/services/{id}";
    readonly operationId: "adminRequestsControllerUpdateService";
    readonly pathParameters: readonly ["id"];
    readonly hasBody: true;
    readonly hasQuery: false;
}, {
    readonly method: "delete";
    readonly path: "/admin/requests/services/{id}";
    readonly operationId: "adminRequestsControllerRemoveService";
    readonly pathParameters: readonly ["id"];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "post";
    readonly path: "/chat/conversations/{id}/read";
    readonly operationId: "chatControllerRead";
    readonly pathParameters: readonly ["id"];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "post";
    readonly path: "/admin/backups/{name}/restore";
    readonly operationId: "adminBackupsControllerRestore";
    readonly pathParameters: readonly ["name"];
    readonly hasBody: true;
    readonly hasQuery: false;
}, {
    readonly method: "post";
    readonly path: "/payments/webhooks/{provider}";
    readonly operationId: "paymentsControllerWebhook";
    readonly pathParameters: readonly ["provider"];
    readonly hasBody: true;
    readonly hasQuery: false;
}, {
    readonly method: "get";
    readonly path: "/admin/plugins/{id}/settings";
    readonly operationId: "pluginsControllerPluginSettingsView";
    readonly pathParameters: readonly ["id"];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "put";
    readonly path: "/admin/plugins/{id}/settings";
    readonly operationId: "pluginsControllerUpdatePluginSettings";
    readonly pathParameters: readonly ["id"];
    readonly hasBody: true;
    readonly hasQuery: false;
}, {
    readonly method: "get";
    readonly path: "/admin/mail/templates/{name}";
    readonly operationId: "adminMailControllerGetTemplate";
    readonly pathParameters: readonly ["name"];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "put";
    readonly path: "/admin/mail/templates/{name}";
    readonly operationId: "adminMailControllerSaveTemplate";
    readonly pathParameters: readonly ["name"];
    readonly hasBody: true;
    readonly hasQuery: false;
}, {
    readonly method: "delete";
    readonly path: "/admin/mail/templates/{name}";
    readonly operationId: "adminMailControllerRemoveTemplate";
    readonly pathParameters: readonly ["name"];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "delete";
    readonly path: "/payments/methods/{methodId}";
    readonly operationId: "paymentsControllerRemoveMethod";
    readonly pathParameters: readonly ["methodId"];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "put";
    readonly path: "/jobs/schedules/{queueName}";
    readonly operationId: "jobsControllerSchedule";
    readonly pathParameters: readonly ["queueName"];
    readonly hasBody: true;
    readonly hasQuery: false;
}, {
    readonly method: "delete";
    readonly path: "/jobs/schedules/{queueName}";
    readonly operationId: "jobsControllerUnschedule";
    readonly pathParameters: readonly ["queueName"];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "put";
    readonly path: "/admin/scheduled-tasks/{id}";
    readonly operationId: "adminScheduledTasksControllerSaveSchedule";
    readonly pathParameters: readonly ["id"];
    readonly hasBody: true;
    readonly hasQuery: false;
}, {
    readonly method: "patch";
    readonly path: "/admin/media-libraries/{id}";
    readonly operationId: "mediaLibrariesControllerUpdate";
    readonly pathParameters: readonly ["id"];
    readonly hasBody: true;
    readonly hasQuery: false;
}, {
    readonly method: "delete";
    readonly path: "/admin/media-libraries/{id}";
    readonly operationId: "mediaLibrariesControllerRemove";
    readonly pathParameters: readonly ["id"];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "get";
    readonly path: "/admin/plugins/{id}/history";
    readonly operationId: "pluginsControllerPluginUpdateHistory";
    readonly pathParameters: readonly ["id"];
    readonly hasBody: false;
    readonly hasQuery: true;
}, {
    readonly method: "post";
    readonly path: "/admin/plugins/{id}/install";
    readonly operationId: "pluginsControllerInstall";
    readonly pathParameters: readonly ["id"];
    readonly hasBody: true;
    readonly hasQuery: false;
}, {
    readonly method: "post";
    readonly path: "/admin/plugins/{id}/disable";
    readonly operationId: "pluginsControllerDisable";
    readonly pathParameters: readonly ["id"];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "post";
    readonly path: "/friends/invites/{username}";
    readonly operationId: "friendsControllerCreateInvite";
    readonly pathParameters: readonly ["username"];
    readonly hasBody: true;
    readonly hasQuery: false;
}, {
    readonly method: "get";
    readonly path: "/internal/config/{service}";
    readonly operationId: "internalConfigControllerGet";
    readonly pathParameters: readonly ["service"];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "delete";
    readonly path: "/auth/sessions/{sessionId}";
    readonly operationId: "authControllerRevokeSession";
    readonly pathParameters: readonly ["sessionId"];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "delete";
    readonly path: "/admin/streams/{sessionId}";
    readonly operationId: "streamsControllerCancelSession";
    readonly pathParameters: readonly ["sessionId"];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "post";
    readonly path: "/admin/plugins/{id}/enable";
    readonly operationId: "pluginsControllerEnable";
    readonly pathParameters: readonly ["id"];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "put";
    readonly path: "/admin/requests/users/{id}";
    readonly operationId: "adminRequestsControllerUpdateUser";
    readonly pathParameters: readonly ["id"];
    readonly hasBody: true;
    readonly hasQuery: false;
}, {
    readonly method: "get";
    readonly path: "/media/items/{id}/progress";
    readonly operationId: "mediaHomeControllerGetProgress";
    readonly pathParameters: readonly ["id"];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "put";
    readonly path: "/media/items/{id}/progress";
    readonly operationId: "mediaHomeControllerSaveProgress";
    readonly pathParameters: readonly ["id"];
    readonly hasBody: true;
    readonly hasQuery: false;
}, {
    readonly method: "patch";
    readonly path: "/admin/network-shares/{id}";
    readonly operationId: "networkSharesControllerUpdate";
    readonly pathParameters: readonly ["id"];
    readonly hasBody: true;
    readonly hasQuery: false;
}, {
    readonly method: "delete";
    readonly path: "/admin/network-shares/{id}";
    readonly operationId: "networkSharesControllerRemove";
    readonly pathParameters: readonly ["id"];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "put";
    readonly path: "/admin/users/{id}/password";
    readonly operationId: "adminUsersControllerSetPassword";
    readonly pathParameters: readonly ["id"];
    readonly hasBody: true;
    readonly hasQuery: false;
}, {
    readonly method: "delete";
    readonly path: "/admin/users/{id}/sessions";
    readonly operationId: "adminUsersControllerRevokeSessions";
    readonly pathParameters: readonly ["id"];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "post";
    readonly path: "/admin/issues/{id}/updates";
    readonly operationId: "adminIssueReportsControllerAddUpdate";
    readonly pathParameters: readonly ["id"];
    readonly hasBody: true;
    readonly hasQuery: false;
}, {
    readonly method: "post";
    readonly path: "/friends/{username}/accept";
    readonly operationId: "friendsControllerAccept";
    readonly pathParameters: readonly ["username"];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "patch";
    readonly path: "/admin/mail/mailboxes/{id}";
    readonly operationId: "adminMailControllerUpdateMailbox";
    readonly pathParameters: readonly ["id"];
    readonly hasBody: true;
    readonly hasQuery: false;
}, {
    readonly method: "delete";
    readonly path: "/admin/mail/mailboxes/{id}";
    readonly operationId: "adminMailControllerRemoveMailbox";
    readonly pathParameters: readonly ["id"];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "patch";
    readonly path: "/admin/guide/sources/{id}";
    readonly operationId: "adminGuideControllerUpdateSource";
    readonly pathParameters: readonly ["id"];
    readonly hasBody: true;
    readonly hasQuery: false;
}, {
    readonly method: "delete";
    readonly path: "/admin/guide/sources/{id}";
    readonly operationId: "adminGuideControllerRemoveSource";
    readonly pathParameters: readonly ["id"];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "put";
    readonly path: "/media/items/{id}/watched";
    readonly operationId: "mediaHomeControllerSetWatched";
    readonly pathParameters: readonly ["id"];
    readonly hasBody: true;
    readonly hasQuery: false;
}, {
    readonly method: "get";
    readonly path: "/admin/search/tasks/{uid}";
    readonly operationId: "adminMediaSearchControllerTask";
    readonly pathParameters: readonly ["uid"];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "patch";
    readonly path: "/admin/issues/{id}/status";
    readonly operationId: "adminIssueReportsControllerUpdateStatus";
    readonly pathParameters: readonly ["id"];
    readonly hasBody: true;
    readonly hasQuery: false;
}, {
    readonly method: "get";
    readonly path: "/admin/mail/messages/{id}";
    readonly operationId: "adminMailControllerGetMessage";
    readonly pathParameters: readonly ["id"];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "delete";
    readonly path: "/admin/mail/messages/{id}";
    readonly operationId: "adminMailControllerRemoveMessage";
    readonly pathParameters: readonly ["id"];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "get";
    readonly path: "/payments/offers/{itemId}";
    readonly operationId: "paymentsControllerOffers";
    readonly pathParameters: readonly ["itemId"];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "post";
    readonly path: "/setup/steps/{step}/test";
    readonly operationId: "setupControllerTestStep";
    readonly pathParameters: readonly ["step"];
    readonly hasBody: true;
    readonly hasQuery: false;
}, {
    readonly method: "get";
    readonly path: "/auth/avatars/{filename}";
    readonly operationId: "avatarControllerAvatar";
    readonly pathParameters: readonly ["filename"];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "get";
    readonly path: "/media/people/{id}/image";
    readonly operationId: "mediaHomeControllerPersonImage";
    readonly pathParameters: readonly ["id"];
    readonly hasBody: false;
    readonly hasQuery: true;
}, {
    readonly method: "post";
    readonly path: "/admin/users/{id}/avatar";
    readonly operationId: "adminUsersControllerSetAvatar";
    readonly pathParameters: readonly ["id"];
    readonly hasBody: true;
    readonly hasQuery: false;
}, {
    readonly method: "delete";
    readonly path: "/admin/users/{id}/avatar";
    readonly operationId: "adminUsersControllerRemoveAvatar";
    readonly pathParameters: readonly ["id"];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "get";
    readonly path: "/admin/access/users/{id}";
    readonly operationId: "adminAccessControllerGet";
    readonly pathParameters: readonly ["id"];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "put";
    readonly path: "/admin/access/users/{id}";
    readonly operationId: "adminAccessControllerSave";
    readonly pathParameters: readonly ["id"];
    readonly hasBody: true;
    readonly hasQuery: false;
}, {
    readonly method: "delete";
    readonly path: "/chat/devices/{deviceId}";
    readonly operationId: "chatControllerRevokeMlsDevice";
    readonly pathParameters: readonly ["deviceId"];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "get";
    readonly path: "/chat/conversations/{id}";
    readonly operationId: "chatControllerGet";
    readonly pathParameters: readonly ["id"];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "patch";
    readonly path: "/chat/conversations/{id}";
    readonly operationId: "chatControllerRename";
    readonly pathParameters: readonly ["id"];
    readonly hasBody: true;
    readonly hasQuery: false;
}, {
    readonly method: "delete";
    readonly path: "/chat/conversations/{id}";
    readonly operationId: "chatControllerDeleteConversation";
    readonly pathParameters: readonly ["id"];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "get";
    readonly path: "/friends/invites/{token}";
    readonly operationId: "friendsControllerGetInvite";
    readonly pathParameters: readonly ["token"];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "get";
    readonly path: "/backups/download/{name}";
    readonly operationId: "backupDownloadControllerDownload";
    readonly pathParameters: readonly ["name"];
    readonly hasBody: false;
    readonly hasQuery: true;
}, {
    readonly method: "patch";
    readonly path: "/admin/mail/domains/{id}";
    readonly operationId: "adminMailControllerUpdateDomain";
    readonly pathParameters: readonly ["id"];
    readonly hasBody: true;
    readonly hasQuery: false;
}, {
    readonly method: "delete";
    readonly path: "/admin/mail/domains/{id}";
    readonly operationId: "adminMailControllerRemoveDomain";
    readonly pathParameters: readonly ["id"];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "get";
    readonly path: "/admin/media/items/{id}";
    readonly operationId: "adminMediaControllerGet";
    readonly pathParameters: readonly ["id"];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "patch";
    readonly path: "/admin/media/items/{id}";
    readonly operationId: "adminMediaControllerUpdate";
    readonly pathParameters: readonly ["id"];
    readonly hasBody: true;
    readonly hasQuery: false;
}, {
    readonly method: "delete";
    readonly path: "/admin/media/items/{id}";
    readonly operationId: "adminMediaControllerRemove";
    readonly pathParameters: readonly ["id"];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "patch";
    readonly path: "/admin/issues/{id}/chat";
    readonly operationId: "adminIssueReportsControllerSetChat";
    readonly pathParameters: readonly ["id"];
    readonly hasBody: true;
    readonly hasQuery: false;
}, {
    readonly method: "post";
    readonly path: "/requests/{id}/approve";
    readonly operationId: "requestsControllerApprove";
    readonly pathParameters: readonly ["id"];
    readonly hasBody: true;
    readonly hasQuery: false;
}, {
    readonly method: "post";
    readonly path: "/requests/{id}/decline";
    readonly operationId: "requestsControllerDecline";
    readonly pathParameters: readonly ["id"];
    readonly hasBody: true;
    readonly hasQuery: false;
}, {
    readonly method: "post";
    readonly path: "/playlists/{id}/items";
    readonly operationId: "playlistsControllerAddItem";
    readonly pathParameters: readonly ["id"];
    readonly hasBody: true;
    readonly hasQuery: false;
}, {
    readonly method: "put";
    readonly path: "/playlists/{id}/order";
    readonly operationId: "playlistsControllerReorder";
    readonly pathParameters: readonly ["id"];
    readonly hasBody: true;
    readonly hasQuery: false;
}, {
    readonly method: "delete";
    readonly path: "/admin/backups/{name}";
    readonly operationId: "adminBackupsControllerRemove";
    readonly pathParameters: readonly ["name"];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "delete";
    readonly path: "/admin/api-keys/{id}";
    readonly operationId: "apiKeysControllerRevoke";
    readonly pathParameters: readonly ["id"];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "post";
    readonly path: "/requests/{id}/retry";
    readonly operationId: "requestsControllerRetry";
    readonly pathParameters: readonly ["id"];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "get";
    readonly path: "/media/browse/{kind}";
    readonly operationId: "mediaHomeControllerBrowse";
    readonly pathParameters: readonly ["kind"];
    readonly hasBody: false;
    readonly hasQuery: true;
}, {
    readonly method: "get";
    readonly path: "/profiles/{username}";
    readonly operationId: "profilesControllerGet";
    readonly pathParameters: readonly ["username"];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "get";
    readonly path: "/sentry/config/{app}";
    readonly operationId: "sentryControllerGetConfig";
    readonly pathParameters: readonly ["app"];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "post";
    readonly path: "/setup/steps/{step}";
    readonly operationId: "setupControllerApplyStep";
    readonly pathParameters: readonly ["step"];
    readonly hasBody: true;
    readonly hasQuery: false;
}, {
    readonly method: "delete";
    readonly path: "/admin/devices/{id}";
    readonly operationId: "devicesControllerSignOut";
    readonly pathParameters: readonly ["id"];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "delete";
    readonly path: "/admin/plugins/{id}";
    readonly operationId: "pluginsControllerUninstall";
    readonly pathParameters: readonly ["id"];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "delete";
    readonly path: "/notifications/{id}";
    readonly operationId: "notificationsControllerRemove";
    readonly pathParameters: readonly ["id"];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "put";
    readonly path: "/favorites/{itemId}";
    readonly operationId: "favoritesControllerAdd";
    readonly pathParameters: readonly ["itemId"];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "delete";
    readonly path: "/favorites/{itemId}";
    readonly operationId: "favoritesControllerRemove";
    readonly pathParameters: readonly ["itemId"];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "post";
    readonly path: "/friends/{username}";
    readonly operationId: "friendsControllerRequest";
    readonly pathParameters: readonly ["username"];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "delete";
    readonly path: "/friends/{username}";
    readonly operationId: "friendsControllerRemove";
    readonly pathParameters: readonly ["username"];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "get";
    readonly path: "/mail/messages/{id}";
    readonly operationId: "userMailControllerGet";
    readonly pathParameters: readonly ["id"];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "delete";
    readonly path: "/mail/messages/{id}";
    readonly operationId: "userMailControllerRemove";
    readonly pathParameters: readonly ["id"];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "get";
    readonly path: "/media/people/{id}";
    readonly operationId: "mediaHomeControllerPerson";
    readonly pathParameters: readonly ["id"];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "get";
    readonly path: "/admin/issues/{id}";
    readonly operationId: "adminIssueReportsControllerGet";
    readonly pathParameters: readonly ["id"];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "delete";
    readonly path: "/admin/issues/{id}";
    readonly operationId: "adminIssueReportsControllerDelete";
    readonly pathParameters: readonly ["id"];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "get";
    readonly path: "/themes/items/{id}";
    readonly operationId: "themesControllerAudio";
    readonly pathParameters: readonly ["id"];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "get";
    readonly path: "/media/items/{id}";
    readonly operationId: "mediaHomeControllerItem";
    readonly pathParameters: readonly ["id"];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "patch";
    readonly path: "/admin/users/{id}";
    readonly operationId: "adminUsersControllerUpdate";
    readonly pathParameters: readonly ["id"];
    readonly hasBody: true;
    readonly hasQuery: false;
}, {
    readonly method: "delete";
    readonly path: "/admin/users/{id}";
    readonly operationId: "adminUsersControllerRemove";
    readonly pathParameters: readonly ["id"];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "put";
    readonly path: "/settings/{key}";
    readonly operationId: "settingsControllerUpdate";
    readonly pathParameters: readonly ["key"];
    readonly hasBody: true;
    readonly hasQuery: false;
}, {
    readonly method: "get";
    readonly path: "/playlists/{id}";
    readonly operationId: "playlistsControllerGet";
    readonly pathParameters: readonly ["id"];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "patch";
    readonly path: "/playlists/{id}";
    readonly operationId: "playlistsControllerUpdate";
    readonly pathParameters: readonly ["id"];
    readonly hasBody: true;
    readonly hasQuery: false;
}, {
    readonly method: "delete";
    readonly path: "/playlists/{id}";
    readonly operationId: "playlistsControllerRemove";
    readonly pathParameters: readonly ["id"];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "delete";
    readonly path: "/requests/{id}";
    readonly operationId: "requestsControllerRemove";
    readonly pathParameters: readonly ["id"];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "get";
    readonly path: "/parties/{id}";
    readonly operationId: "partiesControllerGet";
    readonly pathParameters: readonly ["id"];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "delete";
    readonly path: "/parties/{id}";
    readonly operationId: "partiesControllerEnd";
    readonly pathParameters: readonly ["id"];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "get";
    readonly path: "/issues/{id}";
    readonly operationId: "issueReportsControllerGet";
    readonly pathParameters: readonly ["id"];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "get";
    readonly path: "/users/{id}";
    readonly operationId: "userControllerGetUser";
    readonly pathParameters: readonly ["id"];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "delete";
    readonly path: "/users/{id}";
    readonly operationId: "userControllerDeleteUser";
    readonly pathParameters: readonly ["id"];
    readonly hasBody: true;
    readonly hasQuery: false;
}, {
    readonly method: "post";
    readonly path: "/chat/conversations/{id}/mls/key-packages/{keyPackageId}/claim";
    readonly operationId: "chatControllerClaimMlsKeyPackage";
    readonly pathParameters: readonly ["id", "keyPackageId"];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "post";
    readonly path: "/chat/conversations/{id}/mls/welcomes/{welcomeId}/ack";
    readonly operationId: "chatControllerAcknowledgeMlsWelcome";
    readonly pathParameters: readonly ["id", "welcomeId"];
    readonly hasBody: true;
    readonly hasQuery: false;
}, {
    readonly method: "get";
    readonly path: "/admin/mail/messages/{id}/attachments/{attachmentId}";
    readonly operationId: "adminMailControllerAttachment";
    readonly pathParameters: readonly ["id", "attachmentId"];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "delete";
    readonly path: "/admin/payments/users/{userId}/methods/{methodId}";
    readonly operationId: "adminPaymentsControllerRemoveUserMethod";
    readonly pathParameters: readonly ["userId", "methodId"];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "get";
    readonly path: "/mail/messages/{id}/attachments/{attachmentId}";
    readonly operationId: "userMailControllerAttachment";
    readonly pathParameters: readonly ["id", "attachmentId"];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "post";
    readonly path: "/jobs/queues/{queueName}/jobs/{jobId}/retry";
    readonly operationId: "jobsControllerRetryJob";
    readonly pathParameters: readonly ["queueName", "jobId"];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "delete";
    readonly path: "/chat/conversations/{id}/members/{username}";
    readonly operationId: "chatControllerRemoveMember";
    readonly pathParameters: readonly ["id", "username"];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "post";
    readonly path: "/admin/indexer/tasks/{queue}/{id}/cancel";
    readonly operationId: "adminIndexerControllerCancelTask";
    readonly pathParameters: readonly ["queue", "id"];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "post";
    readonly path: "/admin/indexer/tasks/{queue}/{id}/retry";
    readonly operationId: "adminIndexerControllerRetryTask";
    readonly pathParameters: readonly ["queue", "id"];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "put";
    readonly path: "/admin/media/items/{id}/segments/{type}";
    readonly operationId: "adminMediaControllerSetSegment";
    readonly pathParameters: readonly ["id", "type"];
    readonly hasBody: true;
    readonly hasQuery: false;
}, {
    readonly method: "delete";
    readonly path: "/admin/media/items/{id}/segments/{type}";
    readonly operationId: "adminMediaControllerClearSegment";
    readonly pathParameters: readonly ["id", "type"];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "get";
    readonly path: "/admin/media/items/{id}/images/{index}";
    readonly operationId: "adminMediaControllerImage";
    readonly pathParameters: readonly ["id", "index"];
    readonly hasBody: false;
    readonly hasQuery: true;
}, {
    readonly method: "delete";
    readonly path: "/admin/media/items/{id}/images/{index}";
    readonly operationId: "adminMediaControllerRemoveImage";
    readonly pathParameters: readonly ["id", "index"];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "get";
    readonly path: "/jobs/queues/{queueName}/jobs/{jobId}";
    readonly operationId: "jobsControllerGetJob";
    readonly pathParameters: readonly ["queueName", "jobId"];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "delete";
    readonly path: "/jobs/queues/{queueName}/jobs/{jobId}";
    readonly operationId: "jobsControllerCancelJob";
    readonly pathParameters: readonly ["queueName", "jobId"];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "post";
    readonly path: "/requests/webhook/{kind}/{serviceId}";
    readonly operationId: "requestWebhookControllerReceive";
    readonly pathParameters: readonly ["kind", "serviceId"];
    readonly hasBody: true;
    readonly hasQuery: false;
}, {
    readonly method: "get";
    readonly path: "/requests/images/tmdb/{size}/{file}";
    readonly operationId: "requestImagesControllerTmdb";
    readonly pathParameters: readonly ["size", "file"];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "get";
    readonly path: "/media/items/{id}/images/{index}";
    readonly operationId: "mediaHomeControllerImage";
    readonly pathParameters: readonly ["id", "index"];
    readonly hasBody: false;
    readonly hasQuery: true;
}, {
    readonly method: "post";
    readonly path: "/plugins/{pluginId}/{operation}";
    readonly operationId: "pluginRuntimeControllerInvoke";
    readonly pathParameters: readonly ["pluginId", "operation"];
    readonly hasBody: true;
    readonly hasQuery: false;
}, {
    readonly method: "delete";
    readonly path: "/playlists/{id}/items/{itemId}";
    readonly operationId: "playlistsControllerRemoveTrack";
    readonly pathParameters: readonly ["id", "itemId"];
    readonly hasBody: false;
    readonly hasQuery: false;
}, {
    readonly method: "get";
    readonly path: "/requests/details/{type}/{id}";
    readonly operationId: "requestsControllerDetails";
    readonly pathParameters: readonly ["type", "id"];
    readonly hasBody: false;
    readonly hasQuery: false;
}];
