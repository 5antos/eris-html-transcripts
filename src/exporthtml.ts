import type * as discordv13 from 'discord.js-13';
import type * as discordv14 from 'discord.js-14';
import * as fs              from 'fs';
import * as path            from 'path';
import * as he              from 'he';
import * as staticTypes     from './static';
import * as userDiscord     from 'discord.js';
import { minify }           from 'html-minifier';
import { parse as emoji }   from 'twemoji-parser';
import { JSDOM }            from 'jsdom';
import hljs                 from 'highlight.js';

import { 
    internalGenerateOptions, 
    ObjectType, 
    ReturnTypes,
    Class
} from './types';

import { downloadImageToDataURL } from './utils';
const template = fs.readFileSync(path.join(__dirname, 'template.html'), 'utf8');

const version    = require('../package.json').version;
const isDJSv14   = userDiscord.version.startsWith('14') as boolean;

const Attachment = (isDJSv14 ? 
        // @ts-ignore
        userDiscord.Attachment
        : userDiscord.MessageAttachment
    ) as (Class<discordv14.Attachment | discordv13.MessageAttachment>)

if(!process.env.HIDE_TRANSCRIPT_WARNINGS && isDJSv14)
    console.log('[WARN] discord-html-transcripts was designed to work with v13, but you are using v14. Please note that some bugs may occur.');
    // because of needing to support v13/14, you may seem some weird typescript "hacks"

