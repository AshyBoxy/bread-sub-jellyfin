import { ItemsApi } from "@jellyfin/sdk/lib/generated-client/api/items-api";
import { UserApi } from "@jellyfin/sdk/lib/generated-client/api/user-api";
import { UserLibraryApi } from "@jellyfin/sdk/lib/generated-client/api/user-library-api";
import { BaseItemDto, UserDto } from "@jellyfin/sdk/lib/generated-client/models";
import { ImageUrlsApi } from "@jellyfin/sdk/lib/utils/api/image-urls-api";
import { ButtonBuilder, ButtonStyle, ContainerBuilder, FileUploadBuilder, LabelBuilder, MessageFlags, ModalBuilder, SectionBuilder, TextDisplayBuilder } from "discord.js";
import fs from "node:fs/promises";
import path from "node:path";
import { dbBasePath } from "../../../config";
import { Command, Context } from "../../../framework";
import { jellyfinApi, JUtils } from "../sub";
import tmpConfig from "../tmpConfig";

interface ApisArg {
    userApi: UserApi;
    itemsApi: ItemsApi;
    imageApi: ImageUrlsApi;
    userLibraryApi: UserLibraryApi;
}

const allowedImageContentTypes = ["image/png", "image/jpeg", "image/gif", "image/webp"];

const cmd = new Command(async (bot, ctx) => {
    const user = ctx.user;
    const apis = getApis();

    const jellyfinUser = getUser(user.id);
    if (!jellyfinUser) {
        ctx.reply("You aren't on Jellyfin !");
        return;
    }

    const remoteUser = await getRemoteUser(jellyfinUser.jellyfin, apis);
    if (!remoteUser) {
        ctx.reply("You should exist on Jellyfin but you don't for some reason. panic");
        return;
    }

    const playlists = await getPlaylists(apis, remoteUser.Id!);
    if (playlists.length === 0) {
        ctx.reply("You don't have any playlists !!");
        return;
    }

    // the playlist apis do not work with non user api keys, so we can't filter by whether the user can edit the playlist on jellyfin
    const container = await constructComponents(ctx, playlists, apis, remoteUser.Id!);
    ctx.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
}, {
    runComponent: async (bot, ctx, id, data) => {
        if (id === "playlistpage") {
            // const deferred = ctx.interaction.deferUpdate();
            // const a = new TextDisplayBuilder().setContent("Hi");
            // await deferred;
            // ctx.interaction.editReply({ components: [a] });

            const userId = data[0];
            if (ctx.user.id !== userId) {
                ctx.reply({ content: "Use your own playlist menu", flags: MessageFlags.Ephemeral });
                return;
            }

            const deferred = ctx.interaction.deferUpdate();
            const page = parseInt(data[1]);
            const apis = getApis();
            const jellyfinUser = getUser(ctx.user.id);
            if (!jellyfinUser) {
                (await deferred).edit(basicTextComponent("uhh you stopped existing on jellyfin apparently"));
                return;
            }
            const remoteUser = await getRemoteUser(jellyfinUser.jellyfin, apis);
            if (!remoteUser) {
                (await deferred).edit(basicTextComponent("you stopped existing on jellyfin apparently but the other kind"));
                return;
            }

            const playlists = await getPlaylists(apis, remoteUser.Id!);
            const container = await constructComponents(ctx, playlists, apis, remoteUser.Id!, page);
            (await deferred).edit({ components: [container] });
        } else if (id === "uploadModal") {
            const userId = data[0];
            const playlistId = data[1];
            if (ctx.user.id !== userId) {
                ctx.reply({ content: "Use your own playlist menu", flags: MessageFlags.Ephemeral });
                return;
            }

            const jellyfinUser = getUser(ctx.user.id);
            if (!jellyfinUser) {
                ctx.reply({ content: "uhh you stopped existing on jellyfin apparently", flags: MessageFlags.Ephemeral });
                return;
            }
            const remoteUser = await getRemoteUser(jellyfinUser.jellyfin, getApis());
            if (!remoteUser) {
                ctx.reply({ content: "you stopped existing on jellyfin apparently but the other kind", flags: MessageFlags.Ephemeral });
                return;
            }

            const modal = await constructUploadModal(ctx, playlistId, remoteUser.Id!);
            ctx.interaction.showModal(modal);
        } else if (id === "i") {
            const userId = data[0];
            const playlistId = data[1];
            const apis = getApis();
            const playlistInfo = await getItem(playlistId, userId);
            let imageUrl = apis.imageApi.getItemImageUrlById(playlistId, "Primary");
            imageUrl += `?_t=${Date.now()}`; // i laugh at discord's caching
            ctx.reply(`${playlistInfo!.Name} full image (for ${ctx.user}) [here](${imageUrl})`);
        }
    },
    runModal: async (bot, ctx, id, data) => {
        if (id === "upload") {
            const playlistId = data[0];

            // no need to check the user since they were checked before sending the modal

            const jellyfinUser = getUser(ctx.user.id);
            if (!jellyfinUser) {
                ctx.reply({ content: "uhh you stopped existing on jellyfin apparently", flags: MessageFlags.Ephemeral });
                return;
            }
            const remoteUser = await getRemoteUser(jellyfinUser.jellyfin, getApis());
            if (!remoteUser) {
                ctx.reply({ content: "you stopped existing on jellyfin apparently but the other kind", flags: MessageFlags.Ephemeral });
                return;
            }

            const files = ctx.interaction.fields.getUploadedFiles("fileUpload", true);
            if (files.size < 1) {
                ctx.reply({ content: "well done", flags: MessageFlags.Ephemeral });
                return;
            }

            const file = files.first()!;

            // hopefully discord's validation is good enough
            if (!allowedImageContentTypes.includes(file.contentType ?? "")) {
                ctx.reply({ content: "actually upload an image please (png, jpg (i will not be happy), gif, or webp)", flags: MessageFlags.Ephemeral });
                return;
            }

            // we don't actually need to save these but shrug
            const outDir = path.join(dbBasePath, "uploads", "jellyfin", "playlists_primary");
            const fileName = `${Date.now()}_${file.name}`;
            const outPath = path.join(outDir, fileName);
            await fs.mkdir(outDir, { recursive: true });
            const fileRes = await fetch(file.url);
            const fileBuffer = Buffer.from(await fileRes.arrayBuffer());
            await fs.writeFile(outPath, fileBuffer);

            const playlistInfo = (await getItem(playlistId, remoteUser.Id!))!; // if someone deletes the playlist in the meantime then they're a little dumb

            // const res = await apis.imageApi.setItemImage({ itemId: playlistId, imageType: "Primary", body: new File([fileBuffer], file.name, { type: file.contentType ?? undefined }) }, { validateStatus: () => true });
            // using the api doesn't seem to encode it in base64?
            // honestly this feels kinda weird
            // but at least on 10.10.7 it seems to want base64, and it's what the web ui does
            const res = await fetch(jellyfinApi.getUri(`Items/${playlistId}/Images/Primary`), {
                headers: {
                    Authorization: jellyfinApi.authorizationHeader,
                    "Content-Type": file.contentType ?? "application/octet-stream"
                },
                method: "POST",
                body: fileBuffer.toString("base64")
            });

            if (res.status !== 204) {
                ctx.reply(`Failed to set the new image for '${playlistInfo.Name}' on Jellyfin, status code: ${res.status}`);
                return;
            }

            // ctx.reply(`Got file ${file.name} (${(file.size / 1024).toFixed(2)} KB) [${file.contentType ?? "unknown"}] for playlist: ${playlistInfo.Name}`);
            ctx.reply(`Updated the image for playlist '${playlistInfo.Name}' to ${file.name}`);
        }
    }
});

