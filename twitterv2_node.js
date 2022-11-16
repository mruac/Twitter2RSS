const OAuth = require('oauth');
const { promisify } = require('util');
require('dotenv').config();
const storage = require('node-persist');



let oauth = getOAuth();

const expansions = "expansions=attachments.poll_ids,attachments.media_keys,author_id,in_reply_to_user_id,referenced_tweets.id,referenced_tweets.id.author_id&media.fields=media_key,preview_image_url,type,url,alt_text,variants&poll.fields=id,options&tweet.fields=attachments,author_id,conversation_id,created_at,entities,id,in_reply_to_user_id,referenced_tweets,text&user.fields=protected";
const CACHE_TIME = 900; //in seconds - prevents calling getData() excessively and reaching rate limits too soon. Adjust as needed. 

module.exports = {

    fetchRSS: async function (urlParam) { //URLSearchParams(request.search)
        await storage.init( /* options ... */);

        let action = urlParam.get("action"), //timeline, list, search, likes, tweet
            query = urlParam.get("q"),
            filters = urlParam.get("filters"),
            filterString = [],
            customTitle = urlParam.get("title"); //plain, short, emojify, both

        if (customTitle == undefined) { customTitle = "plain"; }

        //"attachments" requires either "tweets","retweets","replies"
        //"text" requires either "tweets","retweets","replies"
        //if "text" and "attachments" are omitted, they are included by default.
        if (filters == undefined) { filters = "tweets,retweets,replies,attachments,text" }
        filters = filters.split(",").sort();

        if (
            (filters.length == 1 && filters[0] == "attachments") ||
            (filters.length == 1 && filters[0] == "text") ||
            (filters.length == 2 && filters[0] == "attachments" && filters[1] == "text") ||
            (filters.length == 2 && filters[0] == "text" && filters[1] == "attachments")) {
            return "Attachments and/or Text filter must include either of Tweets, Retweets and/or Replies.";
        }
        if (!filters.includes("text") && !filters.includes("attachments")) {
            filters.push("text", "attachments");
        }

        for (let i in filters) {
            switch (filters[i]) {
                case "tweets":
                    filterString.push("Tweets");
                    break;
                case "replies":
                    filterString.push("Replies");
                    break;
                case "retweets":
                    filterString.push("RTs");
                    break;
                case "attachments":
                    filterString.push("Attachments");
                    break;
                case "text":
                    filterString.push("Text");
                    break;
                default:
                    return "Invalid filters value used. Filters value must be \"tweets\", \"replies\", \"retweets\", \"text\" and/or \"attachments\"\nFilters used: " + filters.toString();
            }
        }
        filterString = filterString.join(", ");

        let cacheId = Buffer.from(urlParam.toString()).toString('base64');
        let rss = await storage.getItem(cacheId);

        if (!rss) {  // //if rss is NOT already cached, run a whole bunch of getData() and build the rss feed
        try {

            let url,
                title,
                permalink,
                description;

            switch (action) {
                case "tweet": //comma seperated tweet IDs
                    url = `https://api.twitter.com/2/tweets?ids=${query}`;
                    permalink = "";
                    title = "Tweet(s)";
                    description = "Tweet(s) of: " + query;
                    break;
                case "timeline":
                    query = userLookup(query).data
                    url = "https://api.twitter.com/2/users/" + query.id;
                    permalink = "https://twitter.com/" + query.username;
                    title = "@" + query.username + "'s Updates with " + filterString;
                    description = "Updates from @" + query.username;
                    break;
                case "list":
                    url = `https://api.twitter.com/2/lists/${query}/tweets?max_results=100`;
                    permalink = "https://twitter.com/i/lists/" + query;
                    var listData = await getData(`https://api.twitter.com/2/lists/${query}?expansions=owner_id&user.fields=username`);
                    title = "@" + listData.includes.users[0].username + "'s list: " + listData.data.name + " with " + filterString;
                    description = "Updates from @" + listData.includes.users[0].username + "'s list: " + listData.data.name;
                    break;
                case "search":
                    url = "https://api.twitter.com/2/tweets/search/recent?query=" + encodeURIComponent(query);
                    permalink = "https://twitter.com/search?q=" + encodeURIComponent(query);
                    title = "Twitter Search: " + query + " with " + filterString;
                    description = "Twitter search results for: " + query + ".";
                    break;
                case "likes": //Renamed from favourites to likes
                    // url = "https://api.twitter.com/1.1/favorites/list.json?screen_name=" + query;
                    permalink = "https://twitter.com/" + query + "/likes/";
                    title = "@" + query + "'s Likes with " + filterString;
                    description = "Tweets that @" + query + " liked.";
                    break;
            }

            rss = await rssBuilder(url, title, permalink, description, action, filters, customTitle);

        } catch (e) {
            console.log("Err: ");
            console.log(e);
            return Promise.reject(e);
        }

            await storage.setItem(cacheId, rss, { ttl: 1000 * CACHE_TIME });
            console.log("Saved: " + cacheId);
        } else {
            console.log("Loaded: " + cacheId);
        }

        return rss;

    },

    getData: async function (url) {
        return await getData(url);
    }

}

