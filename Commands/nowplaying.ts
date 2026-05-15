import { ItemsApi } from "@jellyfin/sdk/lib/generated-client/api/items-api";
import { SessionApi } from "@jellyfin/sdk/lib/generated-client/api/session-api";
import { SessionInfoDto } from "@jellyfin/sdk/lib/generated-client/models";
import { ImageUrlsApi } from "@jellyfin/sdk/lib/utils/api/image-urls-api";
import { ContainerBuilder, MessageFlags, SectionBuilder, TextDisplayBuilder } from "discord.js";
import { getAverageColor } from "fast-average-color-node";
import getImageColors from "get-image-colors";
import { Vibrant } from "node-vibrant/node";
import { ArgumentsBuilder, BreadEmbed, Command } from "../../../framework";
import { jellyfin, jellyfinApi, JUtils } from "../sub";
import tmpConfig from "../tmpConfig";

// TODO: configurable
const embedMode = false;
const colorMode: "average" | "dominant" | "vibrant" = "vibrant";

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
    const albumYear = session.NowPlayingItem!.ProductionYear!;
    const artists = session.NowPlayingItem!.Artists!;
    const titleStr = `### ${session.UserName}`;
    const detailsStr = `${trackName}\n${artists.join(", ")}\n${albumName} (${albumYear})\n-# ${session.Client} ${session.ApplicationVersion}`;

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
        bar += "─".repeat(Math.max(beforeLength, 0));
        bar += "⬤";
        bar += "─".repeat(Math.max(afterLength, 0));
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

    type ColorType = [number, number, number];
    let color: ColorType | null = null;

    const res = await fetch(imageUrlForColor);
    const imageBuffer = Buffer.from(await res.arrayBuffer());
    const type = res.headers.get("content-type") || undefined;
    let mode = colorMode;

    // just assuming getting the image won't fail for now
    if (mode === "vibrant") {
        const v = new Vibrant(imageBuffer, { quality: 1 });
        const palette = await v.getPalette();

        const swatch = palette.Vibrant;
        if (!swatch) mode = "average";
        else color = <ColorType>swatch.rgb;
    }

    if (mode === "average") {
        const avgColor = await getAverageColor(imageBuffer, { mode: "speed" });
        color = <ColorType>avgColor.value.slice(0, 3);
    } else if (mode === "dominant") {
        const baseColors = await getImageColors(imageBuffer, { count: 10, type });

        // these could do with some tweaking
        const saturationThreshold = 0.2;
        const chromaThreshold = 50;

        // filter out hueless colors
        let colors = baseColors.filter((c) => !isNaN(c.hsl()[0]));
        // filter by saturation
        colors = colors.filter((c) => c.get("hsl.s") >= saturationThreshold);
        // filter by chroma
        colors = colors.filter((c) => c.get("lch.c") >= chromaThreshold);

        if (colors.length === 0) colors = baseColors;

        const dominantColor = colors[0];
        const rgb = dominantColor.rgb();
        color = <ColorType>rgb.slice(0, 3);
    }

    if (!color) color = [255, 255, 255];

    // vibrant sometimes returns decimals?
    color = <ColorType>color.map((c) => Math.round(c));

    container.setAccentColor(color);

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
