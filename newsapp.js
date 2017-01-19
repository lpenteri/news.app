#!/usr/bin/node
var http = require('http'),
    fs = require('fs'),
    mongo  = require('mongodb'),
    MongoClient = mongo.MongoClient,
    assert = require('assert');
const url = require("url");
const querystring = require("querystring");
var Gettext = require("node-gettext");
var gt = new Gettext();
var english = fs.readFileSync("./locales/en-GB/messages.pot");
var italian = fs.readFileSync("./locales/it-IT/messages.pot");
gt.addTextdomain("en-GB", english);
gt.addTextdomain("it-IT", italian);

var conf = require('./conf');
var eventclient  = require("./eventclient");
var feedlyclient = require('./feedlyclient.js');


/**
 * \class news app
 * \version 0.3.0
 * \date December 2016
 * \author lazaros penteridis <lp@ortelio.co.uk>
 */
function newsapp()
{
    this.marvin  = new eventclient(conf.marvin_ip, conf.marvin_port);
    this.topic = "news";
    this.subscriber = "news_app";
    this.resources = ["UI"];
    this.resources_topics = ["UIEvents", "UCEvents"];
    this.ui_subscribed = false;
    this.img_folder = "./img";

    this.crawler = new feedlyclient();
}

/**
 * \brief initialization steps the app must follow when the start message from the task manager comes
 *        register for news topic, create as needed
 * \param resources (optional) is an array of stings with the resources that required the app, so the app
 *        needs to subscribe to their topics.
 */
newsapp.prototype.init = function(resources)
{
    var self = this;

    self.marvin.get_topics(function(json)
    {
        var exists = false;
        var topics = [];
        try 
        {
            topics = JSON.parse(json);
        }
        catch (e) 
        {
            console.log('init/parse error: ' +e);
            console.log(json);
        }
        for (var i = 0; i < topics.length; i++) 
        {
            if (topics[i] === self.topic) 
            {
                exists = true;
            }
        }
        if (!exists) {
            self.marvin.new_topic(self.topic, function(ok)
            {
                if (ok) 
                {
                    console.log(self.topic + ' created successfully.');
                }
                else 
                {
                    console.log('failed to create topic: ' + self.topic + ' aborting...');
                    return;
                }
            });
        }
        else 
        {
//          throw self.topic + ' existed already.';
            console.log(self.topic + ' existed already.');
        }
    });
}


/**
 * \brief initialization steps the app must follow when the message from the task manager saying that he is 
 *        subscribed to the app's topic comes. The app replies with the components it requires to work properly.
 * \param id Task manager subscribed message id, in order to be used as correlation id to the reply message.
 */
newsapp.prototype.start = function(id)
{
    var self = this;

    // post message with the resources the app requires for the task manager to consume it and start them
    var json = {};
    json.correlationId = id;
    var body = {};
    body.targets = ["taskmanager"];
    body.resources = self.resources;
    json.body = JSON.stringify(body);
    self.post(json,
        function()
        {
            console.log("successfully posted: " + JSON.stringify(json));
        },
        function(error)
        {
            console.log("post failed: " + JSON.stringify(json) + "\nerror code: " + error);
        });

    // try to subscribe to all topics of the required resources in order to be able to use them
    if (self.resources_topics.length) 
    {
        self.marvin.get_topics(function(json) 
        { 
            for (i = 0; i<self.resources_topics.length; i++) 
            {
                self.search_n_sub(self.resources_topics[i], json);
            }
        });
    }

    // post message asking the UI for the required config parameters and wait for a reply to get these
    // parameters and to know that the UI subscribed in the app's topic
    // message format { "action" : "sendconfig",
    //                  "configs" : ["username", "locale", "news_topics"] }
    json = {};
    var body = {};
    body.targets = ["UI"];
    body.action = "sendconfig";
    body.configs = ["username", "locale", "news_topics"];
    json.body = JSON.stringify(body);
    self.post(json,
        function()
        {
            console.log("successfully posted: " + JSON.stringify(json));
        },
        function(error)
        {
            console.log("post failed: " + JSON.stringify(json) + "\nerror code: " + error);
        });
    var interval = setInterval(function()
    { 
        if(self.ui_subscribed === true) {
            clearInterval(interval);
            return;
        }
        self.post(json,
            function()
            {
                console.log("successfully posted: " + JSON.stringify(json));
            },
            function(error)
            {
                console.log("post failed: " + JSON.stringify(json) + "\nerror code: " + error);
            });
    }, 1000);      
}


