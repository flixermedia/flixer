import { CollectionOf, Enum, MaxItems, MaxLength, MinItems, MinLength, Property, Required } from "@tsed/schema";
import { MEDIA_IMAGE_STORAGES, MEDIA_LIBRARY_TYPES, type MediaImageStorage, type MediaLibraryType } from "../../entities/mediaLibrary.entity.js";

export class MediaLibraryFolderRequest {

	@Property()
	@Required()
	@MaxLength(64)
	rootId!: string;

	@Property()
	@Required(true, "")
	@MaxLength(4096)
	path!: string;
}

export class CreateMediaLibraryRequest {

	@Property()
	@Required()
	@MinLength(1)
	@MaxLength(100)
	name!: string;

	@Property()
	@Required()
	@Enum(...MEDIA_LIBRARY_TYPES)
	type!: MediaLibraryType;

	@Property()
	@Enum(...MEDIA_IMAGE_STORAGES)
	imageStorage?: MediaImageStorage;

	@Required()
	@CollectionOf(MediaLibraryFolderRequest)
	@MinItems(1)
	@MaxItems(50)
	folders!: MediaLibraryFolderRequest[];
}

export class UpdateMediaLibraryRequest {

	@Property()
	@MinLength(1)
	@MaxLength(100)
	name?: string;

	@Property()
	@Enum(...MEDIA_LIBRARY_TYPES)
	type?: MediaLibraryType;

	@Property()
	@Enum(...MEDIA_IMAGE_STORAGES)
	imageStorage?: MediaImageStorage;

	@CollectionOf(MediaLibraryFolderRequest)
	@MinItems(1)
	@MaxItems(50)
	folders?: MediaLibraryFolderRequest[];
}
