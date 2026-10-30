import type { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';
export interface RegisterRequest {
    /**
       * @minLength 3
       * @maxLength 64
       * @pattern ^[a-zA-Z0-9_.-]+$
       */
    username: string;
    /**
       * @minLength 1
       * @maxLength 64
       */
    displayName?: string;
    /**
       * @minLength 1
       * @maxLength 254
       */
    email: string;
    /**
       * @minLength 8
       * @maxLength 128
       */
    password: string;
}
export interface UpdateProfileRequest {
    /**
       * @minLength 1
       * @maxLength 64
       */
    displayName?: string;
    /** @maxLength 254 */
    email?: string;
}
export interface SetPasskeyRequiredRequest {
    enabled: boolean;
    password?: string;
}
export interface ChangePasswordRequest {
    /**
       * @minLength 1
       * @maxLength 128
       */
    currentPassword: string;
    /**
       * @minLength 8
       * @maxLength 128
       */
    newPassword: string;
}
export interface DeleteAccountRequest {
    /**
       * @minLength 1
       * @maxLength 128
       */
    password: string;
}
export interface VerifyEmailRequest {
    /**
       * @minLength 1
       * @maxLength 1024
       */
    token: string;
}
export interface LoginRequest {
    /**
       * @minLength 3
       * @maxLength 64
       * @pattern ^[a-zA-Z0-9_.-]+$
       */
    username: string;
    /**
       * @minLength 1
       * @maxLength 128
       */
    password: string;
}
export interface GenericError {
    /**
       * The error name
       * @minLength 1
       */
    name: string;
    /**
       * An error message
       * @minLength 1
       */
    message: string;
    [key: string]: unknown;
}
export interface BadRequest {
    /**
       * The error name
       * @minLength 1
       */
    name: string;
    /**
       * An error message
       * @minLength 1
       */
    message: string;
    /** The status code of the exception */
    status: number;
    /** A list of related errors */
    errors?: GenericError[];
    /** The stack trace (only in development mode) */
    stack?: string;
}
export type PasskeyVerifyRequestResponse = null | number | string | boolean | unknown[] | {
    [key: string]: unknown;
};
export interface PasskeyVerifyRequest {
    response: PasskeyVerifyRequestResponse;
    /** @maxLength 64 */
    name?: string;
}
export type PasskeySecondFactorRequestResponse = null | number | string | boolean | unknown[] | {
    [key: string]: unknown;
};
export interface PasskeySecondFactorRequest {
    /**
       * @minLength 1
       * @maxLength 1024
       */
    ticket: string;
    response?: PasskeySecondFactorRequestResponse;
}
export interface NativePasskeyHandoffStartRequest {
    /**
       * @minLength 43
       * @maxLength 43
       * @pattern ^[A-Za-z0-9_-]+$
       */
    codeChallenge: string;
    /**
       * @minLength 16
       * @maxLength 64
       * @pattern ^[A-Za-z0-9_-]+$
       */
    state: string;
    /** @maxLength 1024 */
    ticket?: string;
}
export interface NativePasskeyHandoffIdRequest {
    /**
       * @minLength 43
       * @maxLength 43
       * @pattern ^[A-Za-z0-9_-]+$
       */
    handoffId: string;
}
export type NativePasskeyHandoffVerifyRequestResponse = null | number | string | boolean | unknown[] | {
    [key: string]: unknown;
};
export interface NativePasskeyHandoffVerifyRequest {
    /**
       * @minLength 43
       * @maxLength 43
       * @pattern ^[A-Za-z0-9_-]+$
       */
    handoffId: string;
    response: NativePasskeyHandoffVerifyRequestResponse;
}
export interface NativePasskeyHandoffExchangeRequest {
    /**
       * @minLength 43
       * @maxLength 43
       * @pattern ^[A-Za-z0-9_-]+$
       */
    code: string;
    /**
       * @minLength 43
       * @maxLength 128
       * @pattern ^[A-Za-z0-9_-]+$
       */
    codeVerifier: string;
    /**
       * @minLength 16
       * @maxLength 64
       * @pattern ^[A-Za-z0-9_-]+$
       */
    state: string;
}
export interface DeleteUserRequest {
    /**
       * @minLength 8
       * @maxLength 128
       */
    password?: string;
}
export interface DashboardGridItemRequest {
    /** @minLength 1 */
    id: string;
    x: number;
    y: number;
    w: number;
    h: number;
}
export interface UpdatePreferencesRequest {
    /** @nullable */
    language?: string | null;
    /** @nullable */
    adminDashboardGrid?: DashboardGridItemRequest[] | null;
    /**
       * @minimum 2
       * @maximum 8
       * @nullable
       */
    browseColumns?: number | null;
    /** @nullable */
    autoSkipIntroCredits?: boolean | null;
    [key: string]: unknown;
}
/**
 * @nullable
 */
export type SettingRequestValue = number | string | boolean | unknown[] | {
    [key: string]: unknown;
} | null;
export interface SettingRequest {
    /** @nullable */
    value: SettingRequestValue;
}
export type EnqueueJobRequestData = {
    [key: string]: unknown;
};
export interface EnqueueJobRequest {
    data?: EnqueueJobRequestData;
}
export type ScheduleJobRequestData = {
    [key: string]: unknown;
};
export interface ScheduleJobRequest {
    /**
       * @minLength 1
       * @maxLength 128
       */
    cron: string;
    data?: ScheduleJobRequestData;
}
export interface AdminScheduledTaskScheduleRequest {
    enabled: boolean;
    /**
       * @minLength 1
       * @maxLength 128
       */
    cron: string;
}
export interface CreateApiKeyRequest {
    /**
       * @minLength 1
       * @maxLength 100
       */
    name: string;
}
/**
 * @minLength 1
 */
export type CreateMediaLibraryRequestType = typeof CreateMediaLibraryRequestType[keyof typeof CreateMediaLibraryRequestType];
export declare const CreateMediaLibraryRequestType: {
    readonly movies: "movies";
    readonly tvshows: "tvshows";
    readonly music: "music";
    readonly homevideos: "homevideos";
    readonly mixed: "mixed";
};
export type CreateMediaLibraryRequestImageStorage = typeof CreateMediaLibraryRequestImageStorage[keyof typeof CreateMediaLibraryRequestImageStorage];
export declare const CreateMediaLibraryRequestImageStorage: {
    readonly cache: "cache";
    readonly alongside: "alongside";
};
export interface MediaLibraryFolderRequest {
    /**
       * @minLength 1
       * @maxLength 64
       */
    rootId: string;
    /** @maxLength 4096 */
    path: string;
}
export interface CreateMediaLibraryRequest {
    /**
       * @minLength 1
       * @maxLength 100
       */
    name: string;
    /** @minLength 1 */
    type: CreateMediaLibraryRequestType;
    imageStorage?: CreateMediaLibraryRequestImageStorage;
    /**
       * @minItems 1
       * @maxItems 50
       */
    folders: MediaLibraryFolderRequest[];
}
export type UpdateMediaLibraryRequestType = typeof UpdateMediaLibraryRequestType[keyof typeof UpdateMediaLibraryRequestType];
export declare const UpdateMediaLibraryRequestType: {
    readonly movies: "movies";
    readonly tvshows: "tvshows";
    readonly music: "music";
    readonly homevideos: "homevideos";
    readonly mixed: "mixed";
};
export type UpdateMediaLibraryRequestImageStorage = typeof UpdateMediaLibraryRequestImageStorage[keyof typeof UpdateMediaLibraryRequestImageStorage];
export declare const UpdateMediaLibraryRequestImageStorage: {
    readonly cache: "cache";
    readonly alongside: "alongside";
};
export interface UpdateMediaLibraryRequest {
    /**
       * @minLength 1
       * @maxLength 100
       */
    name?: string;
    type?: UpdateMediaLibraryRequestType;
    imageStorage?: UpdateMediaLibraryRequestImageStorage;
    /**
       * @minItems 1
       * @maxItems 50
       */
    folders?: MediaLibraryFolderRequest[];
}
export interface ScanLibraryRequest {
    force?: boolean;
    trickplayOnly?: boolean;
    jobs?: unknown[];
}
/**
 * @minLength 1
 */
export type LibrarySegmentScanRequestType = typeof LibrarySegmentScanRequestType[keyof typeof LibrarySegmentScanRequestType];
export declare const LibrarySegmentScanRequestType: {
    readonly movie: "movie";
    readonly episode: "episode";
};
export interface LibrarySegmentScanRequest {
    /** @minLength 1 */
    type: LibrarySegmentScanRequestType;
}
/**
 * @minLength 1
 */
export type RefreshItemRequestItemType = typeof RefreshItemRequestItemType[keyof typeof RefreshItemRequestItemType];
export declare const RefreshItemRequestItemType: {
    readonly movie: "movie";
    readonly series: "series";
    readonly season: "season";
    readonly episode: "episode";
    readonly album: "album";
    readonly track: "track";
    readonly video: "video";
};
export interface RefreshItemRequest {
    /**
       * @minLength 1
       * @maxLength 64
       */
    libraryId: string;
    /**
       * @minLength 1
       * @maxLength 4096
       */
    path: string;
    /** @minLength 1 */
    itemType: RefreshItemRequestItemType;
}
/**
 * @minLength 1
 */
export type CreateMediaRequestType = typeof CreateMediaRequestType[keyof typeof CreateMediaRequestType];
export declare const CreateMediaRequestType: {
    readonly movie: "movie";
    readonly tv: "tv";
    readonly music: "music";
};
export interface CreateMediaRequest {
    /** @minLength 1 */
    type: CreateMediaRequestType;
    /**
       * @minLength 1
       * @maxLength 12
       */
    externalId: string;
    /** @maxItems 200 */
    seasons?: number[];
    /** @maxLength 36 */
    serviceId?: string;
    qualityProfileId?: number;
    /** @maxLength 500 */
    rootFolder?: string;
}
export interface ApproveRequestBody {
    /** @maxLength 36 */
    serviceId?: string;
    qualityProfileId?: number;
    /** @maxLength 500 */
    rootFolder?: string;
}
export interface DeclineRequestBody {
    /**
       * @maxLength 500
       * @nullable
       */
    reason?: string | null;
}
/**
 * @minLength 1
 */
export type TestServiceInputKind = typeof TestServiceInputKind[keyof typeof TestServiceInputKind];
export declare const TestServiceInputKind: {
    readonly sonarr: "sonarr";
    readonly radarr: "radarr";
    readonly lidarr: "lidarr";
};
export interface TestServiceInput {
    /** @minLength 1 */
    kind: TestServiceInputKind;
    /**
       * @minLength 1
       * @maxLength 500
       */
    url: string;
    /** @maxLength 200 */
    apiKey?: string;
    /** @maxLength 36 */
    serviceId?: string;
}
/**
 * @minLength 1
 */
export type RequestServiceInputKind = typeof RequestServiceInputKind[keyof typeof RequestServiceInputKind];
export declare const RequestServiceInputKind: {
    readonly sonarr: "sonarr";
    readonly radarr: "radarr";
    readonly lidarr: "lidarr";
};
export interface RequestServiceInput {
    /** @minLength 1 */
    kind: RequestServiceInputKind;
    /**
       * @minLength 1
       * @maxLength 100
       */
    name: string;
    /**
       * @minLength 1
       * @maxLength 500
       */
    url: string;
    /** @maxLength 200 */
    apiKey?: string;
    isDefault?: boolean;
    enabled?: boolean;
    /**
       * @minLength 1
       * @maxLength 36
       */
    libraryId: string;
    /**
       * @minLength 1
       * @maxLength 500
       */
    rootFolder: string;
    qualityProfileId: number;
    /** @nullable */
    metadataProfileId?: number | null;
    /** @nullable */
    languageProfileId?: number | null;
    /**
       * @maxLength 16
       * @nullable
       */
    minimumAvailability?: string | null;
    seasonFolders?: boolean;
    /** @maxItems 50 */
    tags?: number[];
}
export interface RequestUserLimitInput {
    /** @nullable */
    canRequest?: boolean | null;
    /** @nullable */
    autoApprove?: boolean | null;
    /** @nullable */
    quotaLimit?: number | null;
    /** @nullable */
    quotaDays?: number | null;
}
export interface SubtitleSearchRequest {
    /** @maxLength 200 */
    query?: string;
    /** @items.pattern ^[A-Za-z]{2,3}([-_][A-Za-z0-9]{2,4})?$ */
    languages?: string[];
}
export interface SubtitleDownloadRequest {
    /** @minimum 1 */
    fileId: number;
    /**
       * @minLength 1
       * @pattern ^[A-Za-z]{2,3}([-_][A-Za-z0-9]{2,4})?$
       */
    language: string;
}
export interface SetSegmentRequest {
    /** @minimum 0 */
    startMs: number;
    /** @minimum 1 */
    endMs: number;
}
export type UpdateMediaItemRequestProviderIds = {
    [key: string]: string | null;
};
export interface UpdateMediaItemRequest {
    /** @maxLength 1000 */
    title?: string;
    /**
       * @maxLength 1000
       * @nullable
       */
    sortTitle?: string | null;
    /**
       * @minimum 0
       * @nullable
       */
    year?: number | null;
    /**
       * @minimum 0
       * @nullable
       */
    seasonNumber?: number | null;
    /**
       * @minimum 0
       * @nullable
       */
    episodeNumber?: number | null;
    /**
       * @minimum 0
       * @nullable
       */
    episodeEndNumber?: number | null;
    /**
       * @maxLength 20000
       * @nullable
       */
    overview?: string | null;
    providerIds?: UpdateMediaItemRequestProviderIds;
}
export interface RefreshMediaItemRequest {
    priority?: boolean;
}
export interface WatchProgressRequest {
    /** @minimum 0 */
    positionSeconds: number;
    /** @minimum 0 */
    durationSeconds: number;
}
export interface WatchedRequest {
    watched: boolean;
}
export type CreateNetworkShareRequestProtocol = typeof CreateNetworkShareRequestProtocol[keyof typeof CreateNetworkShareRequestProtocol];
export declare const CreateNetworkShareRequestProtocol: {
    readonly smb: "smb";
};
export interface CreateNetworkShareRequest {
    /**
       * @minLength 1
       * @maxLength 100
       */
    name: string;
    /**
       * @minLength 1
       * @maxLength 255
       */
    host: string;
    /**
       * @minLength 1
       * @maxLength 255
       */
    share: string;
    protocol?: CreateNetworkShareRequestProtocol;
    /** @maxLength 255 */
    username?: string;
    /** @maxLength 64 */
    domain?: string;
    /** @maxLength 512 */
    password?: string;
    readOnly?: boolean;
}
export interface UpdateNetworkShareRequest {
    /**
       * @minLength 1
       * @maxLength 100
       */
    name?: string;
    /**
       * @minLength 1
       * @maxLength 255
       */
    host?: string;
    /**
       * @minLength 1
       * @maxLength 255
       */
    share?: string;
    /** @maxLength 255 */
    username?: string;
    /** @maxLength 64 */
    domain?: string;
    /** @maxLength 512 */
    password?: string;
    readOnly?: boolean;
}
export type CreateAdminUserRequestRole = typeof CreateAdminUserRequestRole[keyof typeof CreateAdminUserRequestRole];
export declare const CreateAdminUserRequestRole: {
    readonly admin: "admin";
    readonly user: "user";
};
export interface CreateAdminUserRequest {
    /**
       * @minLength 3
       * @maxLength 64
       * @pattern ^[a-zA-Z0-9_.-]+$
       */
    username: string;
    /**
       * @minLength 1
       * @maxLength 64
       */
    displayName?: string;
    /**
       * @minLength 1
       * @maxLength 254
       */
    email: string;
    /**
       * @minLength 8
       * @maxLength 128
       */
    password: string;
    role?: CreateAdminUserRequestRole;
}
export type UpdateAdminUserRequestRole = typeof UpdateAdminUserRequestRole[keyof typeof UpdateAdminUserRequestRole];
export declare const UpdateAdminUserRequestRole: {
    readonly admin: "admin";
    readonly user: "user";
};
export interface UpdateAdminUserRequest {
    /**
       * @minLength 1
       * @maxLength 64
       */
    displayName?: string;
    /** @maxLength 254 */
    email?: string;
    role?: UpdateAdminUserRequestRole;
    disabled?: boolean;
}
export interface SetUserPasswordRequest {
    /**
       * @minLength 8
       * @maxLength 128
       */
    password: string;
}
export interface MarkReadRequest {
    /** @maxItems 100 */
    ids?: string[];
}
export interface PushKeysRequest {
    /**
       * @minLength 1
       * @maxLength 256
       */
    p256dh: string;
    /**
       * @minLength 1
       * @maxLength 128
       */
    auth: string;
}
export interface PushSubscriptionRequest {
    /**
       * @minLength 1
       * @maxLength 1024
       */
    endpoint: string;
    keys: PushKeysRequest;
}
export interface PushUnsubscribeRequest {
    /**
       * @minLength 1
       * @maxLength 1024
       */
    endpoint: string;
}
export interface SendNotificationRequest {
    /**
       * @minLength 1
       * @maxLength 120
       */
    title: string;
    /**
       * @minLength 1
       * @maxLength 500
       */
    body: string;
    /**
       * @maxLength 300
       * @nullable
       */
    url?: string | null;
    /** @maxItems 1000 */
    userIds?: string[];
}
export interface CreatePlaylistRequest {
    /**
       * @minLength 1
       * @maxLength 100
       */
    name: string;
    /**
       * @maxLength 500
       * @nullable
       */
    description?: string | null;
    isPublic?: boolean;
}
export interface UpdatePlaylistRequest {
    /**
       * @minLength 1
       * @maxLength 100
       */
    name?: string;
    /**
       * @maxLength 500
       * @nullable
       */
    description?: string | null;
    isPublic?: boolean;
}
export interface PlaylistItemRequest {
    /**
       * @minLength 1
       * @maxLength 36
       */
    itemId: string;
}
export interface PlaylistOrderRequest {
    /** @maxItems 5000 */
    itemIds: string[];
}
export type CreatePartyRequestVisibility = typeof CreatePartyRequestVisibility[keyof typeof CreatePartyRequestVisibility];
export declare const CreatePartyRequestVisibility: {
    readonly public: "public";
    readonly friends: "friends";
    readonly private: "private";
};
export interface CreatePartyRequest {
    /**
       * @minLength 1
       * @maxLength 36
       */
    itemId: string;
    visibility?: CreatePartyRequestVisibility;
}
export interface StartChatRequest {
    /** @maxLength 64 */
    username?: string;
    /** @maxLength 60 */
    name?: string;
    /** @maxItems 50 */
    usernames?: string[];
}
export interface RenameChatRequest {
    /**
       * @minLength 1
       * @maxLength 60
       */
    name: string;
}
export interface SendMessageRequest {
    /**
       * @minLength 1
       * @maxLength 2000
       */
    body: string;
}
export interface AddMembersRequest {
    /** @maxItems 50 */
    usernames: string[];
}
/**
 * @minLength 1
 */
export type UpdateProfileVisibilityRequestVisibility = typeof UpdateProfileVisibilityRequestVisibility[keyof typeof UpdateProfileVisibilityRequestVisibility];
export declare const UpdateProfileVisibilityRequestVisibility: {
    readonly public: "public";
    readonly hidden: "hidden";
    readonly friends: "friends";
};
export interface UpdateProfileVisibilityRequest {
    /** @minLength 1 */
    visibility: UpdateProfileVisibilityRequestVisibility;
}
/**
 * @minLength 1
 */
export type ListeningReportRequestState = typeof ListeningReportRequestState[keyof typeof ListeningReportRequestState];
export declare const ListeningReportRequestState: {
    readonly playing: "playing";
    readonly stopped: "stopped";
};
export interface ListeningReportRequest {
    /**
       * @minLength 1
       * @maxLength 36
       */
    itemId: string;
    /** @minLength 1 */
    state: ListeningReportRequestState;
    positionSeconds?: number;
}
/**
 * @minLength 1
 */
export type CreateFriendInviteRequestMode = typeof CreateFriendInviteRequestMode[keyof typeof CreateFriendInviteRequestMode];
export declare const CreateFriendInviteRequestMode: {
    readonly once: "once";
    readonly unlimited: "unlimited";
    readonly expires: "expires";
};
export interface CreateFriendInviteRequest {
    /** @minLength 1 */
    mode: CreateFriendInviteRequestMode;
    /**
       * @minimum 1
       * @maximum 8760
       */
    expiresInHours?: number;
}
export interface BootstrapSetupStatusSetupStatus {
    state: 'not_started' | 'in_progress' | 'completed' | 'recovery_required';
    mode: 'bootstrap' | 'ready';
    database: 'ok' | 'unconfigured' | 'unavailable';
    persistent: boolean;
}
export interface ConfigStoreRedisConfigRedisConnection {
    addr: string;
    username: string;
    password: string;
    db: number;
    tls: boolean;
}
export interface BootstrapInternalConfigIndexerRuntimeConfig {
    version: number;
    redis: null | ConfigStoreRedisConfigRedisConnection;
}
export type ApiAuthAuthServiceAuthResultSession = {
    id: string;
    expiresAt: string;
};
export type ApiAuthAuthServiceAuthResultUser = {
    id: string;
    username: string;
    displayName: string;
    email: null | string;
    role: 'admin' | 'user';
};
export interface ApiAuthAuthServiceAuthResult {
    accessToken: string;
    tokenType: 'Bearer';
    expiresIn: number;
    session: ApiAuthAuthServiceAuthResultSession;
    user: ApiAuthAuthServiceAuthResultUser;
}
export interface ApiAuthAuthServiceVerificationPending {
    verificationRequired: true;
    email: string;
}
export interface ApiAuthAuthServicePublicUser {
    id: string;
    username: string;
    displayName: string;
    email: null | string;
    emailVerified: boolean;
    pendingEmail: null | string;
    passkeyRequired: boolean;
    avatarUrl: null | string;
    role: 'admin' | 'user';
    createdAt: string;
}
export interface ApiAuthAuthServicePasskeyRequired {
    passkeyRequired: true;
    ticket: string;
}
export interface ApiAuthAuthServicePublicSession {
    id: string;
    createdAt: string;
    expiresAt: string;
    current: boolean;
}
export interface ApiAuthPasskeyServicePublicPasskey {
    id: string;
    name: string;
    deviceType: string;
    backedUp: boolean;
    transports: string[];
    createdAt: string;
    lastUsedAt: null | string;
}
export interface ApiPreferencesPreferencesServiceDashboardGridItem {
    id: string;
    x: number;
    y: number;
    w: number;
    h: number;
}
export interface ApiPreferencesPreferencesServicePreferences {
    language?: string;
    adminDashboardGrid?: ApiPreferencesPreferencesServiceDashboardGridItem[];
    browseColumns?: number;
    autoSkipIntroCredits: boolean;
}
export interface ApiSettingsSettingsServicePublicSetting {
    key: string;
    value: unknown;
    isPublic: boolean;
    updatedAt: string;
}
export interface ApiPlaybackPlaybackServiceSampleVideo {
    id: string;
    title: string;
    container: string;
    directPlay: boolean;
}
export type ApiPlaybackPlaybackServicePlaybackInfoMediaSource = ApiPlaybackPlaybackServiceSampleVideo & {
    mediaSourceId: string;
    streamUrl: string;
};
export interface ApiPlaybackPlaybackServicePlaybackInfo {
    playSessionId: string;
    mediaSource: ApiPlaybackPlaybackServicePlaybackInfoMediaSource;
    expiresAt: string;
}
export interface ApiPlaybackNextEpisodeNextEpisode {
    id: string;
    title: string;
    seasonNumber: null | number;
    episodeNumber: null | number;
}
export interface ApiMediaSegmentLogicChapter {
    title: string;
    startMs: number;
    endMs: number;
}
export interface ApiMediaSegmentLogicResolvedSegment {
    type: 'intro' | 'recap' | 'credits' | 'preview' | 'commercial';
    startMs: number;
    endMs: number;
    source: 'manual' | 'theintrodb' | 'plugin' | 'chapter';
}
export interface ApiMediaMediaSegmentsServiceItemSegments {
    chapters: ApiMediaSegmentLogicChapter[];
    segments: ApiMediaSegmentLogicResolvedSegment[];
}
export interface JobsJobSchedulerAdminTaskRunStatus {
    id: 'scan-libraries' | 'refresh-metadata' | 'trickplay' | 'clean-transcode' | 'clean-logs' | 'optimize-database';
    name: string;
    category: string;
    description: string;
    enabled: boolean;
    cron: string;
    state: 'completed' | 'cancelled' | 'failed' | 'running' | 'queued' | 'never';
    lastRunAt: null | string;
    lastError?: string;
    progress?: number;
}
export interface ApiStreamsStreamsServiceStreamerSource {
    videoCodec: string;
    audioCodec?: string;
    width: number;
    height: number;
    durationSeconds: number;
}
export type ApiStreamsStreamsServiceStreamSessionUser = {
    username: string;
    displayName: string;
} | null;
export interface ApiStreamsStreamsServiceStreamSession {
    user: ApiStreamsStreamsServiceStreamSessionUser;
    id: string;
    userId?: string;
    mediaItemId?: string;
    file: string;
    delivery: 'progressive' | 'hls';
    remoteAddr?: string;
    userAgent?: string;
    source: ApiStreamsStreamsServiceStreamerSource;
    mode: 'DirectPlay' | 'DirectStream' | 'Transcode';
    height: number;
    positionSeconds: number;
    startedAt: string;
    lastActivityAt: string;
    bytesSent: number;
    running: boolean;
    pid?: number;
}
export interface ApiStreamsStreamsServiceStreamSessionsResponse {
    sessions: ApiStreamsStreamsServiceStreamSession[];
    transcodingAvailable: boolean;
    maxTranscodes: number;
    activeTranscodes: number;
}
export type ApiDevicesDevicesServicePublicDeviceUser = {
    id: string;
    username: string;
    displayName: string;
};
export interface ApiDevicesDevicesServicePublicDevice {
    id: string;
    device: string;
    app: string;
    user: ApiDevicesDevicesServicePublicDeviceUser;
    ipAddress: null | string;
    createdAt: string;
    lastSeenAt: string;
    current: boolean;
}
export type ApiApiKeysApiKeyServicePublicApiKeyOwner = {
    id: string;
    username: string;
    displayName: string;
};
export interface ApiApiKeysApiKeyServicePublicApiKey {
    id: string;
    name: string;
    prefix: string;
    owner: ApiApiKeysApiKeyServicePublicApiKeyOwner;
    createdAt: string;
    lastUsedAt: null | string;
}
export type ApiApiKeysApiKeyServiceCreatedApiKeyOwner = {
    id: string;
    username: string;
    displayName: string;
};
export interface ApiApiKeysApiKeyServiceCreatedApiKey {
    secret: string;
    id: string;
    name: string;
    prefix: string;
    owner: ApiApiKeysApiKeyServiceCreatedApiKeyOwner;
    createdAt: string;
    lastUsedAt: null | string;
}
export interface ApiMediaLibrariesMediaLibrariesServicePublicMediaLibraryFolder {
    rootName: string;
    location: string;
    available: boolean;
    rootId: string;
    path: string;
}
export interface ApiMediaLibrariesMediaLibrariesServicePublicMediaLibrary {
    id: string;
    name: string;
    type: 'movies' | 'tvshows' | 'music' | 'homevideos' | 'mixed';
    imageStorage: 'cache' | 'alongside';
    folders: ApiMediaLibrariesMediaLibrariesServicePublicMediaLibraryFolder[];
    createdAt: string;
}
export interface ApiMediaLibrariesMediaRootsServiceBrowseResult {
    rootId: string;
    path: string;
    directories: string[];
}
export interface ApiIndexerIndexerSettingsServiceIndexerProviderSetting {
    enabled: boolean;
    apiKey?: string;
}
export interface ApiIndexerIndexerSettingsServiceIndexerSubtitleSetting {
    apiKey: string;
    username: string;
    password: string;
    languages: string[];
    autoFetch: boolean;
}
export type ApiIndexerIndexerSettingsServiceIndexerSettingsProviders = {
    [key: string]: ApiIndexerIndexerSettingsServiceIndexerProviderSetting;
};
export type ApiIndexerIndexerSettingsServiceIndexerSettingsConcurrency = {
    [key: string]: number;
};
export type ApiIndexerIndexerSettingsServiceIndexerSettingsThemes = {
    enabled: boolean;
};
export type ApiIndexerIndexerSettingsServiceIndexerSettingsPluginsItem = {
    id: string;
    version: string;
    entry: string;
    backendEntry?: string;
    capabilities: string[];
};
export interface ApiIndexerIndexerSettingsServiceIndexerSettings {
    providers: ApiIndexerIndexerSettingsServiceIndexerSettingsProviders;
    concurrency: ApiIndexerIndexerSettingsServiceIndexerSettingsConcurrency;
    language: string;
    subtitles: ApiIndexerIndexerSettingsServiceIndexerSubtitleSetting;
    themes: ApiIndexerIndexerSettingsServiceIndexerSettingsThemes;
    plugins: ApiIndexerIndexerSettingsServiceIndexerSettingsPluginsItem[];
}
export type ApiIndexerIndexerIntroSegmentsServiceIntroSyncCandidateProviderIds = {
    [key: string]: string;
};
export interface ApiIndexerIndexerIntroSegmentsServiceIntroSyncCandidate {
    id: string;
    type: 'movie' | 'episode';
    providerIds: ApiIndexerIndexerIntroSegmentsServiceIntroSyncCandidateProviderIds;
    durationMs?: number;
    season?: number;
    episode?: number;
}
export interface ApiIndexerAdminIndexerServiceIndexerScan {
    libraryId: string;
    state: 'failed' | 'scanning' | 'indexing' | 'complete';
    discovered: number;
    done: number;
    failed: number;
    startedAt?: string;
    finishedAt?: string;
    error?: string;
}
export interface ApiIndexerAdminIndexerServiceIndexerQueueStats {
    queue: 'trickplay' | 'scan' | 'identify' | 'metadata' | 'images' | 'probe' | 'refresh' | 'themes' | 'lyrics' | 'intro-movies' | 'intro-episodes';
    pending: number;
    active: number;
    scheduled: number;
    retry: number;
    archived: number;
    completed: number;
    processed: number;
    failed: number;
    paused: boolean;
    latencyMs: number;
}
export type ApiIndexerAdminIndexerServiceIndexerStatusConcurrency = {
    [key: string]: number;
};
export interface ApiIndexerAdminIndexerServiceIndexerStatus {
    reachable: boolean;
    scans: ApiIndexerAdminIndexerServiceIndexerScan[];
    queues: ApiIndexerAdminIndexerServiceIndexerQueueStats[];
    concurrency: ApiIndexerAdminIndexerServiceIndexerStatusConcurrency;
    maxConcurrency: null | number;
    enabledProviders: string[];
}
export interface ApiIndexerAdminIndexerServiceIndexerTask {
    id: string;
    queue: 'trickplay' | 'scan' | 'identify' | 'metadata' | 'images' | 'probe' | 'refresh' | 'themes' | 'lyrics' | 'intro-movies' | 'intro-episodes' | 'identify-priority' | 'metadata-priority' | 'images-priority' | 'probe-priority' | 'refresh-priority';
    type: string;
    state: 'completed' | 'retry' | 'active' | 'pending' | 'scheduled' | 'archived';
    retried: number;
    maxRetry: number;
    lastError?: string;
    lastFailedAt?: string;
    libraryId?: string;
    libraryName?: string;
    itemType?: string;
    path?: string;
}
export interface ApiIndexerAdminIndexerServiceIndexerTaskPage {
    queue: 'trickplay' | 'scan' | 'identify' | 'metadata' | 'images' | 'probe' | 'refresh' | 'themes' | 'lyrics' | 'intro-movies' | 'intro-episodes' | 'identify-priority' | 'metadata-priority' | 'images-priority' | 'probe-priority' | 'refresh-priority';
    state: 'completed' | 'retry' | 'active' | 'pending' | 'scheduled' | 'archived';
    page: number;
    tasks: ApiIndexerAdminIndexerServiceIndexerTask[];
}
export interface ApiIndexerAdminIndexerServiceIndexerTaskLogEntry {
    time: string;
    level: string;
    message: string;
}
export interface ApiIndexerAdminIndexerServiceIndexerTaskLogs {
    queue: 'trickplay' | 'scan' | 'identify' | 'metadata' | 'images' | 'probe' | 'refresh' | 'themes' | 'lyrics' | 'intro-movies' | 'intro-episodes' | 'identify-priority' | 'metadata-priority' | 'images-priority' | 'probe-priority' | 'refresh-priority';
    id: string;
    state: '' | 'completed' | 'retry' | 'active' | 'pending' | 'scheduled' | 'archived';
    total: number;
    entries: ApiIndexerAdminIndexerServiceIndexerTaskLogEntry[];
}
export interface ApiPluginsPluginManifestPluginColumnDefinition {
    type: 'boolean' | 'text' | 'integer' | 'timestamp' | 'json' | 'uuid';
    primary?: false | true;
    nullable?: false | true;
    default?: null | string | number | false | true;
}
export type ApiPluginsPluginManifestPluginTableDefinitionColumns = {
    [key: string]: ApiPluginsPluginManifestPluginColumnDefinition;
};
export type ApiPluginsPluginManifestPluginTableDefinitionIndexesItem = {
    columns: string[];
    unique?: false | true;
};
export interface ApiPluginsPluginManifestPluginTableDefinition {
    columns: ApiPluginsPluginManifestPluginTableDefinitionColumns;
    indexes?: ApiPluginsPluginManifestPluginTableDefinitionIndexesItem[];
}
export interface ApiPluginsPluginManifestPluginUiPage {
    id: string;
    title: string;
    nav?: 'main';
    adminOnly?: false | true;
}
export type ApiPluginsPluginManifestPluginManifestCompatibility = {
    pluginApi: string;
    flixer?: string;
    'flixer-indexer'?: string;
    'flixer-streamer'?: string;
    'flixer-web'?: string;
};
export type ApiPluginsPluginManifestPluginManifestTargets = {
    [key: string]: unknown;
};
export type ApiPluginsPluginManifestPluginManifestDependencies = {
    [key: string]: string;
};
export type ApiPluginsPluginManifestPluginManifestOptionalDependencies = {
    [key: string]: string;
};
export type ApiPluginsPluginManifestPluginManifestDatabaseTables = {
    [key: string]: ApiPluginsPluginManifestPluginTableDefinition;
};
export type ApiPluginsPluginManifestPluginManifestDatabase = {
    tables: ApiPluginsPluginManifestPluginManifestDatabaseTables;
};
export type ApiPluginsPluginManifestPluginManifestSchedulesItem = {
    operation: string;
    intervalSeconds: number;
};
export type ApiPluginsPluginManifestPluginManifestUi = {
    pages?: ApiPluginsPluginManifestPluginUiPage[];
};
export interface ApiPluginsPluginManifestPluginManifest {
    manifestVersion: 1;
    id: string;
    name: string;
    version: string;
    description: string;
    author: string;
    license: string;
    homepage?: string;
    icon?: string;
    compatibility: ApiPluginsPluginManifestPluginManifestCompatibility;
    targets: ApiPluginsPluginManifestPluginManifestTargets;
    capabilities: string[];
    permissions: string[];
    dependencies?: ApiPluginsPluginManifestPluginManifestDependencies;
    optionalDependencies?: ApiPluginsPluginManifestPluginManifestOptionalDependencies;
    settingsSchema?: string;
    database?: ApiPluginsPluginManifestPluginManifestDatabase;
    schedules?: ApiPluginsPluginManifestPluginManifestSchedulesItem[];
    ui?: ApiPluginsPluginManifestPluginManifestUi;
}
export interface ApiPluginsRepositoryManifestPluginRelease {
    version: string;
    manifest: string;
    package: string;
    sha256: string;
    size?: number;
}
export type ApiPluginsRepositoryManifestPluginRepositoryManifestPluginsItem = {
    id: string;
    name: string;
    description: string;
    author: string;
    capabilities?: string[];
    permissions: string[];
    targets: ('flixer' | 'flixer-indexer' | 'flixer-streamer' | 'flixer-web')[];
    versions: ApiPluginsRepositoryManifestPluginRelease[];
};
export interface ApiPluginsRepositoryManifestPluginRepositoryManifest {
    manifestVersion: 1;
    id: string;
    name: string;
    description: string;
    plugins: ApiPluginsRepositoryManifestPluginRepositoryManifestPluginsItem[];
}
export interface EntitiesPluginRepositoryEntityPluginRepository {
    id: string;
    name: string;
    url: string;
    isOfficial: boolean;
    enabled: boolean;
    lastCheckedAt: null | string;
    lastError: null | string;
    manifest: null | ApiPluginsRepositoryManifestPluginRepositoryManifest;
    createdAt: string;
    updatedAt: string;
}
export type ApiPluginsPluginSettingsServiceJsonSchemaPropertyItems = {
    type?: string;
};
export interface ApiPluginsPluginSettingsServiceJsonSchemaProperty {
    type?: string;
    title?: string;
    description?: string;
    format?: string;
    items?: ApiPluginsPluginSettingsServiceJsonSchemaPropertyItems;
    enum?: unknown[];
    default?: unknown;
    writeOnly?: false | true;
    'x-flixer-secret'?: false | true;
}
export type ApiPluginsPluginSettingsServicePluginSettingsSchemaProperties = {
    [key: string]: ApiPluginsPluginSettingsServiceJsonSchemaProperty;
};
export interface ApiPluginsPluginSettingsServicePluginSettingsSchema {
    type: 'object';
    properties: ApiPluginsPluginSettingsServicePluginSettingsSchemaProperties;
    [key: string]: unknown;
}
export interface EntitiesPluginUpdateHistoryEntityPluginUpdateHistory {
    id: string;
    pluginId: string;
    action: 'install' | 'update';
    fromVersion: null | string;
    toVersion: string;
    outcome: 'failed' | 'succeeded';
    errorMessage: null | string;
    createdAt: string;
}
export type EntitiesPluginInstallationEntityPluginInstallationSettings = {
    [key: string]: unknown;
};
export type EntitiesPluginInstallationEntityPluginInstallationEncryptedSecrets = {
    [key: string]: string;
};
export type EntitiesPluginInstallationEntityPluginInstallationTargetStatus = {
    [key: string]: string;
};
export interface EntitiesPluginInstallationEntityPluginInstallation {
    pluginId: string;
    repositoryId: null | string;
    version: string;
    packageDigest: string;
    installPath: string;
    manifest: ApiPluginsPluginManifestPluginManifest;
    status: 'error' | 'running' | 'installed' | 'initializing' | 'enabled' | 'disabled' | 'updating';
    enabled: boolean;
    approvedPermissions: string[];
    settings: EntitiesPluginInstallationEntityPluginInstallationSettings;
    encryptedSecrets: EntitiesPluginInstallationEntityPluginInstallationEncryptedSecrets;
    targetStatus: EntitiesPluginInstallationEntityPluginInstallationTargetStatus;
    lastError: null | string;
    installedAt: string;
    updatedAt: string;
}
export interface ApiPluginsPluginPagesServicePluginPageSummary {
    pluginId: string;
    id: string;
    title: string;
    nav: null | 'main';
    adminOnly: boolean;
}
export type ApiPluginsPluginSearchServicePluginSearchItemBadge = {
    text: string;
    tone: string;
};
export type ApiPluginsPluginSearchServicePluginSearchItemQuery = {
    [key: string]: string;
};
export interface ApiPluginsPluginSearchServicePluginSearchItem {
    title: string;
    subtitle?: string;
    poster?: string;
    shape: 'poster' | 'square';
    badge?: ApiPluginsPluginSearchServicePluginSearchItemBadge;
    page: string;
    query: ApiPluginsPluginSearchServicePluginSearchItemQuery;
}
export interface ApiPluginsPluginSearchServicePluginSearchSection {
    pluginId: string;
    title: string;
    items: ApiPluginsPluginSearchServicePluginSearchItem[];
}
export type ApiRequestsMediaRequestsServiceRequestsConfigQuota = {
    limit: null | number;
    days: number;
    used: number;
    remaining: null | number;
};
export interface ApiRequestsMediaRequestsServiceRequestsConfig {
    enabled: boolean;
    movies: boolean;
    tv: boolean;
    music: boolean;
    canRequest: boolean;
    autoApprove: boolean;
    isAdmin: boolean;
    quota: ApiRequestsMediaRequestsServiceRequestsConfigQuota;
    tmdbConfigured: boolean;
    discogsConfigured: boolean;
}
export interface ApiRequestsExternalMetadataExternalMediaCard {
    source: 'tmdb' | 'discogs';
    type: 'music' | 'movie' | 'tv';
    id: string;
    title: string;
    year: null | number;
    poster: null | string;
    overview: null | string;
    status: 'none' | 'failed' | 'pending' | 'approved' | 'declined' | 'available';
    requestId: null | string;
}
export interface ApiRequestsExternalMetadataExternalSeason {
    number: number;
    name: string;
    episodeCount: number;
    status: 'none' | 'failed' | 'pending' | 'approved' | 'declined' | 'available';
}
export interface ApiRequestsExternalMetadataExternalMediaDetail {
    backdrop: null | string;
    tagline: null | string;
    genres: string[];
    runtimeMinutes: null | number;
    rating: null | number;
    cast: string[];
    artist: null | string;
    seasons: null | ApiRequestsExternalMetadataExternalSeason[];
    tracklist: null | string[];
    source: 'tmdb' | 'discogs';
    type: 'music' | 'movie' | 'tv';
    id: string;
    title: string;
    year: null | number;
    poster: null | string;
    overview: null | string;
    status: 'none' | 'failed' | 'pending' | 'approved' | 'declined' | 'available';
    requestId: null | string;
}
export type ApiRequestsMediaRequestsServiceMediaRequestViewRequestedBy = {
    id: string;
    username: string;
    displayName: null | string;
};
export interface ApiRequestsMediaRequestsServiceMediaRequestView {
    id: string;
    type: 'music' | 'movie' | 'tv';
    source: string;
    externalId: string;
    title: string;
    year: null | number;
    poster: null | string;
    seasons: null | number[];
    status: 'failed' | 'pending' | 'approved' | 'declined' | 'available';
    requestedBy: ApiRequestsMediaRequestsServiceMediaRequestViewRequestedBy;
    serviceName: null | string;
    declineReason: null | string;
    error: null | string;
    createdAt: string;
    updatedAt: string;
}
export interface ApiRequestsRequestServicesServiceRequestServiceView {
    id: string;
    kind: 'sonarr' | 'radarr' | 'lidarr';
    name: string;
    url: string;
    hasKey: boolean;
    isDefault: boolean;
    enabled: boolean;
    libraryId: null | string;
    libraryName: null | string;
    rootFolder: string;
    qualityProfileId: number;
    metadataProfileId: null | number;
    languageProfileId: null | number;
    minimumAvailability: null | string;
    seasonFolders: boolean;
    tags: number[];
}
export interface ApiRequestsArrClientArrProfile {
    id: number;
    name: string;
}
export interface ApiRequestsArrClientArrRootFolder {
    path: string;
    freeSpace: null | number;
}
export interface ApiRequestsArrClientArrTestResult {
    ok: boolean;
    version: null | string;
    error: null | string;
    qualityProfiles: ApiRequestsArrClientArrProfile[];
    rootFolders: ApiRequestsArrClientArrRootFolder[];
    metadataProfiles: ApiRequestsArrClientArrProfile[];
    languageProfiles: ApiRequestsArrClientArrProfile[];
}
export interface ApiRequestsMediaRequestsServiceRequestUserLimitView {
    id: string;
    username: string;
    displayName: null | string;
    role: string;
    canRequest: null | false | true;
    autoApprove: null | false | true;
    quotaLimit: null | number;
    quotaDays: null | number;
}
export interface ApiMediaSubtitleServiceSubtitleTrack {
    file: string;
    language: string;
    label?: string;
    format: string;
}
export interface ApiMediaSubtitleServiceSubtitleResult {
    fileId: number;
    language: string;
    release: string;
    fileName: string;
    downloads: number;
    hearingImpaired: boolean;
    hashMatch: boolean;
    rating: number;
    uploader?: string;
}
export interface ApiMediaAdminMediaServiceMediaCategoryCounts {
    [key: string]: unknown;
}
export interface ApiMediaAdminMediaServiceMediaItemImage {
    index: number;
    type: string;
    provider: string;
    width: null | number;
    height: null | number;
    language: null | string;
    available: boolean;
    manual: boolean;
}
export type ApiMediaMediaHomeServiceHomeLibraryCover = {
    itemId: string;
    index: number;
    updatedAt: string;
} | null;
export interface ApiMediaMediaHomeServiceHomeLibrary {
    id: string;
    name: string;
    type: string;
    itemCount: number;
    cover: ApiMediaMediaHomeServiceHomeLibraryCover;
}
export interface ApiMediaMediaHomeServiceContinueCard {
    id: string;
    type: 'movie' | 'episode' | 'series' | 'season' | 'album' | 'track' | 'video';
    title: string;
    subtitle: null | string;
    imageItemId: string;
    imageIndex: null | number;
    imageUpdatedAt: string;
    positionSeconds: number;
    progress: number;
    updatedAt: string;
}
export interface ApiMediaMediaHomeServiceCard {
    id: string;
    type: 'movie' | 'episode' | 'series' | 'season' | 'album' | 'track' | 'video';
    title: string;
    year: null | number;
    poster: null | number;
    backdrop: null | number;
    updatedAt: string;
}
export interface ApiMediaMediaHomeServiceHomeCard {
    id: string;
    type: 'movie' | 'episode' | 'series' | 'season' | 'album' | 'track' | 'video';
    title: string;
    year: null | number;
    poster: null | number;
    backdrop: null | number;
    updatedAt: string;
}
export interface ApiMediaMediaHomeServicePersonProfileView {
    description: null | string;
    biography: null | string;
    source: null | string;
    sourceUrl: null | string;
}
export interface ApiNetworkSharesNetworkSharesServicePublicNetworkShare {
    id: string;
    name: string;
    protocol: 'smb';
    host: string;
    share: string;
    username: null | string;
    domain: null | string;
    hasPassword: boolean;
    readOnly: boolean;
    rootId: string;
    location: string;
    status: 'error' | 'connecting' | 'connected';
    error: null | string;
}
export interface ApiAdminUsersAdminUsersServiceAdminUser {
    id: string;
    username: string;
    displayName: string;
    email: null | string;
    emailVerified: boolean;
    role: 'admin' | 'user';
    disabled: boolean;
    passkeys: number;
    activeSessions: number;
    lastActiveAt: null | string;
    createdAt: string;
    avatarUrl: null | string;
    current: boolean;
}
export interface ApiSocialSocialItemsSocialItem {
    id: string;
    type: 'movie' | 'episode' | 'series' | 'season' | 'album' | 'track' | 'video';
    title: string;
    subtitle: null | string;
    year: null | number;
    imageItemId: string;
    imageIndex: null | number;
    imageUpdatedAt: string;
    updatedAt: string;
    at?: string;
}
export type ApiSocialPlaylistsServicePlaylistSummaryCover = {
    itemId: string;
    index: number;
    updatedAt: string;
} | null;
export type ApiSocialPlaylistsServicePlaylistSummaryOwner = {
    username: string;
    displayName: string;
    avatarUrl: null | string;
};
export interface ApiSocialPlaylistsServicePlaylistSummary {
    id: string;
    name: string;
    description: null | string;
    isPublic: boolean;
    trackCount: number;
    durationSeconds: number;
    cover: ApiSocialPlaylistsServicePlaylistSummaryCover;
    owner: ApiSocialPlaylistsServicePlaylistSummaryOwner;
    updatedAt: string;
}
export interface PartyPartiesServicePartyPerson {
    id: string;
    username: string;
    displayName: string;
    avatarUrl: null | string;
}
export interface PartyPartiesServicePartySnapshot {
    id: string;
    kind: 'music' | 'video';
    visibility: 'public' | 'friends' | 'private';
    host: PartyPartiesServicePartyPerson;
    item: ApiSocialSocialItemsSocialItem;
    playing: boolean;
    position: number;
    at: number;
    version: number;
    playbackRate: number;
    members: PartyPartiesServicePartyPerson[];
}
export interface ChatChatServiceChatMember {
    role: 'owner' | 'member';
    username: string;
    displayName: string;
    avatarUrl: null | string;
}
export interface ChatChatServiceChatPerson {
    username: string;
    displayName: string;
    avatarUrl: null | string;
}
export interface ChatChatServiceChatMessage {
    id: string;
    conversationId: string;
    kind: 'text' | 'system';
    body: string;
    sender: null | ChatChatServiceChatPerson;
    createdAt: string;
}
export interface ChatChatServiceChatConversation {
    id: string;
    kind: 'direct' | 'group';
    name: null | string;
    members: ChatChatServiceChatMember[];
    lastMessage: null | ChatChatServiceChatMessage;
    unread: number;
    updatedAt: string;
}
export interface ApiSocialProfilesServiceNowPlaying {
    kind: 'watching' | 'listening';
    item: ApiSocialSocialItemsSocialItem;
    positionSeconds: number;
    durationSeconds: null | number;
}
export interface PartyPartiesServicePartySummary {
    id: string;
    kind: 'music' | 'video';
    title: string;
    memberCount: number;
}
export interface ApiSocialFriendsServiceFriendPerson {
    id: string;
    username: string;
    displayName: string;
    avatarUrl: null | string;
}
export interface ApiUpdatesUpdateServiceComponentStatus {
    id: 'flixer' | 'web' | 'streamer' | 'indexer';
    label: string;
    installed: null | string;
    latest: null | string;
    reachable: boolean;
    updateAvailable: boolean;
}
export type ApiUpdatesUpdateServiceUpdateRunTargets = {
    [key: string]: unknown;
};
export type ApiUpdatesUpdateServiceUpdateRunPrevious = {
    [key: string]: unknown;
};
export interface ApiUpdatesUpdateServiceUpdateRun {
    id: string;
    startedAt: string;
    finishedAt: null | string;
    status: 'failed' | 'running' | 'succeeded' | 'rolled_back' | 'rollback_failed';
    step: string;
    targets: ApiUpdatesUpdateServiceUpdateRunTargets;
    previous: ApiUpdatesUpdateServiceUpdateRunPrevious;
    backup: null | string;
    error: null | string;
    log: string[];
}
export type ApiUpdatesUpdateServiceUpdateStatusBackupsItem = {
    name: string;
    sizeBytes: number;
    createdAt: string;
};
export interface ApiUpdatesUpdateServiceUpdateStatus {
    components: ApiUpdatesUpdateServiceComponentStatus[];
    updatesAvailable: number;
    lastCheckedAt: null | string;
    canApply: boolean;
    updaterReachable: boolean;
    run: null | ApiUpdatesUpdateServiceUpdateRun;
    backups: ApiUpdatesUpdateServiceUpdateStatusBackupsItem[];
}
export interface ApiBackupsBackupServiceBackupRunStep {
    name: string;
    message: string;
    status: 'failed' | 'running' | 'succeeded';
    startedAt: string;
    finishedAt?: string;
}
export interface ApiBackupsBackupServiceBackupRun {
    id: string;
    kind: 'backup' | 'restore';
    startedAt: string;
    finishedAt: null | string;
    status: string;
    step: string;
    steps?: ApiBackupsBackupServiceBackupRunStep[];
    error: null | string;
    log: string[];
    encrypted?: false | true;
    [key: string]: unknown;
}
export type ApiBackupsBackupServiceBackupEntryVersions = {
    [key: string]: string;
};
export interface ApiBackupsBackupServiceBackupEntry {
    name: string;
    size: number;
    createdAt: string;
    encrypted: boolean;
    components: string[];
    versions: ApiBackupsBackupServiceBackupEntryVersions;
}
export interface ApiBackupsBackupServiceBackupStatus {
    updaterReachable: boolean;
    canRestore: boolean;
    passphraseSet: boolean;
    schedule: 'off' | 'daily' | 'weekly';
    keep: number;
    lastScheduledAt: null | string;
    run: null | ApiBackupsBackupServiceBackupRun;
    backups: ApiBackupsBackupServiceBackupEntry[];
}
export interface SentrySentryServiceSentryAppConfig {
    enabled: boolean;
    dsn: null | string;
}
export type VersionControllerGet200 = {
    version: string;
};
export type SetupControllerRequestRecoveryKey200 = {
    [key: string]: unknown;
};
export type SetupControllerProgress200 = {
    [key: string]: unknown;
};
export type SetupControllerFlowBody = {
    [key: string]: unknown;
};
export type SetupControllerFlow200 = {
    [key: string]: unknown;
};
export type SetupControllerTestStepBody = {
    [key: string]: unknown;
};
export type SetupControllerTestStep200 = {
    [key: string]: unknown;
};
export type SetupControllerApplyStepBody = {
    [key: string]: unknown;
};
export type SetupControllerApplyStep200 = {
    [key: string]: unknown;
};
export type SetupControllerComplete200 = {
    [key: string]: unknown;
};
export type SetupControllerResetBody = {
    [key: string]: unknown;
};
export type SetupControllerReset200 = {
    [key: string]: unknown;
};
export type AuthControllerChangePassword200 = {
    changed: true;
};
export type AuthControllerDeleteMe200 = {
    deleted: true;
};
export type AuthControllerVerifyEmail200 = {
    verified: true;
};
export type AuthControllerResendVerification200 = {
    sent: true;
};
export type AuthControllerRevokeSession200 = {
    id: string;
    revoked: true;
};
export type AuthControllerLogout200 = {
    id: string;
    loggedOut: true;
};
export type AvatarControllerUploadBody = {
    avatar?: Blob | File;
};
export type PasskeyControllerRegistrationOptions200Rp = {
    id?: string;
    name: string;
};
export type PasskeyControllerRegistrationOptions200User = {
    id: string;
    name: string;
    displayName: string;
};
export type PasskeyControllerRegistrationOptions200PubKeyCredParamsItem = {
    alg: number;
    type: 'public-key';
};
export type PasskeyControllerRegistrationOptions200ExcludeCredentialsItem = {
    id: string;
    transports?: string[];
    type: string;
};
export type PasskeyControllerRegistrationOptions200AuthenticatorSelection = {
    authenticatorAttachment?: 'cross-platform' | 'platform';
    requireResidentKey?: false | true;
    residentKey?: 'discouraged' | 'preferred' | 'required';
    userVerification?: 'discouraged' | 'preferred' | 'required';
};
export type PasskeyControllerRegistrationOptions200ExtensionsPrfEvalFirst = {
    byteLength: number;
    maxByteLength: number;
    resizable: boolean;
    detached: boolean;
    '__@toStringTag@612': 'ArrayBuffer';
} | {
    buffer: {
        byteLength: number;
        maxByteLength: number;
        resizable: boolean;
        detached: boolean;
        '__@toStringTag@612': 'ArrayBuffer';
    } | {
        byteLength: number;
        growable: boolean;
        maxByteLength: number;
        '__@toStringTag@612': 'SharedArrayBuffer';
    };
    byteLength: number;
    byteOffset: number;
};
export type PasskeyControllerRegistrationOptions200ExtensionsPrfEvalSecond = {
    byteLength: number;
    maxByteLength: number;
    resizable: boolean;
    detached: boolean;
    '__@toStringTag@612': 'ArrayBuffer';
} | {
    buffer: {
        byteLength: number;
        maxByteLength: number;
        resizable: boolean;
        detached: boolean;
        '__@toStringTag@612': 'ArrayBuffer';
    } | {
        byteLength: number;
        growable: boolean;
        maxByteLength: number;
        '__@toStringTag@612': 'SharedArrayBuffer';
    };
    byteLength: number;
    byteOffset: number;
};
export type PasskeyControllerRegistrationOptions200ExtensionsPrfEval = {
    first: PasskeyControllerRegistrationOptions200ExtensionsPrfEvalFirst;
    second?: PasskeyControllerRegistrationOptions200ExtensionsPrfEvalSecond;
};
export type PasskeyControllerRegistrationOptions200ExtensionsPrfEvalByCredentialFirst = {
    byteLength: number;
    maxByteLength: number;
    resizable: boolean;
    detached: boolean;
    '__@toStringTag@612': 'ArrayBuffer';
} | {
    buffer: {
        byteLength: number;
        maxByteLength: number;
        resizable: boolean;
        detached: boolean;
        '__@toStringTag@612': 'ArrayBuffer';
    } | {
        byteLength: number;
        growable: boolean;
        maxByteLength: number;
        '__@toStringTag@612': 'SharedArrayBuffer';
    };
    byteLength: number;
    byteOffset: number;
};
export type PasskeyControllerRegistrationOptions200ExtensionsPrfEvalByCredentialSecond = {
    byteLength: number;
    maxByteLength: number;
    resizable: boolean;
    detached: boolean;
    '__@toStringTag@612': 'ArrayBuffer';
} | {
    buffer: {
        byteLength: number;
        maxByteLength: number;
        resizable: boolean;
        detached: boolean;
        '__@toStringTag@612': 'ArrayBuffer';
    } | {
        byteLength: number;
        growable: boolean;
        maxByteLength: number;
        '__@toStringTag@612': 'SharedArrayBuffer';
    };
    byteLength: number;
    byteOffset: number;
};
export type PasskeyControllerRegistrationOptions200ExtensionsPrfEvalByCredential = {
    [key: string]: {
        first: PasskeyControllerRegistrationOptions200ExtensionsPrfEvalByCredentialFirst;
        second?: PasskeyControllerRegistrationOptions200ExtensionsPrfEvalByCredentialSecond;
    };
};
export type PasskeyControllerRegistrationOptions200ExtensionsPrf = {
    eval?: PasskeyControllerRegistrationOptions200ExtensionsPrfEval;
    evalByCredential?: PasskeyControllerRegistrationOptions200ExtensionsPrfEvalByCredential;
};
export type PasskeyControllerRegistrationOptions200Extensions = {
    appid?: string;
    credProps?: false | true;
    hmacCreateSecret?: false | true;
    minPinLength?: false | true;
    prf?: PasskeyControllerRegistrationOptions200ExtensionsPrf;
};
export type PasskeyControllerRegistrationOptions200 = {
    rp: PasskeyControllerRegistrationOptions200Rp;
    user: PasskeyControllerRegistrationOptions200User;
    challenge: string;
    pubKeyCredParams: PasskeyControllerRegistrationOptions200PubKeyCredParamsItem[];
    timeout?: number;
    excludeCredentials?: PasskeyControllerRegistrationOptions200ExcludeCredentialsItem[];
    authenticatorSelection?: PasskeyControllerRegistrationOptions200AuthenticatorSelection;
    hints?: ('hybrid' | 'security-key' | 'client-device')[];
    attestation?: 'direct' | 'enterprise' | 'indirect' | 'none';
    attestationFormats?: ('none' | 'fido-u2f' | 'packed' | 'android-safetynet' | 'android-key' | 'tpm' | 'apple')[];
    extensions?: PasskeyControllerRegistrationOptions200Extensions;
};
export type PasskeyControllerLoginOptions200AllowCredentialsItem = {
    id: string;
    transports?: string[];
    type: string;
};
export type PasskeyControllerLoginOptions200ExtensionsPrfEvalFirst = {
    byteLength: number;
    maxByteLength: number;
    resizable: boolean;
    detached: boolean;
    '__@toStringTag@612': 'ArrayBuffer';
} | {
    buffer: {
        byteLength: number;
        maxByteLength: number;
        resizable: boolean;
        detached: boolean;
        '__@toStringTag@612': 'ArrayBuffer';
    } | {
        byteLength: number;
        growable: boolean;
        maxByteLength: number;
        '__@toStringTag@612': 'SharedArrayBuffer';
    };
    byteLength: number;
    byteOffset: number;
};
export type PasskeyControllerLoginOptions200ExtensionsPrfEvalSecond = {
    byteLength: number;
    maxByteLength: number;
    resizable: boolean;
    detached: boolean;
    '__@toStringTag@612': 'ArrayBuffer';
} | {
    buffer: {
        byteLength: number;
        maxByteLength: number;
        resizable: boolean;
        detached: boolean;
        '__@toStringTag@612': 'ArrayBuffer';
    } | {
        byteLength: number;
        growable: boolean;
        maxByteLength: number;
        '__@toStringTag@612': 'SharedArrayBuffer';
    };
    byteLength: number;
    byteOffset: number;
};
export type PasskeyControllerLoginOptions200ExtensionsPrfEval = {
    first: PasskeyControllerLoginOptions200ExtensionsPrfEvalFirst;
    second?: PasskeyControllerLoginOptions200ExtensionsPrfEvalSecond;
};
export type PasskeyControllerLoginOptions200ExtensionsPrfEvalByCredentialFirst = {
    byteLength: number;
    maxByteLength: number;
    resizable: boolean;
    detached: boolean;
    '__@toStringTag@612': 'ArrayBuffer';
} | {
    buffer: {
        byteLength: number;
        maxByteLength: number;
        resizable: boolean;
        detached: boolean;
        '__@toStringTag@612': 'ArrayBuffer';
    } | {
        byteLength: number;
        growable: boolean;
        maxByteLength: number;
        '__@toStringTag@612': 'SharedArrayBuffer';
    };
    byteLength: number;
    byteOffset: number;
};
export type PasskeyControllerLoginOptions200ExtensionsPrfEvalByCredentialSecond = {
    byteLength: number;
    maxByteLength: number;
    resizable: boolean;
    detached: boolean;
    '__@toStringTag@612': 'ArrayBuffer';
} | {
    buffer: {
        byteLength: number;
        maxByteLength: number;
        resizable: boolean;
        detached: boolean;
        '__@toStringTag@612': 'ArrayBuffer';
    } | {
        byteLength: number;
        growable: boolean;
        maxByteLength: number;
        '__@toStringTag@612': 'SharedArrayBuffer';
    };
    byteLength: number;
    byteOffset: number;
};
export type PasskeyControllerLoginOptions200ExtensionsPrfEvalByCredential = {
    [key: string]: {
        first: PasskeyControllerLoginOptions200ExtensionsPrfEvalByCredentialFirst;
        second?: PasskeyControllerLoginOptions200ExtensionsPrfEvalByCredentialSecond;
    };
};
export type PasskeyControllerLoginOptions200ExtensionsPrf = {
    eval?: PasskeyControllerLoginOptions200ExtensionsPrfEval;
    evalByCredential?: PasskeyControllerLoginOptions200ExtensionsPrfEvalByCredential;
};
export type PasskeyControllerLoginOptions200Extensions = {
    appid?: string;
    credProps?: false | true;
    hmacCreateSecret?: false | true;
    minPinLength?: false | true;
    prf?: PasskeyControllerLoginOptions200ExtensionsPrf;
};
export type PasskeyControllerLoginOptions200 = {
    challenge: string;
    timeout?: number;
    rpId?: string;
    allowCredentials?: PasskeyControllerLoginOptions200AllowCredentialsItem[];
    userVerification?: 'discouraged' | 'preferred' | 'required';
    hints?: ('hybrid' | 'security-key' | 'client-device')[];
    extensions?: PasskeyControllerLoginOptions200Extensions;
};
export type PasskeyControllerSecondFactorOptions200AllowCredentialsItem = {
    id: string;
    transports?: string[];
    type: string;
};
export type PasskeyControllerSecondFactorOptions200ExtensionsPrfEvalFirst = {
    byteLength: number;
    maxByteLength: number;
    resizable: boolean;
    detached: boolean;
    '__@toStringTag@612': 'ArrayBuffer';
} | {
    buffer: {
        byteLength: number;
        maxByteLength: number;
        resizable: boolean;
        detached: boolean;
        '__@toStringTag@612': 'ArrayBuffer';
    } | {
        byteLength: number;
        growable: boolean;
        maxByteLength: number;
        '__@toStringTag@612': 'SharedArrayBuffer';
    };
    byteLength: number;
    byteOffset: number;
};
export type PasskeyControllerSecondFactorOptions200ExtensionsPrfEvalSecond = {
    byteLength: number;
    maxByteLength: number;
    resizable: boolean;
    detached: boolean;
    '__@toStringTag@612': 'ArrayBuffer';
} | {
    buffer: {
        byteLength: number;
        maxByteLength: number;
        resizable: boolean;
        detached: boolean;
        '__@toStringTag@612': 'ArrayBuffer';
    } | {
        byteLength: number;
        growable: boolean;
        maxByteLength: number;
        '__@toStringTag@612': 'SharedArrayBuffer';
    };
    byteLength: number;
    byteOffset: number;
};
export type PasskeyControllerSecondFactorOptions200ExtensionsPrfEval = {
    first: PasskeyControllerSecondFactorOptions200ExtensionsPrfEvalFirst;
    second?: PasskeyControllerSecondFactorOptions200ExtensionsPrfEvalSecond;
};
export type PasskeyControllerSecondFactorOptions200ExtensionsPrfEvalByCredentialFirst = {
    byteLength: number;
    maxByteLength: number;
    resizable: boolean;
    detached: boolean;
    '__@toStringTag@612': 'ArrayBuffer';
} | {
    buffer: {
        byteLength: number;
        maxByteLength: number;
        resizable: boolean;
        detached: boolean;
        '__@toStringTag@612': 'ArrayBuffer';
    } | {
        byteLength: number;
        growable: boolean;
        maxByteLength: number;
        '__@toStringTag@612': 'SharedArrayBuffer';
    };
    byteLength: number;
    byteOffset: number;
};
export type PasskeyControllerSecondFactorOptions200ExtensionsPrfEvalByCredentialSecond = {
    byteLength: number;
    maxByteLength: number;
    resizable: boolean;
    detached: boolean;
    '__@toStringTag@612': 'ArrayBuffer';
} | {
    buffer: {
        byteLength: number;
        maxByteLength: number;
        resizable: boolean;
        detached: boolean;
        '__@toStringTag@612': 'ArrayBuffer';
    } | {
        byteLength: number;
        growable: boolean;
        maxByteLength: number;
        '__@toStringTag@612': 'SharedArrayBuffer';
    };
    byteLength: number;
    byteOffset: number;
};
export type PasskeyControllerSecondFactorOptions200ExtensionsPrfEvalByCredential = {
    [key: string]: {
        first: PasskeyControllerSecondFactorOptions200ExtensionsPrfEvalByCredentialFirst;
        second?: PasskeyControllerSecondFactorOptions200ExtensionsPrfEvalByCredentialSecond;
    };
};
export type PasskeyControllerSecondFactorOptions200ExtensionsPrf = {
    eval?: PasskeyControllerSecondFactorOptions200ExtensionsPrfEval;
    evalByCredential?: PasskeyControllerSecondFactorOptions200ExtensionsPrfEvalByCredential;
};
export type PasskeyControllerSecondFactorOptions200Extensions = {
    appid?: string;
    credProps?: false | true;
    hmacCreateSecret?: false | true;
    minPinLength?: false | true;
    prf?: PasskeyControllerSecondFactorOptions200ExtensionsPrf;
};
export type PasskeyControllerSecondFactorOptions200 = {
    challenge: string;
    timeout?: number;
    rpId?: string;
    allowCredentials?: PasskeyControllerSecondFactorOptions200AllowCredentialsItem[];
    userVerification?: 'discouraged' | 'preferred' | 'required';
    hints?: ('hybrid' | 'security-key' | 'client-device')[];
    extensions?: PasskeyControllerSecondFactorOptions200Extensions;
};
export type PasskeyControllerStartNativeHandoff200 = {
    handoffId: string;
    appUrl: string;
};
export type PasskeyControllerNativeHandoffOptions200AllowCredentialsItem = {
    id: string;
    transports?: string[];
    type: string;
};
export type PasskeyControllerNativeHandoffOptions200ExtensionsPrfEvalFirst = {
    byteLength: number;
    maxByteLength: number;
    resizable: boolean;
    detached: boolean;
    '__@toStringTag@612': 'ArrayBuffer';
} | {
    buffer: {
        byteLength: number;
        maxByteLength: number;
        resizable: boolean;
        detached: boolean;
        '__@toStringTag@612': 'ArrayBuffer';
    } | {
        byteLength: number;
        growable: boolean;
        maxByteLength: number;
        '__@toStringTag@612': 'SharedArrayBuffer';
    };
    byteLength: number;
    byteOffset: number;
};
export type PasskeyControllerNativeHandoffOptions200ExtensionsPrfEvalSecond = {
    byteLength: number;
    maxByteLength: number;
    resizable: boolean;
    detached: boolean;
    '__@toStringTag@612': 'ArrayBuffer';
} | {
    buffer: {
        byteLength: number;
        maxByteLength: number;
        resizable: boolean;
        detached: boolean;
        '__@toStringTag@612': 'ArrayBuffer';
    } | {
        byteLength: number;
        growable: boolean;
        maxByteLength: number;
        '__@toStringTag@612': 'SharedArrayBuffer';
    };
    byteLength: number;
    byteOffset: number;
};
export type PasskeyControllerNativeHandoffOptions200ExtensionsPrfEval = {
    first: PasskeyControllerNativeHandoffOptions200ExtensionsPrfEvalFirst;
    second?: PasskeyControllerNativeHandoffOptions200ExtensionsPrfEvalSecond;
};
export type PasskeyControllerNativeHandoffOptions200ExtensionsPrfEvalByCredentialFirst = {
    byteLength: number;
    maxByteLength: number;
    resizable: boolean;
    detached: boolean;
    '__@toStringTag@612': 'ArrayBuffer';
} | {
    buffer: {
        byteLength: number;
        maxByteLength: number;
        resizable: boolean;
        detached: boolean;
        '__@toStringTag@612': 'ArrayBuffer';
    } | {
        byteLength: number;
        growable: boolean;
        maxByteLength: number;
        '__@toStringTag@612': 'SharedArrayBuffer';
    };
    byteLength: number;
    byteOffset: number;
};
export type PasskeyControllerNativeHandoffOptions200ExtensionsPrfEvalByCredentialSecond = {
    byteLength: number;
    maxByteLength: number;
    resizable: boolean;
    detached: boolean;
    '__@toStringTag@612': 'ArrayBuffer';
} | {
    buffer: {
        byteLength: number;
        maxByteLength: number;
        resizable: boolean;
        detached: boolean;
        '__@toStringTag@612': 'ArrayBuffer';
    } | {
        byteLength: number;
        growable: boolean;
        maxByteLength: number;
        '__@toStringTag@612': 'SharedArrayBuffer';
    };
    byteLength: number;
    byteOffset: number;
};
export type PasskeyControllerNativeHandoffOptions200ExtensionsPrfEvalByCredential = {
    [key: string]: {
        first: PasskeyControllerNativeHandoffOptions200ExtensionsPrfEvalByCredentialFirst;
        second?: PasskeyControllerNativeHandoffOptions200ExtensionsPrfEvalByCredentialSecond;
    };
};
export type PasskeyControllerNativeHandoffOptions200ExtensionsPrf = {
    eval?: PasskeyControllerNativeHandoffOptions200ExtensionsPrfEval;
    evalByCredential?: PasskeyControllerNativeHandoffOptions200ExtensionsPrfEvalByCredential;
};
export type PasskeyControllerNativeHandoffOptions200Extensions = {
    appid?: string;
    credProps?: false | true;
    hmacCreateSecret?: false | true;
    minPinLength?: false | true;
    prf?: PasskeyControllerNativeHandoffOptions200ExtensionsPrf;
};
export type PasskeyControllerNativeHandoffOptions200 = {
    challenge: string;
    timeout?: number;
    rpId?: string;
    allowCredentials?: PasskeyControllerNativeHandoffOptions200AllowCredentialsItem[];
    userVerification?: 'discouraged' | 'preferred' | 'required';
    hints?: ('hybrid' | 'security-key' | 'client-device')[];
    extensions?: PasskeyControllerNativeHandoffOptions200Extensions;
};
export type PasskeyControllerVerifyNativeHandoff200 = {
    code: string;
    state: string;
};
export type PasskeyControllerRemove200 = {
    id: string;
    deleted: true;
};
export type UserControllerDeleteUser200 = {
    id: string;
    deleted: true;
};
export type SettingsControllerRegistrationStatus200 = {
    registrationEnabled: boolean;
    serverName: string;
    loginBanner: string;
};
export type SettingsControllerSendTestEmail200 = {
    sentTo: string;
};
export type PlaybackControllerItemPlaybackInfo200 = ApiPlaybackPlaybackServicePlaybackInfo & ApiMediaMediaSegmentsServiceItemSegments & ({
    title: string;
    nextEpisode: null | ApiPlaybackNextEpisodeNextEpisode;
});
export type JobsControllerGetQueues200ItemPolicy = 'standard' | 'short' | 'singleton' | 'stately' | 'exclusive' | 'key_strict_fifo' | (string & {
    [key: string]: unknown;
});
export type JobsControllerGetQueues200Item = {
    deferredCount: number;
    blockedCount: number;
    queuedCount: number;
    readyCount: number;
    activeCount: number;
    failedCount: number;
    totalCount: number;
    completedDelta: number;
    failedDelta: number;
    createdDelta: number;
    deltaSeconds: null | number;
    deltaOn: null | string;
    waitBins: null | number[];
    runBins: null | number[];
    readyOldestSeconds: null | number;
    table: string;
    createdOn: string;
    updatedOn: string;
    singletonsActive: null | string[];
    name: string;
    policy?: JobsControllerGetQueues200ItemPolicy;
    partition?: false | true;
    deadLetter?: string;
    warningQueueSize?: number;
    heartbeatSeconds?: number;
    notify?: false | true;
    expireInSeconds?: number;
    retentionSeconds?: number;
    deleteAfterSeconds?: number;
    retryLimit?: number;
    retryDelay?: number;
    retryBackoff?: false | true;
    retryDelayMax?: number;
};
export type JobsControllerFindJobsParams = {
    limit?: number;
};
export type JobsControllerFindJobs200ItemPolicy = 'standard' | 'short' | 'singleton' | 'stately' | 'exclusive' | 'key_strict_fifo' | (string & {
    [key: string]: unknown;
});
export type JobsControllerFindJobs200ItemSignal = {
    aborted: boolean;
    reason: unknown;
};
export type JobsControllerFindJobs200Item = {
    priority: number;
    state: 'completed' | 'created' | 'retry' | 'active' | 'cancelled' | 'failed';
    retryLimit: number;
    retryDelay: number;
    retryBackoff: boolean;
    retryDelayMax?: number;
    startAfter: string;
    startedOn: string;
    singletonKey: null | string;
    singletonOn: null | string;
    expireInSeconds: number;
    deleteAfterSeconds: number;
    createdOn: string;
    completedOn: null | string;
    keepUntil: string;
    policy: JobsControllerFindJobs200ItemPolicy;
    heartbeatOn: null | string;
    heartbeatSeconds: null | number;
    blocked: boolean;
    blocking: boolean;
    pendingDependencies: number;
    deadLetter: string;
    output: unknown;
    sourceName: null | string;
    sourceId: null | string;
    sourceCreatedOn: null | string;
    sourceRetryCount: null | number;
    sourceOutput: null | unknown;
    sourceRootId: null | string;
    id: string;
    name: string;
    data: unknown;
    retryCount: number;
    signal: JobsControllerFindJobs200ItemSignal;
    groupId?: null | string;
    groupTier?: null | string;
};
export type JobsControllerEnqueue200 = {
    id: null | string;
};
export type JobsControllerGetJob200Policy = 'standard' | 'short' | 'singleton' | 'stately' | 'exclusive' | 'key_strict_fifo' | (string & {
    [key: string]: unknown;
});
export type JobsControllerGetJob200Signal = {
    aborted: boolean;
    reason: unknown;
};
export type JobsControllerGetJob200 = {
    priority: number;
    state: 'completed' | 'created' | 'retry' | 'active' | 'cancelled' | 'failed';
    retryLimit: number;
    retryDelay: number;
    retryBackoff: boolean;
    retryDelayMax?: number;
    startAfter: string;
    startedOn: string;
    singletonKey: null | string;
    singletonOn: null | string;
    expireInSeconds: number;
    deleteAfterSeconds: number;
    createdOn: string;
    completedOn: null | string;
    keepUntil: string;
    policy: JobsControllerGetJob200Policy;
    heartbeatOn: null | string;
    heartbeatSeconds: null | number;
    blocked: boolean;
    blocking: boolean;
    pendingDependencies: number;
    deadLetter: string;
    output: unknown;
    sourceName: null | string;
    sourceId: null | string;
    sourceCreatedOn: null | string;
    sourceRetryCount: null | number;
    sourceOutput: null | unknown;
    sourceRootId: null | string;
    id: string;
    name: string;
    data: unknown;
    retryCount: number;
    signal: JobsControllerGetJob200Signal;
    groupId?: null | string;
    groupTier?: null | string;
} | null;
export type JobsControllerCancelJob200 = {
    [key: string]: unknown;
};
export type JobsControllerRetryJob200 = {
    [key: string]: unknown;
};
export type JobsControllerGetSchedules200ItemOptions = ({
    id?: string;
    priority?: number;
    startAfter?: string | number;
    singletonKey?: string;
    singletonSeconds?: number;
    singletonNextSlot?: false | true;
    group?: {
        id: string;
        tier?: string;
    };
    deadLetter?: string;
}) & ({
    expireInSeconds?: number;
    retentionSeconds?: number;
    deleteAfterSeconds?: number;
    retryLimit?: number;
    retryDelay?: number;
    retryBackoff?: false | true;
    retryDelayMax?: number;
    heartbeatSeconds?: number;
}) & {
    db?: {
        [key: string]: unknown;
    };
} & ({
    tz?: string;
    key?: string;
    missed?: 'skip' | 'once';
});
export type JobsControllerGetSchedules200Item = {
    name: string;
    key: string;
    kind: 'cron' | 'rrule';
    cron: string;
    timezone: string;
    data?: unknown;
    options?: JobsControllerGetSchedules200ItemOptions;
    createdOn: string;
    updatedOn: string;
    lastJobId: null | string;
};
export type JobsControllerSchedule200 = {
    queueName: string;
    cron: string;
    scheduled: boolean;
};
export type JobsControllerUnschedule200 = {
    queueName: string;
    scheduled: boolean;
};
export type AdminScheduledTasksControllerList200 = {
    tasks: JobsJobSchedulerAdminTaskRunStatus[];
};
export type AdminScheduledTasksControllerSaveSchedule200 = {
    id: 'scan-libraries' | 'refresh-metadata' | 'trickplay' | 'clean-transcode' | 'clean-logs' | 'optimize-database';
    enabled: boolean;
    cron: string;
};
export type AdminScheduledTasksControllerRun200 = {
    id: null | string;
};
export type AdminScheduledTasksControllerStop200 = {
    stopped: boolean;
};
export type MediaLibrariesControllerListRoots200Item = {
    id: string;
    name: string;
    path: string;
};
export type MediaLibrariesControllerBrowseParams = {
    rootId?: string;
    path?: string;
};
export type StreamerRootsControllerList200RootsItem = {
    id: string;
    path: string;
};
export type StreamerRootsControllerList200 = {
    roots: StreamerRootsControllerList200RootsItem[];
};
export type StreamerRootsControllerTranscoding200 = {
    hwAccel: string;
    preset: string;
    crf: number;
    threads: number;
    maxBitrateKbps: number;
    maxConcurrent: null | number;
};
export type IndexerApiControllerListLibraries200LibrariesItemFoldersItem = {
    rootId: string;
    path: string;
    absolutePath: string;
};
export type IndexerApiControllerListLibraries200LibrariesItem = {
    id: string;
    name: string;
    type: 'movies' | 'tvshows' | 'music' | 'homevideos' | 'mixed';
    imageStorage: 'cache' | 'alongside';
    folders: IndexerApiControllerListLibraries200LibrariesItemFoldersItem[];
};
export type IndexerApiControllerListLibraries200 = {
    libraries: IndexerApiControllerListLibraries200LibrariesItem[];
};
export type IndexerApiControllerUpsertItemBody = {
    [key: string]: unknown;
};
export type IndexerApiControllerUpsertItem200 = {
    id: string;
};
export type IndexerApiControllerIntroSyncCandidatesParams = {
    type?: string;
    libraryId?: string;
    afterId?: string;
    limit?: number;
};
export type IndexerApiControllerIntroSyncCandidates200 = {
    items: ApiIndexerIndexerIntroSegmentsServiceIntroSyncCandidate[];
    nextCursor: null | string;
};
export type IndexerApiControllerExistingIntroSegmentsParams = {
    itemId?: string;
};
export type IndexerApiControllerExistingIntroSegments200Segments = {
    [key: string]: unknown;
};
export type IndexerApiControllerExistingIntroSegments200 = {
    segments: IndexerApiControllerExistingIntroSegments200Segments;
};
export type IndexerApiControllerUpdateIntroSegmentsBody = {
    [key: string]: unknown;
};
export type IndexerApiControllerUpdateIntroSegments200 = {
    ok: boolean;
};
export type IndexerApiControllerPruneLibraryBody = {
    [key: string]: unknown;
};
export type IndexerApiControllerPruneLibrary200 = {
    removed: number;
};
export type AdminIndexerControllerTasksParams = {
    queue?: string;
    state?: string;
    page?: number;
    size?: number;
};
export type AdminIndexerControllerTaskLogsParams = {
    offset?: number;
};
export type AdminIndexerControllerCancelActive200 = {
    queue: 'trickplay' | 'scan' | 'identify' | 'metadata' | 'images' | 'probe' | 'refresh' | 'themes' | 'lyrics' | 'intro-movies' | 'intro-episodes' | 'identify-priority' | 'metadata-priority' | 'images-priority' | 'probe-priority' | 'refresh-priority';
    cancelled: number;
    pending: number;
    running: number;
};
export type AdminIndexerControllerClearFailed200 = {
    queue: 'trickplay' | 'scan' | 'identify' | 'metadata' | 'images' | 'probe' | 'refresh' | 'themes' | 'lyrics' | 'intro-movies' | 'intro-episodes' | 'identify-priority' | 'metadata-priority' | 'images-priority' | 'probe-priority' | 'refresh-priority';
    cleared: number;
};
export type AdminIndexerControllerSetConcurrencyBody = {
    [key: string]: unknown;
};
export type PluginsControllerInstalled200ItemTargetStatus = {
    [key: string]: string;
};
export type PluginsControllerInstalled200ItemRepository = {
    id: string;
    name: string;
    isOfficial: boolean;
} | null;
export type PluginsControllerInstalled200ItemAvailableUpdate = {
    version: string;
    permissions: string[];
} | null;
export type PluginsControllerInstalled200Item = {
    id: string;
    version: string;
    status: 'error' | 'running' | 'installed' | 'initializing' | 'enabled' | 'disabled' | 'updating';
    enabled: boolean;
    approvedPermissions: string[];
    activationSupported: boolean;
    activationReason: null | string;
    targetStatus: PluginsControllerInstalled200ItemTargetStatus;
    lastError: null | string;
    manifest: ApiPluginsPluginManifestPluginManifest;
    repository: PluginsControllerInstalled200ItemRepository;
    availableUpdate: PluginsControllerInstalled200ItemAvailableUpdate;
    installedAt: string;
    updatedAt: string;
};
export type PluginsControllerAddRepositoryBody = {
    [key: string]: unknown;
};
export type PluginsControllerCatalogParams = {
    q?: string;
    target?: string;
    capability?: string;
};
export type PluginsControllerCatalog200ItemRepository = {
    id: string;
    name: string;
    url: string;
    isOfficial: boolean;
};
export type PluginsControllerCatalog200Item = {
    repository: PluginsControllerCatalog200ItemRepository;
    id: string;
    name: string;
    description: string;
    author: string;
    capabilities?: string[];
    permissions: string[];
    targets: ('flixer' | 'flixer-indexer' | 'flixer-streamer' | 'flixer-web')[];
    versions: ApiPluginsRepositoryManifestPluginRelease[];
};
export type PluginsControllerPluginSettingsView200 = {
    /** @nullable */
    schema: null;
    values: {
        [key: string]: unknown;
    };
    secretFields: string[];
} | {
    schema: ApiPluginsPluginSettingsServicePluginSettingsSchema;
    values: {
        [key: string]: unknown;
    };
    secretFields: string[];
};
export type PluginsControllerUpdatePluginSettingsBody = {
    [key: string]: unknown;
};
export type PluginsControllerUpdatePluginSettings200 = {
    /** @nullable */
    schema: null;
    values: {
        [key: string]: unknown;
    };
    secretFields: string[];
} | {
    schema: ApiPluginsPluginSettingsServicePluginSettingsSchema;
    values: {
        [key: string]: unknown;
    };
    secretFields: string[];
};
export type PluginsControllerPluginUpdateHistoryParams = {
    limit?: number;
};
export type PluginsControllerInstallBody = {
    [key: string]: unknown;
};
export type PluginRuntimeControllerSearchSectionsParams = {
    q?: string;
    type?: string;
};
export type PluginRuntimeControllerSearchSections200 = {
    sections: ApiPluginsPluginSearchServicePluginSearchSection[];
};
export type PluginRuntimeControllerInvokeBody = {
    [key: string]: unknown;
};
export type RequestImagesControllerDiscogsParams = {
    u?: string;
};
export type RequestsControllerSearchParams = {
    q?: string;
    type?: string;
};
export type RequestsControllerDiscoverParams = {
    section?: string;
};
export type RequestsControllerDetails200 = ApiRequestsExternalMetadataExternalMediaDetail & ({
    requests: ApiRequestsMediaRequestsServiceMediaRequestView[];
    libraryItemId: null | string;
});
export type RequestsControllerListParams = {
    scope?: string;
    status?: string;
    type?: string;
    offset?: number;
    limit?: number;
};
export type RequestsControllerList200Counts = {
    [key: string]: number;
};
export type RequestsControllerList200 = {
    total: number;
    counts: RequestsControllerList200Counts;
    items: ApiRequestsMediaRequestsServiceMediaRequestView[];
};
export type AdminMediaControllerListSubtitles200 = {
    tracks: ApiMediaSubtitleServiceSubtitleTrack[];
    configured: boolean;
};
export type AdminMediaControllerRemoveSubtitleParams = {
    file?: string;
};
export type AdminMediaControllerSearchSubtitles200 = {
    results: ApiMediaSubtitleServiceSubtitleResult[];
};
export type AdminMediaControllerDownloadSubtitle200 = {
    file: string;
};
export type AdminMediaControllerListParams = {
    libraryId?: string;
    type?: string;
    parentId?: string;
    search?: string;
    page?: number;
    size?: number;
};
export type AdminMediaControllerList200ItemsItemProviderIds = {
    [key: string]: string;
};
export type AdminMediaControllerList200ItemsItem = {
    parentTitle: null | string;
    id: string;
    libraryId: string;
    parentId: null | string;
    type: 'movie' | 'episode' | 'series' | 'season' | 'album' | 'track' | 'video';
    title: string;
    year: null | number;
    seasonNumber: null | number;
    episodeNumber: null | number;
    path: string;
    providerIds: AdminMediaControllerList200ItemsItemProviderIds;
    sizeBytes: null | number;
    edited: boolean;
    poster: null | number;
    updatedAt: string;
};
export type AdminMediaControllerList200 = {
    items: AdminMediaControllerList200ItemsItem[];
    total: number;
    page: number;
    size: number;
    categoryCounts: ApiMediaAdminMediaServiceMediaCategoryCounts;
};
export type AdminMediaControllerGet200Parent = {
    id: string;
    title: string;
    type: 'movie' | 'episode' | 'series' | 'season' | 'album' | 'track' | 'video';
} | null;
export type AdminMediaControllerGet200ProviderIds = {
    [key: string]: string;
};
export type AdminMediaControllerGet200Metadata = {
    [key: string]: unknown;
};
export type AdminMediaControllerGet200Technical = null | {
    [key: string]: unknown;
};
export type AdminMediaControllerGet200 = {
    images: ApiMediaAdminMediaServiceMediaItemImage[];
    parent: AdminMediaControllerGet200Parent;
    childCount: number;
    id: string;
    libraryId: string;
    parentId: null | string;
    type: 'movie' | 'episode' | 'series' | 'season' | 'album' | 'track' | 'video';
    externalKey: string;
    path: string;
    rootId: null | string;
    relativePath: null | string;
    title: string;
    sortTitle: null | string;
    year: null | number;
    seasonNumber: null | number;
    episodeNumber: null | number;
    episodeEndNumber: null | number;
    providerIds: AdminMediaControllerGet200ProviderIds;
    metadata: AdminMediaControllerGet200Metadata;
    technical: AdminMediaControllerGet200Technical;
    sizeBytes: null | number;
    modifiedAt: null | string;
    nfoPresent: boolean;
    localImagesUsed: boolean;
    isPlaceholder: boolean;
    editedFields: string[];
    lastSeenAt: null | string;
    createdAt: string;
    updatedAt: string;
};
export type AdminMediaControllerUpdate200Parent = {
    id: string;
    title: string;
    type: 'movie' | 'episode' | 'series' | 'season' | 'album' | 'track' | 'video';
} | null;
export type AdminMediaControllerUpdate200ProviderIds = {
    [key: string]: string;
};
export type AdminMediaControllerUpdate200Metadata = {
    [key: string]: unknown;
};
export type AdminMediaControllerUpdate200Technical = null | {
    [key: string]: unknown;
};
export type AdminMediaControllerUpdate200 = {
    images: ApiMediaAdminMediaServiceMediaItemImage[];
    parent: AdminMediaControllerUpdate200Parent;
    childCount: number;
    id: string;
    libraryId: string;
    parentId: null | string;
    type: 'movie' | 'episode' | 'series' | 'season' | 'album' | 'track' | 'video';
    externalKey: string;
    path: string;
    rootId: null | string;
    relativePath: null | string;
    title: string;
    sortTitle: null | string;
    year: null | number;
    seasonNumber: null | number;
    episodeNumber: null | number;
    episodeEndNumber: null | number;
    providerIds: AdminMediaControllerUpdate200ProviderIds;
    metadata: AdminMediaControllerUpdate200Metadata;
    technical: AdminMediaControllerUpdate200Technical;
    sizeBytes: null | number;
    modifiedAt: null | string;
    nfoPresent: boolean;
    localImagesUsed: boolean;
    isPlaceholder: boolean;
    editedFields: string[];
    lastSeenAt: null | string;
    createdAt: string;
    updatedAt: string;
};
export type AdminMediaControllerRefresh200 = {
    queued: boolean;
    alreadyQueued: boolean;
};
export type AdminMediaControllerImageParams = {
    w?: number;
};
export type AdminMediaControllerRemoveImage200Parent = {
    id: string;
    title: string;
    type: 'movie' | 'episode' | 'series' | 'season' | 'album' | 'track' | 'video';
} | null;
export type AdminMediaControllerRemoveImage200ProviderIds = {
    [key: string]: string;
};
export type AdminMediaControllerRemoveImage200Metadata = {
    [key: string]: unknown;
};
export type AdminMediaControllerRemoveImage200Technical = null | {
    [key: string]: unknown;
};
export type AdminMediaControllerRemoveImage200 = {
    images: ApiMediaAdminMediaServiceMediaItemImage[];
    parent: AdminMediaControllerRemoveImage200Parent;
    childCount: number;
    id: string;
    libraryId: string;
    parentId: null | string;
    type: 'movie' | 'episode' | 'series' | 'season' | 'album' | 'track' | 'video';
    externalKey: string;
    path: string;
    rootId: null | string;
    relativePath: null | string;
    title: string;
    sortTitle: null | string;
    year: null | number;
    seasonNumber: null | number;
    episodeNumber: null | number;
    episodeEndNumber: null | number;
    providerIds: AdminMediaControllerRemoveImage200ProviderIds;
    metadata: AdminMediaControllerRemoveImage200Metadata;
    technical: AdminMediaControllerRemoveImage200Technical;
    sizeBytes: null | number;
    modifiedAt: null | string;
    nfoPresent: boolean;
    localImagesUsed: boolean;
    isPlaceholder: boolean;
    editedFields: string[];
    lastSeenAt: null | string;
    createdAt: string;
    updatedAt: string;
};
export type AdminMediaControllerAddImageParams = {
    type?: string;
};
export type AdminMediaControllerAddImageBody = {
    image?: Blob | File;
};
export type MediaHomeControllerGetHome200FeaturedItem = {
    tagline: null | string;
    overview: null | string;
    rating: null | string;
    runtimeMinutes: null | number;
    id: string;
    type: 'movie' | 'episode' | 'series' | 'season' | 'album' | 'track' | 'video';
    title: string;
    year: null | number;
    poster: null | number;
    backdrop: null | number;
    updatedAt: string;
};
export type MediaHomeControllerGetHome200 = {
    libraries: ApiMediaMediaHomeServiceHomeLibrary[];
    featured: MediaHomeControllerGetHome200FeaturedItem[];
    continueWatching: ApiMediaMediaHomeServiceContinueCard[];
    recentMovies: ApiMediaMediaHomeServiceCard[];
    recentShows: ApiMediaMediaHomeServiceCard[];
    recentAlbums: ApiMediaMediaHomeServiceCard[];
};
export type MediaHomeControllerGetProgress200 = {
    positionSeconds: number;
    completed: boolean;
};
export type MediaHomeControllerSearchParams = {
    q?: string;
    type?: string;
    genre?: string;
    yearFrom?: number;
    yearTo?: number;
    sort?: string;
    unwatched?: string;
};
export type MediaHomeControllerPersonImageParams = {
    w?: number;
};
export type MediaHomeControllerPerson200GroupsItemItemsItem = ApiMediaMediaHomeServiceHomeCard & ({
    detail: null | string;
});
export type MediaHomeControllerPerson200GroupsItem = {
    role: string;
    items: MediaHomeControllerPerson200GroupsItemItemsItem[];
};
export type MediaHomeControllerPerson200 = {
    id: string;
    name: string;
    hasImage: boolean;
    profile: null | ApiMediaMediaHomeServicePersonProfileView;
    groups: MediaHomeControllerPerson200GroupsItem[];
};
export type MediaHomeControllerBrowseParams = {
    sort?: string;
    offset?: number;
    limit?: number;
};
export type MediaHomeControllerBrowse200 = {
    total: number;
    items: ApiMediaMediaHomeServiceHomeCard[];
};
export type MediaHomeControllerItem200CastItem = {
    id: string;
    name: string;
    role: null | string;
    hasImage: boolean;
};
export type MediaHomeControllerItem200CrewItem = {
    id: string;
    name: string;
    role: string;
    hasImage: boolean;
};
export type MediaHomeControllerItem200Ratings = {
    [key: string]: number;
};
export type MediaHomeControllerItem200Technical = {
    container: null | string;
    videoCodec: null | string;
    audioCodec: null | string;
    width: null | number;
    height: null | number;
    hdr: null | string;
} | null;
export type MediaHomeControllerItem200Parent = {
    id: string;
    type: 'movie' | 'episode' | 'series' | 'season' | 'album' | 'track' | 'video';
    title: string;
} | null;
export type MediaHomeControllerItem200Series = {
    id: string;
    title: string;
} | null;
export type MediaHomeControllerItem200ChildrenItemEpisodesItem = {
    id: string;
    watched: boolean;
    type: 'movie' | 'episode' | 'series' | 'season' | 'album' | 'track' | 'video';
    title: string;
    year: null | number;
    seasonNumber: null | number;
    episodeNumber: null | number;
    overview: null | string;
    runtimeMinutes: null | number;
    poster: null | number;
    thumb: null | number;
    updatedAt: string;
};
export type MediaHomeControllerItem200ChildrenItem = {
    episodes: MediaHomeControllerItem200ChildrenItemEpisodesItem[];
    id: string;
    watched: boolean;
    type: 'movie' | 'episode' | 'series' | 'season' | 'album' | 'track' | 'video';
    title: string;
    year: null | number;
    seasonNumber: null | number;
    episodeNumber: null | number;
    overview: null | string;
    runtimeMinutes: null | number;
    poster: null | number;
    thumb: null | number;
    updatedAt: string;
};
export type MediaHomeControllerItem200 = {
    id: string;
    watched: boolean;
    type: 'movie' | 'episode' | 'series' | 'season' | 'album' | 'track' | 'video';
    title: string;
    year: null | number;
    seasonNumber: null | number;
    episodeNumber: null | number;
    tagline: null | string;
    overview: null | string;
    rating: null | string;
    runtimeMinutes: null | number;
    genres: string[];
    studios: string[];
    cast: MediaHomeControllerItem200CastItem[];
    crew: MediaHomeControllerItem200CrewItem[];
    ratings: MediaHomeControllerItem200Ratings;
    status: null | string;
    artist: null | string;
    artistId: null | string;
    technical: MediaHomeControllerItem200Technical;
    chapters: ApiMediaSegmentLogicChapter[];
    poster: null | number;
    backdrop: null | number;
    logo: null | number;
    updatedAt: string;
    parent: MediaHomeControllerItem200Parent;
    series: MediaHomeControllerItem200Series;
    children: MediaHomeControllerItem200ChildrenItem[];
};
export type MediaHomeControllerImageParams = {
    w?: number;
};
export type NetworkSharesControllerSupport200 = {
    supported: boolean;
};
export type AdminUsersControllerSetAvatarBody = {
    avatar?: Blob | File;
};
export type AdminUsersControllerRevokeSessions200 = {
    revoked: number;
};
export type NotificationsControllerList200ItemsItem = {
    id: string;
    kind: 'admin' | 'new_media' | 'request' | 'message' | 'friend_request';
    title: string;
    body: string;
    url: null | string;
    read: boolean;
    createdAt: string;
};
export type NotificationsControllerList200 = {
    unread: number;
    items: NotificationsControllerList200ItemsItem[];
};
export type NotificationsControllerConfig200 = {
    enabled: boolean;
    permissionPrompt: 'button' | 'load';
};
export type NotificationsControllerPushKey200 = {
    publicKey: string;
};
export type NotificationsControllerPushStatusParams = {
    endpoint?: string;
};
export type NotificationsControllerPushStatus200 = {
    subscribed: boolean;
};
export type AdminNotificationsControllerSend200 = {
    recipients: number;
    pushed: number;
};
export type FavoritesControllerList200 = {
    items: ApiSocialSocialItemsSocialItem[];
};
export type FavoritesControllerIds200 = {
    ids: string[];
};
export type PlaylistsControllerList200 = {
    playlists: ApiSocialPlaylistsServicePlaylistSummary[];
};
export type PlaylistsControllerContaining200 = {
    playlistIds: string[];
};
export type PlaylistsControllerGet200TracksItem = ApiSocialSocialItemsSocialItem & ({
    artist: null | string;
    album: null | string;
    albumId: null | string;
    durationSeconds: null | number;
    position: number;
});
export type PlaylistsControllerGet200Cover = {
    itemId: string;
    index: number;
    updatedAt: string;
} | null;
export type PlaylistsControllerGet200Owner = {
    username: string;
    displayName: string;
    avatarUrl: null | string;
};
export type PlaylistsControllerGet200 = {
    isOwner: boolean;
    tracks: PlaylistsControllerGet200TracksItem[];
    id: string;
    name: string;
    description: null | string;
    isPublic: boolean;
    trackCount: number;
    durationSeconds: number;
    cover: PlaylistsControllerGet200Cover;
    owner: PlaylistsControllerGet200Owner;
    updatedAt: string;
};
export type PlaylistsControllerAddItem200 = {
    added: number;
};
export type ChatControllerList200 = {
    conversations: ChatChatServiceChatConversation[];
    unread: number;
};
export type ChatControllerUnread200 = {
    count: number;
};
export type ChatControllerMessagesParams = {
    before?: string;
    after?: string;
};
export type ChatControllerMessages200 = {
    messages: ChatChatServiceChatMessage[];
    hasMore: boolean;
};
export type ProfilesControllerDirectoryParams = {
    q?: string;
};
export type ProfilesControllerDirectory200ProfilesItem = {
    username: string;
    displayName: string;
    avatarUrl: null | string;
    joinedAt: string;
    favoriteCount: number;
    playlistCount: number;
    playCount: number;
    nowPlaying: null | ApiSocialProfilesServiceNowPlaying;
};
export type ProfilesControllerDirectory200 = {
    profiles: ProfilesControllerDirectory200ProfilesItem[];
};
export type ProfilesControllerMe200 = {
    username: string;
    displayName: string;
    avatarUrl: null | string;
    joinedAt: string;
    isSelf: boolean;
    hidden: boolean;
    visibility: 'public' | 'friends' | 'hidden';
    friendship: 'none' | 'friends' | 'self' | 'outgoing' | 'incoming';
    isFriend: boolean;
    nowPlaying: null | ApiSocialProfilesServiceNowPlaying;
    recentlyWatched: ApiSocialSocialItemsSocialItem[];
    recentlyListened: ApiSocialSocialItemsSocialItem[];
    favorites: ApiSocialSocialItemsSocialItem[];
    playlists: ApiSocialPlaylistsServicePlaylistSummary[];
};
export type ProfilesControllerSetVisibility200 = {
    visibility: 'public' | 'friends' | 'hidden';
};
export type ProfilesControllerGet200 = {
    party: null | PartyPartiesServicePartySummary;
    username: string;
    displayName: string;
    avatarUrl: null | string;
    joinedAt: string;
    isSelf: boolean;
    hidden: boolean;
    visibility: 'public' | 'friends' | 'hidden';
    friendship: 'none' | 'friends' | 'self' | 'outgoing' | 'incoming';
    isFriend: boolean;
    nowPlaying: null | ApiSocialProfilesServiceNowPlaying;
    recentlyWatched: ApiSocialSocialItemsSocialItem[];
    recentlyListened: ApiSocialSocialItemsSocialItem[];
    favorites: ApiSocialSocialItemsSocialItem[];
    playlists: ApiSocialPlaylistsServicePlaylistSummary[];
};
export type FriendsControllerList200 = {
    friends: ApiSocialFriendsServiceFriendPerson[];
    incoming: ApiSocialFriendsServiceFriendPerson[];
    outgoing: ApiSocialFriendsServiceFriendPerson[];
};
export type FriendsControllerCreateInvite200 = {
    token: string;
    expiresAt: null | string;
};
export type FriendsControllerGetInvite200 = {
    username: string;
    displayName: string;
    avatarUrl: null | string;
    friendship: 'none' | 'friends' | 'self' | 'outgoing' | 'incoming';
};
export type FriendsControllerAcceptInvite200 = {
    status: 'friends';
};
export type FriendsControllerRequest200 = {
    status: 'friends' | 'outgoing' | 'incoming';
};
export type FriendsControllerAccept200 = {
    status: 'friends';
};
export type ThemesControllerSyncBody = {
    libraryId?: string;
};
export type ThemesControllerSync200 = {
    eligible: number;
    queued: number;
};
export type AdminUpdatesControllerStatusParams = {
    refresh?: string;
};
export type AdminBackupsControllerUploadBody = {
    backup?: Blob | File;
};
export type AdminBackupsControllerSetPassphraseBody = {
    [key: string]: unknown;
};
export type AdminBackupsControllerSetPassphrase200 = {
    passphraseSet: boolean;
};
export type AdminBackupsControllerClearPassphrase200 = {
    passphraseSet: boolean;
};
export type AdminBackupsControllerRestoreBody = {
    [key: string]: unknown;
};
export type AdminBackupsControllerDownloadLink200 = {
    path: string;
    expiresAt: string;
};
export type AdminBackupsControllerRemove200 = {
    deleted: string;
};
export type BackupDownloadControllerDownloadParams = {
    expires?: string;
    signature?: string;
};
export type BackupDownloadControllerDownload200Errored = {
    name: string;
    message: string;
    stack?: string;
    cause?: unknown;
} | null;
export type BackupDownloadControllerDownload200 = {
    bytesRead: number;
    path: string | Blob;
    pending: boolean;
    readableAborted: boolean;
    readable: boolean;
    readableDidRead: boolean;
    readableEncoding: null | 'ascii' | 'utf8' | 'utf-8' | 'utf16le' | 'utf-16le' | 'ucs2' | 'ucs-2' | 'base64' | 'base64url' | 'latin1' | 'binary' | 'hex';
    readableEnded: boolean;
    readableFlowing: null | false | true;
    readableHighWaterMark: number;
    readableLength: number;
    readableObjectMode: boolean;
    destroyed: boolean;
    closed: boolean;
    errored: BackupDownloadControllerDownload200Errored;
};
export type OverviewControllerGet200Counts = {
    users: number;
    movies: number;
    series: number;
    episodes: number;
    albums: number;
    tracks: number;
};
export type OverviewControllerGet200LibrariesItem = {
    id: string;
    name: string;
    type: 'movies' | 'tvshows' | 'music' | 'homevideos' | 'mixed';
    items: number;
    sizeBytes: number;
};
export type OverviewControllerGet200StorageDisksItem = {
    totalBytes: number;
    freeBytes: number;
    roots: string[];
};
export type OverviewControllerGet200Storage = {
    usedBytes: number;
    disks: OverviewControllerGet200StorageDisksItem[];
};
export type OverviewControllerGet200ActivityItem = {
    user: string;
    title: string;
    type: string;
    showTitle: null | string;
    seasonNumber: null | number;
    episodeNumber: null | number;
    positionSeconds: number;
    durationSeconds: number;
    completed: boolean;
    at: string;
};
export type OverviewControllerGet200ServerStreamer = {
    reachable: boolean;
    transcodingAvailable: boolean;
    activeTranscodes: number;
    maxTranscodes: number;
    sessions: number;
};
export type OverviewControllerGet200ServerIndexer = {
    reachable: boolean;
    activeScans: number;
    providers: string[];
};
export type OverviewControllerGet200Server = {
    name: string;
    version: string;
    node: string;
    os: string;
    uptimeSeconds: number;
    streamer: OverviewControllerGet200ServerStreamer;
    indexer: OverviewControllerGet200ServerIndexer;
};
export type OverviewControllerGet200 = {
    counts: OverviewControllerGet200Counts;
    libraries: OverviewControllerGet200LibrariesItem[];
    storage: OverviewControllerGet200Storage;
    activity: OverviewControllerGet200ActivityItem[];
    server: OverviewControllerGet200Server;
};
export type OverviewControllerActivityListParams = {
    search?: string;
    user?: string;
    type?: string;
    status?: string;
    from?: string;
    to?: string;
    sort?: string;
    page?: string;
    pageSize?: string;
};
export type OverviewControllerActivityList200ItemsItem = {
    user: string;
    title: string;
    type: string;
    showTitle: null | string;
    seasonNumber: null | number;
    episodeNumber: null | number;
    positionSeconds: number;
    durationSeconds: number;
    completed: boolean;
    at: string;
};
export type OverviewControllerActivityList200Summary = {
    total: number;
    finished: number;
    inProgress: number;
    users: number;
};
export type OverviewControllerActivityList200UsersItem = {
    id: string;
    name: string;
};
export type OverviewControllerActivityList200 = {
    items: OverviewControllerActivityList200ItemsItem[];
    page: number;
    pageSize: number;
    total: number;
    summary: OverviewControllerActivityList200Summary;
    users: OverviewControllerActivityList200UsersItem[];
};
export declare const getApiDocumentation: (axiosInstance?: AxiosInstance) => {
    versionControllerGet: (options?: AxiosRequestConfig) => Promise<AxiosResponse<VersionControllerGet200>>;
    setupControllerStatus: (options?: AxiosRequestConfig) => Promise<AxiosResponse<BootstrapSetupStatusSetupStatus>>;
    setupControllerRequestRecoveryKey: (options?: AxiosRequestConfig) => Promise<AxiosResponse<SetupControllerRequestRecoveryKey200>>;
    setupControllerProgress: (options?: AxiosRequestConfig) => Promise<AxiosResponse<SetupControllerProgress200>>;
    setupControllerFlow: (setupControllerFlowBody?: SetupControllerFlowBody, options?: AxiosRequestConfig) => Promise<AxiosResponse<SetupControllerFlow200>>;
    setupControllerTestStep: (step: string, setupControllerTestStepBody?: SetupControllerTestStepBody, options?: AxiosRequestConfig) => Promise<AxiosResponse<SetupControllerTestStep200>>;
    setupControllerApplyStep: (step: string, setupControllerApplyStepBody?: SetupControllerApplyStepBody, options?: AxiosRequestConfig) => Promise<AxiosResponse<SetupControllerApplyStep200>>;
    setupControllerComplete: (options?: AxiosRequestConfig) => Promise<AxiosResponse<SetupControllerComplete200>>;
    setupControllerReset: (setupControllerResetBody?: SetupControllerResetBody, options?: AxiosRequestConfig) => Promise<AxiosResponse<SetupControllerReset200>>;
    internalConfigControllerGet: (service: string, options?: AxiosRequestConfig) => Promise<AxiosResponse<BootstrapInternalConfigIndexerRuntimeConfig>>;
    authControllerRegister: (registerRequest?: RegisterRequest, options?: AxiosRequestConfig) => Promise<AxiosResponse<ApiAuthAuthServiceAuthResult | ApiAuthAuthServiceVerificationPending>>;
    authControllerMe: (options?: AxiosRequestConfig) => Promise<AxiosResponse<ApiAuthAuthServicePublicUser>>;
    authControllerUpdateMe: (updateProfileRequest?: UpdateProfileRequest, options?: AxiosRequestConfig) => Promise<AxiosResponse<ApiAuthAuthServicePublicUser>>;
    authControllerSetPasskeyRequired: (setPasskeyRequiredRequest?: SetPasskeyRequiredRequest, options?: AxiosRequestConfig) => Promise<AxiosResponse<ApiAuthAuthServicePublicUser>>;
    authControllerChangePassword: (changePasswordRequest?: ChangePasswordRequest, options?: AxiosRequestConfig) => Promise<AxiosResponse<AuthControllerChangePassword200>>;
    authControllerDeleteMe: (deleteAccountRequest?: DeleteAccountRequest, options?: AxiosRequestConfig) => Promise<AxiosResponse<AuthControllerDeleteMe200>>;
    authControllerVerifyEmail: (verifyEmailRequest?: VerifyEmailRequest, options?: AxiosRequestConfig) => Promise<AxiosResponse<AuthControllerVerifyEmail200>>;
    authControllerResendVerification: (loginRequest?: LoginRequest, options?: AxiosRequestConfig) => Promise<AxiosResponse<AuthControllerResendVerification200>>;
    authControllerLogin: (loginRequest?: LoginRequest, options?: AxiosRequestConfig) => Promise<AxiosResponse<ApiAuthAuthServiceAuthResult | ApiAuthAuthServicePasskeyRequired>>;
    authControllerListSessions: (options?: AxiosRequestConfig) => Promise<AxiosResponse<ApiAuthAuthServicePublicSession[]>>;
    authControllerRevokeSession: (sessionId: string, options?: AxiosRequestConfig) => Promise<AxiosResponse<AuthControllerRevokeSession200>>;
    authControllerLogout: (options?: AxiosRequestConfig) => Promise<AxiosResponse<AuthControllerLogout200>>;
    avatarControllerUpload: (avatarControllerUploadBody?: AvatarControllerUploadBody, options?: AxiosRequestConfig) => Promise<AxiosResponse<unknown>>;
    avatarControllerRemove: (options?: AxiosRequestConfig) => Promise<AxiosResponse<ApiAuthAuthServicePublicUser>>;
    avatarControllerAvatar: (filename: string, options?: AxiosRequestConfig) => Promise<AxiosResponse<Blob>>;
    passkeyControllerList: (options?: AxiosRequestConfig) => Promise<AxiosResponse<ApiAuthPasskeyServicePublicPasskey[]>>;
    passkeyControllerRegistrationOptions: (deleteAccountRequest?: DeleteAccountRequest, options?: AxiosRequestConfig) => Promise<AxiosResponse<PasskeyControllerRegistrationOptions200>>;
    passkeyControllerRegistrationVerify: (passkeyVerifyRequest?: PasskeyVerifyRequest, options?: AxiosRequestConfig) => Promise<AxiosResponse<ApiAuthPasskeyServicePublicPasskey>>;
    passkeyControllerLoginOptions: (options?: AxiosRequestConfig) => Promise<AxiosResponse<PasskeyControllerLoginOptions200>>;
    passkeyControllerLoginVerify: (passkeyVerifyRequest?: PasskeyVerifyRequest, options?: AxiosRequestConfig) => Promise<AxiosResponse<ApiAuthAuthServiceAuthResult>>;
    passkeyControllerSecondFactorOptions: (passkeySecondFactorRequest?: PasskeySecondFactorRequest, options?: AxiosRequestConfig) => Promise<AxiosResponse<PasskeyControllerSecondFactorOptions200>>;
    passkeyControllerSecondFactorVerify: (passkeySecondFactorRequest?: PasskeySecondFactorRequest, options?: AxiosRequestConfig) => Promise<AxiosResponse<ApiAuthAuthServiceAuthResult>>;
    passkeyControllerStartNativeHandoff: (nativePasskeyHandoffStartRequest?: NativePasskeyHandoffStartRequest, options?: AxiosRequestConfig) => Promise<AxiosResponse<PasskeyControllerStartNativeHandoff200>>;
    passkeyControllerNativeHandoffOptions: (nativePasskeyHandoffIdRequest?: NativePasskeyHandoffIdRequest, options?: AxiosRequestConfig) => Promise<AxiosResponse<PasskeyControllerNativeHandoffOptions200>>;
    passkeyControllerVerifyNativeHandoff: (nativePasskeyHandoffVerifyRequest?: NativePasskeyHandoffVerifyRequest, options?: AxiosRequestConfig) => Promise<AxiosResponse<PasskeyControllerVerifyNativeHandoff200>>;
    passkeyControllerExchangeNativeHandoff: (nativePasskeyHandoffExchangeRequest?: NativePasskeyHandoffExchangeRequest, options?: AxiosRequestConfig) => Promise<AxiosResponse<ApiAuthAuthServiceAuthResult>>;
    passkeyControllerRemove: (passkeyId: string, deleteAccountRequest?: DeleteAccountRequest, options?: AxiosRequestConfig) => Promise<AxiosResponse<PasskeyControllerRemove200>>;
    userControllerListUsers: (options?: AxiosRequestConfig) => Promise<AxiosResponse<ApiAuthAuthServicePublicUser[]>>;
    userControllerGetUser: (id: string, options?: AxiosRequestConfig) => Promise<AxiosResponse<ApiAuthAuthServicePublicUser>>;
    userControllerDeleteUser: (id: string, deleteUserRequest?: DeleteUserRequest, options?: AxiosRequestConfig) => Promise<AxiosResponse<UserControllerDeleteUser200>>;
    preferencesControllerGet: (options?: AxiosRequestConfig) => Promise<AxiosResponse<ApiPreferencesPreferencesServicePreferences>>;
    preferencesControllerUpdate: (updatePreferencesRequest?: UpdatePreferencesRequest, options?: AxiosRequestConfig) => Promise<AxiosResponse<ApiPreferencesPreferencesServicePreferences>>;
    settingsControllerList: (options?: AxiosRequestConfig) => Promise<AxiosResponse<ApiSettingsSettingsServicePublicSetting[]>>;
    settingsControllerRegistrationStatus: (options?: AxiosRequestConfig) => Promise<AxiosResponse<SettingsControllerRegistrationStatus200>>;
    settingsControllerSendTestEmail: (options?: AxiosRequestConfig) => Promise<AxiosResponse<SettingsControllerSendTestEmail200>>;
    settingsControllerUpdate: (key: string, settingRequest?: SettingRequest, options?: AxiosRequestConfig) => Promise<AxiosResponse<ApiSettingsSettingsServicePublicSetting>>;
    playbackControllerListSamples: (options?: AxiosRequestConfig) => Promise<AxiosResponse<ApiPlaybackPlaybackServiceSampleVideo[]>>;
    playbackControllerItemPlaybackInfo: (id: string, options?: AxiosRequestConfig) => Promise<AxiosResponse<PlaybackControllerItemPlaybackInfo200>>;
    playbackControllerPlaybackInfo: (id: string, options?: AxiosRequestConfig) => Promise<AxiosResponse<ApiPlaybackPlaybackServicePlaybackInfo>>;
    jobsControllerGetQueues: (options?: AxiosRequestConfig) => Promise<AxiosResponse<JobsControllerGetQueues200Item[]>>;
    jobsControllerFindJobs: (queueName: string, params?: JobsControllerFindJobsParams, options?: AxiosRequestConfig) => Promise<AxiosResponse<JobsControllerFindJobs200Item[]>>;
    jobsControllerEnqueue: (queueName: string, enqueueJobRequest?: EnqueueJobRequest, options?: AxiosRequestConfig) => Promise<AxiosResponse<JobsControllerEnqueue200>>;
    jobsControllerGetJob: (queueName: string, jobId: string, options?: AxiosRequestConfig) => Promise<AxiosResponse<JobsControllerGetJob200>>;
    jobsControllerCancelJob: (queueName: string, jobId: string, options?: AxiosRequestConfig) => Promise<AxiosResponse<JobsControllerCancelJob200>>;
    jobsControllerRetryJob: (queueName: string, jobId: string, options?: AxiosRequestConfig) => Promise<AxiosResponse<JobsControllerRetryJob200>>;
    jobsControllerGetSchedules: (options?: AxiosRequestConfig) => Promise<AxiosResponse<JobsControllerGetSchedules200Item[]>>;
    jobsControllerSchedule: (queueName: string, scheduleJobRequest?: ScheduleJobRequest, options?: AxiosRequestConfig) => Promise<AxiosResponse<JobsControllerSchedule200>>;
    jobsControllerUnschedule: (queueName: string, options?: AxiosRequestConfig) => Promise<AxiosResponse<JobsControllerUnschedule200>>;
    adminScheduledTasksControllerList: (options?: AxiosRequestConfig) => Promise<AxiosResponse<AdminScheduledTasksControllerList200>>;
    adminScheduledTasksControllerSaveSchedule: (id: string, adminScheduledTaskScheduleRequest?: AdminScheduledTaskScheduleRequest, options?: AxiosRequestConfig) => Promise<AxiosResponse<AdminScheduledTasksControllerSaveSchedule200>>;
    adminScheduledTasksControllerRun: (id: string, options?: AxiosRequestConfig) => Promise<AxiosResponse<AdminScheduledTasksControllerRun200>>;
    adminScheduledTasksControllerStop: (id: string, options?: AxiosRequestConfig) => Promise<AxiosResponse<AdminScheduledTasksControllerStop200>>;
    streamsControllerListSessions: (options?: AxiosRequestConfig) => Promise<AxiosResponse<ApiStreamsStreamsServiceStreamSessionsResponse>>;
    streamsControllerCancelSession: (sessionId: string, options?: AxiosRequestConfig) => Promise<AxiosResponse<void>>;
    devicesControllerList: (options?: AxiosRequestConfig) => Promise<AxiosResponse<ApiDevicesDevicesServicePublicDevice[]>>;
    devicesControllerSignOut: (id: string, options?: AxiosRequestConfig) => Promise<AxiosResponse<void>>;
    apiKeysControllerList: (options?: AxiosRequestConfig) => Promise<AxiosResponse<ApiApiKeysApiKeyServicePublicApiKey[]>>;
    apiKeysControllerCreate: (createApiKeyRequest?: CreateApiKeyRequest, options?: AxiosRequestConfig) => Promise<AxiosResponse<ApiApiKeysApiKeyServiceCreatedApiKey>>;
    apiKeysControllerRevoke: (id: string, options?: AxiosRequestConfig) => Promise<AxiosResponse<void>>;
    mediaLibrariesControllerList: (options?: AxiosRequestConfig) => Promise<AxiosResponse<ApiMediaLibrariesMediaLibrariesServicePublicMediaLibrary[]>>;
    mediaLibrariesControllerCreate: (createMediaLibraryRequest?: CreateMediaLibraryRequest, options?: AxiosRequestConfig) => Promise<AxiosResponse<ApiMediaLibrariesMediaLibrariesServicePublicMediaLibrary>>;
    mediaLibrariesControllerListRoots: (options?: AxiosRequestConfig) => Promise<AxiosResponse<MediaLibrariesControllerListRoots200Item[]>>;
    mediaLibrariesControllerBrowse: (params?: MediaLibrariesControllerBrowseParams, options?: AxiosRequestConfig) => Promise<AxiosResponse<ApiMediaLibrariesMediaRootsServiceBrowseResult>>;
    mediaLibrariesControllerUpdate: (id: string, updateMediaLibraryRequest?: UpdateMediaLibraryRequest, options?: AxiosRequestConfig) => Promise<AxiosResponse<ApiMediaLibrariesMediaLibrariesServicePublicMediaLibrary>>;
    mediaLibrariesControllerRemove: (id: string, options?: AxiosRequestConfig) => Promise<AxiosResponse<void>>;
    streamerRootsControllerList: (options?: AxiosRequestConfig) => Promise<AxiosResponse<StreamerRootsControllerList200>>;
    streamerRootsControllerTranscoding: (options?: AxiosRequestConfig) => Promise<AxiosResponse<StreamerRootsControllerTranscoding200>>;
    indexerApiControllerListLibraries: (options?: AxiosRequestConfig) => Promise<AxiosResponse<IndexerApiControllerListLibraries200>>;
    indexerApiControllerGetSettings: (options?: AxiosRequestConfig) => Promise<AxiosResponse<ApiIndexerIndexerSettingsServiceIndexerSettings>>;
    indexerApiControllerUpsertItem: (indexerApiControllerUpsertItemBody?: IndexerApiControllerUpsertItemBody, options?: AxiosRequestConfig) => Promise<AxiosResponse<IndexerApiControllerUpsertItem200>>;
    indexerApiControllerIntroSyncCandidates: (params?: IndexerApiControllerIntroSyncCandidatesParams, options?: AxiosRequestConfig) => Promise<AxiosResponse<IndexerApiControllerIntroSyncCandidates200>>;
    indexerApiControllerExistingIntroSegments: (params?: IndexerApiControllerExistingIntroSegmentsParams, options?: AxiosRequestConfig) => Promise<AxiosResponse<IndexerApiControllerExistingIntroSegments200>>;
    indexerApiControllerUpdateIntroSegments: (indexerApiControllerUpdateIntroSegmentsBody?: IndexerApiControllerUpdateIntroSegmentsBody, options?: AxiosRequestConfig) => Promise<AxiosResponse<IndexerApiControllerUpdateIntroSegments200>>;
    indexerApiControllerPruneLibrary: (id: string, indexerApiControllerPruneLibraryBody?: IndexerApiControllerPruneLibraryBody, options?: AxiosRequestConfig) => Promise<AxiosResponse<IndexerApiControllerPruneLibrary200>>;
    adminIndexerControllerStatus: (options?: AxiosRequestConfig) => Promise<AxiosResponse<ApiIndexerAdminIndexerServiceIndexerStatus>>;
    adminIndexerControllerScan: (id: string, scanLibraryRequest?: ScanLibraryRequest, options?: AxiosRequestConfig) => Promise<AxiosResponse<unknown>>;
    adminIndexerControllerQueueSegments: (id: string, librarySegmentScanRequest?: LibrarySegmentScanRequest, options?: AxiosRequestConfig) => Promise<AxiosResponse<unknown>>;
    adminIndexerControllerRefresh: (refreshItemRequest?: RefreshItemRequest, options?: AxiosRequestConfig) => Promise<AxiosResponse<unknown>>;
    adminIndexerControllerTasks: (params?: AdminIndexerControllerTasksParams, options?: AxiosRequestConfig) => Promise<AxiosResponse<ApiIndexerAdminIndexerServiceIndexerTaskPage>>;
    adminIndexerControllerTaskLogs: (queue: string, id: string, params?: AdminIndexerControllerTaskLogsParams, options?: AxiosRequestConfig) => Promise<AxiosResponse<ApiIndexerAdminIndexerServiceIndexerTaskLogs>>;
    adminIndexerControllerCancelTask: (queue: string, id: string, options?: AxiosRequestConfig) => Promise<AxiosResponse<unknown>>;
    adminIndexerControllerRetryTask: (queue: string, id: string, options?: AxiosRequestConfig) => Promise<AxiosResponse<unknown>>;
    adminIndexerControllerCancelActive: (queue: string, options?: AxiosRequestConfig) => Promise<AxiosResponse<AdminIndexerControllerCancelActive200>>;
    adminIndexerControllerClearFailed: (queue: string, options?: AxiosRequestConfig) => Promise<AxiosResponse<AdminIndexerControllerClearFailed200>>;
    adminIndexerControllerPause: (queue: string, options?: AxiosRequestConfig) => Promise<AxiosResponse<unknown>>;
    adminIndexerControllerResume: (queue: string, options?: AxiosRequestConfig) => Promise<AxiosResponse<unknown>>;
    adminIndexerControllerSetConcurrency: (adminIndexerControllerSetConcurrencyBody?: AdminIndexerControllerSetConcurrencyBody, options?: AxiosRequestConfig) => Promise<AxiosResponse<ApiIndexerAdminIndexerServiceIndexerStatus>>;
    pluginsControllerInstalled: (options?: AxiosRequestConfig) => Promise<AxiosResponse<PluginsControllerInstalled200Item[]>>;
    pluginsControllerRepositories: (options?: AxiosRequestConfig) => Promise<AxiosResponse<EntitiesPluginRepositoryEntityPluginRepository[]>>;
    pluginsControllerAddRepository: (pluginsControllerAddRepositoryBody?: PluginsControllerAddRepositoryBody, options?: AxiosRequestConfig) => Promise<AxiosResponse<EntitiesPluginRepositoryEntityPluginRepository>>;
    pluginsControllerCatalog: (params?: PluginsControllerCatalogParams, options?: AxiosRequestConfig) => Promise<AxiosResponse<PluginsControllerCatalog200Item[]>>;
    pluginsControllerPluginSettingsView: (id: string, options?: AxiosRequestConfig) => Promise<AxiosResponse<PluginsControllerPluginSettingsView200>>;
    pluginsControllerUpdatePluginSettings: (id: string, pluginsControllerUpdatePluginSettingsBody?: PluginsControllerUpdatePluginSettingsBody, options?: AxiosRequestConfig) => Promise<AxiosResponse<PluginsControllerUpdatePluginSettings200>>;
    pluginsControllerPluginUpdateHistory: (id: string, params?: PluginsControllerPluginUpdateHistoryParams, options?: AxiosRequestConfig) => Promise<AxiosResponse<EntitiesPluginUpdateHistoryEntityPluginUpdateHistory[]>>;
    pluginsControllerInstall: (id: string, pluginsControllerInstallBody?: PluginsControllerInstallBody, options?: AxiosRequestConfig) => Promise<AxiosResponse<EntitiesPluginInstallationEntityPluginInstallation>>;
    pluginsControllerEnable: (id: string, options?: AxiosRequestConfig) => Promise<AxiosResponse<EntitiesPluginInstallationEntityPluginInstallation>>;
    pluginsControllerDisable: (id: string, options?: AxiosRequestConfig) => Promise<AxiosResponse<EntitiesPluginInstallationEntityPluginInstallation>>;
    pluginsControllerUninstall: (id: string, options?: AxiosRequestConfig) => Promise<AxiosResponse<void>>;
    pluginsControllerRefreshRepository: (id: string, options?: AxiosRequestConfig) => Promise<AxiosResponse<EntitiesPluginRepositoryEntityPluginRepository>>;
    pluginsControllerRemoveRepository: (id: string, options?: AxiosRequestConfig) => Promise<AxiosResponse<void>>;
    pluginRuntimeControllerListPages: (options?: AxiosRequestConfig) => Promise<AxiosResponse<ApiPluginsPluginPagesServicePluginPageSummary[]>>;
    pluginRuntimeControllerSearchSections: (params?: PluginRuntimeControllerSearchSectionsParams, options?: AxiosRequestConfig) => Promise<AxiosResponse<PluginRuntimeControllerSearchSections200>>;
    pluginRuntimeControllerInvoke: (pluginId: string, operation: string, pluginRuntimeControllerInvokeBody?: PluginRuntimeControllerInvokeBody, options?: AxiosRequestConfig) => Promise<AxiosResponse<unknown>>;
    requestImagesControllerTmdb: (size: string, file: string, options?: AxiosRequestConfig) => Promise<AxiosResponse<Blob>>;
    requestImagesControllerDiscogs: (params?: RequestImagesControllerDiscogsParams, options?: AxiosRequestConfig) => Promise<AxiosResponse<Blob>>;
    requestsControllerConfig: (options?: AxiosRequestConfig) => Promise<AxiosResponse<ApiRequestsMediaRequestsServiceRequestsConfig>>;
    requestsControllerSearch: (params?: RequestsControllerSearchParams, options?: AxiosRequestConfig) => Promise<AxiosResponse<ApiRequestsExternalMetadataExternalMediaCard[]>>;
    requestsControllerDiscover: (params?: RequestsControllerDiscoverParams, options?: AxiosRequestConfig) => Promise<AxiosResponse<ApiRequestsExternalMetadataExternalMediaCard[]>>;
    requestsControllerDetails: (type: string, id: string, options?: AxiosRequestConfig) => Promise<AxiosResponse<RequestsControllerDetails200>>;
    requestsControllerList: (params?: RequestsControllerListParams, options?: AxiosRequestConfig) => Promise<AxiosResponse<RequestsControllerList200>>;
    requestsControllerCreate: (createMediaRequest?: CreateMediaRequest, options?: AxiosRequestConfig) => Promise<AxiosResponse<ApiRequestsMediaRequestsServiceMediaRequestView>>;
    requestsControllerApprove: (id: string, approveRequestBody?: ApproveRequestBody, options?: AxiosRequestConfig) => Promise<AxiosResponse<ApiRequestsMediaRequestsServiceMediaRequestView>>;
    requestsControllerDecline: (id: string, declineRequestBody?: DeclineRequestBody, options?: AxiosRequestConfig) => Promise<AxiosResponse<ApiRequestsMediaRequestsServiceMediaRequestView>>;
    requestsControllerRetry: (id: string, options?: AxiosRequestConfig) => Promise<AxiosResponse<ApiRequestsMediaRequestsServiceMediaRequestView>>;
    requestsControllerRemove: (id: string, options?: AxiosRequestConfig) => Promise<AxiosResponse<void>>;
    adminRequestsControllerListServices: (options?: AxiosRequestConfig) => Promise<AxiosResponse<ApiRequestsRequestServicesServiceRequestServiceView[]>>;
    adminRequestsControllerCreateService: (requestServiceInput?: RequestServiceInput, options?: AxiosRequestConfig) => Promise<AxiosResponse<ApiRequestsRequestServicesServiceRequestServiceView>>;
    adminRequestsControllerTestService: (testServiceInput?: TestServiceInput, options?: AxiosRequestConfig) => Promise<AxiosResponse<ApiRequestsArrClientArrTestResult>>;
    adminRequestsControllerUpdateService: (id: string, requestServiceInput?: RequestServiceInput, options?: AxiosRequestConfig) => Promise<AxiosResponse<ApiRequestsRequestServicesServiceRequestServiceView>>;
    adminRequestsControllerRemoveService: (id: string, options?: AxiosRequestConfig) => Promise<AxiosResponse<void>>;
    adminRequestsControllerListUsers: (options?: AxiosRequestConfig) => Promise<AxiosResponse<ApiRequestsMediaRequestsServiceRequestUserLimitView[]>>;
    adminRequestsControllerUpdateUser: (id: string, requestUserLimitInput?: RequestUserLimitInput, options?: AxiosRequestConfig) => Promise<AxiosResponse<ApiRequestsMediaRequestsServiceRequestUserLimitView>>;
    adminMediaControllerListSubtitles: (id: string, options?: AxiosRequestConfig) => Promise<AxiosResponse<AdminMediaControllerListSubtitles200>>;
    adminMediaControllerRemoveSubtitle: (id: string, params?: AdminMediaControllerRemoveSubtitleParams, options?: AxiosRequestConfig) => Promise<AxiosResponse<void>>;
    adminMediaControllerSearchSubtitles: (id: string, subtitleSearchRequest?: SubtitleSearchRequest, options?: AxiosRequestConfig) => Promise<AxiosResponse<AdminMediaControllerSearchSubtitles200>>;
    adminMediaControllerDownloadSubtitle: (id: string, subtitleDownloadRequest?: SubtitleDownloadRequest, options?: AxiosRequestConfig) => Promise<AxiosResponse<AdminMediaControllerDownloadSubtitle200>>;
    adminMediaControllerSetSegment: (id: string, type: string, setSegmentRequest?: SetSegmentRequest, options?: AxiosRequestConfig) => Promise<AxiosResponse<void>>;
    adminMediaControllerClearSegment: (id: string, type: string, options?: AxiosRequestConfig) => Promise<AxiosResponse<void>>;
    adminMediaControllerList: (params?: AdminMediaControllerListParams, options?: AxiosRequestConfig) => Promise<AxiosResponse<AdminMediaControllerList200>>;
    adminMediaControllerGet: (id: string, options?: AxiosRequestConfig) => Promise<AxiosResponse<AdminMediaControllerGet200>>;
    adminMediaControllerUpdate: (id: string, updateMediaItemRequest?: UpdateMediaItemRequest, options?: AxiosRequestConfig) => Promise<AxiosResponse<AdminMediaControllerUpdate200>>;
    adminMediaControllerRemove: (id: string, options?: AxiosRequestConfig) => Promise<AxiosResponse<void>>;
    adminMediaControllerRefresh: (id: string, refreshMediaItemRequest?: RefreshMediaItemRequest, options?: AxiosRequestConfig) => Promise<AxiosResponse<AdminMediaControllerRefresh200>>;
    adminMediaControllerImage: (id: string, index: number, params?: AdminMediaControllerImageParams, options?: AxiosRequestConfig) => Promise<AxiosResponse<Blob>>;
    adminMediaControllerRemoveImage: (id: string, index: number, options?: AxiosRequestConfig) => Promise<AxiosResponse<AdminMediaControllerRemoveImage200>>;
    adminMediaControllerAddImage: (id: string, adminMediaControllerAddImageBody?: AdminMediaControllerAddImageBody, params?: AdminMediaControllerAddImageParams, options?: AxiosRequestConfig) => Promise<AxiosResponse<unknown>>;
    mediaHomeControllerGetHome: (options?: AxiosRequestConfig) => Promise<AxiosResponse<MediaHomeControllerGetHome200>>;
    mediaHomeControllerGetProgress: (id: string, options?: AxiosRequestConfig) => Promise<AxiosResponse<MediaHomeControllerGetProgress200>>;
    mediaHomeControllerSaveProgress: (id: string, watchProgressRequest?: WatchProgressRequest, options?: AxiosRequestConfig) => Promise<AxiosResponse<void>>;
    mediaHomeControllerSetWatched: (id: string, watchedRequest?: WatchedRequest, options?: AxiosRequestConfig) => Promise<AxiosResponse<void>>;
    mediaHomeControllerGenres: (options?: AxiosRequestConfig) => Promise<AxiosResponse<string[]>>;
    mediaHomeControllerSearch: (params?: MediaHomeControllerSearchParams, options?: AxiosRequestConfig) => Promise<AxiosResponse<ApiMediaMediaHomeServiceHomeCard[]>>;
    mediaHomeControllerPersonImage: (id: string, params?: MediaHomeControllerPersonImageParams, options?: AxiosRequestConfig) => Promise<AxiosResponse<Blob>>;
    mediaHomeControllerPerson: (id: string, options?: AxiosRequestConfig) => Promise<AxiosResponse<MediaHomeControllerPerson200>>;
    mediaHomeControllerBrowse: (kind: string, params?: MediaHomeControllerBrowseParams, options?: AxiosRequestConfig) => Promise<AxiosResponse<MediaHomeControllerBrowse200>>;
    mediaHomeControllerItem: (id: string, options?: AxiosRequestConfig) => Promise<AxiosResponse<MediaHomeControllerItem200>>;
    mediaHomeControllerImage: (id: string, index: number, params?: MediaHomeControllerImageParams, options?: AxiosRequestConfig) => Promise<AxiosResponse<Blob>>;
    networkSharesControllerList: (options?: AxiosRequestConfig) => Promise<AxiosResponse<ApiNetworkSharesNetworkSharesServicePublicNetworkShare[]>>;
    networkSharesControllerCreate: (createNetworkShareRequest?: CreateNetworkShareRequest, options?: AxiosRequestConfig) => Promise<AxiosResponse<ApiNetworkSharesNetworkSharesServicePublicNetworkShare>>;
    networkSharesControllerSupport: (options?: AxiosRequestConfig) => Promise<AxiosResponse<NetworkSharesControllerSupport200>>;
    networkSharesControllerUpdate: (id: string, updateNetworkShareRequest?: UpdateNetworkShareRequest, options?: AxiosRequestConfig) => Promise<AxiosResponse<ApiNetworkSharesNetworkSharesServicePublicNetworkShare>>;
    networkSharesControllerRemove: (id: string, options?: AxiosRequestConfig) => Promise<AxiosResponse<void>>;
    networkSharesControllerReconnect: (id: string, options?: AxiosRequestConfig) => Promise<AxiosResponse<ApiNetworkSharesNetworkSharesServicePublicNetworkShare>>;
    adminUsersControllerList: (options?: AxiosRequestConfig) => Promise<AxiosResponse<ApiAdminUsersAdminUsersServiceAdminUser[]>>;
    adminUsersControllerCreate: (createAdminUserRequest?: CreateAdminUserRequest, options?: AxiosRequestConfig) => Promise<AxiosResponse<ApiAdminUsersAdminUsersServiceAdminUser>>;
    adminUsersControllerUpdate: (id: string, updateAdminUserRequest?: UpdateAdminUserRequest, options?: AxiosRequestConfig) => Promise<AxiosResponse<ApiAdminUsersAdminUsersServiceAdminUser>>;
    adminUsersControllerRemove: (id: string, options?: AxiosRequestConfig) => Promise<AxiosResponse<void>>;
    adminUsersControllerSetAvatar: (id: string, adminUsersControllerSetAvatarBody?: AdminUsersControllerSetAvatarBody, options?: AxiosRequestConfig) => Promise<AxiosResponse<unknown>>;
    adminUsersControllerRemoveAvatar: (id: string, options?: AxiosRequestConfig) => Promise<AxiosResponse<ApiAdminUsersAdminUsersServiceAdminUser>>;
    adminUsersControllerSetPassword: (id: string, setUserPasswordRequest?: SetUserPasswordRequest, options?: AxiosRequestConfig) => Promise<AxiosResponse<void>>;
    adminUsersControllerRevokeSessions: (id: string, options?: AxiosRequestConfig) => Promise<AxiosResponse<AdminUsersControllerRevokeSessions200>>;
    notificationsControllerList: (options?: AxiosRequestConfig) => Promise<AxiosResponse<NotificationsControllerList200>>;
    notificationsControllerMarkRead: (markReadRequest?: MarkReadRequest, options?: AxiosRequestConfig) => Promise<AxiosResponse<void>>;
    notificationsControllerRemove: (id: string, options?: AxiosRequestConfig) => Promise<AxiosResponse<void>>;
    notificationsControllerConfig: (options?: AxiosRequestConfig) => Promise<AxiosResponse<NotificationsControllerConfig200>>;
    notificationsControllerPushKey: (options?: AxiosRequestConfig) => Promise<AxiosResponse<NotificationsControllerPushKey200>>;
    notificationsControllerPushStatus: (params?: NotificationsControllerPushStatusParams, options?: AxiosRequestConfig) => Promise<AxiosResponse<NotificationsControllerPushStatus200>>;
    notificationsControllerSubscribe: (pushSubscriptionRequest?: PushSubscriptionRequest, options?: AxiosRequestConfig) => Promise<AxiosResponse<void>>;
    notificationsControllerUnsubscribe: (pushUnsubscribeRequest?: PushUnsubscribeRequest, options?: AxiosRequestConfig) => Promise<AxiosResponse<void>>;
    adminNotificationsControllerSend: (sendNotificationRequest?: SendNotificationRequest, options?: AxiosRequestConfig) => Promise<AxiosResponse<AdminNotificationsControllerSend200>>;
    favoritesControllerList: (options?: AxiosRequestConfig) => Promise<AxiosResponse<FavoritesControllerList200>>;
    favoritesControllerIds: (options?: AxiosRequestConfig) => Promise<AxiosResponse<FavoritesControllerIds200>>;
    favoritesControllerAdd: (itemId: string, options?: AxiosRequestConfig) => Promise<AxiosResponse<void>>;
    favoritesControllerRemove: (itemId: string, options?: AxiosRequestConfig) => Promise<AxiosResponse<void>>;
    playlistsControllerList: (options?: AxiosRequestConfig) => Promise<AxiosResponse<PlaylistsControllerList200>>;
    playlistsControllerCreate: (createPlaylistRequest?: CreatePlaylistRequest, options?: AxiosRequestConfig) => Promise<AxiosResponse<ApiSocialPlaylistsServicePlaylistSummary>>;
    playlistsControllerContaining: (itemId: string, options?: AxiosRequestConfig) => Promise<AxiosResponse<PlaylistsControllerContaining200>>;
    playlistsControllerGet: (id: string, options?: AxiosRequestConfig) => Promise<AxiosResponse<PlaylistsControllerGet200>>;
    playlistsControllerUpdate: (id: string, updatePlaylistRequest?: UpdatePlaylistRequest, options?: AxiosRequestConfig) => Promise<AxiosResponse<ApiSocialPlaylistsServicePlaylistSummary>>;
    playlistsControllerRemove: (id: string, options?: AxiosRequestConfig) => Promise<AxiosResponse<void>>;
    playlistsControllerAddItem: (id: string, playlistItemRequest?: PlaylistItemRequest, options?: AxiosRequestConfig) => Promise<AxiosResponse<PlaylistsControllerAddItem200>>;
    playlistsControllerRemoveTrack: (id: string, itemId: string, options?: AxiosRequestConfig) => Promise<AxiosResponse<void>>;
    playlistsControllerReorder: (id: string, playlistOrderRequest?: PlaylistOrderRequest, options?: AxiosRequestConfig) => Promise<AxiosResponse<void>>;
    partiesControllerCreate: (createPartyRequest?: CreatePartyRequest, options?: AxiosRequestConfig) => Promise<AxiosResponse<PartyPartiesServicePartySnapshot>>;
    partiesControllerGet: (id: string, options?: AxiosRequestConfig) => Promise<AxiosResponse<PartyPartiesServicePartySnapshot>>;
    partiesControllerEnd: (id: string, options?: AxiosRequestConfig) => Promise<AxiosResponse<void>>;
    chatControllerList: (options?: AxiosRequestConfig) => Promise<AxiosResponse<ChatControllerList200>>;
    chatControllerStart: (startChatRequest?: StartChatRequest, options?: AxiosRequestConfig) => Promise<AxiosResponse<ChatChatServiceChatConversation>>;
    chatControllerUnread: (options?: AxiosRequestConfig) => Promise<AxiosResponse<ChatControllerUnread200>>;
    chatControllerGet: (id: string, options?: AxiosRequestConfig) => Promise<AxiosResponse<ChatChatServiceChatConversation>>;
    chatControllerRename: (id: string, renameChatRequest?: RenameChatRequest, options?: AxiosRequestConfig) => Promise<AxiosResponse<ChatChatServiceChatConversation>>;
    chatControllerDeleteConversation: (id: string, options?: AxiosRequestConfig) => Promise<AxiosResponse<void>>;
    chatControllerMessages: (id: string, params?: ChatControllerMessagesParams, options?: AxiosRequestConfig) => Promise<AxiosResponse<ChatControllerMessages200>>;
    chatControllerSend: (id: string, sendMessageRequest?: SendMessageRequest, options?: AxiosRequestConfig) => Promise<AxiosResponse<ChatChatServiceChatMessage>>;
    chatControllerRead: (id: string, options?: AxiosRequestConfig) => Promise<AxiosResponse<void>>;
    chatControllerAddMembers: (id: string, addMembersRequest?: AddMembersRequest, options?: AxiosRequestConfig) => Promise<AxiosResponse<ChatChatServiceChatConversation>>;
    chatControllerRemoveMember: (id: string, username: string, options?: AxiosRequestConfig) => Promise<AxiosResponse<void>>;
    profilesControllerDirectory: (params?: ProfilesControllerDirectoryParams, options?: AxiosRequestConfig) => Promise<AxiosResponse<ProfilesControllerDirectory200>>;
    profilesControllerMe: (options?: AxiosRequestConfig) => Promise<AxiosResponse<ProfilesControllerMe200>>;
    profilesControllerSetVisibility: (updateProfileVisibilityRequest?: UpdateProfileVisibilityRequest, options?: AxiosRequestConfig) => Promise<AxiosResponse<ProfilesControllerSetVisibility200>>;
    profilesControllerListening: (listeningReportRequest?: ListeningReportRequest, options?: AxiosRequestConfig) => Promise<AxiosResponse<void>>;
    profilesControllerGet: (username: string, options?: AxiosRequestConfig) => Promise<AxiosResponse<ProfilesControllerGet200>>;
    friendsControllerList: (options?: AxiosRequestConfig) => Promise<AxiosResponse<FriendsControllerList200>>;
    friendsControllerCreateInvite: (username: string, createFriendInviteRequest?: CreateFriendInviteRequest, options?: AxiosRequestConfig) => Promise<AxiosResponse<FriendsControllerCreateInvite200>>;
    friendsControllerGetInvite: (token: string, options?: AxiosRequestConfig) => Promise<AxiosResponse<FriendsControllerGetInvite200>>;
    friendsControllerAcceptInvite: (token: string, options?: AxiosRequestConfig) => Promise<AxiosResponse<FriendsControllerAcceptInvite200>>;
    friendsControllerRequest: (username: string, options?: AxiosRequestConfig) => Promise<AxiosResponse<FriendsControllerRequest200>>;
    friendsControllerRemove: (username: string, options?: AxiosRequestConfig) => Promise<AxiosResponse<void>>;
    friendsControllerAccept: (username: string, options?: AxiosRequestConfig) => Promise<AxiosResponse<FriendsControllerAccept200>>;
    themesControllerAudio: (id: string, options?: AxiosRequestConfig) => Promise<AxiosResponse<Blob>>;
    themesControllerSync: (themesControllerSyncBody?: ThemesControllerSyncBody, options?: AxiosRequestConfig) => Promise<AxiosResponse<ThemesControllerSync200>>;
    adminUpdatesControllerStatus: (params?: AdminUpdatesControllerStatusParams, options?: AxiosRequestConfig) => Promise<AxiosResponse<ApiUpdatesUpdateServiceUpdateStatus>>;
    adminUpdatesControllerApply: (options?: AxiosRequestConfig) => Promise<AxiosResponse<ApiUpdatesUpdateServiceUpdateRun>>;
    adminBackupsControllerStatus: (options?: AxiosRequestConfig) => Promise<AxiosResponse<ApiBackupsBackupServiceBackupStatus>>;
    adminBackupsControllerCreate: (options?: AxiosRequestConfig) => Promise<AxiosResponse<ApiBackupsBackupServiceBackupRun>>;
    adminBackupsControllerUpload: (adminBackupsControllerUploadBody?: AdminBackupsControllerUploadBody, options?: AxiosRequestConfig) => Promise<AxiosResponse<unknown>>;
    adminBackupsControllerSetPassphrase: (adminBackupsControllerSetPassphraseBody?: AdminBackupsControllerSetPassphraseBody, options?: AxiosRequestConfig) => Promise<AxiosResponse<AdminBackupsControllerSetPassphrase200>>;
    adminBackupsControllerClearPassphrase: (options?: AxiosRequestConfig) => Promise<AxiosResponse<AdminBackupsControllerClearPassphrase200>>;
    adminBackupsControllerRestore: (name: string, adminBackupsControllerRestoreBody?: AdminBackupsControllerRestoreBody, options?: AxiosRequestConfig) => Promise<AxiosResponse<ApiBackupsBackupServiceBackupRun>>;
    adminBackupsControllerDownloadLink: (name: string, options?: AxiosRequestConfig) => Promise<AxiosResponse<AdminBackupsControllerDownloadLink200>>;
    adminBackupsControllerRemove: (name: string, options?: AxiosRequestConfig) => Promise<AxiosResponse<AdminBackupsControllerRemove200>>;
    backupDownloadControllerDownload: (name: string, params?: BackupDownloadControllerDownloadParams, options?: AxiosRequestConfig) => Promise<AxiosResponse<BackupDownloadControllerDownload200>>;
    overviewControllerGet: (options?: AxiosRequestConfig) => Promise<AxiosResponse<OverviewControllerGet200>>;
    overviewControllerActivityList: (params?: OverviewControllerActivityListParams, options?: AxiosRequestConfig) => Promise<AxiosResponse<OverviewControllerActivityList200>>;
    sentryControllerGetConfig: (app: string, options?: AxiosRequestConfig) => Promise<AxiosResponse<SentrySentryServiceSentryAppConfig>>;
    getVersionControllerGetUrl: () => string;
    getSetupControllerStatusUrl: () => string;
    getSetupControllerRequestRecoveryKeyUrl: () => string;
    getSetupControllerProgressUrl: () => string;
    getSetupControllerFlowUrl: () => string;
    getSetupControllerTestStepUrl: (step: string) => string;
    getSetupControllerApplyStepUrl: (step: string) => string;
    getSetupControllerCompleteUrl: () => string;
    getSetupControllerResetUrl: () => string;
    getInternalConfigControllerGetUrl: (service: string) => string;
    getAuthControllerRegisterUrl: () => string;
    getAuthControllerMeUrl: () => string;
    getAuthControllerUpdateMeUrl: () => string;
    getAuthControllerSetPasskeyRequiredUrl: () => string;
    getAuthControllerChangePasswordUrl: () => string;
    getAuthControllerDeleteMeUrl: () => string;
    getAuthControllerVerifyEmailUrl: () => string;
    getAuthControllerResendVerificationUrl: () => string;
    getAuthControllerLoginUrl: () => string;
    getAuthControllerListSessionsUrl: () => string;
    getAuthControllerRevokeSessionUrl: (sessionId: string) => string;
    getAuthControllerLogoutUrl: () => string;
    getAvatarControllerUploadUrl: () => string;
    getAvatarControllerRemoveUrl: () => string;
    getAvatarControllerAvatarUrl: (filename: string) => string;
    getPasskeyControllerListUrl: () => string;
    getPasskeyControllerRegistrationOptionsUrl: () => string;
    getPasskeyControllerRegistrationVerifyUrl: () => string;
    getPasskeyControllerLoginOptionsUrl: () => string;
    getPasskeyControllerLoginVerifyUrl: () => string;
    getPasskeyControllerSecondFactorOptionsUrl: () => string;
    getPasskeyControllerSecondFactorVerifyUrl: () => string;
    getPasskeyControllerStartNativeHandoffUrl: () => string;
    getPasskeyControllerNativeHandoffOptionsUrl: () => string;
    getPasskeyControllerVerifyNativeHandoffUrl: () => string;
    getPasskeyControllerExchangeNativeHandoffUrl: () => string;
    getPasskeyControllerRemoveUrl: (passkeyId: string) => string;
    getUserControllerListUsersUrl: () => string;
    getUserControllerGetUserUrl: (id: string) => string;
    getUserControllerDeleteUserUrl: (id: string) => string;
    getPreferencesControllerGetUrl: () => string;
    getPreferencesControllerUpdateUrl: () => string;
    getSettingsControllerListUrl: () => string;
    getSettingsControllerRegistrationStatusUrl: () => string;
    getSettingsControllerSendTestEmailUrl: () => string;
    getSettingsControllerUpdateUrl: (key: string) => string;
    getPlaybackControllerListSamplesUrl: () => string;
    getPlaybackControllerItemPlaybackInfoUrl: (id: string) => string;
    getPlaybackControllerPlaybackInfoUrl: (id: string) => string;
    getJobsControllerGetQueuesUrl: () => string;
    getJobsControllerFindJobsUrl: (queueName: string, params?: JobsControllerFindJobsParams) => string;
    getJobsControllerEnqueueUrl: (queueName: string) => string;
    getJobsControllerGetJobUrl: (queueName: string, jobId: string) => string;
    getJobsControllerCancelJobUrl: (queueName: string, jobId: string) => string;
    getJobsControllerRetryJobUrl: (queueName: string, jobId: string) => string;
    getJobsControllerGetSchedulesUrl: () => string;
    getJobsControllerScheduleUrl: (queueName: string) => string;
    getJobsControllerUnscheduleUrl: (queueName: string) => string;
    getAdminScheduledTasksControllerListUrl: () => string;
    getAdminScheduledTasksControllerSaveScheduleUrl: (id: string) => string;
    getAdminScheduledTasksControllerRunUrl: (id: string) => string;
    getAdminScheduledTasksControllerStopUrl: (id: string) => string;
    getStreamsControllerListSessionsUrl: () => string;
    getStreamsControllerCancelSessionUrl: (sessionId: string) => string;
    getDevicesControllerListUrl: () => string;
    getDevicesControllerSignOutUrl: (id: string) => string;
    getApiKeysControllerListUrl: () => string;
    getApiKeysControllerCreateUrl: () => string;
    getApiKeysControllerRevokeUrl: (id: string) => string;
    getMediaLibrariesControllerListUrl: () => string;
    getMediaLibrariesControllerCreateUrl: () => string;
    getMediaLibrariesControllerListRootsUrl: () => string;
    getMediaLibrariesControllerBrowseUrl: (params?: MediaLibrariesControllerBrowseParams) => string;
    getMediaLibrariesControllerUpdateUrl: (id: string) => string;
    getMediaLibrariesControllerRemoveUrl: (id: string) => string;
    getStreamerRootsControllerListUrl: () => string;
    getStreamerRootsControllerTranscodingUrl: () => string;
    getIndexerApiControllerListLibrariesUrl: () => string;
    getIndexerApiControllerGetSettingsUrl: () => string;
    getIndexerApiControllerUpsertItemUrl: () => string;
    getIndexerApiControllerIntroSyncCandidatesUrl: (params?: IndexerApiControllerIntroSyncCandidatesParams) => string;
    getIndexerApiControllerExistingIntroSegmentsUrl: (params?: IndexerApiControllerExistingIntroSegmentsParams) => string;
    getIndexerApiControllerUpdateIntroSegmentsUrl: () => string;
    getIndexerApiControllerPruneLibraryUrl: (id: string) => string;
    getAdminIndexerControllerStatusUrl: () => string;
    getAdminIndexerControllerScanUrl: (id: string) => string;
    getAdminIndexerControllerQueueSegmentsUrl: (id: string) => string;
    getAdminIndexerControllerRefreshUrl: () => string;
    getAdminIndexerControllerTasksUrl: (params?: AdminIndexerControllerTasksParams) => string;
    getAdminIndexerControllerTaskLogsUrl: (queue: string, id: string, params?: AdminIndexerControllerTaskLogsParams) => string;
    getAdminIndexerControllerCancelTaskUrl: (queue: string, id: string) => string;
    getAdminIndexerControllerRetryTaskUrl: (queue: string, id: string) => string;
    getAdminIndexerControllerCancelActiveUrl: (queue: string) => string;
    getAdminIndexerControllerClearFailedUrl: (queue: string) => string;
    getAdminIndexerControllerPauseUrl: (queue: string) => string;
    getAdminIndexerControllerResumeUrl: (queue: string) => string;
    getAdminIndexerControllerSetConcurrencyUrl: () => string;
    getPluginsControllerInstalledUrl: () => string;
    getPluginsControllerRepositoriesUrl: () => string;
    getPluginsControllerAddRepositoryUrl: () => string;
    getPluginsControllerCatalogUrl: (params?: PluginsControllerCatalogParams) => string;
    getPluginsControllerPluginSettingsViewUrl: (id: string) => string;
    getPluginsControllerUpdatePluginSettingsUrl: (id: string) => string;
    getPluginsControllerPluginUpdateHistoryUrl: (id: string, params?: PluginsControllerPluginUpdateHistoryParams) => string;
    getPluginsControllerInstallUrl: (id: string) => string;
    getPluginsControllerEnableUrl: (id: string) => string;
    getPluginsControllerDisableUrl: (id: string) => string;
    getPluginsControllerUninstallUrl: (id: string) => string;
    getPluginsControllerRefreshRepositoryUrl: (id: string) => string;
    getPluginsControllerRemoveRepositoryUrl: (id: string) => string;
    getPluginRuntimeControllerListPagesUrl: () => string;
    getPluginRuntimeControllerSearchSectionsUrl: (params?: PluginRuntimeControllerSearchSectionsParams) => string;
    getPluginRuntimeControllerInvokeUrl: (pluginId: string, operation: string) => string;
    getRequestImagesControllerTmdbUrl: (size: string, file: string) => string;
    getRequestImagesControllerDiscogsUrl: (params?: RequestImagesControllerDiscogsParams) => string;
    getRequestsControllerConfigUrl: () => string;
    getRequestsControllerSearchUrl: (params?: RequestsControllerSearchParams) => string;
    getRequestsControllerDiscoverUrl: (params?: RequestsControllerDiscoverParams) => string;
    getRequestsControllerDetailsUrl: (type: string, id: string) => string;
    getRequestsControllerListUrl: (params?: RequestsControllerListParams) => string;
    getRequestsControllerCreateUrl: () => string;
    getRequestsControllerApproveUrl: (id: string) => string;
    getRequestsControllerDeclineUrl: (id: string) => string;
    getRequestsControllerRetryUrl: (id: string) => string;
    getRequestsControllerRemoveUrl: (id: string) => string;
    getAdminRequestsControllerListServicesUrl: () => string;
    getAdminRequestsControllerCreateServiceUrl: () => string;
    getAdminRequestsControllerTestServiceUrl: () => string;
    getAdminRequestsControllerUpdateServiceUrl: (id: string) => string;
    getAdminRequestsControllerRemoveServiceUrl: (id: string) => string;
    getAdminRequestsControllerListUsersUrl: () => string;
    getAdminRequestsControllerUpdateUserUrl: (id: string) => string;
    getAdminMediaControllerListSubtitlesUrl: (id: string) => string;
    getAdminMediaControllerRemoveSubtitleUrl: (id: string, params?: AdminMediaControllerRemoveSubtitleParams) => string;
    getAdminMediaControllerSearchSubtitlesUrl: (id: string) => string;
    getAdminMediaControllerDownloadSubtitleUrl: (id: string) => string;
    getAdminMediaControllerSetSegmentUrl: (id: string, type: string) => string;
    getAdminMediaControllerClearSegmentUrl: (id: string, type: string) => string;
    getAdminMediaControllerListUrl: (params?: AdminMediaControllerListParams) => string;
    getAdminMediaControllerGetUrl: (id: string) => string;
    getAdminMediaControllerUpdateUrl: (id: string) => string;
    getAdminMediaControllerRemoveUrl: (id: string) => string;
    getAdminMediaControllerRefreshUrl: (id: string) => string;
    getAdminMediaControllerImageUrl: (id: string, index: number, params?: AdminMediaControllerImageParams) => string;
    getAdminMediaControllerRemoveImageUrl: (id: string, index: number) => string;
    getAdminMediaControllerAddImageUrl: (id: string, params?: AdminMediaControllerAddImageParams) => string;
    getMediaHomeControllerGetHomeUrl: () => string;
    getMediaHomeControllerGetProgressUrl: (id: string) => string;
    getMediaHomeControllerSaveProgressUrl: (id: string) => string;
    getMediaHomeControllerSetWatchedUrl: (id: string) => string;
    getMediaHomeControllerGenresUrl: () => string;
    getMediaHomeControllerSearchUrl: (params?: MediaHomeControllerSearchParams) => string;
    getMediaHomeControllerPersonImageUrl: (id: string, params?: MediaHomeControllerPersonImageParams) => string;
    getMediaHomeControllerPersonUrl: (id: string) => string;
    getMediaHomeControllerBrowseUrl: (kind: string, params?: MediaHomeControllerBrowseParams) => string;
    getMediaHomeControllerItemUrl: (id: string) => string;
    getMediaHomeControllerImageUrl: (id: string, index: number, params?: MediaHomeControllerImageParams) => string;
    getNetworkSharesControllerListUrl: () => string;
    getNetworkSharesControllerCreateUrl: () => string;
    getNetworkSharesControllerSupportUrl: () => string;
    getNetworkSharesControllerUpdateUrl: (id: string) => string;
    getNetworkSharesControllerRemoveUrl: (id: string) => string;
    getNetworkSharesControllerReconnectUrl: (id: string) => string;
    getAdminUsersControllerListUrl: () => string;
    getAdminUsersControllerCreateUrl: () => string;
    getAdminUsersControllerUpdateUrl: (id: string) => string;
    getAdminUsersControllerRemoveUrl: (id: string) => string;
    getAdminUsersControllerSetAvatarUrl: (id: string) => string;
    getAdminUsersControllerRemoveAvatarUrl: (id: string) => string;
    getAdminUsersControllerSetPasswordUrl: (id: string) => string;
    getAdminUsersControllerRevokeSessionsUrl: (id: string) => string;
    getNotificationsControllerListUrl: () => string;
    getNotificationsControllerMarkReadUrl: () => string;
    getNotificationsControllerRemoveUrl: (id: string) => string;
    getNotificationsControllerConfigUrl: () => string;
    getNotificationsControllerPushKeyUrl: () => string;
    getNotificationsControllerPushStatusUrl: (params?: NotificationsControllerPushStatusParams) => string;
    getNotificationsControllerSubscribeUrl: () => string;
    getNotificationsControllerUnsubscribeUrl: () => string;
    getAdminNotificationsControllerSendUrl: () => string;
    getFavoritesControllerListUrl: () => string;
    getFavoritesControllerIdsUrl: () => string;
    getFavoritesControllerAddUrl: (itemId: string) => string;
    getFavoritesControllerRemoveUrl: (itemId: string) => string;
    getPlaylistsControllerListUrl: () => string;
    getPlaylistsControllerCreateUrl: () => string;
    getPlaylistsControllerContainingUrl: (itemId: string) => string;
    getPlaylistsControllerGetUrl: (id: string) => string;
    getPlaylistsControllerUpdateUrl: (id: string) => string;
    getPlaylistsControllerRemoveUrl: (id: string) => string;
    getPlaylistsControllerAddItemUrl: (id: string) => string;
    getPlaylistsControllerRemoveTrackUrl: (id: string, itemId: string) => string;
    getPlaylistsControllerReorderUrl: (id: string) => string;
    getPartiesControllerCreateUrl: () => string;
    getPartiesControllerGetUrl: (id: string) => string;
    getPartiesControllerEndUrl: (id: string) => string;
    getChatControllerListUrl: () => string;
    getChatControllerStartUrl: () => string;
    getChatControllerUnreadUrl: () => string;
    getChatControllerGetUrl: (id: string) => string;
    getChatControllerRenameUrl: (id: string) => string;
    getChatControllerDeleteConversationUrl: (id: string) => string;
    getChatControllerMessagesUrl: (id: string, params?: ChatControllerMessagesParams) => string;
    getChatControllerSendUrl: (id: string) => string;
    getChatControllerReadUrl: (id: string) => string;
    getChatControllerAddMembersUrl: (id: string) => string;
    getChatControllerRemoveMemberUrl: (id: string, username: string) => string;
    getProfilesControllerDirectoryUrl: (params?: ProfilesControllerDirectoryParams) => string;
    getProfilesControllerMeUrl: () => string;
    getProfilesControllerSetVisibilityUrl: () => string;
    getProfilesControllerListeningUrl: () => string;
    getProfilesControllerGetUrl: (username: string) => string;
    getFriendsControllerListUrl: () => string;
    getFriendsControllerCreateInviteUrl: (username: string) => string;
    getFriendsControllerGetInviteUrl: (token: string) => string;
    getFriendsControllerAcceptInviteUrl: (token: string) => string;
    getFriendsControllerRequestUrl: (username: string) => string;
    getFriendsControllerRemoveUrl: (username: string) => string;
    getFriendsControllerAcceptUrl: (username: string) => string;
    getThemesControllerAudioUrl: (id: string) => string;
    getThemesControllerSyncUrl: () => string;
    getAdminUpdatesControllerStatusUrl: (params?: AdminUpdatesControllerStatusParams) => string;
    getAdminUpdatesControllerApplyUrl: () => string;
    getAdminBackupsControllerStatusUrl: () => string;
    getAdminBackupsControllerCreateUrl: () => string;
    getAdminBackupsControllerUploadUrl: () => string;
    getAdminBackupsControllerSetPassphraseUrl: () => string;
    getAdminBackupsControllerClearPassphraseUrl: () => string;
    getAdminBackupsControllerRestoreUrl: (name: string) => string;
    getAdminBackupsControllerDownloadLinkUrl: (name: string) => string;
    getAdminBackupsControllerRemoveUrl: (name: string) => string;
    getBackupDownloadControllerDownloadUrl: (name: string, params?: BackupDownloadControllerDownloadParams) => string;
    getOverviewControllerGetUrl: () => string;
    getOverviewControllerActivityListUrl: (params?: OverviewControllerActivityListParams) => string;
    getSentryControllerGetConfigUrl: (app: string) => string;
};
export type VersionControllerGetResult = AxiosResponse<VersionControllerGet200>;
export type SetupControllerStatusResult = AxiosResponse<BootstrapSetupStatusSetupStatus>;
export type SetupControllerRequestRecoveryKeyResult = AxiosResponse<SetupControllerRequestRecoveryKey200>;
export type SetupControllerProgressResult = AxiosResponse<SetupControllerProgress200>;
export type SetupControllerFlowResult = AxiosResponse<SetupControllerFlow200>;
export type SetupControllerTestStepResult = AxiosResponse<SetupControllerTestStep200>;
export type SetupControllerApplyStepResult = AxiosResponse<SetupControllerApplyStep200>;
export type SetupControllerCompleteResult = AxiosResponse<SetupControllerComplete200>;
export type SetupControllerResetResult = AxiosResponse<SetupControllerReset200>;
export type InternalConfigControllerGetResult = AxiosResponse<BootstrapInternalConfigIndexerRuntimeConfig>;
export type AuthControllerRegisterResult = AxiosResponse<ApiAuthAuthServiceAuthResult | ApiAuthAuthServiceVerificationPending>;
export type AuthControllerMeResult = AxiosResponse<ApiAuthAuthServicePublicUser>;
export type AuthControllerUpdateMeResult = AxiosResponse<ApiAuthAuthServicePublicUser>;
export type AuthControllerSetPasskeyRequiredResult = AxiosResponse<ApiAuthAuthServicePublicUser>;
export type AuthControllerChangePasswordResult = AxiosResponse<AuthControllerChangePassword200>;
export type AuthControllerDeleteMeResult = AxiosResponse<AuthControllerDeleteMe200>;
export type AuthControllerVerifyEmailResult = AxiosResponse<AuthControllerVerifyEmail200>;
export type AuthControllerResendVerificationResult = AxiosResponse<AuthControllerResendVerification200>;
export type AuthControllerLoginResult = AxiosResponse<ApiAuthAuthServiceAuthResult | ApiAuthAuthServicePasskeyRequired>;
export type AuthControllerListSessionsResult = AxiosResponse<ApiAuthAuthServicePublicSession[]>;
export type AuthControllerRevokeSessionResult = AxiosResponse<AuthControllerRevokeSession200>;
export type AuthControllerLogoutResult = AxiosResponse<AuthControllerLogout200>;
export type AvatarControllerUploadResult = AxiosResponse<unknown>;
export type AvatarControllerRemoveResult = AxiosResponse<ApiAuthAuthServicePublicUser>;
export type AvatarControllerAvatarResult = AxiosResponse<Blob>;
export type PasskeyControllerListResult = AxiosResponse<ApiAuthPasskeyServicePublicPasskey[]>;
export type PasskeyControllerRegistrationOptionsResult = AxiosResponse<PasskeyControllerRegistrationOptions200>;
export type PasskeyControllerRegistrationVerifyResult = AxiosResponse<ApiAuthPasskeyServicePublicPasskey>;
export type PasskeyControllerLoginOptionsResult = AxiosResponse<PasskeyControllerLoginOptions200>;
export type PasskeyControllerLoginVerifyResult = AxiosResponse<ApiAuthAuthServiceAuthResult>;
export type PasskeyControllerSecondFactorOptionsResult = AxiosResponse<PasskeyControllerSecondFactorOptions200>;
export type PasskeyControllerSecondFactorVerifyResult = AxiosResponse<ApiAuthAuthServiceAuthResult>;
export type PasskeyControllerStartNativeHandoffResult = AxiosResponse<PasskeyControllerStartNativeHandoff200>;
export type PasskeyControllerNativeHandoffOptionsResult = AxiosResponse<PasskeyControllerNativeHandoffOptions200>;
export type PasskeyControllerVerifyNativeHandoffResult = AxiosResponse<PasskeyControllerVerifyNativeHandoff200>;
export type PasskeyControllerExchangeNativeHandoffResult = AxiosResponse<ApiAuthAuthServiceAuthResult>;
export type PasskeyControllerRemoveResult = AxiosResponse<PasskeyControllerRemove200>;
export type UserControllerListUsersResult = AxiosResponse<ApiAuthAuthServicePublicUser[]>;
export type UserControllerGetUserResult = AxiosResponse<ApiAuthAuthServicePublicUser>;
export type UserControllerDeleteUserResult = AxiosResponse<UserControllerDeleteUser200>;
export type PreferencesControllerGetResult = AxiosResponse<ApiPreferencesPreferencesServicePreferences>;
export type PreferencesControllerUpdateResult = AxiosResponse<ApiPreferencesPreferencesServicePreferences>;
export type SettingsControllerListResult = AxiosResponse<ApiSettingsSettingsServicePublicSetting[]>;
export type SettingsControllerRegistrationStatusResult = AxiosResponse<SettingsControllerRegistrationStatus200>;
export type SettingsControllerSendTestEmailResult = AxiosResponse<SettingsControllerSendTestEmail200>;
export type SettingsControllerUpdateResult = AxiosResponse<ApiSettingsSettingsServicePublicSetting>;
export type PlaybackControllerListSamplesResult = AxiosResponse<ApiPlaybackPlaybackServiceSampleVideo[]>;
export type PlaybackControllerItemPlaybackInfoResult = AxiosResponse<PlaybackControllerItemPlaybackInfo200>;
export type PlaybackControllerPlaybackInfoResult = AxiosResponse<ApiPlaybackPlaybackServicePlaybackInfo>;
export type JobsControllerGetQueuesResult = AxiosResponse<JobsControllerGetQueues200Item[]>;
export type JobsControllerFindJobsResult = AxiosResponse<JobsControllerFindJobs200Item[]>;
export type JobsControllerEnqueueResult = AxiosResponse<JobsControllerEnqueue200>;
export type JobsControllerGetJobResult = AxiosResponse<JobsControllerGetJob200>;
export type JobsControllerCancelJobResult = AxiosResponse<JobsControllerCancelJob200>;
export type JobsControllerRetryJobResult = AxiosResponse<JobsControllerRetryJob200>;
export type JobsControllerGetSchedulesResult = AxiosResponse<JobsControllerGetSchedules200Item[]>;
export type JobsControllerScheduleResult = AxiosResponse<JobsControllerSchedule200>;
export type JobsControllerUnscheduleResult = AxiosResponse<JobsControllerUnschedule200>;
export type AdminScheduledTasksControllerListResult = AxiosResponse<AdminScheduledTasksControllerList200>;
export type AdminScheduledTasksControllerSaveScheduleResult = AxiosResponse<AdminScheduledTasksControllerSaveSchedule200>;
export type AdminScheduledTasksControllerRunResult = AxiosResponse<AdminScheduledTasksControllerRun200>;
export type AdminScheduledTasksControllerStopResult = AxiosResponse<AdminScheduledTasksControllerStop200>;
export type StreamsControllerListSessionsResult = AxiosResponse<ApiStreamsStreamsServiceStreamSessionsResponse>;
export type StreamsControllerCancelSessionResult = AxiosResponse<void>;
export type DevicesControllerListResult = AxiosResponse<ApiDevicesDevicesServicePublicDevice[]>;
export type DevicesControllerSignOutResult = AxiosResponse<void>;
export type ApiKeysControllerListResult = AxiosResponse<ApiApiKeysApiKeyServicePublicApiKey[]>;
export type ApiKeysControllerCreateResult = AxiosResponse<ApiApiKeysApiKeyServiceCreatedApiKey>;
export type ApiKeysControllerRevokeResult = AxiosResponse<void>;
export type MediaLibrariesControllerListResult = AxiosResponse<ApiMediaLibrariesMediaLibrariesServicePublicMediaLibrary[]>;
export type MediaLibrariesControllerCreateResult = AxiosResponse<ApiMediaLibrariesMediaLibrariesServicePublicMediaLibrary>;
export type MediaLibrariesControllerListRootsResult = AxiosResponse<MediaLibrariesControllerListRoots200Item[]>;
export type MediaLibrariesControllerBrowseResult = AxiosResponse<ApiMediaLibrariesMediaRootsServiceBrowseResult>;
export type MediaLibrariesControllerUpdateResult = AxiosResponse<ApiMediaLibrariesMediaLibrariesServicePublicMediaLibrary>;
export type MediaLibrariesControllerRemoveResult = AxiosResponse<void>;
export type StreamerRootsControllerListResult = AxiosResponse<StreamerRootsControllerList200>;
export type StreamerRootsControllerTranscodingResult = AxiosResponse<StreamerRootsControllerTranscoding200>;
export type IndexerApiControllerListLibrariesResult = AxiosResponse<IndexerApiControllerListLibraries200>;
export type IndexerApiControllerGetSettingsResult = AxiosResponse<ApiIndexerIndexerSettingsServiceIndexerSettings>;
export type IndexerApiControllerUpsertItemResult = AxiosResponse<IndexerApiControllerUpsertItem200>;
export type IndexerApiControllerIntroSyncCandidatesResult = AxiosResponse<IndexerApiControllerIntroSyncCandidates200>;
export type IndexerApiControllerExistingIntroSegmentsResult = AxiosResponse<IndexerApiControllerExistingIntroSegments200>;
export type IndexerApiControllerUpdateIntroSegmentsResult = AxiosResponse<IndexerApiControllerUpdateIntroSegments200>;
export type IndexerApiControllerPruneLibraryResult = AxiosResponse<IndexerApiControllerPruneLibrary200>;
export type AdminIndexerControllerStatusResult = AxiosResponse<ApiIndexerAdminIndexerServiceIndexerStatus>;
export type AdminIndexerControllerScanResult = AxiosResponse<unknown>;
export type AdminIndexerControllerQueueSegmentsResult = AxiosResponse<unknown>;
export type AdminIndexerControllerRefreshResult = AxiosResponse<unknown>;
export type AdminIndexerControllerTasksResult = AxiosResponse<ApiIndexerAdminIndexerServiceIndexerTaskPage>;
export type AdminIndexerControllerTaskLogsResult = AxiosResponse<ApiIndexerAdminIndexerServiceIndexerTaskLogs>;
export type AdminIndexerControllerCancelTaskResult = AxiosResponse<unknown>;
export type AdminIndexerControllerRetryTaskResult = AxiosResponse<unknown>;
export type AdminIndexerControllerCancelActiveResult = AxiosResponse<AdminIndexerControllerCancelActive200>;
export type AdminIndexerControllerClearFailedResult = AxiosResponse<AdminIndexerControllerClearFailed200>;
export type AdminIndexerControllerPauseResult = AxiosResponse<unknown>;
export type AdminIndexerControllerResumeResult = AxiosResponse<unknown>;
export type AdminIndexerControllerSetConcurrencyResult = AxiosResponse<ApiIndexerAdminIndexerServiceIndexerStatus>;
export type PluginsControllerInstalledResult = AxiosResponse<PluginsControllerInstalled200Item[]>;
export type PluginsControllerRepositoriesResult = AxiosResponse<EntitiesPluginRepositoryEntityPluginRepository[]>;
export type PluginsControllerAddRepositoryResult = AxiosResponse<EntitiesPluginRepositoryEntityPluginRepository>;
export type PluginsControllerCatalogResult = AxiosResponse<PluginsControllerCatalog200Item[]>;
export type PluginsControllerPluginSettingsViewResult = AxiosResponse<PluginsControllerPluginSettingsView200>;
export type PluginsControllerUpdatePluginSettingsResult = AxiosResponse<PluginsControllerUpdatePluginSettings200>;
export type PluginsControllerPluginUpdateHistoryResult = AxiosResponse<EntitiesPluginUpdateHistoryEntityPluginUpdateHistory[]>;
export type PluginsControllerInstallResult = AxiosResponse<EntitiesPluginInstallationEntityPluginInstallation>;
export type PluginsControllerEnableResult = AxiosResponse<EntitiesPluginInstallationEntityPluginInstallation>;
export type PluginsControllerDisableResult = AxiosResponse<EntitiesPluginInstallationEntityPluginInstallation>;
export type PluginsControllerUninstallResult = AxiosResponse<void>;
export type PluginsControllerRefreshRepositoryResult = AxiosResponse<EntitiesPluginRepositoryEntityPluginRepository>;
export type PluginsControllerRemoveRepositoryResult = AxiosResponse<void>;
export type PluginRuntimeControllerListPagesResult = AxiosResponse<ApiPluginsPluginPagesServicePluginPageSummary[]>;
export type PluginRuntimeControllerSearchSectionsResult = AxiosResponse<PluginRuntimeControllerSearchSections200>;
export type PluginRuntimeControllerInvokeResult = AxiosResponse<unknown>;
export type RequestImagesControllerTmdbResult = AxiosResponse<Blob>;
export type RequestImagesControllerDiscogsResult = AxiosResponse<Blob>;
export type RequestsControllerConfigResult = AxiosResponse<ApiRequestsMediaRequestsServiceRequestsConfig>;
export type RequestsControllerSearchResult = AxiosResponse<ApiRequestsExternalMetadataExternalMediaCard[]>;
export type RequestsControllerDiscoverResult = AxiosResponse<ApiRequestsExternalMetadataExternalMediaCard[]>;
export type RequestsControllerDetailsResult = AxiosResponse<RequestsControllerDetails200>;
export type RequestsControllerListResult = AxiosResponse<RequestsControllerList200>;
export type RequestsControllerCreateResult = AxiosResponse<ApiRequestsMediaRequestsServiceMediaRequestView>;
export type RequestsControllerApproveResult = AxiosResponse<ApiRequestsMediaRequestsServiceMediaRequestView>;
export type RequestsControllerDeclineResult = AxiosResponse<ApiRequestsMediaRequestsServiceMediaRequestView>;
export type RequestsControllerRetryResult = AxiosResponse<ApiRequestsMediaRequestsServiceMediaRequestView>;
export type RequestsControllerRemoveResult = AxiosResponse<void>;
export type AdminRequestsControllerListServicesResult = AxiosResponse<ApiRequestsRequestServicesServiceRequestServiceView[]>;
export type AdminRequestsControllerCreateServiceResult = AxiosResponse<ApiRequestsRequestServicesServiceRequestServiceView>;
export type AdminRequestsControllerTestServiceResult = AxiosResponse<ApiRequestsArrClientArrTestResult>;
export type AdminRequestsControllerUpdateServiceResult = AxiosResponse<ApiRequestsRequestServicesServiceRequestServiceView>;
export type AdminRequestsControllerRemoveServiceResult = AxiosResponse<void>;
export type AdminRequestsControllerListUsersResult = AxiosResponse<ApiRequestsMediaRequestsServiceRequestUserLimitView[]>;
export type AdminRequestsControllerUpdateUserResult = AxiosResponse<ApiRequestsMediaRequestsServiceRequestUserLimitView>;
export type AdminMediaControllerListSubtitlesResult = AxiosResponse<AdminMediaControllerListSubtitles200>;
export type AdminMediaControllerRemoveSubtitleResult = AxiosResponse<void>;
export type AdminMediaControllerSearchSubtitlesResult = AxiosResponse<AdminMediaControllerSearchSubtitles200>;
export type AdminMediaControllerDownloadSubtitleResult = AxiosResponse<AdminMediaControllerDownloadSubtitle200>;
export type AdminMediaControllerSetSegmentResult = AxiosResponse<void>;
export type AdminMediaControllerClearSegmentResult = AxiosResponse<void>;
export type AdminMediaControllerListResult = AxiosResponse<AdminMediaControllerList200>;
export type AdminMediaControllerGetResult = AxiosResponse<AdminMediaControllerGet200>;
export type AdminMediaControllerUpdateResult = AxiosResponse<AdminMediaControllerUpdate200>;
export type AdminMediaControllerRemoveResult = AxiosResponse<void>;
export type AdminMediaControllerRefreshResult = AxiosResponse<AdminMediaControllerRefresh200>;
export type AdminMediaControllerImageResult = AxiosResponse<Blob>;
export type AdminMediaControllerRemoveImageResult = AxiosResponse<AdminMediaControllerRemoveImage200>;
export type AdminMediaControllerAddImageResult = AxiosResponse<unknown>;
export type MediaHomeControllerGetHomeResult = AxiosResponse<MediaHomeControllerGetHome200>;
export type MediaHomeControllerGetProgressResult = AxiosResponse<MediaHomeControllerGetProgress200>;
export type MediaHomeControllerSaveProgressResult = AxiosResponse<void>;
export type MediaHomeControllerSetWatchedResult = AxiosResponse<void>;
export type MediaHomeControllerGenresResult = AxiosResponse<string[]>;
export type MediaHomeControllerSearchResult = AxiosResponse<ApiMediaMediaHomeServiceHomeCard[]>;
export type MediaHomeControllerPersonImageResult = AxiosResponse<Blob>;
export type MediaHomeControllerPersonResult = AxiosResponse<MediaHomeControllerPerson200>;
export type MediaHomeControllerBrowseResult = AxiosResponse<MediaHomeControllerBrowse200>;
export type MediaHomeControllerItemResult = AxiosResponse<MediaHomeControllerItem200>;
export type MediaHomeControllerImageResult = AxiosResponse<Blob>;
export type NetworkSharesControllerListResult = AxiosResponse<ApiNetworkSharesNetworkSharesServicePublicNetworkShare[]>;
export type NetworkSharesControllerCreateResult = AxiosResponse<ApiNetworkSharesNetworkSharesServicePublicNetworkShare>;
export type NetworkSharesControllerSupportResult = AxiosResponse<NetworkSharesControllerSupport200>;
export type NetworkSharesControllerUpdateResult = AxiosResponse<ApiNetworkSharesNetworkSharesServicePublicNetworkShare>;
export type NetworkSharesControllerRemoveResult = AxiosResponse<void>;
export type NetworkSharesControllerReconnectResult = AxiosResponse<ApiNetworkSharesNetworkSharesServicePublicNetworkShare>;
export type AdminUsersControllerListResult = AxiosResponse<ApiAdminUsersAdminUsersServiceAdminUser[]>;
export type AdminUsersControllerCreateResult = AxiosResponse<ApiAdminUsersAdminUsersServiceAdminUser>;
export type AdminUsersControllerUpdateResult = AxiosResponse<ApiAdminUsersAdminUsersServiceAdminUser>;
export type AdminUsersControllerRemoveResult = AxiosResponse<void>;
export type AdminUsersControllerSetAvatarResult = AxiosResponse<unknown>;
export type AdminUsersControllerRemoveAvatarResult = AxiosResponse<ApiAdminUsersAdminUsersServiceAdminUser>;
export type AdminUsersControllerSetPasswordResult = AxiosResponse<void>;
export type AdminUsersControllerRevokeSessionsResult = AxiosResponse<AdminUsersControllerRevokeSessions200>;
export type NotificationsControllerListResult = AxiosResponse<NotificationsControllerList200>;
export type NotificationsControllerMarkReadResult = AxiosResponse<void>;
export type NotificationsControllerRemoveResult = AxiosResponse<void>;
export type NotificationsControllerConfigResult = AxiosResponse<NotificationsControllerConfig200>;
export type NotificationsControllerPushKeyResult = AxiosResponse<NotificationsControllerPushKey200>;
export type NotificationsControllerPushStatusResult = AxiosResponse<NotificationsControllerPushStatus200>;
export type NotificationsControllerSubscribeResult = AxiosResponse<void>;
export type NotificationsControllerUnsubscribeResult = AxiosResponse<void>;
export type AdminNotificationsControllerSendResult = AxiosResponse<AdminNotificationsControllerSend200>;
export type FavoritesControllerListResult = AxiosResponse<FavoritesControllerList200>;
export type FavoritesControllerIdsResult = AxiosResponse<FavoritesControllerIds200>;
export type FavoritesControllerAddResult = AxiosResponse<void>;
export type FavoritesControllerRemoveResult = AxiosResponse<void>;
export type PlaylistsControllerListResult = AxiosResponse<PlaylistsControllerList200>;
export type PlaylistsControllerCreateResult = AxiosResponse<ApiSocialPlaylistsServicePlaylistSummary>;
export type PlaylistsControllerContainingResult = AxiosResponse<PlaylistsControllerContaining200>;
export type PlaylistsControllerGetResult = AxiosResponse<PlaylistsControllerGet200>;
export type PlaylistsControllerUpdateResult = AxiosResponse<ApiSocialPlaylistsServicePlaylistSummary>;
export type PlaylistsControllerRemoveResult = AxiosResponse<void>;
export type PlaylistsControllerAddItemResult = AxiosResponse<PlaylistsControllerAddItem200>;
export type PlaylistsControllerRemoveTrackResult = AxiosResponse<void>;
export type PlaylistsControllerReorderResult = AxiosResponse<void>;
export type PartiesControllerCreateResult = AxiosResponse<PartyPartiesServicePartySnapshot>;
export type PartiesControllerGetResult = AxiosResponse<PartyPartiesServicePartySnapshot>;
export type PartiesControllerEndResult = AxiosResponse<void>;
export type ChatControllerListResult = AxiosResponse<ChatControllerList200>;
export type ChatControllerStartResult = AxiosResponse<ChatChatServiceChatConversation>;
export type ChatControllerUnreadResult = AxiosResponse<ChatControllerUnread200>;
export type ChatControllerGetResult = AxiosResponse<ChatChatServiceChatConversation>;
export type ChatControllerRenameResult = AxiosResponse<ChatChatServiceChatConversation>;
export type ChatControllerDeleteConversationResult = AxiosResponse<void>;
export type ChatControllerMessagesResult = AxiosResponse<ChatControllerMessages200>;
export type ChatControllerSendResult = AxiosResponse<ChatChatServiceChatMessage>;
export type ChatControllerReadResult = AxiosResponse<void>;
export type ChatControllerAddMembersResult = AxiosResponse<ChatChatServiceChatConversation>;
export type ChatControllerRemoveMemberResult = AxiosResponse<void>;
export type ProfilesControllerDirectoryResult = AxiosResponse<ProfilesControllerDirectory200>;
export type ProfilesControllerMeResult = AxiosResponse<ProfilesControllerMe200>;
export type ProfilesControllerSetVisibilityResult = AxiosResponse<ProfilesControllerSetVisibility200>;
export type ProfilesControllerListeningResult = AxiosResponse<void>;
export type ProfilesControllerGetResult = AxiosResponse<ProfilesControllerGet200>;
export type FriendsControllerListResult = AxiosResponse<FriendsControllerList200>;
export type FriendsControllerCreateInviteResult = AxiosResponse<FriendsControllerCreateInvite200>;
export type FriendsControllerGetInviteResult = AxiosResponse<FriendsControllerGetInvite200>;
export type FriendsControllerAcceptInviteResult = AxiosResponse<FriendsControllerAcceptInvite200>;
export type FriendsControllerRequestResult = AxiosResponse<FriendsControllerRequest200>;
export type FriendsControllerRemoveResult = AxiosResponse<void>;
export type FriendsControllerAcceptResult = AxiosResponse<FriendsControllerAccept200>;
export type ThemesControllerAudioResult = AxiosResponse<Blob>;
export type ThemesControllerSyncResult = AxiosResponse<ThemesControllerSync200>;
export type AdminUpdatesControllerStatusResult = AxiosResponse<ApiUpdatesUpdateServiceUpdateStatus>;
export type AdminUpdatesControllerApplyResult = AxiosResponse<ApiUpdatesUpdateServiceUpdateRun>;
export type AdminBackupsControllerStatusResult = AxiosResponse<ApiBackupsBackupServiceBackupStatus>;
export type AdminBackupsControllerCreateResult = AxiosResponse<ApiBackupsBackupServiceBackupRun>;
export type AdminBackupsControllerUploadResult = AxiosResponse<unknown>;
export type AdminBackupsControllerSetPassphraseResult = AxiosResponse<AdminBackupsControllerSetPassphrase200>;
export type AdminBackupsControllerClearPassphraseResult = AxiosResponse<AdminBackupsControllerClearPassphrase200>;
export type AdminBackupsControllerRestoreResult = AxiosResponse<ApiBackupsBackupServiceBackupRun>;
export type AdminBackupsControllerDownloadLinkResult = AxiosResponse<AdminBackupsControllerDownloadLink200>;
export type AdminBackupsControllerRemoveResult = AxiosResponse<AdminBackupsControllerRemove200>;
export type BackupDownloadControllerDownloadResult = AxiosResponse<BackupDownloadControllerDownload200>;
export type OverviewControllerGetResult = AxiosResponse<OverviewControllerGet200>;
export type OverviewControllerActivityListResult = AxiosResponse<OverviewControllerActivityList200>;
export type SentryControllerGetConfigResult = AxiosResponse<SentrySentryServiceSentryAppConfig>;