/**
 * \brief initialization steps the app must follow when the message from the task manager asking it to stop comes.
 *        The app unsubscribes from all topics except taskmanager, posts a message that it stopped and deletes
 *        its topic.
 * \param id Task manager subscribed message id, in order to be used as correlation id to the reply message.
 */
newsapp.prototype.stop = function(id)
{
    var self = this;

    if (self.resources_topics.length) 
    {
        for (i = 0; i < self.resources_topics.length; i++) 
        {
            var current_topic;
            self.marvin.unsubscribe(current_topic=self.resources_topics[i], self.subscriber, function(ok)
            {
                if (ok) 
                {
                    console.log(self.subscriber + ' successfully unsubscribed from topic ' + current_topic);
                }
                else 
                {
                    throw self.subscriber + ' failed to unsubscribe from topic: ' + current_topic;
                }
            });
        }
    }

    var json = {};
    json.correlationId = id;
    var body = {};
//    body.targets = ["taskmanager"];
    body.state = "stopped";
    json.body = JSON.stringify(body);
    self.post(json,
        function()
        {
            console.log("successfully posted: " + JSON.stringify(json));
            // The message that the app stopped was sent successfully, so now we can delete the topic
            self.marvin.del_topic(self.topic, function(ok)
            {
                if (ok) 
                {
                    console.log(self.topic + ' deleted successfully.');
                    self.ui_subscribed = false;
                }
                else 
                {
                    throw 'failed to delete topic: ' + self.topic + ' aborting...';
                }
            });
        },
        function(error)
        {
            console.log("post failed: " + JSON.stringify(json) + "\nerror code: " + error);
        });
}


/// \brief publish a message to the topic of the app after ensuring its existence
/// \param json the json object to be passed to eventclient.publish in order to be posted
newsapp.prototype.post = function(json, on_success, on_failure)
{
    var self = this;

    self.marvin.get_topics(function(topics_json)
    {
        var exists = false;
        var topics = [];
        try 
        {
            topics = JSON.parse(topics_json);
        }
        catch (e) 
        {
            console.log('init/parse error: ' +e);
            console.log(topics_json);
        }
        for (var i = 0; i < topics.length; i++) 
        {
            if (topics[i] === self.topic) 
            {
                exists = true;
            }
        }
        if (exists) {
            self.marvin.publish(self.topic, json, on_success, on_failure);
        }
        else
        {
            throw self.topic + " no longer exists.";
        }
    });
}


/**
 * \brief process a new message and pass it to the appropriate function depending on who sent it
 */
newsapp.prototype.msg_proc = function(message, topic)
{
    var self = this;

    // split the message into an array using the newline(s)
    var list = message.split("\n\n").filter(function(el){return el.length !== 0;});
    // get the last message from the marvin queue
    var last = list[list.length - 1];
    // remove the first 6 characters (`data =`)
    message = last.substring(6);
    var data = null;

    // parse message
    try
    {
        var data = JSON.parse(message);
    }
    catch(e)
    {
        console.log('parse error: ' + e);
        console.log(message);
    }
    if (topic === "taskmanager")
    {
        self.tm_msg(data);
    }
    else if (topic === "UIEvents" || topic === "UCEvents")
    {
        self.ui_msg(data);
    }
}


/**
 * \brief process and take proper action concerning messages from the taskmanager topic
 * \param data the data property of the message.
 */
