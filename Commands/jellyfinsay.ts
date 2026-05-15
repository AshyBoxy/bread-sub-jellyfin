import { ArgumentsBuilder, Command } from "../../../framework/src";
import { jellyfinApi, JUtils } from "../sub";
import tmpConfig from "../tmpConfig";

const timeoutMs = 5000;

export default new Command(async (bot, ctx, args) => {
    const user = args.getUser("user");
    const message = args.getGreedyStringOrThrow("message");

    const sessionApi = JUtils.getSessionApi(jellyfinApi);
    const jellyfinUsers = tmpConfig.users;

    let sessions = (await sessionApi.getSessions()).data;
    if (sessions.length === 0) {
        ctx.reply("No one's on Jellyfin right now");
        return;
    }

    if (user) {
        const jellyfinUser = jellyfinUsers.find((u) => u.discord === user.id);
        if (!jellyfinUser) {
            ctx.reply("That person isn't on the Jellyfin server");
            return;
        }

        sessions = sessions.filter((v) => v.UserName === jellyfinUser.jellyfin);
        if (sessions.length === 0) {
            ctx.reply("That person isn't on Jellyfin right now");
            return;
        }
    }

    for (const s of sessions) sessionApi.sendMessageCommand({
        sessionId: s.Id!,
        messageCommand: {
            Header: ctx.user.displayName,
            TimeoutMs: timeoutMs,
            Text: message
        }
    });

    ctx.reply(`Sent your message to ${sessions.length} sessions`);

}, {
    args: new ArgumentsBuilder()
        .addUser("user", false)
        .addGreedyString("message", true)
});
