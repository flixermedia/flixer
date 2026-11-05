export const routes = [
    {
        "method": "post",
        "path": "/admin/mail/mailboxes/generate-user-addresses",
        "operationId": "adminMailControllerGenerateUserAddresses",
        "pathParameters": [],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "post",
        "path": "/admin/database-transfer/restore-writes",
        "operationId": "adminDatabaseTransferControllerRestoreWrites",
        "pathParameters": [],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "post",
        "path": "/auth/passkeys/native-handoff/exchange",
        "operationId": "passkeyControllerExchangeNativeHandoff",
        "pathParameters": [],
        "hasBody": true,
        "hasQuery": false
    },
    {
        "method": "post",
        "path": "/auth/passkeys/native-handoff/options",
        "operationId": "passkeyControllerNativeHandoffOptions",
        "pathParameters": [],
        "hasBody": true,
        "hasQuery": false
    },
    {
        "method": "post",
        "path": "/auth/passkeys/second-factor/options",
        "operationId": "passkeyControllerSecondFactorOptions",
        "pathParameters": [],
        "hasBody": true,
        "hasQuery": false
    },
    {
        "method": "post",
        "path": "/auth/passkeys/native-handoff/verify",
        "operationId": "passkeyControllerVerifyNativeHandoff",
        "pathParameters": [],
        "hasBody": true,
        "hasQuery": false
    },
    {
        "method": "post",
        "path": "/auth/passkeys/second-factor/verify",
        "operationId": "passkeyControllerSecondFactorVerify",
        "pathParameters": [],
        "hasBody": true,
        "hasQuery": false
    },
    {
        "method": "post",
        "path": "/auth/passkeys/native-handoff/start",
        "operationId": "passkeyControllerStartNativeHandoff",
        "pathParameters": [],
        "hasBody": true,
        "hasQuery": false
    },
    {
        "method": "get",
        "path": "/internal/ai/runtime-configuration",
        "operationId": "aiControllerRuntimeConfiguration",
        "pathParameters": [],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "delete",
        "path": "/internal/ai/recommendation-cache",
        "operationId": "aiControllerClearRecommendationCache",
        "pathParameters": [],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "put",
        "path": "/notifications/push/subscription",
        "operationId": "notificationsControllerSubscribe",
        "pathParameters": [],
        "hasBody": true,
        "hasQuery": false
    },
    {
        "method": "post",
        "path": "/auth/passkeys/register/options",
        "operationId": "passkeyControllerRegistrationOptions",
        "pathParameters": [],
        "hasBody": true,
        "hasQuery": false
    },
    {
        "method": "post",
        "path": "/notifications/push/unsubscribe",
        "operationId": "notificationsControllerUnsubscribe",
        "pathParameters": [],
        "hasBody": true,
        "hasQuery": false
    },
    {
        "method": "post",
        "path": "/auth/passkeys/register/verify",
        "operationId": "passkeyControllerRegistrationVerify",
        "pathParameters": [],
        "hasBody": true,
        "hasQuery": false
    },
    {
        "method": "post",
        "path": "/admin/requests/webhook/rotate",
        "operationId": "adminRequestsControllerRotateWebhookCredentials",
        "pathParameters": [],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "get",
        "path": "/admin/media-libraries/browse",
        "operationId": "mediaLibrariesControllerBrowse",
        "pathParameters": [],
        "hasBody": false,
        "hasQuery": true
    },
    {
        "method": "get",
        "path": "/indexer/media/intro-segments",
        "operationId": "indexerApiControllerExistingIntroSegments",
        "pathParameters": [],
        "hasBody": false,
        "hasQuery": true
    },
    {
        "method": "post",
        "path": "/indexer/media/intro-segments",
        "operationId": "indexerApiControllerUpdateIntroSegments",
        "pathParameters": [],
        "hasBody": true,
        "hasQuery": false
    },
    {
        "method": "post",
        "path": "/admin/requests/services/test",
        "operationId": "adminRequestsControllerTestService",
        "pathParameters": [],
        "hasBody": true,
        "hasQuery": false
    },
    {
        "method": "get",
        "path": "/admin/network-shares/support",
        "operationId": "networkSharesControllerSupport",
        "pathParameters": [],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "get",
        "path": "/admin/payments/subscriptions",
        "operationId": "adminPaymentsControllerSubscriptions",
        "pathParameters": [],
        "hasBody": false,
        "hasQuery": true
    },
    {
        "method": "get",
        "path": "/internal/ai/library-context",
        "operationId": "aiControllerLibraryContext",
        "pathParameters": [],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "post",
        "path": "/auth/passkeys/login/options",
        "operationId": "passkeyControllerLoginOptions",
        "pathParameters": [],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "get",
        "path": "/admin/media-libraries/roots",
        "operationId": "mediaLibrariesControllerListRoots",
        "pathParameters": [],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "get",
        "path": "/admin/payments/scope-search",
        "operationId": "adminPaymentsControllerScopeSearch",
        "pathParameters": [],
        "hasBody": false,
        "hasQuery": true
    },
    {
        "method": "get",
        "path": "/recommendations/home/music",
        "operationId": "recommendationsControllerMusicRecommendations",
        "pathParameters": [],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "post",
        "path": "/auth/passkeys/login/verify",
        "operationId": "passkeyControllerLoginVerify",
        "pathParameters": [],
        "hasBody": true,
        "hasQuery": false
    },
    {
        "method": "get",
        "path": "/admin/plugins/repositories",
        "operationId": "pluginsControllerRepositories",
        "pathParameters": [],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "post",
        "path": "/admin/plugins/repositories",
        "operationId": "pluginsControllerAddRepository",
        "pathParameters": [],
        "hasBody": true,
        "hasQuery": false
    },
    {
        "method": "post",
        "path": "/admin/payments/config/test",
        "operationId": "adminPaymentsControllerTest",
        "pathParameters": [],
        "hasBody": true,
        "hasQuery": false
    },
    {
        "method": "put",
        "path": "/admin/indexer/concurrency",
        "operationId": "adminIndexerControllerSetConcurrency",
        "pathParameters": [],
        "hasBody": true,
        "hasQuery": false
    },
    {
        "method": "get",
        "path": "/notifications/push/status",
        "operationId": "notificationsControllerPushStatus",
        "pathParameters": [],
        "hasBody": false,
        "hasQuery": true
    },
    {
        "method": "get",
        "path": "/admin/payments/currencies",
        "operationId": "adminPaymentsControllerCurrencies",
        "pathParameters": [],
        "hasBody": false,
        "hasQuery": true
    },
    {
        "method": "get",
        "path": "/admin/ai/recommendations",
        "operationId": "aiAdminControllerRecommendations",
        "pathParameters": [],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "patch",
        "path": "/auth/me/passkey-required",
        "operationId": "authControllerSetPasskeyRequired",
        "pathParameters": [],
        "hasBody": true,
        "hasQuery": false
    },
    {
        "method": "post",
        "path": "/auth/resend-verification",
        "operationId": "authControllerResendVerification",
        "pathParameters": [],
        "hasBody": true,
        "hasQuery": false
    },
    {
        "method": "get",
        "path": "/indexer/media/intro-sync",
        "operationId": "indexerApiControllerIntroSyncCandidates",
        "pathParameters": [],
        "hasBody": false,
        "hasQuery": true
    },
    {
        "method": "put",
        "path": "/admin/backups/passphrase",
        "operationId": "adminBackupsControllerSetPassphrase",
        "pathParameters": [],
        "hasBody": true,
        "hasQuery": false
    },
    {
        "method": "delete",
        "path": "/admin/backups/passphrase",
        "operationId": "adminBackupsControllerClearPassphrase",
        "pathParameters": [],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "post",
        "path": "/payments/signup/complete",
        "operationId": "paymentsControllerSignupComplete",
        "pathParameters": [],
        "hasBody": true,
        "hasQuery": false
    },
    {
        "method": "get",
        "path": "/requests/images/discogs",
        "operationId": "requestImagesControllerDiscogs",
        "pathParameters": [],
        "hasBody": false,
        "hasQuery": true
    },
    {
        "method": "get",
        "path": "/admin/requests/services",
        "operationId": "adminRequestsControllerListServices",
        "pathParameters": [],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "post",
        "path": "/admin/requests/services",
        "operationId": "adminRequestsControllerCreateService",
        "pathParameters": [],
        "hasBody": true,
        "hasQuery": false
    },
    {
        "method": "get",
        "path": "/admin/database-transfer",
        "operationId": "adminDatabaseTransferControllerStatus",
        "pathParameters": [],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "post",
        "path": "/admin/database-transfer",
        "operationId": "adminDatabaseTransferControllerStart",
        "pathParameters": [],
        "hasBody": true,
        "hasQuery": false
    },
    {
        "method": "get",
        "path": "/admin/overview/activity",
        "operationId": "overviewControllerActivityList",
        "pathParameters": [],
        "hasBody": false,
        "hasQuery": true
    },
    {
        "method": "get",
        "path": "/admin/payments/products",
        "operationId": "adminPaymentsControllerProducts",
        "pathParameters": [],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "post",
        "path": "/admin/payments/products",
        "operationId": "adminPaymentsControllerCreateProduct",
        "pathParameters": [],
        "hasBody": true,
        "hasQuery": false
    },
    {
        "method": "post",
        "path": "/setup/recovery/request",
        "operationId": "setupControllerRequestRecoveryKey",
        "pathParameters": [],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "put",
        "path": "/admin/ai/configuration",
        "operationId": "aiAdminControllerUpdateConfiguration",
        "pathParameters": [],
        "hasBody": true,
        "hasQuery": false
    },
    {
        "method": "get",
        "path": "/admin/requests/webhook",
        "operationId": "adminRequestsControllerGetWebhookCredentials",
        "pathParameters": [],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "get",
        "path": "/notifications/push/key",
        "operationId": "notificationsControllerPushKey",
        "pathParameters": [],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "get",
        "path": "/chat/encryption/status",
        "operationId": "chatControllerEncryptionStatus",
        "pathParameters": [],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "post",
        "path": "/admin/mail/diagnostics",
        "operationId": "adminMailControllerDiagnostics",
        "pathParameters": [],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "post",
        "path": "/payments/methods/setup",
        "operationId": "paymentsControllerBeginMethod",
        "pathParameters": [],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "get",
        "path": "/admin/payments/coupons",
        "operationId": "adminPaymentsControllerCoupons",
        "pathParameters": [],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "post",
        "path": "/admin/payments/coupons",
        "operationId": "adminPaymentsControllerCreateCoupon",
        "pathParameters": [],
        "hasBody": true,
        "hasQuery": false
    },
    {
        "method": "get",
        "path": "/settings/registration",
        "operationId": "settingsControllerRegistrationStatus",
        "pathParameters": [],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "get",
        "path": "/admin/scheduled-tasks",
        "operationId": "adminScheduledTasksControllerList",
        "pathParameters": [],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "get",
        "path": "/admin/media-libraries",
        "operationId": "mediaLibrariesControllerList",
        "pathParameters": [],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "post",
        "path": "/admin/media-libraries",
        "operationId": "mediaLibrariesControllerCreate",
        "pathParameters": [],
        "hasBody": true,
        "hasQuery": false
    },
    {
        "method": "post",
        "path": "/admin/indexer/refresh",
        "operationId": "adminIndexerControllerRefresh",
        "pathParameters": [],
        "hasBody": true,
        "hasQuery": false
    },
    {
        "method": "get",
        "path": "/admin/plugins/catalog",
        "operationId": "pluginsControllerCatalog",
        "pathParameters": [],
        "hasBody": false,
        "hasQuery": true
    },
    {
        "method": "put",
        "path": "/admin/search/settings",
        "operationId": "adminMediaSearchControllerSaveSettings",
        "pathParameters": [],
        "hasBody": true,
        "hasQuery": false
    },
    {
        "method": "post",
        "path": "/profiles/me/listening",
        "operationId": "profilesControllerListening",
        "pathParameters": [],
        "hasBody": true,
        "hasQuery": false
    },
    {
        "method": "post",
        "path": "/payments/signup/setup",
        "operationId": "paymentsControllerSignupSetup",
        "pathParameters": [],
        "hasBody": true,
        "hasQuery": false
    },
    {
        "method": "get",
        "path": "/admin/payments/config",
        "operationId": "adminPaymentsControllerGetConfig",
        "pathParameters": [],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "put",
        "path": "/admin/payments/config",
        "operationId": "adminPaymentsControllerPutConfig",
        "pathParameters": [],
        "hasBody": true,
        "hasQuery": false
    },
    {
        "method": "get",
        "path": "/admin/payments/orders",
        "operationId": "adminPaymentsControllerOrders",
        "pathParameters": [],
        "hasBody": false,
        "hasQuery": true
    },
    {
        "method": "get",
        "path": "/recommendations/home",
        "operationId": "recommendationsControllerHomeRecommendations",
        "pathParameters": [],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "put",
        "path": "/admin/guide/channels",
        "operationId": "adminGuideControllerUpdateChannels",
        "pathParameters": [],
        "hasBody": true,
        "hasQuery": false
    },
    {
        "method": "put",
        "path": "/admin/guide/settings",
        "operationId": "adminGuideControllerUpdateSettings",
        "pathParameters": [],
        "hasBody": true,
        "hasQuery": false
    },
    {
        "method": "get",
        "path": "/streamer/media-roots",
        "operationId": "streamerRootsControllerList",
        "pathParameters": [],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "get",
        "path": "/streamer/transcoding",
        "operationId": "streamerRootsControllerTranscoding",
        "pathParameters": [],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "get",
        "path": "/admin/indexer/status",
        "operationId": "adminIndexerControllerStatus",
        "pathParameters": [],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "get",
        "path": "/admin/requests/users",
        "operationId": "adminRequestsControllerListUsers",
        "pathParameters": [],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "post",
        "path": "/admin/search/rebuild",
        "operationId": "adminMediaSearchControllerRebuild",
        "pathParameters": [],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "get",
        "path": "/admin/network-shares",
        "operationId": "networkSharesControllerList",
        "pathParameters": [],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "post",
        "path": "/admin/network-shares",
        "operationId": "networkSharesControllerCreate",
        "pathParameters": [],
        "hasBody": true,
        "hasQuery": false
    },
    {
        "method": "get",
        "path": "/admin/access/options",
        "operationId": "adminAccessControllerOptions",
        "pathParameters": [],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "get",
        "path": "/notifications/config",
        "operationId": "notificationsControllerConfig",
        "pathParameters": [],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "post",
        "path": "/admin/backups/upload",
        "operationId": "adminBackupsControllerUpload",
        "pathParameters": [],
        "hasBody": true,
        "hasQuery": false
    },
    {
        "method": "get",
        "path": "/admin/mail/mailboxes",
        "operationId": "adminMailControllerListMailboxes",
        "pathParameters": [],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "post",
        "path": "/admin/mail/mailboxes",
        "operationId": "adminMailControllerCreateMailbox",
        "pathParameters": [],
        "hasBody": true,
        "hasQuery": false
    },
    {
        "method": "get",
        "path": "/admin/mail/templates",
        "operationId": "adminMailControllerListTemplates",
        "pathParameters": [],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "get",
        "path": "/admin/payments/stats",
        "operationId": "adminPaymentsControllerStats",
        "pathParameters": [],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "get",
        "path": "/admin/payments/plans",
        "operationId": "adminPaymentsControllerPlans",
        "pathParameters": [],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "post",
        "path": "/admin/payments/plans",
        "operationId": "adminPaymentsControllerCreatePlan",
        "pathParameters": [],
        "hasBody": true,
        "hasQuery": false
    },
    {
        "method": "post",
        "path": "/settings/email/test",
        "operationId": "settingsControllerSendTestEmail",
        "pathParameters": [],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "get",
        "path": "/admin/guide/sources",
        "operationId": "adminGuideControllerSources",
        "pathParameters": [],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "post",
        "path": "/admin/guide/sources",
        "operationId": "adminGuideControllerCreateSource",
        "pathParameters": [],
        "hasBody": true,
        "hasQuery": false
    },
    {
        "method": "post",
        "path": "/indexer/media/items",
        "operationId": "indexerApiControllerUpsertItem",
        "pathParameters": [],
        "hasBody": true,
        "hasQuery": false
    },
    {
        "method": "get",
        "path": "/admin/indexer/tasks",
        "operationId": "adminIndexerControllerTasks",
        "pathParameters": [],
        "hasBody": false,
        "hasQuery": true
    },
    {
        "method": "get",
        "path": "/media/search/genres",
        "operationId": "mediaHomeControllerGenres",
        "pathParameters": [],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "get",
        "path": "/admin/search/status",
        "operationId": "adminMediaSearchControllerStatus",
        "pathParameters": [],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "post",
        "path": "/admin/notifications",
        "operationId": "adminNotificationsControllerSend",
        "pathParameters": [],
        "hasBody": true,
        "hasQuery": false
    },
    {
        "method": "get",
        "path": "/chat/history-backup",
        "operationId": "chatControllerChatHistoryBackup",
        "pathParameters": [],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "put",
        "path": "/chat/history-backup",
        "operationId": "chatControllerSaveChatHistoryBackup",
        "pathParameters": [],
        "hasBody": true,
        "hasQuery": false
    },
    {
        "method": "post",
        "path": "/admin/updates/apply",
        "operationId": "adminUpdatesControllerApply",
        "pathParameters": [],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "get",
        "path": "/admin/mail/settings",
        "operationId": "adminMailControllerGetSettings",
        "pathParameters": [],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "put",
        "path": "/admin/mail/settings",
        "operationId": "adminMailControllerUpdateSettings",
        "pathParameters": [],
        "hasBody": true,
        "hasQuery": false
    },
    {
        "method": "get",
        "path": "/admin/mail/messages",
        "operationId": "adminMailControllerListMessages",
        "pathParameters": [],
        "hasBody": false,
        "hasQuery": true
    },
    {
        "method": "post",
        "path": "/admin/search/reset",
        "operationId": "adminMediaSearchControllerReset",
        "pathParameters": [],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "post",
        "path": "/notifications/read",
        "operationId": "notificationsControllerMarkRead",
        "pathParameters": [],
        "hasBody": true,
        "hasQuery": false
    },
    {
        "method": "get",
        "path": "/chat/conversations",
        "operationId": "chatControllerList",
        "pathParameters": [],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "post",
        "path": "/chat/conversations",
        "operationId": "chatControllerStart",
        "pathParameters": [],
        "hasBody": true,
        "hasQuery": false
    },
    {
        "method": "get",
        "path": "/admin/mail/domains",
        "operationId": "adminMailControllerListDomains",
        "pathParameters": [],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "post",
        "path": "/admin/mail/domains",
        "operationId": "adminMailControllerCreateDomain",
        "pathParameters": [],
        "hasBody": true,
        "hasQuery": false
    },
    {
        "method": "post",
        "path": "/auth/verify-email",
        "operationId": "authControllerVerifyEmail",
        "pathParameters": [],
        "hasBody": true,
        "hasQuery": false
    },
    {
        "method": "get",
        "path": "/indexer/libraries",
        "operationId": "indexerApiControllerListLibraries",
        "pathParameters": [],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "get",
        "path": "/requests/discover",
        "operationId": "requestsControllerDiscover",
        "pathParameters": [],
        "hasBody": false,
        "hasQuery": true
    },
    {
        "method": "get",
        "path": "/admin/media/items",
        "operationId": "adminMediaControllerList",
        "pathParameters": [],
        "hasBody": false,
        "hasQuery": true
    },
    {
        "method": "get",
        "path": "/admin/mail/status",
        "operationId": "adminMailControllerStatus",
        "pathParameters": [],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "post",
        "path": "/payments/checkout",
        "operationId": "paymentsControllerCheckout",
        "pathParameters": [],
        "hasBody": true,
        "hasQuery": false
    },
    {
        "method": "post",
        "path": "/auth/me/password",
        "operationId": "authControllerChangePassword",
        "pathParameters": [],
        "hasBody": true,
        "hasQuery": false
    },
    {
        "method": "get",
        "path": "/playback/samples",
        "operationId": "playbackControllerListSamples",
        "pathParameters": [],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "get",
        "path": "/indexer/settings",
        "operationId": "indexerApiControllerGetSettings",
        "pathParameters": [],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "post",
        "path": "/payments/methods",
        "operationId": "paymentsControllerAddMethod",
        "pathParameters": [],
        "hasBody": true,
        "hasQuery": false
    },
    {
        "method": "post",
        "path": "/recommendations",
        "operationId": "recommendationsControllerRecommend",
        "pathParameters": [],
        "hasBody": true,
        "hasQuery": false
    },
    {
        "method": "get",
        "path": "/admin/ai/status",
        "operationId": "aiAdminControllerStatus",
        "pathParameters": [],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "get",
        "path": "/requests/config",
        "operationId": "requestsControllerConfig",
        "pathParameters": [],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "get",
        "path": "/requests/search",
        "operationId": "requestsControllerSearch",
        "pathParameters": [],
        "hasBody": false,
        "hasQuery": true
    },
    {
        "method": "post",
        "path": "/admin/mail/send",
        "operationId": "adminMailControllerSend",
        "pathParameters": [],
        "hasBody": true,
        "hasQuery": false
    },
    {
        "method": "get",
        "path": "/payments/status",
        "operationId": "paymentsControllerStatus",
        "pathParameters": [],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "post",
        "path": "/payments/access",
        "operationId": "paymentsControllerAccess",
        "pathParameters": [],
        "hasBody": true,
        "hasQuery": false
    },
    {
        "method": "get",
        "path": "/setup/progress",
        "operationId": "setupControllerProgress",
        "pathParameters": [],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "post",
        "path": "/setup/complete",
        "operationId": "setupControllerComplete",
        "pathParameters": [],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "post",
        "path": "/admin/ai/retry",
        "operationId": "aiAdminControllerRetry",
        "pathParameters": [],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "post",
        "path": "/auth/me/delete",
        "operationId": "authControllerDeleteMe",
        "pathParameters": [],
        "hasBody": true,
        "hasQuery": false
    },
    {
        "method": "post",
        "path": "/auth/me/avatar",
        "operationId": "avatarControllerUpload",
        "pathParameters": [],
        "hasBody": true,
        "hasQuery": false
    },
    {
        "method": "delete",
        "path": "/auth/me/avatar",
        "operationId": "avatarControllerRemove",
        "pathParameters": [],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "get",
        "path": "/jobs/schedules",
        "operationId": "jobsControllerGetSchedules",
        "pathParameters": [],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "get",
        "path": "/admin/api-keys",
        "operationId": "apiKeysControllerList",
        "pathParameters": [],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "post",
        "path": "/admin/api-keys",
        "operationId": "apiKeysControllerCreate",
        "pathParameters": [],
        "hasBody": true,
        "hasQuery": false
    },
    {
        "method": "get",
        "path": "/plugins/search",
        "operationId": "pluginRuntimeControllerSearchSections",
        "pathParameters": [],
        "hasBody": false,
        "hasQuery": true
    },
    {
        "method": "get",
        "path": "/admin/overview",
        "operationId": "overviewControllerGet",
        "pathParameters": [],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "get",
        "path": "/payments/plans",
        "operationId": "paymentsControllerPlans",
        "pathParameters": [],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "post",
        "path": "/payments/quote",
        "operationId": "paymentsControllerQuote",
        "pathParameters": [],
        "hasBody": true,
        "hasQuery": false
    },
    {
        "method": "post",
        "path": "/auth/register",
        "operationId": "authControllerRegister",
        "pathParameters": [],
        "hasBody": true,
        "hasQuery": false
    },
    {
        "method": "get",
        "path": "/auth/sessions",
        "operationId": "authControllerListSessions",
        "pathParameters": [],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "get",
        "path": "/auth/passkeys",
        "operationId": "passkeyControllerList",
        "pathParameters": [],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "get",
        "path": "/admin/streams",
        "operationId": "streamsControllerListSessions",
        "pathParameters": [],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "get",
        "path": "/admin/devices",
        "operationId": "devicesControllerList",
        "pathParameters": [],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "get",
        "path": "/admin/plugins",
        "operationId": "pluginsControllerInstalled",
        "pathParameters": [],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "get",
        "path": "/plugins/pages",
        "operationId": "pluginRuntimeControllerListPages",
        "pathParameters": [],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "post",
        "path": "/access/unlock",
        "operationId": "accessControllerUnlock",
        "pathParameters": [],
        "hasBody": true,
        "hasQuery": false
    },
    {
        "method": "get",
        "path": "/notifications",
        "operationId": "notificationsControllerList",
        "pathParameters": [],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "get",
        "path": "/favorites/ids",
        "operationId": "favoritesControllerIds",
        "pathParameters": [],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "get",
        "path": "/issues/config",
        "operationId": "issueReportsControllerConfiguration",
        "pathParameters": [],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "get",
        "path": "/admin/updates",
        "operationId": "adminUpdatesControllerStatus",
        "pathParameters": [],
        "hasBody": false,
        "hasQuery": true
    },
    {
        "method": "get",
        "path": "/admin/backups",
        "operationId": "adminBackupsControllerStatus",
        "pathParameters": [],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "post",
        "path": "/admin/backups",
        "operationId": "adminBackupsControllerCreate",
        "pathParameters": [],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "get",
        "path": "/mail/messages",
        "operationId": "userMailControllerList",
        "pathParameters": [],
        "hasBody": false,
        "hasQuery": true
    },
    {
        "method": "get",
        "path": "/setup/status",
        "operationId": "setupControllerStatus",
        "pathParameters": [],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "get",
        "path": "/media/search",
        "operationId": "mediaHomeControllerSearch",
        "pathParameters": [],
        "hasBody": false,
        "hasQuery": true
    },
    {
        "method": "post",
        "path": "/chat/devices",
        "operationId": "chatControllerRegisterMlsDevice",
        "pathParameters": [],
        "hasBody": true,
        "hasQuery": false
    },
    {
        "method": "get",
        "path": "/chat/devices",
        "operationId": "chatControllerMlsDevices",
        "pathParameters": [],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "get",
        "path": "/admin/issues",
        "operationId": "adminIssueReportsControllerList",
        "pathParameters": [],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "post",
        "path": "/setup/reset",
        "operationId": "setupControllerReset",
        "pathParameters": [],
        "hasBody": true,
        "hasQuery": false
    },
    {
        "method": "post",
        "path": "/auth/logout",
        "operationId": "authControllerLogout",
        "pathParameters": [],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "get",
        "path": "/preferences",
        "operationId": "preferencesControllerGet",
        "pathParameters": [],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "patch",
        "path": "/preferences",
        "operationId": "preferencesControllerUpdate",
        "pathParameters": [],
        "hasBody": true,
        "hasQuery": false
    },
    {
        "method": "get",
        "path": "/admin/guide",
        "operationId": "adminGuideControllerOverview",
        "pathParameters": [],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "get",
        "path": "/jobs/queues",
        "operationId": "jobsControllerGetQueues",
        "pathParameters": [],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "get",
        "path": "/admin/users",
        "operationId": "adminUsersControllerList",
        "pathParameters": [],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "post",
        "path": "/admin/users",
        "operationId": "adminUsersControllerCreate",
        "pathParameters": [],
        "hasBody": true,
        "hasQuery": false
    },
    {
        "method": "post",
        "path": "/access/lock",
        "operationId": "accessControllerLock",
        "pathParameters": [],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "get",
        "path": "/chat/unread",
        "operationId": "chatControllerUnread",
        "pathParameters": [],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "get",
        "path": "/profiles/me",
        "operationId": "profilesControllerMe",
        "pathParameters": [],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "put",
        "path": "/profiles/me",
        "operationId": "profilesControllerSetVisibility",
        "pathParameters": [],
        "hasBody": true,
        "hasQuery": false
    },
    {
        "method": "post",
        "path": "/themes/sync",
        "operationId": "themesControllerSync",
        "pathParameters": [],
        "hasBody": true,
        "hasQuery": false
    },
    {
        "method": "get",
        "path": "/payments/me",
        "operationId": "paymentsControllerMe",
        "pathParameters": [],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "post",
        "path": "/setup/flow",
        "operationId": "setupControllerFlow",
        "pathParameters": [],
        "hasBody": true,
        "hasQuery": false
    },
    {
        "method": "post",
        "path": "/auth/login",
        "operationId": "authControllerLogin",
        "pathParameters": [],
        "hasBody": true,
        "hasQuery": false
    },
    {
        "method": "get",
        "path": "/media/home",
        "operationId": "mediaHomeControllerGetHome",
        "pathParameters": [],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "get",
        "path": "/access/me",
        "operationId": "accessControllerMe",
        "pathParameters": [],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "get",
        "path": "/favorites",
        "operationId": "favoritesControllerList",
        "pathParameters": [],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "get",
        "path": "/playlists",
        "operationId": "playlistsControllerList",
        "pathParameters": [],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "post",
        "path": "/playlists",
        "operationId": "playlistsControllerCreate",
        "pathParameters": [],
        "hasBody": true,
        "hasQuery": false
    },
    {
        "method": "get",
        "path": "/settings",
        "operationId": "settingsControllerList",
        "pathParameters": [],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "get",
        "path": "/requests",
        "operationId": "requestsControllerList",
        "pathParameters": [],
        "hasBody": false,
        "hasQuery": true
    },
    {
        "method": "post",
        "path": "/requests",
        "operationId": "requestsControllerCreate",
        "pathParameters": [],
        "hasBody": true,
        "hasQuery": false
    },
    {
        "method": "get",
        "path": "/profiles",
        "operationId": "profilesControllerDirectory",
        "pathParameters": [],
        "hasBody": false,
        "hasQuery": true
    },
    {
        "method": "get",
        "path": "/version",
        "operationId": "versionControllerGet",
        "pathParameters": [],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "get",
        "path": "/auth/me",
        "operationId": "authControllerMe",
        "pathParameters": [],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "patch",
        "path": "/auth/me",
        "operationId": "authControllerUpdateMe",
        "pathParameters": [],
        "hasBody": true,
        "hasQuery": false
    },
    {
        "method": "post",
        "path": "/parties",
        "operationId": "partiesControllerCreate",
        "pathParameters": [],
        "hasBody": true,
        "hasQuery": false
    },
    {
        "method": "get",
        "path": "/friends",
        "operationId": "friendsControllerList",
        "pathParameters": [],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "get",
        "path": "/mail/me",
        "operationId": "userMailControllerMe",
        "pathParameters": [],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "get",
        "path": "/issues",
        "operationId": "issueReportsControllerList",
        "pathParameters": [],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "post",
        "path": "/issues",
        "operationId": "issueReportsControllerCreate",
        "pathParameters": [],
        "hasBody": true,
        "hasQuery": false
    },
    {
        "method": "get",
        "path": "/users",
        "operationId": "userControllerListUsers",
        "pathParameters": [],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "get",
        "path": "/guide",
        "operationId": "guideControllerGet",
        "pathParameters": [],
        "hasBody": false,
        "hasQuery": true
    },
    {
        "method": "post",
        "path": "/admin/payments/subscriptions/{subscriptionId}/cancel",
        "operationId": "adminPaymentsControllerCancelSubscription",
        "pathParameters": [
            "subscriptionId"
        ],
        "hasBody": true,
        "hasQuery": false
    },
    {
        "method": "get",
        "path": "/internal/ai/users/{userId}/recommendation-context",
        "operationId": "aiControllerRecommendationContext",
        "pathParameters": [
            "userId"
        ],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "get",
        "path": "/internal/ai/users/{userId}/recommendation-cache",
        "operationId": "aiControllerRecommendationCacheState",
        "pathParameters": [
            "userId"
        ],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "put",
        "path": "/internal/ai/users/{userId}/recommendation-cache",
        "operationId": "aiControllerSaveRecommendationCache",
        "pathParameters": [
            "userId"
        ],
        "hasBody": true,
        "hasQuery": false
    },
    {
        "method": "post",
        "path": "/admin/ai/users/{userId}/recommendations/refresh",
        "operationId": "aiAdminControllerRefreshUserRecommendations",
        "pathParameters": [
            "userId"
        ],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "post",
        "path": "/payments/subscriptions/{subscriptionId}/cancel",
        "operationId": "paymentsControllerCancel",
        "pathParameters": [
            "subscriptionId"
        ],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "post",
        "path": "/payments/subscriptions/{subscriptionId}/resume",
        "operationId": "paymentsControllerResume",
        "pathParameters": [
            "subscriptionId"
        ],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "post",
        "path": "/playback/guide-channels/{id}/playback-info",
        "operationId": "playbackControllerChannelPlaybackInfo",
        "pathParameters": [
            "id"
        ],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "post",
        "path": "/admin/indexer/queues/{queue}/cancel-active",
        "operationId": "adminIndexerControllerCancelActive",
        "pathParameters": [
            "queue"
        ],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "post",
        "path": "/admin/payments/users/{userId}/waive-signup",
        "operationId": "adminPaymentsControllerWaiveSignup",
        "pathParameters": [
            "userId"
        ],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "post",
        "path": "/admin/indexer/queues/{queue}/clear-failed",
        "operationId": "adminIndexerControllerClearFailed",
        "pathParameters": [
            "queue"
        ],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "post",
        "path": "/admin/media/items/{id}/subtitles/download",
        "operationId": "adminMediaControllerDownloadSubtitle",
        "pathParameters": [
            "id"
        ],
        "hasBody": true,
        "hasQuery": false
    },
    {
        "method": "get",
        "path": "/chat/conversations/{id}/mls/key-packages",
        "operationId": "chatControllerMlsKeyPackages",
        "pathParameters": [
            "id"
        ],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "post",
        "path": "/admin/plugins/repositories/{id}/refresh",
        "operationId": "pluginsControllerRefreshRepository",
        "pathParameters": [
            "id"
        ],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "post",
        "path": "/admin/media/items/{id}/subtitles/search",
        "operationId": "adminMediaControllerSearchSubtitles",
        "pathParameters": [
            "id"
        ],
        "hasBody": true,
        "hasQuery": false
    },
    {
        "method": "post",
        "path": "/admin/payments/orders/{orderId}/refund",
        "operationId": "adminPaymentsControllerRefund",
        "pathParameters": [
            "orderId"
        ],
        "hasBody": true,
        "hasQuery": false
    },
    {
        "method": "patch",
        "path": "/admin/payments/grants/{grantId}/revoke",
        "operationId": "adminPaymentsControllerRevoke",
        "pathParameters": [
            "grantId"
        ],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "post",
        "path": "/admin/indexer/libraries/{id}/segments",
        "operationId": "adminIndexerControllerQueueSegments",
        "pathParameters": [
            "id"
        ],
        "hasBody": true,
        "hasQuery": false
    },
    {
        "method": "post",
        "path": "/chat/devices/{deviceId}/key-packages",
        "operationId": "chatControllerAddMlsKeyPackage",
        "pathParameters": [
            "deviceId"
        ],
        "hasBody": true,
        "hasQuery": false
    },
    {
        "method": "get",
        "path": "/chat/devices/{deviceId}/key-packages",
        "operationId": "chatControllerDeviceMlsKeyPackages",
        "pathParameters": [
            "deviceId"
        ],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "get",
        "path": "/chat/conversations/{id}/mls/welcomes",
        "operationId": "chatControllerMlsWelcomes",
        "pathParameters": [
            "id"
        ],
        "hasBody": false,
        "hasQuery": true
    },
    {
        "method": "post",
        "path": "/chat/conversations/{id}/mls/welcomes",
        "operationId": "chatControllerStoreMlsWelcome",
        "pathParameters": [
            "id"
        ],
        "hasBody": true,
        "hasQuery": false
    },
    {
        "method": "get",
        "path": "/admin/payments/users/{userId}/grants",
        "operationId": "adminPaymentsControllerGrants",
        "pathParameters": [
            "userId"
        ],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "post",
        "path": "/admin/payments/users/{userId}/grants",
        "operationId": "adminPaymentsControllerGrant",
        "pathParameters": [
            "userId"
        ],
        "hasBody": true,
        "hasQuery": false
    },
    {
        "method": "post",
        "path": "/playback/samples/{id}/playback-info",
        "operationId": "playbackControllerPlaybackInfo",
        "pathParameters": [
            "id"
        ],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "post",
        "path": "/indexer/libraries/{id}/remove-paths",
        "operationId": "indexerApiControllerRemoveItemsAtPaths",
        "pathParameters": [
            "id"
        ],
        "hasBody": true,
        "hasQuery": false
    },
    {
        "method": "post",
        "path": "/admin/indexer/queues/{queue}/resume",
        "operationId": "adminIndexerControllerResume",
        "pathParameters": [
            "queue"
        ],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "post",
        "path": "/admin/network-shares/{id}/reconnect",
        "operationId": "networkSharesControllerReconnect",
        "pathParameters": [
            "id"
        ],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "post",
        "path": "/admin/mail/domains/{id}/rotate-dkim",
        "operationId": "adminMailControllerRotateDkim",
        "pathParameters": [
            "id"
        ],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "post",
        "path": "/admin/mail/templates/{name}/preview",
        "operationId": "adminMailControllerPreviewTemplate",
        "pathParameters": [
            "name"
        ],
        "hasBody": true,
        "hasQuery": false
    },
    {
        "method": "post",
        "path": "/payments/methods/{methodId}/default",
        "operationId": "paymentsControllerMakeDefault",
        "pathParameters": [
            "methodId"
        ],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "put",
        "path": "/admin/payments/products/{productId}",
        "operationId": "adminPaymentsControllerUpdateProduct",
        "pathParameters": [
            "productId"
        ],
        "hasBody": true,
        "hasQuery": false
    },
    {
        "method": "delete",
        "path": "/admin/payments/products/{productId}",
        "operationId": "adminPaymentsControllerDeleteProduct",
        "pathParameters": [
            "productId"
        ],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "post",
        "path": "/admin/indexer/queues/{queue}/pause",
        "operationId": "adminIndexerControllerPause",
        "pathParameters": [
            "queue"
        ],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "post",
        "path": "/admin/backups/{name}/download-link",
        "operationId": "adminBackupsControllerDownloadLink",
        "pathParameters": [
            "name"
        ],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "post",
        "path": "/playback/items/{id}/playback-info",
        "operationId": "playbackControllerItemPlaybackInfo",
        "pathParameters": [
            "id"
        ],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "post",
        "path": "/admin/indexer/libraries/{id}/scan",
        "operationId": "adminIndexerControllerScan",
        "pathParameters": [
            "id"
        ],
        "hasBody": true,
        "hasQuery": false
    },
    {
        "method": "post",
        "path": "/chat/conversations/{id}/downgrade",
        "operationId": "chatControllerDowngradeToPlaintext",
        "pathParameters": [
            "id"
        ],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "get",
        "path": "/payments/orders/{orderId}/receipt",
        "operationId": "paymentsControllerReceipt",
        "pathParameters": [
            "orderId"
        ],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "post",
        "path": "/payments/orders/{orderId}/confirm",
        "operationId": "paymentsControllerConfirm",
        "pathParameters": [
            "orderId"
        ],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "put",
        "path": "/admin/payments/coupons/{couponId}",
        "operationId": "adminPaymentsControllerUpdateCoupon",
        "pathParameters": [
            "couponId"
        ],
        "hasBody": true,
        "hasQuery": false
    },
    {
        "method": "delete",
        "path": "/admin/payments/coupons/{couponId}",
        "operationId": "adminPaymentsControllerDeleteCoupon",
        "pathParameters": [
            "couponId"
        ],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "post",
        "path": "/recommendations/similar/{itemId}",
        "operationId": "recommendationsControllerSimilar",
        "pathParameters": [
            "itemId"
        ],
        "hasBody": true,
        "hasQuery": false
    },
    {
        "method": "post",
        "path": "/auth/passkeys/{passkeyId}/delete",
        "operationId": "passkeyControllerRemove",
        "pathParameters": [
            "passkeyId"
        ],
        "hasBody": true,
        "hasQuery": false
    },
    {
        "method": "post",
        "path": "/admin/guide/sources/{id}/refresh",
        "operationId": "adminGuideControllerRefreshSource",
        "pathParameters": [
            "id"
        ],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "get",
        "path": "/admin/media/items/{id}/subtitles",
        "operationId": "adminMediaControllerListSubtitles",
        "pathParameters": [
            "id"
        ],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "delete",
        "path": "/admin/media/items/{id}/subtitles",
        "operationId": "adminMediaControllerRemoveSubtitle",
        "pathParameters": [
            "id"
        ],
        "hasBody": false,
        "hasQuery": true
    },
    {
        "method": "get",
        "path": "/chat/conversations/{id}/messages",
        "operationId": "chatControllerMessages",
        "pathParameters": [
            "id"
        ],
        "hasBody": false,
        "hasQuery": true
    },
    {
        "method": "post",
        "path": "/chat/conversations/{id}/messages",
        "operationId": "chatControllerSend",
        "pathParameters": [
            "id"
        ],
        "hasBody": true,
        "hasQuery": false
    },
    {
        "method": "post",
        "path": "/admin/mail/templates/{name}/test",
        "operationId": "adminMailControllerTestTemplate",
        "pathParameters": [
            "name"
        ],
        "hasBody": true,
        "hasQuery": false
    },
    {
        "method": "post",
        "path": "/admin/scheduled-tasks/{id}/stop",
        "operationId": "adminScheduledTasksControllerStop",
        "pathParameters": [
            "id"
        ],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "post",
        "path": "/indexer/media/items/{id}/lyrics",
        "operationId": "indexerApiControllerUpsertItemLyrics",
        "pathParameters": [
            "id"
        ],
        "hasBody": true,
        "hasQuery": false
    },
    {
        "method": "delete",
        "path": "/admin/plugins/repositories/{id}",
        "operationId": "pluginsControllerRemoveRepository",
        "pathParameters": [
            "id"
        ],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "post",
        "path": "/admin/access/users/{id}/preview",
        "operationId": "adminAccessControllerPreview",
        "pathParameters": [
            "id"
        ],
        "hasBody": true,
        "hasQuery": false
    },
    {
        "method": "post",
        "path": "/chat/devices/{deviceId}/approve",
        "operationId": "chatControllerApproveMlsDevice",
        "pathParameters": [
            "deviceId"
        ],
        "hasBody": true,
        "hasQuery": false
    },
    {
        "method": "post",
        "path": "/chat/conversations/{id}/upgrade",
        "operationId": "chatControllerUpgradeToEncrypted",
        "pathParameters": [
            "id"
        ],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "post",
        "path": "/chat/conversations/{id}/members",
        "operationId": "chatControllerAddMembers",
        "pathParameters": [
            "id"
        ],
        "hasBody": true,
        "hasQuery": false
    },
    {
        "method": "post",
        "path": "/admin/scheduled-tasks/{id}/run",
        "operationId": "adminScheduledTasksControllerRun",
        "pathParameters": [
            "id"
        ],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "post",
        "path": "/admin/media/items/{id}/refresh",
        "operationId": "adminMediaControllerRefresh",
        "pathParameters": [
            "id"
        ],
        "hasBody": true,
        "hasQuery": false
    },
    {
        "method": "post",
        "path": "/friends/invites/{token}/accept",
        "operationId": "friendsControllerAcceptInvite",
        "pathParameters": [
            "token"
        ],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "post",
        "path": "/admin/mail/domains/{id}/verify",
        "operationId": "adminMailControllerVerifyDomain",
        "pathParameters": [
            "id"
        ],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "post",
        "path": "/admin/media/items/{id}/images",
        "operationId": "adminMediaControllerAddImage",
        "pathParameters": [
            "id"
        ],
        "hasBody": true,
        "hasQuery": true
    },
    {
        "method": "get",
        "path": "/playlists/containing/{itemId}",
        "operationId": "playlistsControllerContaining",
        "pathParameters": [
            "itemId"
        ],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "put",
        "path": "/admin/payments/plans/{planId}",
        "operationId": "adminPaymentsControllerUpdatePlan",
        "pathParameters": [
            "planId"
        ],
        "hasBody": true,
        "hasQuery": false
    },
    {
        "method": "delete",
        "path": "/admin/payments/plans/{planId}",
        "operationId": "adminPaymentsControllerDeletePlan",
        "pathParameters": [
            "planId"
        ],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "get",
        "path": "/admin/payments/users/{userId}",
        "operationId": "adminPaymentsControllerUserOverview",
        "pathParameters": [
            "userId"
        ],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "get",
        "path": "/jobs/queues/{queueName}/jobs",
        "operationId": "jobsControllerFindJobs",
        "pathParameters": [
            "queueName"
        ],
        "hasBody": false,
        "hasQuery": true
    },
    {
        "method": "post",
        "path": "/jobs/queues/{queueName}/jobs",
        "operationId": "jobsControllerEnqueue",
        "pathParameters": [
            "queueName"
        ],
        "hasBody": true,
        "hasQuery": false
    },
    {
        "method": "post",
        "path": "/indexer/libraries/{id}/prune",
        "operationId": "indexerApiControllerPruneLibrary",
        "pathParameters": [
            "id"
        ],
        "hasBody": true,
        "hasQuery": false
    },
    {
        "method": "put",
        "path": "/admin/requests/services/{id}",
        "operationId": "adminRequestsControllerUpdateService",
        "pathParameters": [
            "id"
        ],
        "hasBody": true,
        "hasQuery": false
    },
    {
        "method": "delete",
        "path": "/admin/requests/services/{id}",
        "operationId": "adminRequestsControllerRemoveService",
        "pathParameters": [
            "id"
        ],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "post",
        "path": "/chat/conversations/{id}/read",
        "operationId": "chatControllerRead",
        "pathParameters": [
            "id"
        ],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "post",
        "path": "/admin/backups/{name}/restore",
        "operationId": "adminBackupsControllerRestore",
        "pathParameters": [
            "name"
        ],
        "hasBody": true,
        "hasQuery": false
    },
    {
        "method": "post",
        "path": "/payments/webhooks/{provider}",
        "operationId": "paymentsControllerWebhook",
        "pathParameters": [
            "provider"
        ],
        "hasBody": true,
        "hasQuery": false
    },
    {
        "method": "get",
        "path": "/admin/plugins/{id}/settings",
        "operationId": "pluginsControllerPluginSettingsView",
        "pathParameters": [
            "id"
        ],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "put",
        "path": "/admin/plugins/{id}/settings",
        "operationId": "pluginsControllerUpdatePluginSettings",
        "pathParameters": [
            "id"
        ],
        "hasBody": true,
        "hasQuery": false
    },
    {
        "method": "get",
        "path": "/admin/mail/templates/{name}",
        "operationId": "adminMailControllerGetTemplate",
        "pathParameters": [
            "name"
        ],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "put",
        "path": "/admin/mail/templates/{name}",
        "operationId": "adminMailControllerSaveTemplate",
        "pathParameters": [
            "name"
        ],
        "hasBody": true,
        "hasQuery": false
    },
    {
        "method": "delete",
        "path": "/admin/mail/templates/{name}",
        "operationId": "adminMailControllerRemoveTemplate",
        "pathParameters": [
            "name"
        ],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "delete",
        "path": "/payments/methods/{methodId}",
        "operationId": "paymentsControllerRemoveMethod",
        "pathParameters": [
            "methodId"
        ],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "put",
        "path": "/jobs/schedules/{queueName}",
        "operationId": "jobsControllerSchedule",
        "pathParameters": [
            "queueName"
        ],
        "hasBody": true,
        "hasQuery": false
    },
    {
        "method": "delete",
        "path": "/jobs/schedules/{queueName}",
        "operationId": "jobsControllerUnschedule",
        "pathParameters": [
            "queueName"
        ],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "put",
        "path": "/admin/scheduled-tasks/{id}",
        "operationId": "adminScheduledTasksControllerSaveSchedule",
        "pathParameters": [
            "id"
        ],
        "hasBody": true,
        "hasQuery": false
    },
    {
        "method": "patch",
        "path": "/admin/media-libraries/{id}",
        "operationId": "mediaLibrariesControllerUpdate",
        "pathParameters": [
            "id"
        ],
        "hasBody": true,
        "hasQuery": false
    },
    {
        "method": "delete",
        "path": "/admin/media-libraries/{id}",
        "operationId": "mediaLibrariesControllerRemove",
        "pathParameters": [
            "id"
        ],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "get",
        "path": "/admin/plugins/{id}/history",
        "operationId": "pluginsControllerPluginUpdateHistory",
        "pathParameters": [
            "id"
        ],
        "hasBody": false,
        "hasQuery": true
    },
    {
        "method": "post",
        "path": "/admin/plugins/{id}/install",
        "operationId": "pluginsControllerInstall",
        "pathParameters": [
            "id"
        ],
        "hasBody": true,
        "hasQuery": false
    },
    {
        "method": "post",
        "path": "/admin/plugins/{id}/disable",
        "operationId": "pluginsControllerDisable",
        "pathParameters": [
            "id"
        ],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "post",
        "path": "/friends/invites/{username}",
        "operationId": "friendsControllerCreateInvite",
        "pathParameters": [
            "username"
        ],
        "hasBody": true,
        "hasQuery": false
    },
    {
        "method": "get",
        "path": "/internal/config/{service}",
        "operationId": "internalConfigControllerGet",
        "pathParameters": [
            "service"
        ],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "delete",
        "path": "/auth/sessions/{sessionId}",
        "operationId": "authControllerRevokeSession",
        "pathParameters": [
            "sessionId"
        ],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "delete",
        "path": "/admin/streams/{sessionId}",
        "operationId": "streamsControllerCancelSession",
        "pathParameters": [
            "sessionId"
        ],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "post",
        "path": "/admin/plugins/{id}/enable",
        "operationId": "pluginsControllerEnable",
        "pathParameters": [
            "id"
        ],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "put",
        "path": "/admin/requests/users/{id}",
        "operationId": "adminRequestsControllerUpdateUser",
        "pathParameters": [
            "id"
        ],
        "hasBody": true,
        "hasQuery": false
    },
    {
        "method": "get",
        "path": "/media/items/{id}/progress",
        "operationId": "mediaHomeControllerGetProgress",
        "pathParameters": [
            "id"
        ],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "put",
        "path": "/media/items/{id}/progress",
        "operationId": "mediaHomeControllerSaveProgress",
        "pathParameters": [
            "id"
        ],
        "hasBody": true,
        "hasQuery": false
    },
    {
        "method": "patch",
        "path": "/admin/network-shares/{id}",
        "operationId": "networkSharesControllerUpdate",
        "pathParameters": [
            "id"
        ],
        "hasBody": true,
        "hasQuery": false
    },
    {
        "method": "delete",
        "path": "/admin/network-shares/{id}",
        "operationId": "networkSharesControllerRemove",
        "pathParameters": [
            "id"
        ],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "put",
        "path": "/admin/users/{id}/password",
        "operationId": "adminUsersControllerSetPassword",
        "pathParameters": [
            "id"
        ],
        "hasBody": true,
        "hasQuery": false
    },
    {
        "method": "delete",
        "path": "/admin/users/{id}/sessions",
        "operationId": "adminUsersControllerRevokeSessions",
        "pathParameters": [
            "id"
        ],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "post",
        "path": "/admin/issues/{id}/updates",
        "operationId": "adminIssueReportsControllerAddUpdate",
        "pathParameters": [
            "id"
        ],
        "hasBody": true,
        "hasQuery": false
    },
    {
        "method": "post",
        "path": "/friends/{username}/accept",
        "operationId": "friendsControllerAccept",
        "pathParameters": [
            "username"
        ],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "patch",
        "path": "/admin/mail/mailboxes/{id}",
        "operationId": "adminMailControllerUpdateMailbox",
        "pathParameters": [
            "id"
        ],
        "hasBody": true,
        "hasQuery": false
    },
    {
        "method": "delete",
        "path": "/admin/mail/mailboxes/{id}",
        "operationId": "adminMailControllerRemoveMailbox",
        "pathParameters": [
            "id"
        ],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "patch",
        "path": "/admin/guide/sources/{id}",
        "operationId": "adminGuideControllerUpdateSource",
        "pathParameters": [
            "id"
        ],
        "hasBody": true,
        "hasQuery": false
    },
    {
        "method": "delete",
        "path": "/admin/guide/sources/{id}",
        "operationId": "adminGuideControllerRemoveSource",
        "pathParameters": [
            "id"
        ],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "put",
        "path": "/media/items/{id}/watched",
        "operationId": "mediaHomeControllerSetWatched",
        "pathParameters": [
            "id"
        ],
        "hasBody": true,
        "hasQuery": false
    },
    {
        "method": "get",
        "path": "/admin/search/tasks/{uid}",
        "operationId": "adminMediaSearchControllerTask",
        "pathParameters": [
            "uid"
        ],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "patch",
        "path": "/admin/issues/{id}/status",
        "operationId": "adminIssueReportsControllerUpdateStatus",
        "pathParameters": [
            "id"
        ],
        "hasBody": true,
        "hasQuery": false
    },
    {
        "method": "get",
        "path": "/admin/mail/messages/{id}",
        "operationId": "adminMailControllerGetMessage",
        "pathParameters": [
            "id"
        ],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "delete",
        "path": "/admin/mail/messages/{id}",
        "operationId": "adminMailControllerRemoveMessage",
        "pathParameters": [
            "id"
        ],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "get",
        "path": "/payments/offers/{itemId}",
        "operationId": "paymentsControllerOffers",
        "pathParameters": [
            "itemId"
        ],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "post",
        "path": "/setup/steps/{step}/test",
        "operationId": "setupControllerTestStep",
        "pathParameters": [
            "step"
        ],
        "hasBody": true,
        "hasQuery": false
    },
    {
        "method": "get",
        "path": "/auth/avatars/{filename}",
        "operationId": "avatarControllerAvatar",
        "pathParameters": [
            "filename"
        ],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "get",
        "path": "/media/people/{id}/image",
        "operationId": "mediaHomeControllerPersonImage",
        "pathParameters": [
            "id"
        ],
        "hasBody": false,
        "hasQuery": true
    },
    {
        "method": "post",
        "path": "/admin/users/{id}/avatar",
        "operationId": "adminUsersControllerSetAvatar",
        "pathParameters": [
            "id"
        ],
        "hasBody": true,
        "hasQuery": false
    },
    {
        "method": "delete",
        "path": "/admin/users/{id}/avatar",
        "operationId": "adminUsersControllerRemoveAvatar",
        "pathParameters": [
            "id"
        ],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "get",
        "path": "/admin/access/users/{id}",
        "operationId": "adminAccessControllerGet",
        "pathParameters": [
            "id"
        ],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "put",
        "path": "/admin/access/users/{id}",
        "operationId": "adminAccessControllerSave",
        "pathParameters": [
            "id"
        ],
        "hasBody": true,
        "hasQuery": false
    },
    {
        "method": "delete",
        "path": "/chat/devices/{deviceId}",
        "operationId": "chatControllerRevokeMlsDevice",
        "pathParameters": [
            "deviceId"
        ],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "get",
        "path": "/chat/conversations/{id}",
        "operationId": "chatControllerGet",
        "pathParameters": [
            "id"
        ],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "patch",
        "path": "/chat/conversations/{id}",
        "operationId": "chatControllerRename",
        "pathParameters": [
            "id"
        ],
        "hasBody": true,
        "hasQuery": false
    },
    {
        "method": "delete",
        "path": "/chat/conversations/{id}",
        "operationId": "chatControllerDeleteConversation",
        "pathParameters": [
            "id"
        ],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "get",
        "path": "/friends/invites/{token}",
        "operationId": "friendsControllerGetInvite",
        "pathParameters": [
            "token"
        ],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "get",
        "path": "/backups/download/{name}",
        "operationId": "backupDownloadControllerDownload",
        "pathParameters": [
            "name"
        ],
        "hasBody": false,
        "hasQuery": true
    },
    {
        "method": "patch",
        "path": "/admin/mail/domains/{id}",
        "operationId": "adminMailControllerUpdateDomain",
        "pathParameters": [
            "id"
        ],
        "hasBody": true,
        "hasQuery": false
    },
    {
        "method": "delete",
        "path": "/admin/mail/domains/{id}",
        "operationId": "adminMailControllerRemoveDomain",
        "pathParameters": [
            "id"
        ],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "get",
        "path": "/admin/media/items/{id}",
        "operationId": "adminMediaControllerGet",
        "pathParameters": [
            "id"
        ],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "patch",
        "path": "/admin/media/items/{id}",
        "operationId": "adminMediaControllerUpdate",
        "pathParameters": [
            "id"
        ],
        "hasBody": true,
        "hasQuery": false
    },
    {
        "method": "delete",
        "path": "/admin/media/items/{id}",
        "operationId": "adminMediaControllerRemove",
        "pathParameters": [
            "id"
        ],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "patch",
        "path": "/admin/issues/{id}/chat",
        "operationId": "adminIssueReportsControllerSetChat",
        "pathParameters": [
            "id"
        ],
        "hasBody": true,
        "hasQuery": false
    },
    {
        "method": "post",
        "path": "/requests/{id}/approve",
        "operationId": "requestsControllerApprove",
        "pathParameters": [
            "id"
        ],
        "hasBody": true,
        "hasQuery": false
    },
    {
        "method": "post",
        "path": "/requests/{id}/decline",
        "operationId": "requestsControllerDecline",
        "pathParameters": [
            "id"
        ],
        "hasBody": true,
        "hasQuery": false
    },
    {
        "method": "post",
        "path": "/playlists/{id}/items",
        "operationId": "playlistsControllerAddItem",
        "pathParameters": [
            "id"
        ],
        "hasBody": true,
        "hasQuery": false
    },
    {
        "method": "put",
        "path": "/playlists/{id}/order",
        "operationId": "playlistsControllerReorder",
        "pathParameters": [
            "id"
        ],
        "hasBody": true,
        "hasQuery": false
    },
    {
        "method": "delete",
        "path": "/admin/backups/{name}",
        "operationId": "adminBackupsControllerRemove",
        "pathParameters": [
            "name"
        ],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "delete",
        "path": "/admin/api-keys/{id}",
        "operationId": "apiKeysControllerRevoke",
        "pathParameters": [
            "id"
        ],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "post",
        "path": "/requests/{id}/retry",
        "operationId": "requestsControllerRetry",
        "pathParameters": [
            "id"
        ],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "get",
        "path": "/media/browse/{kind}",
        "operationId": "mediaHomeControllerBrowse",
        "pathParameters": [
            "kind"
        ],
        "hasBody": false,
        "hasQuery": true
    },
    {
        "method": "get",
        "path": "/profiles/{username}",
        "operationId": "profilesControllerGet",
        "pathParameters": [
            "username"
        ],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "get",
        "path": "/sentry/config/{app}",
        "operationId": "sentryControllerGetConfig",
        "pathParameters": [
            "app"
        ],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "post",
        "path": "/setup/steps/{step}",
        "operationId": "setupControllerApplyStep",
        "pathParameters": [
            "step"
        ],
        "hasBody": true,
        "hasQuery": false
    },
    {
        "method": "delete",
        "path": "/admin/devices/{id}",
        "operationId": "devicesControllerSignOut",
        "pathParameters": [
            "id"
        ],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "delete",
        "path": "/admin/plugins/{id}",
        "operationId": "pluginsControllerUninstall",
        "pathParameters": [
            "id"
        ],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "delete",
        "path": "/notifications/{id}",
        "operationId": "notificationsControllerRemove",
        "pathParameters": [
            "id"
        ],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "put",
        "path": "/favorites/{itemId}",
        "operationId": "favoritesControllerAdd",
        "pathParameters": [
            "itemId"
        ],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "delete",
        "path": "/favorites/{itemId}",
        "operationId": "favoritesControllerRemove",
        "pathParameters": [
            "itemId"
        ],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "post",
        "path": "/friends/{username}",
        "operationId": "friendsControllerRequest",
        "pathParameters": [
            "username"
        ],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "delete",
        "path": "/friends/{username}",
        "operationId": "friendsControllerRemove",
        "pathParameters": [
            "username"
        ],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "get",
        "path": "/mail/messages/{id}",
        "operationId": "userMailControllerGet",
        "pathParameters": [
            "id"
        ],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "delete",
        "path": "/mail/messages/{id}",
        "operationId": "userMailControllerRemove",
        "pathParameters": [
            "id"
        ],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "get",
        "path": "/media/people/{id}",
        "operationId": "mediaHomeControllerPerson",
        "pathParameters": [
            "id"
        ],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "get",
        "path": "/admin/issues/{id}",
        "operationId": "adminIssueReportsControllerGet",
        "pathParameters": [
            "id"
        ],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "delete",
        "path": "/admin/issues/{id}",
        "operationId": "adminIssueReportsControllerDelete",
        "pathParameters": [
            "id"
        ],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "get",
        "path": "/themes/items/{id}",
        "operationId": "themesControllerAudio",
        "pathParameters": [
            "id"
        ],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "get",
        "path": "/media/items/{id}",
        "operationId": "mediaHomeControllerItem",
        "pathParameters": [
            "id"
        ],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "patch",
        "path": "/admin/users/{id}",
        "operationId": "adminUsersControllerUpdate",
        "pathParameters": [
            "id"
        ],
        "hasBody": true,
        "hasQuery": false
    },
    {
        "method": "delete",
        "path": "/admin/users/{id}",
        "operationId": "adminUsersControllerRemove",
        "pathParameters": [
            "id"
        ],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "put",
        "path": "/settings/{key}",
        "operationId": "settingsControllerUpdate",
        "pathParameters": [
            "key"
        ],
        "hasBody": true,
        "hasQuery": false
    },
    {
        "method": "get",
        "path": "/playlists/{id}",
        "operationId": "playlistsControllerGet",
        "pathParameters": [
            "id"
        ],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "patch",
        "path": "/playlists/{id}",
        "operationId": "playlistsControllerUpdate",
        "pathParameters": [
            "id"
        ],
        "hasBody": true,
        "hasQuery": false
    },
    {
        "method": "delete",
        "path": "/playlists/{id}",
        "operationId": "playlistsControllerRemove",
        "pathParameters": [
            "id"
        ],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "delete",
        "path": "/requests/{id}",
        "operationId": "requestsControllerRemove",
        "pathParameters": [
            "id"
        ],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "get",
        "path": "/parties/{id}",
        "operationId": "partiesControllerGet",
        "pathParameters": [
            "id"
        ],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "delete",
        "path": "/parties/{id}",
        "operationId": "partiesControllerEnd",
        "pathParameters": [
            "id"
        ],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "get",
        "path": "/issues/{id}",
        "operationId": "issueReportsControllerGet",
        "pathParameters": [
            "id"
        ],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "get",
        "path": "/users/{id}",
        "operationId": "userControllerGetUser",
        "pathParameters": [
            "id"
        ],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "delete",
        "path": "/users/{id}",
        "operationId": "userControllerDeleteUser",
        "pathParameters": [
            "id"
        ],
        "hasBody": true,
        "hasQuery": false
    },
    {
        "method": "post",
        "path": "/chat/conversations/{id}/mls/key-packages/{keyPackageId}/claim",
        "operationId": "chatControllerClaimMlsKeyPackage",
        "pathParameters": [
            "id",
            "keyPackageId"
        ],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "post",
        "path": "/chat/conversations/{id}/mls/welcomes/{welcomeId}/ack",
        "operationId": "chatControllerAcknowledgeMlsWelcome",
        "pathParameters": [
            "id",
            "welcomeId"
        ],
        "hasBody": true,
        "hasQuery": false
    },
    {
        "method": "get",
        "path": "/admin/mail/messages/{id}/attachments/{attachmentId}",
        "operationId": "adminMailControllerAttachment",
        "pathParameters": [
            "id",
            "attachmentId"
        ],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "delete",
        "path": "/admin/payments/users/{userId}/methods/{methodId}",
        "operationId": "adminPaymentsControllerRemoveUserMethod",
        "pathParameters": [
            "userId",
            "methodId"
        ],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "get",
        "path": "/mail/messages/{id}/attachments/{attachmentId}",
        "operationId": "userMailControllerAttachment",
        "pathParameters": [
            "id",
            "attachmentId"
        ],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "post",
        "path": "/jobs/queues/{queueName}/jobs/{jobId}/retry",
        "operationId": "jobsControllerRetryJob",
        "pathParameters": [
            "queueName",
            "jobId"
        ],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "delete",
        "path": "/chat/conversations/{id}/members/{username}",
        "operationId": "chatControllerRemoveMember",
        "pathParameters": [
            "id",
            "username"
        ],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "post",
        "path": "/admin/indexer/tasks/{queue}/{id}/cancel",
        "operationId": "adminIndexerControllerCancelTask",
        "pathParameters": [
            "queue",
            "id"
        ],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "post",
        "path": "/admin/indexer/tasks/{queue}/{id}/retry",
        "operationId": "adminIndexerControllerRetryTask",
        "pathParameters": [
            "queue",
            "id"
        ],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "put",
        "path": "/admin/media/items/{id}/segments/{type}",
        "operationId": "adminMediaControllerSetSegment",
        "pathParameters": [
            "id",
            "type"
        ],
        "hasBody": true,
        "hasQuery": false
    },
    {
        "method": "delete",
        "path": "/admin/media/items/{id}/segments/{type}",
        "operationId": "adminMediaControllerClearSegment",
        "pathParameters": [
            "id",
            "type"
        ],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "get",
        "path": "/admin/indexer/tasks/{queue}/{id}/logs",
        "operationId": "adminIndexerControllerTaskLogs",
        "pathParameters": [
            "queue",
            "id"
        ],
        "hasBody": false,
        "hasQuery": true
    },
    {
        "method": "get",
        "path": "/admin/media/items/{id}/images/{index}",
        "operationId": "adminMediaControllerImage",
        "pathParameters": [
            "id",
            "index"
        ],
        "hasBody": false,
        "hasQuery": true
    },
    {
        "method": "delete",
        "path": "/admin/media/items/{id}/images/{index}",
        "operationId": "adminMediaControllerRemoveImage",
        "pathParameters": [
            "id",
            "index"
        ],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "get",
        "path": "/jobs/queues/{queueName}/jobs/{jobId}",
        "operationId": "jobsControllerGetJob",
        "pathParameters": [
            "queueName",
            "jobId"
        ],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "delete",
        "path": "/jobs/queues/{queueName}/jobs/{jobId}",
        "operationId": "jobsControllerCancelJob",
        "pathParameters": [
            "queueName",
            "jobId"
        ],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "post",
        "path": "/requests/webhook/{kind}/{serviceId}",
        "operationId": "requestWebhookControllerReceive",
        "pathParameters": [
            "kind",
            "serviceId"
        ],
        "hasBody": true,
        "hasQuery": false
    },
    {
        "method": "get",
        "path": "/requests/images/tmdb/{size}/{file}",
        "operationId": "requestImagesControllerTmdb",
        "pathParameters": [
            "size",
            "file"
        ],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "get",
        "path": "/media/items/{id}/images/{index}",
        "operationId": "mediaHomeControllerImage",
        "pathParameters": [
            "id",
            "index"
        ],
        "hasBody": false,
        "hasQuery": true
    },
    {
        "method": "post",
        "path": "/plugins/{pluginId}/{operation}",
        "operationId": "pluginRuntimeControllerInvoke",
        "pathParameters": [
            "pluginId",
            "operation"
        ],
        "hasBody": true,
        "hasQuery": false
    },
    {
        "method": "delete",
        "path": "/playlists/{id}/items/{itemId}",
        "operationId": "playlistsControllerRemoveTrack",
        "pathParameters": [
            "id",
            "itemId"
        ],
        "hasBody": false,
        "hasQuery": false
    },
    {
        "method": "get",
        "path": "/requests/details/{type}/{id}",
        "operationId": "requestsControllerDetails",
        "pathParameters": [
            "type",
            "id"
        ],
        "hasBody": false,
        "hasQuery": false
    }
];