newsapp.prototype.tm_msg = function(data)
{
    var self = this;

    if (data.hasOwnProperty("messageId"))
    {
        var msg_id = data.messageId;
    }
    
    if (data.hasOwnProperty("body")) 
    {
        var body = JSON.parse(data.body);
        if (body.hasOwnProperty("ability") && (body.ability === self.topic)) {
            if (body.hasOwnProperty("command"))
            {
                if ((body.command === "start") && !body.hasOwnProperty("resources"))
                {
                    self.init();
                }
                else if ((body.command === "start") && body.hasOwnProperty("resources"))
                {
                    self.init(body.resources);
                }
                else if (body.command === "stop")
                {
                    self.stop(msg_id);
                }    
            }
            else if (body.hasOwnProperty("state"))
            {
                if (body.state === "subscribed")
                {
                    self.start(msg_id);
                }
                else if (body.state !== "running")
                {
                    console.log("Wrong message format. Unknown state.");
                }
            }
            else
            {
                console.log("Wrong message format. No command or state.");
            }
        }
    }
    else 
    {
        console.log('Wrong message format. No `body` found.');
    }
}

/**
 * \brief process and take proper action concerning messages from the UIEvents topic
 * \param data the data property of the message.
 */
newsapp.prototype.ui_msg = function(data)
{
    var self = this;

    if (data.hasOwnProperty("body")) 
    {
        var body = JSON.parse(data.body);

        // check JSON format and members 
//        if (body.hasOwnProperty("event") && body.hasOwnProperty("ability") && (body.ability === self.topic))
        if (body.hasOwnProperty("ability") && (body.ability === self.topic))
        {
//            if (body.event === "touch" || body.event === "speak")
//            {
                if (body.hasOwnProperty("action"))
                {
                    var act_url = url.parse(body.action);
                    var action = act_url.pathname;
                    var act_params = querystring.parse(act_url.query);
                    if (action === "homescreen")
                    {
                        var json ={};
                        var body = {};
                        body.targets = ["UI"];
                        body.action = "showoptions";
                        body.heading = gt.dgettext(self.locale, "What would you like to do?");
                        var options = [];
                            
                        var temp = {};
                        temp.name = gt.dgettext(self.locale, "Read all headlines?");
                        temp.img = "/_img/mario/news-icon.png";
                        temp.action = "showheadlines";
                        temp.keywords = gt.dgettext(self.locale, "all_headlines_keywords").split(', ');
                        options.push(temp);

                        temp = {};
                        temp.name = gt.dgettext(self.locale, "Select a topic of news?");
                        temp.img = "/_img/mario/select.jpg";
                        temp.action = "selecttopic";
                        temp.keywords = gt.dgettext(self.locale, "select_topic_keywords").split(', ');
                        options.push(temp);

                        body.options = options;
                        json.body = JSON.stringify(body);

                        self.post(json,
                            function()
                            {
                                console.log("successfully posted: " + JSON.stringify(json));
                            },
                            function(error)
                            {
                                console.log("post failed: " + JSON.stringify(json) + "\nerror code: " + error);
                            });
                    }
                    else if (action === "selecttopic")
                    {
                        MongoClient.connect(conf.mongodb, function(err, db)
                        {
                            assert.equal(null, err);
                            console.log("Connected successfully to the db server");
                            var json ={};
                            var body = {};
                            body.targets = ["UI"];
                            body.action = "showoptions";
                            body.heading = gt.dgettext(self.locale, "Which topic would you like to read about?");
                            var options = [];
                            var temp = {};
                            for (var i=0; i < self.news_topics.length; i++)
                            {
                                temp = {};
                                temp.name = gt.dgettext(self.locale, self.news_topics[i]) + "? ";
                                temp.img = "/_img/mario/news-icon.png";
                                temp.action = "showheadlines?topic=" + gt.dgettext(self.locale, self.news_topics[i]);
                                temp.keywords = gt.dgettext(self.locale, [self.news_topics[i]]);
                                options.push(temp);
                            }

                            for (var i=0; i<self.feeds.length; i++)
                            {
                                temp = {};
                                temp.name = gt.dgettext(self.locale, self.feeds[i].tags[0]) + "? ";
                                temp.img = "/_img/mario/news-icon.png";
                                temp.action = "showheadlines?feed=" +  self.feeds[i].rss;
                                temp.keywords = gt.dgettext(self.locale, self.feeds[i].tags[0]);
                                options.push(temp);
                            }

                            body.options = options;
                            json.body = JSON.stringify(body);
                            self.post(json,
                                function()
                                {
                                    console.log("successfully posted: " + JSON.stringify(json));
                                },
                                function(error)
                                {
                                    console.log("post failed: " + JSON.stringify(json) + "\nerror code: " + error);
                                });    
                            db.close();
                        });
                    }
                    else if (action === "showheadlines")
                    {
                        var actual_keywords = [];    
                        if ('feed' in act_params) {
                            for (var i = 0; i < self.feeds.length; i++) {
                                if (self.feeds[i].rss == act_params['feed'])
                                    actual_keywords = self.feeds[i].tags;
                            }
                            self.crawler.parse_feed(act_params['feed'], self.locale, 
                                function(news)
                                {
                                    for (var i = 0; i < news.length; i++) {
                                        // add a saved field with default false value to each news document
                                        news[i].saved = false;
                                        news[i].keywords = actual_keywords;
                                    }
                                    self.save_and_post(news, actual_keywords, conf.mongodb);
                                }
                            );
                        }
                        else {
                            var keywords = [gt.dgettext(self.locale, "latest")];
                            keywords.push(act_params["topic"]);
                            actual_keywords.push(act_params["topic"]);
                            keywords.push(gt.dgettext(self.locale, "news"));
                            var search = keywords.join("+");
                            var sources_num = 5;
                            var all_news = [];
                            var j = 0;
                            var lengths = [];
                            // NOTE - multiple published messages **may** be provided
                            //      - Marvin seems to have a BUG with large text.
                            //        when I strip from news the content I get no errors.
                            self.crawler.search(search, self.locale, sources_num,
                                function(news)
                                {
                                    lengths.push(news.length);
                                    j++;
                                    for (var i = 0; i < news.length; i++) {
                                        // add a saved field with default false value to each news document
                                        news[i].saved = false;
                                        if (actual_keywords.length)
                                            news[i].keywords = actual_keywords;
                                    }
                                    all_news = all_news.concat(news);
                                    if (j === sources_num) {
                                        var multiplexed_news = self.multiplex_news(all_news, lengths);
                                        self.save_and_post(multiplexed_news, actual_keywords, conf.mongodb);   
                                    }
                                },
                                function(error)
                                {
                                    console.log(error);
                                    MongoClient.connect(conf.mongodb, function(err, db)
                                    {
                                        assert.equal(null, err);
                                        console.log("Connected successfully to the db server");
                                        var json = {};
                                        var body = {};
                                        body.targets = ["UI"];
                                        body.action = "showheadlines";
                                        body.heading = gt.dgettext(self.locale, "News headlines");
                                        var headlines = [];
                                        self.db_find_news(db, actual_keywords, self.locale, function(news) 
                                        {
                                            for (var i = 0; i < news.length; i++) {
                                                if (i>=20)
                                                    break;
                                                var temp = {};
                                                temp.text = news[i].title; 
    //                                          temp.img = "/_img/mario/news/" + ".png";
                                                temp.author = news[i].author;
                                                temp.published = news[i].published;
                                                temp.action = "showarticle?id=" + news[i]._id;
                                                temp.keywords = news[i].title.split(" ");
                                                headlines.push(temp);
                                            }
                                            body.headlines = headlines;
                                            json.body = JSON.stringify(body);
                                            self.post(json,
                                                function()
                                                {
                                                    console.log("successfully posted: " + JSON.stringify(json));
                                                },
                                                function(error)
                                                {
                                                    console.log("post failed: " + JSON.stringify(json) + "\nerror code: " + error);
                                                });
                                            db.close();
                                        });
                                    });
                                }
                            );
                        }
                    }
                    else if (action === "showarticle")
                    {
                        MongoClient.connect(conf.mongodb, function(err, db)
                        {
                            assert.equal(null, err);
                            console.log("Connected successfully to the db server");
                            var news_col = db.collection('news');
                            var o_id = new mongo.ObjectID(act_params.id);
                            news_col.findOne({_id: o_id }, function(err, doc) 
                            {
                                if (err)
                                    console.log(err); 
                                else 
                                {
                                    var json ={};
                                    var body = {};
                                    body.targets = ["UI"];
                                    body.action = "showarticle";
                                    body.title = doc.title;
                                    body.author = doc.author;
                                    body.published = doc.published;
                                    body.text = doc.content;
                                    body.saved = doc.saved;
                                    body.saveaction = "togglesave?id=" + o_id;
            //                      body.img = "/_img/mario/news/" + ".png";
                                    if (doc.keyword)
                                        body.nextaction = "showheadlines?topic=" + doc.keyword[0];
                                    else
                                        body.nextaction = "showheadlines";
                                    json.body = JSON.stringify(body);

                                    self.post(json,
                                        function()
                                        {
                                            console.log("successfully posted: " + JSON.stringify(json));
                                        },
                                        function(error)
                                        {
                                            console.log("post failed: " + JSON.stringify(json) + "\nerror code: " + error);
                                        });
                                }
                                db.close();
                            });
                        });
                    }
                    else if (action === "togglesave")
                    {
                        MongoClient.connect(conf.mongodb, function(err, db)
                        {
                            assert.equal(null, err);
                            console.log("Connected successfully to the db server");
                            var news_col = db.collection('news');
                            var o_id = new mongo.ObjectID(act_params.id);
                            news_col.findOne({_id: o_id}, function(err, doc) 
                            {
                                if (err)
                                    console.log(err); 
                                else 
                                {
                                    doc.saved = !doc.saved;
                                    news_col.updateOne(
                                        {"_id": o_id},
                                        doc,
                                        {upsert: true},
                                        function(error)
                                        {
                                            if (error)
                                                console.log(error);
                                            else 
                                                console.log("succesfully changed article saved status");
                                            db.close();
                                        }
                                    );
                                }
                            });
                        });
                    }
                }
/*              else
                {
                    console.log("Wrong message format. Action property missing.");
                }
            } */
//            else if (body.event === "config")
            if (body.event === "config")
            {
                self.ui_subscribed = true;
//                var update_obj = {};
                if (body.hasOwnProperty("username"))
                {
                    self.username = body.username;
//                    update_obj.username = body.username;
                }

/*                if (body.hasOwnProperty("locale"))
                {
                    update_obj.locale = body.locale;
                }
                if (body.hasOwnProperty("news_topics"))
                {
                    update_obj.topics = body.news_topics;
                //    update_obj.topics = body.news_topics.split(', ');
                }
                if (body.hasOwnProperty("feeds"))
                {
                    update_obj.feeds = body.feeds;
                }
*/
                MongoClient.connect(conf.mongodb, function(err, db)
                {
                    assert.equal(null, err);
                    console.log("Connected successfully to the db server");
                    var collection = db.collection("users");
/*                    collection.updateOne(
                        {"username": self.username},
                        update_obj,
                        {upsert: true},
                        function()
                        {
 */
					collection.findOne({"username": self.username}, function(err, doc) {
						assert.equal(err, null);
						self.locale = doc.locale;
						self.news_topics = doc.topics;
						self.feeds = doc.feeds;
						db.close();
					});
/*                        }
                    );
 */
                });
                var json ={};
                var body = {};
                body.targets = ["UI"];
                body.action = "showoptions";
                body.heading = gt.dgettext(self.locale, "What would you like to do?");
                var options = [];

                var temp = {};
                temp.name = gt.dgettext(self.locale, "Read all headlines?");
                temp.img = "/_img/mario/news-icon.png";
                temp.action = "showheadlines";
                temp.keywords = gt.dgettext(self.locale, "all_headlines_keywords").split(', ');
                options.push(temp);
                
                temp = {};
                temp.name = gt.dgettext(self.locale, "Select a topic of news?");
                temp.img = "/_img/mario/select.jpg";
                temp.action = "selecttopic";
                temp.keywords = gt.dgettext(self.locale, "select_topic_keywords").split(', ');
                options.push(temp);

                body.options = options;
                json.body = JSON.stringify(body);

                self.post(json,
                    function()
                    {
                        console.log("successfully posted: " + JSON.stringify(json));
                    },
                    function(error)
                    {
                        console.log("post failed: " + JSON.stringify(json) + "\nerror code: " + error);
                    });
            }
/*          else if (body.event !== "subscribed")
            {
                console.log("Wrong message format. Unknown event.");
            } */
        }
    }
    else 
    {
        console.log('Wrong message format. No `body` found.');
    }
}


