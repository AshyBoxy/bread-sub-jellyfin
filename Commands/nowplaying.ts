import { SessionInfoDto } from "@jellyfin/sdk/lib/generated-client/models";
import { ImageUrlsApi } from "@jellyfin/sdk/lib/utils/api/image-urls-api";
import { ContainerBuilder, MessageFlags, SectionBuilder, TextDisplayBuilder } from "discord.js";
import { getAverageColor } from "fast-average-color-node";
import { ArgumentsBuilder, BreadEmbed, Command } from "../../../framework";
import { jellyfin, jellyfinApi, JUtils } from "../sub";
import tmpConfig from "../tmpConfig";

// TODO: configurable
const embedMode = false;

export default new Command(async (bot, ctx, args) => {
    noop(jellyfin, jellyfinApi, JUtils, tmpConfig);

    const sessionApi = JUtils.getSessionApi(jellyfinApi);
    const imageApi = JUtils.getImageApi(jellyfinApi);

    let sessions = (await sessionApi.getSessions()).data;
    sessions = sessions.filter((s) => typeof s.NowPlayingItem === "object")
        .sort((a, b) => a.UserName!.localeCompare(b.UserName!)!);

    if (!args.getFlag("showpaused")) sessions = sessions.filter((s) => !(s.PlayState?.IsPaused ?? false));

    if (embedMode) ctx.reply({ embeds: constructEmbeds(sessions, imageApi) });
    else ctx.reply({ components: await constructComponents(sessions, imageApi), flags: MessageFlags.IsComponentsV2 });
}, {
    args: new ArgumentsBuilder()
        .addFlag("showpaused", "p", false)
});

async function constructComponents(sessions: SessionInfoDto[], imageApi: ImageUrlsApi): Promise<(SectionBuilder | TextDisplayBuilder | ContainerBuilder)[]> {
    const components: (SectionBuilder | TextDisplayBuilder | ContainerBuilder)[] = [];

    for (const session of sessions) {
        if (session.NowPlayingItem!.Type! === "Audio") {
            components.push(await constructComponentMusic(session, imageApi));
            continue;
        }

        const container = new ContainerBuilder();
        const section = new SectionBuilder();

        section.addTextDisplayComponents((c) => c.setContent(`${session.UserName} is playing ${session.NowPlayingItem!.Name}`));
        // TODO: anything other than music
        const imageUrl = imageApi.getItemImageUrlById(session.NowPlayingItem!.Id!, "Primary");
        section.setThumbnailAccessory((b) => b.setURL(imageUrl));

        container.addSectionComponents(section);
        components.push(container);
    }

    return components;
}

async function constructComponentMusic(session: SessionInfoDto, imageApi: ImageUrlsApi): Promise<ContainerBuilder> {
    const container = new ContainerBuilder();
    const section = new SectionBuilder();

    const trackName = session.NowPlayingItem!.Name!;
    const albumName = session.NowPlayingItem!.Album!;
    const artists = session.NowPlayingItem!.Artists!;
    const titleStr = `### ${session.UserName}`;
    const detailsStr = `${trackName}\n${albumName}\n${artists.join(", ")}\n-# ${session.Client} ${session.ApplicationVersion}`;

    // assuming at least one of these will have a primary image
    let tryIds = [session.NowPlayingItem!.Id!, session.NowPlayingItem!.ParentId!];
    let id = "";
    for (const tryId of tryIds) {
        id = tryId;
        const imageUrlTest = imageApi.getItemImageUrlById(tryId, "Primary");
        const response = await fetch(imageUrlTest, { method: "HEAD" });
        if (response.status === 200) {
            break;
        }
    };

    section.addTextDisplayComponents((c) => c.setContent(titleStr));

    if (typeof session.PlayState?.PositionTicks === "number" && typeof session.NowPlayingItem?.RunTimeTicks === "number") {
        const positionSeconds = Math.floor(session.PlayState.PositionTicks / 10000000);
        const runtimeSeconds = Math.floor(session.NowPlayingItem.RunTimeTicks / 10000000);

        const minutesPos = Math.floor(positionSeconds / 60);
        const secondsPos = positionSeconds % 60;
        const minutesRun = Math.floor(runtimeSeconds / 60);
        const secondsRun = runtimeSeconds % 60;

        const secondsPosStr = secondsPos.toString().padStart(2, "0");
        const secondsRunStr = secondsRun.toString().padStart(2, "0");

        let text = `${minutesPos}:${secondsPosStr}/${minutesRun}:${secondsRunStr}`;
        if (session.PlayState.IsPaused) text += " (Paused)";

        section.addTextDisplayComponents((c) => c.setContent(`-# ${text}`));
    }

    section.addTextDisplayComponents((c) => c.setContent(detailsStr));

    const imageUrl = imageApi.getItemImageUrlById(id, "Primary");
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

function noop(..._args: unknown[]): void {
    return;
}
