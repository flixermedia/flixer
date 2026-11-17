import { User } from "../entities/user.entity.js";
import { UserSession } from "../entities/userSession.entity.js";
import { ExternalIdentity } from "../entities/externalIdentity.entity.js";
import { ExternalAuthFlow } from "../entities/externalAuthFlow.entity.js";
import { ExternalOAuthProvider } from "../entities/externalOAuthProvider.entity.js";
import { MediaOrganizationPlan, MediaOrganizationPlanAudit, MediaOrganizationSettings } from "../entities/mediaOrganization.entity.js";
import { Setting } from "../entities/setting.entity.js";
import { UserPreference } from "../entities/userPreference.entity.js";
import { UserAccessPolicy } from "../entities/userAccessPolicy.entity.js";
import { GuideSettings, GuideSource } from "../entities/guideSource.entity.js";
import { GuideProgramme } from "../entities/guideProgramme.entity.js";
import { MailServerSettings } from "../entities/mailServerSettings.entity.js";
import { MailDomain } from "../entities/mailDomain.entity.js";
import { Mailbox } from "../entities/mailbox.entity.js";
import { MailMessage } from "../entities/mailMessage.entity.js";
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
import { ApiKey } from "../entities/apiKey.entity.js";
import { MediaLibrary } from "../entities/mediaLibrary.entity.js";
import { MediaItem } from "../entities/mediaItem.entity.js";
import { NetworkShare } from "../entities/networkShare.entity.js";
import { WatchProgress } from "../entities/watchProgress.entity.js";
import { Favorite } from "../entities/favorite.entity.js";
import { Playlist } from "../entities/playlist.entity.js";
import { PlaylistItem } from "../entities/playlistItem.entity.js";
import { ListeningHistory } from "../entities/listeningHistory.entity.js";
import { MediaCredit } from "../entities/mediaCredit.entity.js";
import { PersonProfile } from "../entities/personProfile.entity.js";
import { Notification } from "../entities/notification.entity.js";
import { PushSubscription } from "../entities/pushSubscription.entity.js";
import { PushKey } from "../entities/pushKey.entity.js";
import { MediaSegment } from "../entities/mediaSegment.entity.js";
import { PluginInstallation } from "../entities/pluginInstallation.entity.js";
import { PluginRepository } from "../entities/pluginRepository.entity.js";
import { PluginUpdateHistory } from "../entities/pluginUpdateHistory.entity.js";
import { PluginStorageEntry } from "../entities/pluginStorageEntry.entity.js";
import { PluginSecret } from "../entities/pluginSecret.entity.js";
import { MediaRequest } from "../entities/mediaRequest.entity.js";
import { RequestService } from "../entities/requestService.entity.js";
import { RequestUserLimit } from "../entities/requestUserLimit.entity.js";
import { PasskeyChallenge } from "../entities/passkeyChallenge.entity.js";
import { PasskeyCredential } from "../entities/passkeyCredential.entity.js";
import { NativePasskeyHandoff } from "../entities/nativePasskeyHandoff.entity.js";
import { AiRecommendationCache } from "../entities/aiRecommendationCache.entity.js";
import { QuickConnectRequest } from "../entities/quickConnectRequest.entity.js";
import { Theme } from "../entities/theme.entity.js";
import { ThemeVersion } from "../entities/themeVersion.entity.js";
import { PlaybackHistory } from "../entities/playbackHistory.entity.js";
import { IssueReport, IssueReportUpdate } from "../entities/issueReport.entity.js";
import { ChatConversation } from "../entities/chatConversation.entity.js";
import { OidcArtifact, OidcClient, OidcConfig, OidcConsent } from "../entities/oidc.entity.js";
import { SocialFriendInvite, SocialFriendship } from "../entities/social.entity.js";
import { VideoCollection, VideoCollectionItem } from "../entities/videoCollection.entity.js";
import { RecommendationFeedback, UpNextQueueItem, WatchLaterItem } from "../entities/userMediaQueue.entity.js";

export const ENTITIES = [
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
	IssueReport,
	IssueReportUpdate,
	ChatConversation,
	OidcClient,
	OidcArtifact,
	OidcConfig,
	OidcConsent,
	SocialFriendship,
	SocialFriendInvite,
	VideoCollection,
	VideoCollectionItem,
	UpNextQueueItem,
	WatchLaterItem,
	RecommendationFeedback,
];
