# Twitter2RSS
 
A NodeJS app for converting Twitter inputs (User Timeline, Lists, Search and User Likes) into an RSS feed using Twitter's API v2.

## Installation & Running the app
**Prerequisites**
```
Twitter Developer account with consumer (API) and read-only access keys.
NodeJS 12 or greater, with npm installed.
```
1. Create your `.env` file from the included `.env.example` file.
   ```
    TWITTER_CONSUMER_KEY = "Twitter_API_Key"
    TWITTER_CONSUMER_SECRET = "Twitter_API_Secret"
    TWITTER_ACCESS_KEY = "Twitter_OAuth1.0a_Access_key"
    TWITTER_ACCESS_TOKEN_SECRET = "Twitter_OAuth1.0a_Access_secret"
    key = "Your personal key for securing feeds from your Twitter authentication."
    PORT = Remove this line for the default port (3000) or set your own (80)
   ```

2. Change directory to the root of this repo and install the dependencies. Then, run the app.
   ```
   $ cd ./Twitter2RSS
   $ node install
   $ node app.js
   ```

3. Navigate to RSS link builder:
   ```
   localhost:3000/?key=your_key_here
   ```

## Docker
1. Build your `.env` file, but do not set the port.
2. Build the Docker image tagged `twitter2rss`:
   ```
   $ cd ./Twitter2RSS
   $ docker build -t twitter2rss .
   ```
3. Run the `twitter2rss` image in a container, then access it at `localhost:3000`:
   ```
   $ docker run -d -P twitter2rss
   ```
   Alternatively, map the container port to your host to change the port it's accessed on:
   ```
   $ docker run -d -p PORT:3000 twitter2rss
   ```
   Omit the `-d` to make it run in the CLI.

___
## Notes
For debugging purposes, the `/api` endpoint is used for querying Twitter's API. This can be enabled by setting `DEBUG` to `true` in your `.env` file. Authentication with `key` parameter is _not_ required. To use this, put anything _after_ the `api.twitter.com/` as the query parameter. For example:
```
localhost:3000/api?2/tweets?ids=1460323737035677698,1519781379172495360,1519781381693353984&expansions=author_id
```

Additionally, the `tweet` feed type is available with all the other feed options included to test how a tweet is displayed in a feed reader. This is considered a feedtype and so does not need to be enabled via the `DEBUG` environment variable, and as such authentication with `key` parameter _is_ required.
```
localhost:3000/rss?q=1460323737035677698,1519781379172495360,1519781381693353984&action=tweet&filters=tweets,replies,retweets,attachments,text&title=plain
```