async function rssBuilder(url, title, permalink, description, action, filters, customTitle) {
    rss = "<?xml version=\"1.0\"?><rss version=\"2.0\"><channel>\n";
    rss += "<title>" + title + "</title>\n";
    rss += "<link>" + permalink + "</link>\n";
    rss += "<description>" + description + "</description>\n";

    switch (action) {
        case "tweet":
        case "list":
            let response = await getData(`${url}&${expansions}`);
            //process tweets for any additional getData(tweet[i].*.id) needed.            
            response = await extendData(response);
            response.filters = filters;
            let tweets = response.data;

            //build the rss
            tweets.forEach((tweet) => {
                if (!v2("checkFilters", tweet, response.filters)) { return; }
                /* From this tweet object, get other tweet objects if they are referenced. */
                let tweetObject = get_tweet(tweet, response, customTitle, true);

                rss += "<item>\n";
                rss += `    <title>${v2("titleBuilder", tweetObject)}</title>\n`;
                rss += `    <pubDate>${tweetObject.created_time}</pubDate>\n`;
                rss += `    <guid>https://twitter.com/${tweetObject.user}/status/${tweetObject.id}</guid>\n`;
                rss += `    <description><![CDATA[\n${v2("descriptionBuilder", tweetObject, response.includes)}\n    ]]></description>\n`;
                rss += "</item>\n";
            });
            break;
        case "timeline":
/*             //TODO: review the options & expansions for this option
                                        //https://api.twitter.com/2/users/username
            var response = await getData(`${url}/tweets?${expansions}&max_results=100`);
            response.filters = filters;
            var tweets = response.data;
            for (var i in tweets) {
                if (!v2("checkFilters", tweets[i], response.filters)) { continue; }
                rss += "<item>";
                rss += "<title>" + v2("includes", response.includes, "users", tweets[i].author_id) + " " + v2("title", response, tweets[i]) + "</title>";
                rss += "<pubDate>" + new Date(tweets[i].created_at).toUTCString() + "</pubDate>";
                rss += "<guid>https://twitter.com/" + v2("includes", response.includes, "users", tweets[i].author_id) + "/status/" + tweets[i].id + "</guid>";
                rss += "<description>";
                //Check if Tweet is RT. If so, get RT'ed Tweet's text instead of using Source Tweet's text.
                //RT'd text are truncated with … if Source Tweet text >= 140 characters (including "RT @USERNAME: ")
                if (tweets[i].referenced_tweets != undefined) {
                    //ignore "retweeted", RTs will be added in v2("getReferenced") later on
                    if (tweets[i].referenced_tweets[0].type != "retweeted") {
                        rss += v2("linkify", tweets[i]);
                    }
                } else {
                    rss += v2("linkify", tweets[i]);
                }
                rss += v2("getAttachments", response, tweets[i]);
                rss += await v2("getReferenced", response, tweets[i]);
                rss += "</description>";
                rss += "</item>";
            }
 */            break;

        case "likes":
/*             //50 tweets compensates for the default 15min RSS fetch interval for when the user goes on a "liking frenzy"
            //TODO: review the options & expansions for this option
            var tweets = await getData(url + "&include_rts=true&tweet_mode=extended&count=50");
            for (var i in tweets) {
                if (!v1_1("checkFilters", tweets[i], filters)) { continue; }
                rss += "<item>";
                //v1.1 API does not have include context tweet information, only the user.
                rss += "<title>" + tweets[i].user.screen_name + " " + v1_1("title", tweets[i]) + "</title>";
                rss += "<pubDate>" + new Date(tweets[i].created_at).toUTCString() + "</pubDate>";
                rss += "<guid>https://twitter.com/" + tweets[i].user.screen_name + "/status/" + tweets[i].id + "</guid>";
                rss += "<description>";
                rss += `<hr>`; //liked tweet
                rss += v1_1("tweetBody", tweets[i]);
                rss += "</description>";
                rss += "</item>";
            }
 */            break;
        case "search":
            /*             //TODO: review the options & expansions for this option
                        var response = await getData(url + "&${expansions}&max_results=100");
                        response.filters = filters;
                        var tweets = response.data;
                        for (var i in tweets) {
                            if (!v2("checkFilters", tweets[i], response.filters)) { continue; }
                            rss += "<item>";
                            rss += "<title>" + v2("includes", response.includes, "users", tweets[i].author_id) + " " + v2("title", response, tweets[i]) + "</title>";
                            rss += "<pubDate>" + new Date(tweets[i].created_at).toUTCString() + "</pubDate>";
                            rss += "<guid>https://twitter.com/" + v2("includes", response.includes, "users", tweets[i].author_id) + "/status/" + tweets[i].id + "</guid>";
                            rss += "<description>";
                            //Check if Tweet is RT. If so, get RT'ed Tweet's text instead of using Source Tweet's text.
                            //RT'd text are truncated with … if Source Tweet text >= 140 characters (including "RT @USERNAME: ")
                            if (tweets[i].referenced_tweets != undefined) {
                                //ignore "retweeted", RTs will be added in v2("getReferenced") later on
                                if (tweets[i].referenced_tweets[0].type != "retweeted") {
                                    rss += v2("linkify", tweets[i]);
                                }
                            } else {
                                rss += v2("linkify", tweets[i]);
                            }
                            rss += v2("getAttachments", response, tweets[i]);
                            rss += await v2("getReferenced", response, tweets[i]);
                            rss += "</description>";
                            rss += "</item>";
                        } */
            break;
    }

    rss += "</channel></rss>";
    return rss;
}