export default cmd;

function basicTextComponent(text: string): { components: TextDisplayBuilder[]; } {
    const textComponent = new TextDisplayBuilder()
        .setContent(text);
    return { components: [textComponent] };
}

function getApis(): ApisArg {
    return {
        userApi: JUtils.getUserApi(jellyfinApi),
        itemsApi: JUtils.getItemsApi(jellyfinApi),
        imageApi: JUtils.getImageApi(jellyfinApi),
        userLibraryApi: JUtils.getUserLibraryApi(jellyfinApi)
    };
}

function getUser(userId: string): typeof tmpConfig.users[0] | null {
    const jellyfinUsers = tmpConfig.users;
    const jellyfinUser = jellyfinUsers.find((u) => u.discord === userId);
    if (!jellyfinUser)
        return null;
    return jellyfinUser;
}

async function getRemoteUser(username: string, apis: ApisArg): Promise<UserDto | null> {
    const remoteUsers = await apis.userApi.getUsers();
    const remoteUser = remoteUsers.data.find((u) => u.Name === username);
    return remoteUser ?? null;
}

// this is playlists which are visible to the given user
async function getPlaylists(apis: ApisArg, userId: string): Promise<BaseItemDto[]> {
    const playlists = (await apis.itemsApi.getItems({
        parentId: tmpConfig.playlistLibrary,
        includeItemTypes: ["Playlist", "ManualPlaylistsFolder", "PlaylistsFolder"],
        userId,
        sortBy: ["DateCreated"],
        sortOrder: ["Descending"]
    })).data;
    return playlists.Items ?? [];
}