newsapp.prototype.multiplex_news = function(all_news, lengths)
{
    var multiplexed_news = [];
    for (var j = 0; j < 4; j++) {
        multiplexed_news.push(all_news[j]);
        for (var i = 1; i < lengths.length; i++) {
            multiplexed_news.push(all_news[j + lengths[i-1]]);
        }
    }
    return multiplexed_news;
}


newsapp.prototype.save_and_post = function(news, keywords, mongo) 
{
    var self = this;
    MongoClient.connect(mongo, function(err, db)
    {
        assert.equal(null, err);
        console.log("Connected successfully to the db server");
        var json = {};
        var body = {};
        body.targets = ["UI"];
        body.action = "showheadlines";
        body.heading = gt.dgettext(self.locale, "News headlines");
        var headlines = [];
        var ins_obj = {};
        ins_obj.news = news;
        self.db_upsert(db, ins_obj, "title", function()
        {
            self.db_find_news(db, keywords, self.locale, function(news) 
            {
                for (var i=0;i<news.length;i++) {
                    if (i>=20)
                        break;
                    var temp = {};
                    temp.title = news[i].title; 
//                  temp.img = "/_img/mario/news/" + ".png";
                    temp.author = news[i].author;
                    temp.published = news[i].published;
                    temp.action = "showarticle?id=" + news[i]._id;
                    temp.keywords = news[i].title.split(" ");
                    headlines.push(temp);
                }
                body.headlines = headlines;
                json.body = JSON.stringify(body);
                self.post(json,
                    function()
                    {
                        console.log("successfully posted: " + JSON.stringify(json));
                    },
                    function(error)
                    {
                        console.log("post failed: " + JSON.stringify(json) + "\nerror code: " + error);
                    });
                db.close();
            });
        });
    });
}