//API functions
function v2(type, ...params) {
    switch (type) {
        case "linkify": return linkifyText(params[0]);
        case "includes": return findIncludes.apply(null, params);
        case "getAttachments": return getTweetAttachments.apply(null, params);
        case "getReferenced": return getReferencedTweets.apply(null, params);
        case "checkFilters": return checkFilters.apply(null, params);
        case "type": return getTweetType.apply(null, params);
        case "titleBuilder": return titleBuilder.apply(null, params);
        case "descriptionBuilder": return descriptionBuilder.apply(null, params);
    }

    function linkifyText(tweet) {
        var text = tweet.text;
        text = text.replace(/\n/gm, ` <br/>\n`);
        if (tweet.entities != undefined) {
            if (tweet.entities.urls != undefined) {
                var urls = tweet.entities.urls;
                for (var i in urls) {
                    if (urls[i].expanded_url != undefined) {
                        if (urls[i].expanded_url.search(/twitter.com\/.*?\/status\/\d+\/(photo|video)\/\d+/g) > -1) {
                            text = text.replace(urls[i].url, ""); //removes twitter.com/i/status/xxx/photo/1 at the end of each tweet with media
                        } else {
                            text = text.replace(urls[i].url, `<a href="${urls[i].expanded_url}">${urls[i].expanded_url}</a>`);
                        }
                    }
                }
            }
        }
        return text;
    }

    function findIncludes(includes, type, val, tweet_id) {
        //returns undefined if not found
        if (includes[type] == undefined) { return undefined; }
        switch (type) {
            case "tweets":
                var res = includes[type].filter(function (inclTweet) {
                    return inclTweet.id == val
                })[0];
                break;
            case "users":
                var user = includes[type].filter(function (inclUser) {
                    return inclUser.id == val
                })[0];
                if (user == undefined) { res = "missing user"; break; }
                var res = user.username;
                break;
            //"media" also exists for URL attachments with playable video.
            case "media":
                var media = includes[type].filter(function (inclMedia) {
                    return inclMedia.media_key == val
                })[0];
                if (media == undefined) { return media; }
                var res = "";
                switch (media.type) {
                    case "photo":
                        res += `<img src="${media.url}">`;
                        break;
                    case "animated_gif":
                    case "video":
                        if (tweet_id != undefined) {
                            // video url not yet implemented into v2 api. using v1.1 workaround
                            // var videoURL = getVideoMediaURL(tweet_id);
                            var videoURL = undefined;
                            let variants = media.variants.sort(function (a, b) { return b.bit_rate - a.bit_rate });
                            for (var i in variants) {
                                if (variants[i].bit_rate != undefined) {
                                    videoURL = variants[i].url;
                                    break;
                                }
                            }

                        }
                        if (tweet_id == undefined || videoURL == undefined) {
                            res = `Video: <img src="${media.preview_image_url}">`;
                        } else {
                            res += `<video controls="controls" poster="${media.preview_image_url}"`;
                            if (media.type == "animated_gif") { res += ` loop="loop"`; }
                            res += ` src="${videoURL}"></video>`;
                        }
                        break;
                }
                break;
            case "polls":
                var poll = includes[type].filter(function (inclPoll) {
                    return inclPoll.id == val
                })[0];
                if (poll == undefined) { res = "missing poll"; break; }
                var res = poll.options;

                break;
        }
        return res;
    }

    function getTweetAttachments(includes, tweet) {
        //check for attachments (photo, animated_gif, video, poll, link previews (NOTE: Inconsistent results in timeline endpoint, to be added.))
        //Don't use "unwound_url" to check for link preview as some links in tweet text also contain "unwound_url"
        let attch = "";
        //media
        if (tweet.attachments != undefined) {
            if (tweet.attachments.poll_ids != undefined) {
                attch += `<table><tr><th><b><u>Poll</u></b></th></tr>`;
                let pollItems = findIncludes(includes, "polls", tweet.attachments.poll_ids[0], tweet.id);
                if (pollItems != undefined) {
                    for (let i in pollItems) {
                        attch += `<tr><td><a href="https://twitter.com/i/status/${tweet.id}">${pollItems[i].label}</a></td></tr>`;
                    }
                    attch += `</table>`;
                } else {
                    attch += `<br><a href="https://twitter.com/i/status/${tweet.id}">POLL</a>`;
                }
            }
            if (tweet.attachments.media_keys != undefined) {
                for (let i in tweet.attachments.media_keys) {
                    let attchTmp = findIncludes(includes, "media", tweet.attachments.media_keys[i], tweet.id);
                    if (attchTmp != undefined) {
                        attch += "<br>"; //Puts video/picture on newline to prevent tall media breaking up text flow
                        attch += attchTmp;
                    } else {
                        attch += `<br><a href="https://twitter.com/i/status/${tweet.id}">ATTACHMENT</a>`;
                    }
                }
            }
        }
        return attch;
    }

    function getReferencedTweets(data, tweet, customTitle) {
        var res = {};
        if (tweet.referenced_tweets != undefined) { //check if "retweet", "quoted" or "replied_to" object(s) exists. If none found then it is plain tweet.
            for (let i in tweet.referenced_tweets) {
                let refTweet = findIncludes(data.includes, "tweets", tweet.referenced_tweets[i].id);//get tweet object of the referenced_tweet (RT'd, QT'd or replied to)
                if (refTweet != undefined) {
                    /*
                    Four different possibilities:
                    Retweeted <= Contains partial data of the Referenced tweet. getData the referenced tweet IS required.
                    Replied to
                    incl. Quote Tweet
                    Replied to WITH Quote Tweet.
                    */
                    if (tweet.referenced_tweets[i].type == "replied_to") {
                        res["replied_to"] = get_tweet(refTweet, data, customTitle); //force get referenced_Tweets for the replied_to tweet to get quoted if exists.

                        let repliedtos_qt = refTweet.referenced_tweets?.filter((referenced_tweet) => { return referenced_tweet.type === "quoted" });
                        if (repliedtos_qt != undefined && repliedtos_qt.length > 0) {
                            if (res["replied_to"].referenced_tweets === undefined) { res["replied_to"].referenced_tweets = {}; }
                            res["replied_to"].referenced_tweets["quoted"] = get_tweet(findIncludes(data.includes, "tweets", repliedtos_qt.id), data, customTitle);
                        }
                    }
                    if (tweet.referenced_tweets[i].type == "retweeted") {
                        res["retweeted"] = get_tweet(refTweet, data, customTitle);

                        if (refTweet.referenced_tweets) {
                            refTweet.referenced_tweets.forEach((referenced_tweet) => {
                                if (res["retweeted"].referenced_tweets === undefined) { res["retweeted"].referenced_tweets = {}; }
                                if (referenced_tweet.type == "replied_to") {
                                    res["retweeted"].referenced_tweets["replied_to"] = get_tweet(findIncludes(data.includes, "tweets", referenced_tweet.id), data, customTitle);
                                }
                                if (referenced_tweet.type == "quoted") {
                                    res["retweeted"].referenced_tweets["quoted"] = get_tweet(findIncludes(data.includes, "tweets", referenced_tweet.id), data, customTitle);
                                }
                            });
                        }
                    }
                    if (tweet.referenced_tweets[i].type == "quoted") {
                        res["quoted"] = get_tweet(refTweet, data, customTitle);
                    }
                } else {
                    if (tweet.referenced_tweets[i].type == "replied_to") {
                        res["replied_to"] = undefined;
                    }
                    if (tweet.referenced_tweets[i].type == "retweeted") {
                        res["retweeted"] = undefined;
                    }
                    if (tweet.referenced_tweets[i].type == "quoted") {
                        res["quoted"] = undefined;
                    }
                }
            }
        }
        return res;
    }

    function checkFilters(tweet, filters) {
        //Return true if tweet passes, else false.
        result = false;
        //check "tweets,retweets,replies"
        if (tweet.referenced_tweets != undefined) {
            var refTweet = tweet.referenced_tweets[tweet.referenced_tweets.length - 1];
            switch (refTweet.type) {
                case "replied_to":
                    if (filters.includes("replies")) {
                        result = true;
                    }
                    break;
                case "retweeted":
                    if (filters.includes("retweets")) {
                        result = true;
                    }
                    break;
                case "quoted":
                    if (filters.includes("tweets")) {
                        result = true;
                    }
                    break;
            }
        } else {
            if (filters.includes("tweets")) {
                result = true;
            }
        }

        //if "tweets,retweets,replies" passes, check "attachments,text"
        if (result && tweet.attachments != undefined && filters.includes("attachments")) {
            result = true;
        } else if (result && filters.includes("text")) {
            result = true;
        } else { result = false; }
        return result;
    }

    function getTweetType(tweet, customTitle) {
        var res = {};
        if (tweet.referenced_tweets != undefined) {
            // Chooses "replied_to" when ["quoted", "replied_to"] or more than one entries is available. This happens when a user replies to a tweet with a quote tweet.
            //It is not possible to have a "retweet" AND either or both of "quoted" and "replied_to".
            var refTweet = tweet.referenced_tweets[tweet.referenced_tweets.length - 1];
            if (refTweet.type === "replied_to") {
                switch (customTitle) {
                    case "plain": res = { "past_tense": "replied to", "present_tense": "reply" }; break;
                    case "short": res = { "past_tense": "RE'd", "present_tense": "RE" }; break;
                    case "emojify": res = { "past_tense": "💬'd", "present_tense": "💬" }; break;
                    case "both": res = { "past_tense": "💬 RE'd", "present_tense": "💬 RE" }; break;
                }
            } else if (refTweet.type === "retweeted") {
                switch (customTitle) {
                    case "plain": res = { "past_tense": "retweeted", "present_tense": "retweet" }; break;
                    case "short": res = { "past_tense": "RT'd", "present_tense": "RT" }; break;
                    case "emojify": res = { "past_tense": "🔃'd", "present_tense": "🔃" }; break;
                    case "both": res = { "past_tense": "🔃 RT'd", "present_tense": "🔃 RT" }; break;
                }
            }
            else if (refTweet.type === "quoted") {
                switch (customTitle) {
                    case "plain": res = { "past_tense": "quote tweeted", "present_tense": "quote tweet" }; break;
                    case "short": res = { "past_tense": "QRT'd", "present_tense": "QRT" }; break;
                    case "emojify": res = { "past_tense": "💬🔃'd", "present_tense": "💬🔃" }; break;
                    case "both": res = { "past_tense": "💬🔃 QRT'd", "present_tense": "💬🔃 QRT" }; break;
                }
            }
        } else { res = { "past_tense": "tweeted", "present_tense": "tweet" } }
        return res;
    }

    function titleBuilder(tweet) {
        let title = "";
        if (tweet.locked) { title += "🔒"; }
        title += `@${tweet.user} ${tweet.type.past_tense}`; //@User1 tweet typed
        if (tweet.referenced_tweets != undefined) { //+ @User2's tweet type
            if (tweet.referenced_tweets["retweeted"]) { title += ` @${tweet.referenced_tweets["retweeted"].user}'s ${tweet.referenced_tweets["retweeted"].type.present_tense}`; }
            else if (tweet.referenced_tweets["replied_to"]) { title += ` @${tweet.referenced_tweets["replied_to"].user}'s ${tweet.referenced_tweets["replied_to"].type.present_tense}`; }
            else if (tweet.referenced_tweets["quoted"]) { title += ` @${tweet.referenced_tweets["quoted"].user}'s ${tweet.referenced_tweets["quoted"].type.present_tense}`; }
        }
        return title;
    }

    function descriptionBuilder(tweet) {
        let res = "";
        if (tweet.referenced_tweets?.["retweeted"]) {
            tweet = tweet.referenced_tweets["retweeted"]; //override current tweet with retweeted tweet
        }
        res += tweet.body + "\n" + tweet.attachments;

        if (tweet.referenced_tweets?.["quoted"]) { //include QT if included in plain tweet / tweet reply
            res += `\n<hr><h3><a href="https://twitter.com/${tweet.referenced_tweets["quoted"].user}/status/${tweet.referenced_tweets["quoted"].id}">@${tweet.user} quoted @${tweet.referenced_tweets["quoted"].user}'s ${tweet.referenced_tweets["quoted"].type.present_tense}:</a></h3>\n`;
            res += tweet.referenced_tweets["quoted"].body + "\n" + tweet.referenced_tweets["quoted"].attachments;
        }
        res += `\n<hr><hr>\n`; //end tweet

        if (tweet.referenced_tweets?.["replied_to"]) { //replied to tweet for context
            res += `\n<h3><a href="https://twitter.com/${tweet.referenced_tweets["replied_to"].user}/status/${tweet.referenced_tweets["replied_to"].id}">Replying to @${tweet.referenced_tweets["replied_to"].user}'s ${tweet.referenced_tweets["replied_to"].type.present_tense}:</a></h3>\n`;
            res += tweet.referenced_tweets["replied_to"].body + "\n" + tweet.referenced_tweets["replied_to"].attachments;
            //include replied_to's QRT
            if (tweet.referenced_tweets["replied_to"].referenced_tweets?.quoted) {
                let repliedtos_qt = tweet.referenced_tweets["replied_to"].referenced_tweets.quoted;
                res += `\n<hr><h3><a href="https://twitter.com/${repliedtos_qt.user}/status/${repliedtos_qt.id}">@${tweet.referenced_tweets["replied_to"].user} quoted @${repliedtos_qt.user}'s ${repliedtos_qt.type.past_tense}:</a></h3>\n`;
                res += repliedtos_qt.body + "\n" + repliedtos_qt.attachments;
            }
            res += `\n<hr><hr>\n`; //end replied to tweet
        }
        return res;
    }
}