async function generateTranscript<T extends ReturnTypes>(
    messages: userDiscord.Message[], 
    inputChannel: userDiscord.TextBasedChannel, 
    opts: internalGenerateOptions = { returnType: 'buffer' as T, fileName: 'transcript.html' }
): Promise<ObjectType<T>> {
    const channelTemp = inputChannel as (discordv13.TextBasedChannel | discordv14.TextBasedChannel);

    if(
        (isDJSv14 
            ? channelTemp.type === 1 // djs v14 uses 1 for dm
            : channelTemp.type === "DM")
        || inputChannel.isThread()
    ) throw new Error("Cannot operate on DM channels or thread channels");

    const channel = inputChannel as (discordv13.NewsChannel | discordv13.TextChannel);

    const dom = new JSDOM(template.replace('{{TITLE}}', channel.name));
    const document = dom.window.document;

    // Replace <style>...</style> with <link rel="stylesheet" src="https://cdn.jsdelivr.net/npm/discord-html-transcripts@version/dist/template.css">
    const style = document.querySelector('style')!;
    style.parentNode!.removeChild(style);
    const link = document.createElement('link');
    link.setAttribute('rel', 'stylesheet');
    link.setAttribute('href', 'https://cdn.jsdelivr.net/npm/discord-html-transcripts@' + (version ?? 'latest') + '/dist/template.css');
    document.head.appendChild(link);

    // Basic Info (header)
    const guildIcon = document.getElementsByClassName('preamble__guild-icon')[0] as HTMLImageElement;
    guildIcon.src = channel.guild.iconURL() ?? staticTypes.defaultPFP;

    document.getElementById('guildname')!.textContent = channel.guild.name;
    document.getElementById('ticketname')!.textContent = channel.name;
    document.getElementById('tickettopic')!.textContent = `This is the start of the #${channel.name} channel.`;
    if (channel.topic && channel.topic != null) {
        document.getElementById('tickettopic')!.innerHTML = `This is the start of the #${he.escape(channel.name)} channel. ${formatContent(channel.topic, channel, false, true)}`;
    }

    const transcript = document.getElementById('chatlog')!;

    const messagesArray = (Array.from(messages.values())).sort((a, b) => a.createdTimestamp - b.createdTimestamp);

    // Messages
    await Promise.all(messagesArray.map(async message => {
        // create message group
        const messageGroup = document.createElement('div');
        messageGroup.classList.add('chatlog__message-group');

        // message reference
        if(message.reference?.messageId) {
            // create symbol
            const referenceSymbol = document.createElement('div');
            referenceSymbol.classList.add('chatlog__reference-symbol');

            // create reference
            const reference = document.createElement('div');
            reference.classList.add('chatlog__reference');

            const referencedMessage: userDiscord.Message | null = messages instanceof userDiscord.Collection ? messages.get(message.reference.messageId) : messages.find(m => m.id === message.reference!.messageId);
            const author = referencedMessage?.author ?? staticTypes.DummyUser;

            reference.innerHTML = 
            `<img class="chatlog__reference-avatar" src="${author.avatarURL({ dynamic: true }) ?? staticTypes.defaultPFP}" alt="Avatar" loading="lazy">
            <span class="chatlog__reference-name" title="${author.username.replace(/"/g, '')}" style="color: ${author.hexAccentColor ?? '#FFFFFF'}">${author.bot ? `<span class="chatlog__bot-tag">BOT</span> ${he.escape(author.username)}` : he.escape(author.username)}</span>
            <div class="chatlog__reference-content">
                <span class="chatlog__reference-link" onclick="scrollToMessage(event, '${message.reference.messageId}')">
                        ${referencedMessage ? (referencedMessage?.content ? `${formatContent(referencedMessage?.content, channel, false, true)}...` : '<em>Click to see attachment</em>') : '<em>Original message was deleted.</em>'}
                </span>
            </div>`;

            messageGroup.appendChild(referenceSymbol);
            messageGroup.appendChild(reference);
        }

        // message author pfp
        const author = message.author ?? staticTypes.DummyUser;
        
        const authorElement = document.createElement('div');
        authorElement.classList.add('chatlog__author-avatar-container');

        const authorAvatar = document.createElement('img');
        authorAvatar.classList.add('chatlog__author-avatar');
        authorAvatar.src = author.avatarURL({ dynamic: true }) ?? staticTypes.defaultPFP;
        authorAvatar.alt = 'Avatar';
        authorAvatar.loading = 'lazy';

        authorElement.appendChild(authorAvatar);
        messageGroup.appendChild(authorElement);

        // message content
        const content = document.createElement('div');
        content.classList.add('chatlog__messages');

        // message author name
        const authorName = document.createElement('span');
        authorName.classList.add('chatlog__author-name');
        authorName.title = he.escape(author.tag);
        authorName.textContent = author.username;
        authorName.setAttribute('data-user-id', author.id);
        authorName.style.color = message.member?.displayHexColor ?? `#ffffff`;

        content.appendChild(authorName);

        if(author.bot) {
            const botTag = document.createElement('span');
            botTag.classList.add('chatlog__bot-tag');
            botTag.textContent = (author.flags?.has(65536 /* verified bot flag */) ? '✔ ' : '') + 'BOT';
            content.appendChild(botTag);
        }

        // timestamp
        const timestamp = document.createElement('span');
        timestamp.classList.add('chatlog__timestamp');
        timestamp.textContent = message.createdAt.toLocaleString("en-us", staticTypes.timestampShort);
        timestamp.title = he.escape(message.createdAt.toLocaleTimeString("en-us", staticTypes.timestampLong))

        content.appendChild(timestamp);

        const messageContent = document.createElement('div');
        messageContent.classList.add('chatlog__message');
        messageContent.setAttribute('data-message-id', message.id);
        messageContent.setAttribute('id', `message-${message.id}`);

        // message content
        if(message.content) {
            console.log(message.content, validateURL(message.content));
            if (validateURL(message.content)) {
                var link = document.createElement('a');
                link.classList.add('chatlog__content');
                link.href = message.content;
                link.target = '_blank';
                link.textContent = message.content;
                messageContent.appendChild(link);

                if (message.editedTimestamp != null) {
                    var edited = document.createElement('div');
                    edited.classList.add('chatlog__edited');
                    edited.textContent = '(edited)';
                    messageContent.appendChild(edited);
                }
            } else {
                const messageContentContent = document.createElement('div');
                messageContentContent.classList.add('chatlog__content');

                const messageContentContentMarkdown = document.createElement('div');
                messageContentContentMarkdown.classList.add('markdown');

                const messageContentContentMarkdownSpan = document.createElement('span');
                messageContentContentMarkdownSpan.classList.add('preserve-whitespace');
                messageContentContentMarkdownSpan.innerHTML = formatContent(
                    message.content,
                    channel,
                    message.webhookId !== null
                );
                messageContentContentMarkdown.appendChild(messageContentContentMarkdownSpan);
                messageContentContent.appendChild(messageContentContentMarkdown);
                messageContent.appendChild(messageContentContent);

                if (message.editedTimestamp != null) {
                    var edited = document.createElement('div');
                    edited.classList.add('chatlog__edited');
                    edited.textContent = '(edited)';
                    messageContentContentMarkdownSpan.appendChild(edited);
                }
            }
        }

        // message attachments
        if(message.attachments && message.attachments.size > 0) {
            for(const attachment of Array.from(message.attachments.values())) {
                const attachmentsDiv = document.createElement('div');
                attachmentsDiv.classList.add('chatlog__attachment');

                const attachmentType = (attachment.name ?? "unknown.png").split('.').pop()!.toLowerCase();

                if(['png', 'jpg', 'jpeg', 'gif'].includes(attachmentType)) {
                    const attachmentLink = document.createElement('a');

                    const attachmentImage = document.createElement('img');
                    attachmentImage.classList.add('chatlog__attachment-media');
                    attachmentImage.src = (opts.saveImages ? await downloadImageToDataURL(attachment.proxyURL ?? attachment.url) : null) ?? attachment.proxyURL ?? attachment.url;
                    attachmentImage.alt = attachment.description ? `Image: ${attachment.description}` : 'Image attachment';
                    attachmentImage.loading = 'lazy';
                    attachmentImage.title = `Image: ${attachment.name} (${formatBytes(attachment.size)})`;

                    attachmentLink.appendChild(attachmentImage);
                    attachmentsDiv.appendChild(attachmentLink);
                } else if(['mp4', 'webm'].includes(attachmentType)) {
                    const attachmentVideo = document.createElement('video');
                    attachmentVideo.classList.add('chatlog__attachment-media');
                    attachmentVideo.src = attachment.proxyURL ?? attachment.url;
                    // attachmentVideo.alt = 'Video attachment';
                    attachmentVideo.controls = true;
                    attachmentVideo.title = `Video: ${attachment.name} (${formatBytes(attachment.size)})`;

                    attachmentsDiv.appendChild(attachmentVideo);
                } else if(['mp3', 'ogg'].includes(attachmentType)) {
                    const attachmentAudio = document.createElement('audio');
                    attachmentAudio.classList.add('chatlog__attachment-media');
                    attachmentAudio.src = attachment.proxyURL ?? attachment.url;
                    // attachmentAudio.alt = 'Audio attachment';
                    attachmentAudio.controls = true;
                    attachmentAudio.title = `Audio: ${attachment.name} (${formatBytes(attachment.size)})`;

                    attachmentsDiv.appendChild(attachmentAudio);
                } else {
                    const attachmentGeneric = document.createElement('div');
                    attachmentGeneric.classList.add('chatlog__attachment-generic');

                    const attachmentGenericIcon = document.createElement('svg');
                    attachmentGenericIcon.classList.add('chatlog__attachment-generic-icon');

                    const attachmentGenericIconUse = document.createElement('use');
                    attachmentGenericIconUse.setAttribute('href', '#icon-attachment');

                    attachmentGenericIcon.appendChild(attachmentGenericIconUse);
                    attachmentGeneric.appendChild(attachmentGenericIcon);
                    
                    const attachmentGenericName = document.createElement('div');
                    attachmentGenericName.classList.add('chatlog__attachment-generic-name');

                    const attachmentGenericNameLink = document.createElement('a');
                    attachmentGenericNameLink.href = attachment.proxyURL ?? attachment.url;
                    attachmentGenericNameLink.textContent = attachment.name;

                    attachmentGenericName.appendChild(attachmentGenericNameLink);
                    attachmentGeneric.appendChild(attachmentGenericName);

                    const attachmentGenericSize = document.createElement('div');
                    attachmentGenericSize.classList.add('chatlog__attachment-generic-size');

                    attachmentGenericSize.textContent = `${formatBytes(attachment.size)}`;
                    attachmentGeneric.appendChild(attachmentGenericSize);

                    attachmentsDiv.appendChild(attachmentGeneric);
                }

                messageContent.appendChild(attachmentsDiv);
            }
        }

        content.appendChild(messageContent);

        // embeds
        if(message.embeds && message.embeds.length > 0) {
            for(const embed of message.embeds) {
                const embedDiv = document.createElement('div');
                embedDiv.classList.add('chatlog__embed');

                // embed color
                if(embed.hexColor) {
                    const embedColorPill = document.createElement('div');
                    embedColorPill.classList.add('chatlog__embed-color-pill');
                    embedColorPill.style.backgroundColor = embed.hexColor;

                    embedDiv.appendChild(embedColorPill);
                }

                const embedContentContainer = document.createElement('div');
                embedContentContainer.classList.add('chatlog__embed-content-container');

                const embedContent = document.createElement('div');
                embedContent.classList.add('chatlog__embed-content');

                const embedText = document.createElement('div');
                embedText.classList.add('chatlog__embed-text');

                // embed author
                if(embed.author?.name) {
                    const embedAuthor = document.createElement('div');
                    embedAuthor.classList.add('chatlog__embed-author');

                    if(embed.author.iconURL) {
                        const embedAuthorIcon = document.createElement('img');
                        embedAuthorIcon.classList.add('chatlog__embed-author-icon');
                        embedAuthorIcon.src = embed.author.iconURL;
                        embedAuthorIcon.alt = 'Author icon';
                        embedAuthorIcon.loading = 'lazy';
                        embedAuthorIcon.onerror = () => embedAuthorIcon.style.visibility = 'hidden';

                        embedAuthor.appendChild(embedAuthorIcon);
                    }

                    const embedAuthorName = document.createElement('span');
                    embedAuthorName.classList.add('chatlog__embed-author-name');

                    if(embed.author.url) {
                        const embedAuthorNameLink = document.createElement('a');
                        embedAuthorNameLink.classList.add('chatlog__embed-author-name-link');
                        embedAuthorNameLink.href = embed.author.url;
                        embedAuthorNameLink.textContent = embed.author.name;

                        embedAuthorName.appendChild(embedAuthorNameLink);
                    } else {
                        embedAuthorName.textContent = embed.author.name;
                    }

                    embedAuthor.appendChild(embedAuthorName);
                    embedText.appendChild(embedAuthor);
                }

                // embed title
                if(embed.title) {
                    const embedTitle = document.createElement('div');
                    embedTitle.classList.add('chatlog__embed-title');

                    if(embed.url) {
                        const embedTitleLink = document.createElement('a');
                        embedTitleLink.classList.add('chatlog__embed-title-link');
                        embedTitleLink.href = embed.url;

                        const embedTitleMarkdown = document.createElement('div');
                        embedTitleMarkdown.classList.add('markdown', 'preserve-whitespace');
                        embedTitleMarkdown.textContent = embed.title;

                        embedTitleLink.appendChild(embedTitleMarkdown);
                        embedTitle.appendChild(embedTitleLink);
                    } else {
                        const embedTitleMarkdown = document.createElement('div');
                        embedTitleMarkdown.classList.add('markdown', 'preserve-whitespace');
                        embedTitleMarkdown.textContent = embed.title;

                        embedTitle.appendChild(embedTitleMarkdown);
                    }

                    embedText.appendChild(embedTitle);
                }

                // embed description
                if(embed.description) {
                    const embedDescription = document.createElement('div');
                    embedDescription.classList.add('chatlog__embed-description');

                    const embedDescriptionMarkdown = document.createElement('div');
                    embedDescriptionMarkdown.classList.add('markdown', 'preserve-whitespace');
                    embedDescriptionMarkdown.innerHTML = formatContent(
                        embed.description,
                        channel,
                        true
                    );

                    embedDescription.appendChild(embedDescriptionMarkdown);
                    embedText.appendChild(embedDescription);
                }

                // embed fields
                if(embed.fields && embed.fields.length > 0) {
                    const embedFields = document.createElement('div');
                    embedFields.classList.add('chatlog__embed-fields');

                    for(const field of embed.fields) {
                        const embedField = document.createElement('div');
                        embedField.classList.add(
                            ...(!field.inline ? ['chatlog__embed-field'] : ['chatlog__embed-field', 'chatlog__embed-field--inline'])
                        );

                        // Field name
                        const embedFieldName = document.createElement('div');
                        embedFieldName.classList.add('chatlog__embed-field-name');

                        const embedFieldNameMarkdown = document.createElement('div');
                        embedFieldNameMarkdown.classList.add('markdown', 'preserve-whitespace');
                        embedFieldNameMarkdown.textContent = field.name;

                        embedFieldName.appendChild(embedFieldNameMarkdown);
                        embedField.appendChild(embedFieldName);


                        // Field value
                        const embedFieldValue = document.createElement('div');
                        embedFieldValue.classList.add('chatlog__embed-field-value');

                        const embedFieldValueMarkdown = document.createElement('div');
                        embedFieldValueMarkdown.classList.add('markdown', 'preserve-whitespace');
                        embedFieldValueMarkdown.innerHTML = formatContent(
                            field.value,
                            channel,
                            true
                        );

                        embedFieldValue.appendChild(embedFieldValueMarkdown);
                        embedField.appendChild(embedFieldValue);

                        embedFields.appendChild(embedField);
                    }

                    embedText.appendChild(embedFields);
                }

                embedContent.appendChild(embedText);

                // embed thumbnail
                if(embed.thumbnail?.proxyURL ?? embed.thumbnail?.url) {
                    const embedThumbnail = document.createElement('div');
                    embedThumbnail.classList.add('chatlog__embed-thumbnail-container');

                    const embedThumbnailLink = document.createElement('a');
                    embedThumbnailLink.classList.add('chatlog__embed-thumbnail-link');
                    embedThumbnailLink.href = embed.thumbnail.proxyURL ?? embed.thumbnail.url;

                    const embedThumbnailImage = document.createElement('img');
                    embedThumbnailImage.classList.add('chatlog__embed-thumbnail');
                    embedThumbnailImage.src = embed.thumbnail.proxyURL ?? embed.thumbnail.url;
                    embedThumbnailImage.alt = 'Thumbnail';
                    embedThumbnailImage.loading = 'lazy';

                    embedThumbnailLink.appendChild(embedThumbnailImage);
                    embedThumbnail.appendChild(embedThumbnailLink);

                    embedContent.appendChild(embedThumbnail);
                }

                embedContentContainer.appendChild(embedContent);

                // embed image
                if(embed.image) {
                    const embedImage = document.createElement('div');
                    embedImage.classList.add('chatlog__embed-image-container');

                    const embedImageLink = document.createElement('a');
                    embedImageLink.classList.add('chatlog__embed-image-link');
                    embedImageLink.href = embed.image.proxyURL ?? embed.image.url;

                    const embedImageImage = document.createElement('img');
                    embedImageImage.classList.add('chatlog__embed-image');
                    embedImageImage.src = embed.image.proxyURL ?? embed.image.url;
                    embedImageImage.alt = 'Image';
                    embedImageImage.loading = 'lazy';

                    embedImageLink.appendChild(embedImageImage);
                    embedImage.appendChild(embedImageLink);

                    embedContentContainer.appendChild(embedImage);
                } 

                // footer
                if(embed.footer?.text) {
                    const embedFooter = document.createElement('div');
                    embedFooter.classList.add('chatlog__embed-footer');

                    if(embed.footer.iconURL) {
                        const embedFooterIcon = document.createElement('img');
                        embedFooterIcon.classList.add('chatlog__embed-footer-icon');
                        embedFooterIcon.src = embed.footer.proxyIconURL ?? embed.footer.iconURL;
                        embedFooterIcon.alt = 'Footer icon';
                        embedFooterIcon.loading = 'lazy';

                        embedFooter.appendChild(embedFooterIcon);
                    }

                    const embedFooterText = document.createElement('span');
                    embedFooterText.classList.add('chatlog__embed-footer-text');
                    embedFooterText.textContent = embed.timestamp ? `${embed.footer.text} • ${new Date(embed.timestamp).toLocaleString()}` : embed.footer.text;
                    
                    embedFooter.appendChild(embedFooterText);

                    embedContentContainer.appendChild(embedFooter);
                }

                embedDiv.appendChild(embedContentContainer);
                content.appendChild(embedDiv);
            } 
        }

        // reactions
        if(message.reactions.cache.size > 0) {
            const reactionsDiv = document.createElement('div');
            reactionsDiv.classList.add('chatlog__reactions');

            for(const reaction of Array.from(message.reactions.cache.values())) {
                /*
                    <div class="chatlog__reaction" title="upside_down"> - reactionContainer
                        <img class="emoji emoji--small" alt="🙃" src="https://twemoji.maxcdn.com/2/svg/1f643.svg" loading="lazy"> - reactionEmoji
                        <span class="chatlog__reaction-count">1</span> - reactionCount
                    </div>
                */

                const reactionContainer = document.createElement('div');
                reactionContainer.classList.add('chatlog__reaction');
                reactionContainer.title = reaction.emoji.name ?? reaction.emoji.id ?? 'Unknown';
                
                const reactionEmoji = document.createElement('img');
                reactionEmoji.classList.add('emoji', 'emoji--small');
                reactionEmoji.alt = reaction.emoji.name ?? reaction.emoji.id ?? reaction.emoji.identifier;
                if(reaction.emoji.url) {
                    reactionEmoji.src = reaction.emoji.url;
                } else if(reaction.emoji.name) {
                    // console.log(reaction.emoji.identifier, reaction.emoji.name, reaction.emoji.id);
                    reactionEmoji.src = emoji(reaction.emoji.name)[0].url;
                } else {
                    // reactionEmoji.src = `https://twemoji.maxcdn.com/2/svg/${reaction.emoji.id}.svg`;
                    console.warn(`[discord-html-transcripts] [WARN] Failed to parse reaction emoji:`, reaction.emoji);
                }

                const reactionCount = document.createElement('span');
                reactionCount.classList.add('chatlog__reaction-count');
                reactionCount.textContent = reaction.count.toString();

                reactionContainer.appendChild(reactionEmoji);
                reactionContainer.appendChild(reactionCount);

                reactionsDiv.appendChild(reactionContainer);
            }

            content.appendChild(reactionsDiv);
        }

        messageGroup.appendChild(content);
        transcript.appendChild(messageGroup);
    }));

    var serialized = dom.serialize();
    try {
        if(opts.minify) serialized = minify(serialized, staticTypes.MINIFY_OPTIONS)
    } catch (error) {
        console.error(`[discord-html-transcripts] [ERROR] Failed to minify: `, error);
    }

    if(opts.returnType === "string")
        return serialized as ObjectType<T>;

    if(opts.returnType === "buffer")
        return Buffer.from(serialized) as ObjectType<T>;

    if(opts.returnType === "attachment")
        return new Attachment(Buffer.from(serialized), opts.fileName ?? 'transcript.html') as ObjectType<T>;

    // should never get here.
    return serialized as ObjectType<T>;
}