async function getItem(playlistId: string, userId: string): Promise<BaseItemDto | null> {
    try {
        // i have no clue how to do this with the sdk
        const playlistInfo = <BaseItemDto>(await (await fetch(jellyfinApi.getUri(`Items/${playlistId}`, { userId }), {
            headers: {
                Authorization: jellyfinApi.authorizationHeader
            }
        })).json());
        return playlistInfo;
    } catch (e) {
        return null;
    }
}

async function constructComponents(ctx: Context, playlists: BaseItemDto[], { imageApi }: ApisArg, userId: string, page = 0): Promise<ContainerBuilder> {
    const playlistsPerPage = 5;
    const pageCount = Math.ceil(playlists.length / playlistsPerPage);

    const container = new ContainerBuilder();

    const headerText = `Playlists page ${page + 1}/${pageCount}\n${playlists.length} total playlists\n-# Sorted by date added\n-# Please don't mess with other people's playlists without permission`;
    container.addTextDisplayComponents((b) => b.setContent(headerText));

    const start = page * playlistsPerPage;
    const playlistsOnThisPage = Math.min(start + playlistsPerPage, playlists.length);
    for (let i = start; i < playlistsOnThisPage; i++) {
        const playlist = playlists[i];
        const playlistInfo = (await getItem(playlist.Id!, userId))!;
        const section = new SectionBuilder();

        const text = `### ${playlist.Name!}\n${playlistInfo.Taglines?.join("\n") ?? "No description"}\n`;
        // get item count here... when the playlist apis work

        section.addTextDisplayComponents((c) => c.setContent(text));
        section.setThumbnailAccessory((b) => b.setURL(imageApi.getItemImageUrlById(playlist.Id!, "Primary", { format: "Jpg", maxWidth: 1000, maxHeight: 1000 })));

        container.addSectionComponents(section);

        const imageButton = new ButtonBuilder()
            .setLabel("Upload New Image")
            .setStyle(ButtonStyle.Secondary)
            .setCustomId(cmd.makeComponentId("uploadModal", [ctx.user.id, playlist.Id!]));
        const fullImageButton = new ButtonBuilder()
            .setLabel("Gimme the current image")
            .setStyle(ButtonStyle.Secondary)
            // having two jellyfin ids made it too long
            .setCustomId(cmd.makeShortComponentId("i", [userId, playlist.Id!]));
        // it is stupid that i can't put this in the section
        container.addActionRowComponents((r) => r.addComponents(imageButton, fullImageButton));

        if (i < playlistsOnThisPage - 1)
            container.addSeparatorComponents((s) => s.setDivider(true));
    }

    const backButton = new ButtonBuilder()
        .setCustomId(cmd.makeComponentId("playlistpage", [ctx.user.id, (page - 1).toString()]))
        .setLabel("Back")
        .setStyle(ButtonStyle.Primary);
    if (page === 0) backButton.setDisabled(true);

    const nextButton = new ButtonBuilder()
        .setCustomId(cmd.makeComponentId("playlistpage", [ctx.user.id, (page + 1).toString()]))
        .setLabel("Next")
        .setStyle(ButtonStyle.Primary);
    if (page + 1 >= pageCount) nextButton.setDisabled(true);

    container.addActionRowComponents((r) => r.addComponents(backButton, nextButton));

    return container;
}

async function constructUploadModal(ctx: Context, playlistId: string, userId: string): Promise<ModalBuilder> {
    // note to self: you could probably shove random extra data in the custom ids of a bunch of disabled buttons if you needed to(?)
    const playlistInfo = (await getItem(playlistId, userId))!;

    const modal = new ModalBuilder()
        .setCustomId(cmd.makeComponentId("upload", [playlistId]))
        .setTitle("Upload new playlist image");

    modal.addTextDisplayComponents((c) => c.setContent(`This is for: ${playlistInfo.Name}`));

    const fileUploadInput = new FileUploadBuilder()
        .setCustomId("fileUpload")
        .setMinValues(1)
        .setMaxValues(1)
        .setRequired(true);
    const fileUploadLabel = new LabelBuilder()
        .setLabel("New image")
        .setDescription("i mean it should be obvious")
        .setFileUploadComponent(fileUploadInput);

    modal.addLabelComponents(fileUploadLabel);

    return modal;
}
