import { ItemsApi } from "@jellyfin/sdk/lib/generated-client/api/items-api";
import { SessionApi } from "@jellyfin/sdk/lib/generated-client/api/session-api";
import { SessionInfoDto } from "@jellyfin/sdk/lib/generated-client/models";
import { ImageUrlsApi } from "@jellyfin/sdk/lib/utils/api/image-urls-api";
import { ContainerBuilder, MessageFlags, SectionBuilder, TextDisplayBuilder } from "discord.js";
import { getAverageColor } from "fast-average-color-node";
import { ArgumentsBuilder, BreadEmbed, Command } from "../../../framework";
import { jellyfin, jellyfinApi, JUtils } from "../sub";
import tmpConfig from "../tmpConfig";

// TODO: configurable
const embedMode = false;

interface ApiArgs {
    sessionApi: SessionApi;
    imageApi: ImageUrlsApi;
    itemsApi: ItemsApi;
}

export default new Command(async (bot, ctx, args) => {
    void jellyfin; void tmpConfig;

    const sessionApi = JUtils.getSessionApi(jellyfinApi);
    const imageApi = JUtils.getImageApi(jellyfinApi);
    const itemsApi = JUtils.getItemsApi(jellyfinApi);

    let sessions = (await sessionApi.getSessions()).data;
    sessions = sessions.filter((s) => typeof s.NowPlayingItem === "object")
        .sort((a, b) => a.UserName!.localeCompare(b.UserName!)!);

    if (!args.getFlag("showpaused")) sessions = sessions.filter((s) => !(s.PlayState?.IsPaused ?? false));

    if (sessions.length === 0) {
        ctx.reply("No one's listening to anything :<");
        return;
    }

    if (embedMode) ctx.reply({ embeds: constructEmbeds(sessions, imageApi) });
    else ctx.reply({ components: await constructComponents(sessions, { sessionApi, imageApi, itemsApi }), flags: MessageFlags.IsComponentsV2 });
}, {
    args: new ArgumentsBuilder()
        .addFlag("showpaused", "p", false)
});

async function constructComponents(sessions: SessionInfoDto[], apis: ApiArgs): Promise<(SectionBuilder | TextDisplayBuilder | ContainerBuilder)[]> {
    const components: (SectionBuilder | TextDisplayBuilder | ContainerBuilder)[] = [];

    for (const session of sessions) {
        if (session.NowPlayingItem!.Type === "Audio") {
            components.push(await constructComponentMusic(session, apis));
            continue;
        }

        const container = new ContainerBuilder();
        const section = new SectionBuilder();

        section.addTextDisplayComponents((c) => c.setContent(`${session.UserName} is playing ${session.NowPlayingItem!.Name}`));
        // TODO: anything other than music
        const imageUrl = apis.imageApi.getItemImageUrlById(session.NowPlayingItem!.Id!, "Primary");
        section.setThumbnailAccessory((b) => b.setURL(imageUrl));

        container.addSectionComponents(section);
        components.push(container);
    }

    return components;
}

async function constructComponentMusic(session: SessionInfoDto, { imageApi, itemsApi }: ApiArgs): Promise<ContainerBuilder> {
    const container = new ContainerBuilder();
    const section = new SectionBuilder();

    const trackName = session.NowPlayingItem!.Name!;
    const albumName = session.NowPlayingItem!.Album!;
    const artists = session.NowPlayingItem!.Artists!;
    const titleStr = `### ${session.UserName}`;
    const detailsStr = `${trackName}\n${albumName}\n${artists.join(", ")}\n-# ${session.Client} ${session.ApplicationVersion}`;

    // assuming at least one of these will have a primary image
    const tryIds = [session.NowPlayingItem!.Id!, session.NowPlayingItem!.ParentId!];
    let id = "";
    for (const tryId of tryIds) {
        id = tryId;
        const imageUrlTest = imageApi.getItemImageUrlById(tryId, "Primary");
        const response = await fetch(imageUrlTest, { method: "HEAD" });
        if (response.status === 200) break;
    };

    section.addTextDisplayComponents((c) => c.setContent(titleStr));

    let upperDetailStr = "";

    if (typeof session.PlayState?.PositionTicks === "number" && typeof session.NowPlayingItem?.RunTimeTicks === "number") {
        const positionSeconds = Math.floor(session.PlayState.PositionTicks / 10000000);
        const runtimeSeconds = Math.floor(session.NowPlayingItem.RunTimeTicks / 10000000);

        const minutesPos = Math.floor(positionSeconds / 60);
        const secondsPos = positionSeconds % 60;
        const minutesRun = Math.floor(runtimeSeconds / 60);
        const secondsRun = runtimeSeconds % 60;

        const secondsPosStr = secondsPos.toString().padStart(2, "0");
        const secondsRunStr = secondsRun.toString().padStart(2, "0");

        const progressText = `${minutesPos}:${secondsPosStr}`;
        const totalText = `${minutesRun}:${secondsRunStr}`;

        // const barChar = "/";
        // const barChar = "|";
        const barChar = "";
        let bar = barChar;
        const barLength = 20;
        const progress = session.PlayState.PositionTicks / session.NowPlayingItem.RunTimeTicks;
        const point = Math.floor(progress * barLength);
        const beforeLength = point;
        const afterLength = barLength - beforeLength - 1;
        bar += "─".repeat(beforeLength);
        bar += "⬤";
        bar += "─".repeat(afterLength);
        bar += barChar;

        let text = `${progressText} \`${bar}\` ${totalText}`;
        if (session.PlayState.IsPaused) text += " (Paused)";
        upperDetailStr += `\n-# ${text}`;
    }

    const userData = (await itemsApi.getItemUserData({ itemId: session.NowPlayingItem!.Id!, userId: session.UserId! })).data;
    if (typeof userData.PlayCount === "number")
        upperDetailStr += `\n-# Plays: ${userData.PlayCount}`;


    section.addTextDisplayComponents((c) => c.setContent(upperDetailStr));
    section.addTextDisplayComponents((c) => c.setContent(detailsStr));

    const imageUrl = imageApi.getItemImageUrlById(id, "Primary", { format: "Jpg", maxWidth: 1000, maxHeight: 1000 });
    section.setThumbnailAccessory((b) => b.setURL(imageUrl));

    const imageUrlForColor = imageApi.getItemImageUrlById(id, "Primary", { width: 256, format: "Jpg" });
    const color = await getAverageColor(imageUrlForColor, { mode: "speed" });
    container.setAccentColor(<[number, number, number]>color.value.slice(0, 3));

    container.addSectionComponents(section);
    return container;
}

function constructEmbeds(sessions: SessionInfoDto[], imageApi: ImageUrlsApi): BreadEmbed[] {
    const embeds: BreadEmbed[] = [];

    for (const session of sessions) {
        const embed = new BreadEmbed();
        embed.setAuthor({ name: session.UserName! })
            .setTitle(`Now Playing: ${session.NowPlayingItem!.Name}`)
            .setThumbnail(imageApi.getItemImageUrlById(session.NowPlayingItem!.ParentId!, "Primary"));

        embeds.push(embed);
    }

    return embeds;
}