const languages = hljs.listLanguages();

function formatContent(content: string, context: discordv13.NewsChannel | discordv13.TextChannel | discordv13.ThreadChannel, allowExtra=false, replyStyle=false, purify=he.escape) {
    const emojiClass = /^(<(a?):([^:]+?):(\d+?)>([ \t]+?)?){0,27}$/.test(content)
        ? `emoji--large` : `emoji--small`;
    
    content = purify(content)
        .replace(/\&\#x60;/g, '`') // we dont want ` to be escaped
        .replace(/```(.+?)```/gs, (code: string) => {
            if (!replyStyle) {
              const split = code.slice(3, -3).split('\n');
              let language = (split.shift() ?? "").trim().toLowerCase();

              if (language in staticTypes.LanguageAliases)
                language = staticTypes.LanguageAliases[language as (keyof typeof staticTypes.LanguageAliases)];

              if (languages.includes(language)) {
                const joined = he.unescape(split.join("\n"));
                return `<div class="pre pre--multiline language-${language}">${
                  hljs.highlight(joined, {
                    language,
                  }).value
                }</div>`;
              } else {
                return `<div class="pre pre--multiline nohighlight">${code
                  .slice(3, -3)
                  .trim()}</div>`;
              }
            } else {
                const split = code.slice(3, -3).split('\n');
                split.shift();

                const joined = he.unescape(split.join('\n'));

                return `<span class="pre pre--inline">${joined.substring(0, 42)}</span>`;
            }
        })
        .replace(/\&lt\;a:(.+?):(\d+?)\&gt\;/g, (_content, _name, id) => `<img src="https://cdn.discordapp.com/emojis/${id}.gif?size=96" class="emoji ${emojiClass}">`)
        .replace(/\&lt\;:(.+?):(\d+?)\&gt\;/g, (_content, _name, id) => `<img src="https://cdn.discordapp.com/emojis/${id}.webp?size=96" class="emoji ${emojiClass}">`)
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
        .replace(/~~(.+?)~~/g, '<s>$1</s>')
        .replace(/__(.+?)__/g, '<u>$1</u>')
        .replace(/\_(.+?)\_/g, '<em>$1</em>')
        .replace(/`(.+?)`/g, `<span class="pre pre--inline">$1</span>`)
        .replace(/\|\|(.+?)\|\|/g, `<span class="spoiler-text spoiler-text--hidden" ${replyStyle ? '' : 'onclick="showSpoiler(event, this)"'}>$1</span>`)
        .replace(/\&lt\;@!*&*([0-9]{16,20})\&gt\;/g, (user: string) => { // matches @!<id> or @<id>
            const userId = (user.match(/[0-9]{16,20}/) ?? [""])[0];
            const userInGuild = context.client?.users?.resolve(userId);

            return `<span class="mention" title="${userInGuild?.tag ?? userId}">@${userInGuild?.username ?? "Unknown User"}</span>`
        })
        .replace(/\&lt\;#!*&*([0-9]{16,20})\&gt\;/g, (channel: string) => { // matches #!<id> or #<id>
            const channelId = (channel.match(/[0-9]{16,20}/) ?? [""])[0];
            const channelInGuild = context.guild.channels.resolve(channelId);

            const pre = channelInGuild ? channelInGuild.isText() ? '#' : channelInGuild.isVoice() ? '🔊' : '📁' : "#";

            return `<span class="mention" title="${channelInGuild?.name ?? channelId}">${pre}${channelInGuild?.name ?? "Unknown Channel"}</span>`;
        })
        .replace(/\&lt\;\@\&amp\;([0-9]{16,20})\&gt\;/g, (channel: string) => { // matches &!<id> or &<id>
            const roleId = (channel.match(/[0-9]{16,20}/) ?? [""])[0];
            const roleInGuild = context.guild.roles.resolve(roleId);

            if(!roleInGuild) 
                return `<span class="mention" title="${roleId}">Unknown Role</span>`;
            if(!roleInGuild.color) 
                return `<span class="mention" title="${roleInGuild.name}">@${roleInGuild.name ?? "Unknown Role"}</span>`;
            
            const rgb  = roleInGuild.color ?? 0;
            const r    = (rgb >> 16) & 0xFF;
            const g    = (rgb >> 8) & 0xFF;
            const b    = rgb & 0xFF;
            const a    = 0.1;
            const rgba = `rgba(${r}, ${g}, ${b}, ${a})`;

            return `<span class="mention" style="color: ${roleInGuild.hexColor}; background-color: ${rgba};" title="${roleInGuild?.name ?? roleId}">@${roleInGuild?.name ?? "Unknown Role"}</span>`;
        });
        
    if(allowExtra) {
        content = content
            .replace(/\[(.+?)\]\((.+?)\)/g, `<a href="$2">$1</a>`)
    }

    return replyStyle ? content.replace(/(?:\r\n|\r|\n)/g, ' ')  : content.replace(/(?:\r\n|\r|\n)/g, '<br />'); // do this last
}

function formatBytes(bytes: number, decimals = 2) {
    if (bytes === 0) return '0 Bytes';

    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];

    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

function validateURL(url: string) {
    return /https?:\/\/(www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_\+.~#?&//=]*)/i.test(url);
}

export default generateTranscript;