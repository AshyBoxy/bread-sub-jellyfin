/* eslint-disable prefer-template */
// TODO: turn this rule off fully
import { ArgumentsBuilder, Command } from "../../../framework";
import tmpConfig from "../tmpConfig";

export default new Command((bot, ctx, args) => {
    const user = args.getUser("user") ?? ctx.user;

    const jellyfinUsers = tmpConfig.users;
    const jellyfinUser = jellyfinUsers.find((u) => u.discord === user.id);

    if (!jellyfinUser)
        ctx.reply((user.id === ctx.user.id ? "You aren't" : `${user} isn't`) + " on Jellyfin");
    else
        ctx.reply((user.id === ctx.user.id ? "You are" : `${user} is`) + ` ${jellyfinUser.jellyfin} on Jellyfin`);
}, {
    args: new ArgumentsBuilder()
        .addUser("user", false)
});