/**
 * \brief unsubscribe self from topic
 * \note may happen on termination or crash or exception
 *       where a subscriber using the `news_app` name exists. 
 */
newsapp.prototype.unsub_resub = function(topic)
{
    var self = this;

    self.marvin.get_subscribers(topic, function(json) {
        var exists = false;
        var subs = [];
        try
        {
            subs = JSON.parse(json);
        }
        catch (e) {
            console.log('unsub_resub/parse error: ' + e);
            console.log(json);
        }
        for (var i = 0; i < subs.length; i++) {
            if (subs[i] === self.subscriber)
            {
                exists = true;
            }
        }
        if (exists) {
            console.log('subscriber ' + self.subscriber + ' to topic ' + topic + ' exists, removing...');
            self.marvin.unsubscribe(topic, self.subscriber, function(){
                console.log('subscriber ' + self.subscriber + ' to topic ' + topic + ' removed, re-subscribing');
                self.marvin.subscribe(topic, self.subscriber, function(message){
                    self.msg_proc(message, topic);
                });
            });
        }
        else
        {
            console.log('subscriber ' + self.subscriber + ' to topic ' + topic + ' does not exist, subscribing');
            self.marvin.subscribe(topic, self.subscriber, function(message){
                self.msg_proc(message, topic);
            });
        }
    });
}

