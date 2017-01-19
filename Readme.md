# News App (MARIO project)

This app is written in Node.JS and it:

1. queries a local mongoDB database for news
2. queries feedly API for RSS feeds, and then parses them for news

It is mean to communicate via SSE/Marvin only:

1. it subscribes to task manager
2. when task manager sends message to the app to start it:
3. creates a topic (/marvin/eventbus/topics/news) if it doesn't exist
4. it publishes to it the resources it requires for the task manager to notify them to start listening to the app's topic
3. it controlls the resources via properly formated messages

## Functionality

It will reply in a **stream** of **multiple** messages, by using:

```json
{
    "replyId" : "uid",
    "reply"     : [
                    {
                        "author"    : "...",
                        "title"     : "...",
                        "content"   : "...",
                        "published" : "...",
                        "lang"      : "...",
                    },
                    { ... }
                  ]
}
```

*Notes*: 
The `content` might contain HTML entities.