function get_tweet(tweet, data, customTitle, get_referenced) {
    if (tweet === undefined) { return undefined; }
    let res = {};

    if (get_referenced) {
        res["referenced_tweets"] = v2("getReferenced", data, tweet, "plain"); //object including either of "replied_to", "retweeted" and/or "quoted" tweets, each with get_tweet() object.
    }
    // if (tweet.in_reply_to_user_id != undefined) {
    //     res["in_reply_to_user"] = v2("includes", data.includes, "users", tweet.in_reply_to_user_id);
    // }

    res["id"] = tweet.id;
    res["created_time"] = new Date(tweet.created_at).toUTCString();
    res["user"] = v2("includes", data.includes, "users", tweet.author_id); //creator of tweet
    res["locked"] = data.includes["users"].filter(function (user) { return user.id == tweet.author_id })[0].protected;
    res["type"] = v2("type", tweet, customTitle); //{ "past_tense": "tweeted", "present_tense": "tweet" }
    res["body"] = v2("linkify", tweet);
    res["attachments"] = v2("getAttachments", data.includes, tweet);
    res["has_quote_id"] = tweet.referenced_tweets?.quoted?.id; //short circuit evaluation. returns either undefined or the quote tweet's id.

    //TESTME potential recursive loop at res["referenced_tweets"] - fixed by checking for get_referenced flag
    // res["referenced_tweets"] = undefined;
    //FIXME Finish off get_tweet so that refTweet is in here, not in rssBuilder.
    return res;
}