/**
 * \brief search for a topic until it's created and then subscribe to it.
 * \param topic the topic to be searched.
 * \param json array with the topics, in which we are searching.
 */
newsapp.prototype.search_n_sub = function(topic, json)
{
    var self = this;
    var topics = [];
    var exists = false;
    try {
        topics = JSON.parse(json);
    }
    catch (e) {
        console.log('init/parse error: ' +e);
        console.log(json);
    }
    for (var i = 0; i < topics.length; i++) 
    {
        if (topics[i] === topic) 
        {
            exists = true;
        }
    }
    // topic exists - (re)subscribe and process messages
    if (exists) {
        console.log('topic: ' + topic + ' exists, will try to subscribe');
        self.unsub_resub(topic);
    }
    // get the topics again until topic is found
    else {
        console.log('topic ' + topic + ' not found. Will try again in 0.1 seconds...');
        setTimeout(function() { 
            self.marvin.get_topics(function(json) { 
                self.search_n_sub(topic, json);
            }); 
        }, 100);
    }
}


///
/// \brief save to mongoDB the object with the retrieved news
/// \param db is the mongoDB to which we connected
/// \param obj is an object with properties the collections with their documents
///        that we wish to insert in the dv an array of JSON objects
newsapp.prototype.db_insert = function(db, obj, functor)
{
    for (var coll in obj)
    {
        // Get the documents collection
        var collection = db.collection(coll);
        // Insert some documents
        collection.insertMany(obj[coll], function(err, result) {
            assert.equal(err, null);
            assert.equal(obj[coll].length, result.result.n);
            assert.equal(obj[coll].length, result.ops.length);
            console.log("Inserted " + obj[coll].length +  " documents into the collection " + coll);
            functor(result);
        });
    }
}

