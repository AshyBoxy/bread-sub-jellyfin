import path from "node:path";
import Sub from "../../Interfaces/Sub";
import { HOOK_CODES, HookPhases, Hooks, Strings } from "../../framework";
import * as JSDK from "@jellyfin/sdk";
import * as JUtils from "@jellyfin/sdk/lib/utils/api";
import tmpConfig from "./tmpConfig";

const __dirname = path.dirname(new URL(import.meta.url).pathname);
const stringsPath = path.join(__dirname, "strings/english.json");

export const jellyfin = new JSDK.Jellyfin({
    clientInfo: {
        name: "Bread Sub Jellyfin",
        version: "0.0.1"
    },
    deviceInfo: {
        name: "Unknown",
        id: "discord-0"
    }
});
export let jellyfinApi: JSDK.Api;
export { JUtils };

export default {
    async load(bot) {
        bot.logger.info("Loading Jellyfin sub");

        bot.addModuleSearchPath(path.join(__dirname, "Commands"));

        Strings.setupAddDefaultSource({
            name: "bread_jellyfin_strings",
            data: (await import(stringsPath, { with: { type: "json" } })).default
        });

        bot.addHooks(Hooks.ClientReady, HookPhases.Immediately, (rBot): HOOK_CODES => {
            rBot.logger.info("Setting up Jellyfin API client");
            jellyfin.deviceInfo.name = rBot.user.tag;
            jellyfin.deviceInfo.id = `discord-${rBot.user.id}`;
            jellyfinApi = jellyfin.createApi(tmpConfig.jellyfin, tmpConfig.apiKey);

            return HOOK_CODES.CONTINUE;
        });
    }
} satisfies Sub;