async function userLookup(username) {
    var user = await getData("https://api.twitter.com/2/users/by/username/" + username);
    return user;
}

async function getUsernamebyID(id) {
    var user = await getData("https://api.twitter.com/2/users/" + id);
    return user.data?.username;
}

async function extendData(initialResponse) {
    let ids = new Set(); //forces a list of unique tweet IDs to be fetched later
    initialResponse.data.forEach((tweet) => {
        if (tweet.referenced_tweets != undefined) { //check if "retweet", "quoted" or "replied_to" object(s) exists. If none found then it is plain tweet.
            for (let i in tweet.referenced_tweets) {
                let refTweet = v2("includes", initialResponse.includes, "tweets", tweet.referenced_tweets[i].id);//get tweet object of the referenced_tweet (RT'd, QT'd or replied to)
                if (refTweet != undefined) {
                    ids.add(refTweet.id);
                    if (refTweet.referenced_tweets != undefined) {
                        refTweet.referenced_tweets.forEach((referenced_refTweet) => {
                            ids.add(referenced_refTweet.id) //quoted and/or replied_to
                        });
                    }
                }
            }
        }
    });

    if (ids.size > 0) {
        var idsArr = [];
        let i = 0;
        idsArr[i] = [];
        ids.forEach((val) => {
            if (idsArr[i].length > 99) {
                i++;
                idsArr[i] = [];
            }
            idsArr[i].push(val);
        });

        for (let ii = 0; ii < idsArr.length; ii++){
            const secondResponse = await getData(`https://api.twitter.com/2/tweets?ids=${idsArr[ii].toString()}&${expansions}`);
            if (secondResponse.includes != undefined) {
                for (let i in secondResponse.includes) { //"users", "tweets", "media", "polls"
                    if (initialResponse.includes[i] != undefined) { //if includes exists in initialResponse
                        if (i === "tweets") {
                            initialResponse.includes[i] = initialResponse.includes[i].concat(secondResponse.data);
                        }
                        if (secondResponse.includes[i] != undefined) {
                            initialResponse.includes[i] = initialResponse.includes[i].concat(secondResponse.includes[i]);
                        }
                    } else {

                        initialResponse.includes[i] = [];
                        if (i === "tweets") {
                            initialResponse.includes[i] = initialResponse.includes[i].concat(secondResponse.data);
                        }
                        initialResponse.includes[i] = initialResponse.includes[i].concat(secondResponse.includes[i]);
                    }
                }
            }
        }
    }

    return initialResponse;
}

function getOAuth() {
    return new OAuth.OAuth(
        'https://api.twitter.com/oauth/request_token',
        'https://api.twitter.com/oauth/access_token',
        process.env.TWITTER_CONSUMER_KEY,
        process.env.TWITTER_CONSUMER_SECRET,
        '1.0A', null, 'HMAC-SHA1'
    );
}

async function getData(url) {

    console.log("getData: " + url);
    const get = promisify(oauth.get.bind(oauth));

    let body;
    try {
        body = await get(
            url,
            process.env.TWITTER_ACCESS_KEY,
            process.env.TWITTER_ACCESS_TOKEN_SECRET
        );
    } catch (e) {
        console.log("getData failed: \n" + JSON.stringify(e));
        return Promise.reject(e);
    }
    return JSON.parse(body);
    // var response = await getData(url);
}