/// \brief update or insert object to the db
/// \param db is the mongoDB to which we connected
/// \param obj is an object with properties the collections with their documents
///        that we wish to insert in the db as an array of JSON objects
/// \param prop is the property according to which the documents are going to 
/// 	be inserted or updated
newsapp.prototype.db_upsert = function(db, obj, prop, functor)
{
    for (var coll in obj)
    {
        // Get the documents collection
        var collection = db.collection(coll);
        // Insert or update some documents
        for (var i = 0; i < obj[coll].length; i++)
        {
            var filter = {};
            filter[prop] = obj[coll][i][prop];
            if (i===obj[coll].length-1)
            {
//                collection.updateOne({prop: obj[coll][i][prop]}, obj[coll][i], {upsert:true}, function(err, result) {
                collection.updateOne(filter, obj[coll][i], {upsert:true}, function(err, result) {
                    assert.equal(err, null);
                    functor(true);
                });
            }
            else
            {
                collection.updateOne(filter, obj[coll][i], {upsert:true}, function(err, result) {
                    assert.equal(err, null);
                });
            }
        }
    }
}


///
/// \brief query mongoDB for news concerning \param keyword and \param locale
/// \param functor will receive the news, an array of JSON objects
///
newsapp.prototype.db_find_news = function(db, keywords, locale, functor)
{
    // Get the documents collection
    var collection = db.collection('news');
    if (keywords.length)
    { 
        var regex_main = keywords[0];
        for (var i=1;i<keywords.length;i++)
        {
            regex_main = "|" + keywords[i];
        }
        var regex = new RegExp(".*" + regex_main + ".*");
    }
    else
        var regex = new RegExp(".*");
    collection.find({"lang": locale, $or:[{"title": regex}, {"author": regex}, {"keywords": keywords}]}).sort({_id:-1}).limit(20).toArray(function(err, docs) {
        assert.equal(err, null);
        console.log("Found " + docs.length + " news records");
        functor(docs); 
    });
}


///
/// \brief query mongoDB for topics 
/// \param functor will receive the news, an array of JSON objects
///
newsapp.prototype.db_find_topics = function(db, username, functor)
{
    // Get the documents collection
    var collection = db.collection('users');
    collection.findOne({"username": username}, {topics: true, _id: false}, function(err, docs) {
        assert.equal(err, null);
        console.log("Found " + docs.topics.length + " topic records");
        functor(docs); 
    });
}


///
/// \brief save in mongodb users from the json file users.json
///
newsapp.prototype.db_register_new_users = function(db, functor)
{
	var self = this;
    fs.readFile('users.json', 'utf8', function(err, data) {
		if (err) throw err;
		MongoClient.connect(db, function(err, db)
		{
			assert.equal(null, err);
			console.log("Connected successfully to the db server");
			var json = JSON.parse(data);
			self.db_upsert(db, json, "username", function(ok) {
				functor(ok);
			});
		});
	});
}


/**
 * \brief entry point - subscribe to taskmanager topic and register any
 * possible new user from the config json file
 */
newsapp.prototype.run = function()
{
    var self = this;
    self.marvin.get_topics(function(json) { 
        self.search_n_sub("taskmanager", json);
    });
    self.db_register_new_users(conf.mongodb, function(ok) {
        if (ok)
            console.log("users successfully saved from json file in the db");
        else
            console.log("users insertion in the db failed");
    });
}

/// exports
module.exports = newsapp;
